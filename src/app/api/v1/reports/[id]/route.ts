import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { PUBLIC_CDN_CACHE } from "@/lib/httpCache";
import { authenticatePartner, requestMeta } from "@/lib/partnerAuth";
import { buildPatch } from "@/lib/patch.mjs";
import {
  isUuid,
  RESOURCES,
  VIEW_COLUMNS,
  VIEW_FOR_TABLE,
  typeForResource,
  fuzzPersonCoords,
} from "@/lib/reports.mjs";
import {
  requireJsonContentType,
  resolveRequestId,
  errorBody,
  SERVICE_UNAVAILABLE_MESSAGE,
} from "@/lib/apiPolicy.mjs";
import type { Json } from "@/types/database.types.gen";
import { logError, logDebug } from "@/lib/log.mjs";

// /api/v1/reports/{id} — un reporte por su id global (uuid).
//
// GET: lectura ABIERTA, proyectada SIN PII (lee las vistas public_*). El id es
// global y único; se resuelve probando las 4 vistas (id es PK). La respuesta
// añade `type` (discriminador) — NUNCA va en la ruta.
//
// PATCH: modificación parcial, cerrada por API key (scope `write`). Vía RPC
// `patch_report` (UPDATE + audit before/after, atómico). NO permite cambiar
// id/source/external_id (el creador original se preserva; el editor solo queda
// en el audit). Valida el patch contra el esquema del type correcto.

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_PATCH_BODY_BYTES = 64 * 1024; // un patch es UN objeto; 64KB sobra

type Params = { params: Promise<{ id: string }> };
type ReportTable = "checkins" | "help_requests" | "help_offers" | "damaged_reports";
type ReportView = "public_checkins" | "public_help_requests" | "public_help_offers" | "public_damaged_reports";
type ReportResource = {
  table: ReportTable;
  view: ReportView;
  columns: string[];
};

// Proyecta una fila CRUDA (con PII) a sus columnas públicas + `type`. Whitelist
// por VIEW_COLUMNS → phone_private/contact/manage_token nunca salen.
function projectPublic(table: string, row: Record<string, unknown>): Record<string, unknown> {
  // VIEW_COLUMNS/VIEW_FOR_TABLE vienen de un .mjs sin tipos → TS los infiere como
  // objetos literales sin index signature. Se acotan a Record para indexar por la
  // tabla resuelta en runtime.
  const viewFor = VIEW_FOR_TABLE as Record<string, string>;
  const colsByView = VIEW_COLUMNS as Record<string, string[]>;
  const cols = colsByView[viewFor[table]] ?? [];
  // El RPC patch_report devuelve la fila base CRUDA con lat/lng EXACTAS. Para
  // tablas de personas, redondear igual que la vista pública (B3) ANTES de
  // proyectar: si no, un socio con scope write leería la coord precisa de un
  // missing_person/checkin saltándose la vista fuzzeada. Edificios = exacto.
  const fuzzed = fuzzPersonCoords(table, row) as Record<string, unknown>;
  const out: Record<string, unknown> = { type: typeForResource(table, row) };
  for (const c of cols) out[c] = fuzzed[c] ?? null;
  return out;
}

async function probeReportTable(
  svc: ReturnType<typeof getServerSupabase>,
  table: ReportTable,
  id: string,
) {
  switch (table) {
    case "checkins":
      return svc.from("checkins").select("id,status").eq("id", id).maybeSingle();
    case "help_requests":
      return svc.from("help_requests").select("id").eq("id", id).maybeSingle();
    case "help_offers":
      return svc.from("help_offers").select("id").eq("id", id).maybeSingle();
    case "damaged_reports":
      return svc.from("damaged_reports").select("id").eq("id", id).maybeSingle();
  }
}

async function probeReportView(
  svc: ReturnType<typeof getServerSupabase>,
  resource: ReportResource,
  id: string,
) {
  const select = resource.columns.join(",");
  switch (resource.view) {
    case "public_checkins":
      return svc.from("public_checkins").select(select).eq("id", id).maybeSingle();
    case "public_help_requests":
      return svc.from("public_help_requests").select(select).eq("id", id).maybeSingle();
    case "public_help_offers":
      return svc.from("public_help_offers").select(select).eq("id", id).maybeSingle();
    case "public_damaged_reports":
      return svc.from("public_damaged_reports").select(select).eq("id", id).maybeSingle();
  }
}

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "id inválido (se espera un uuid)." }, { status: 400 });
  }

  const rl = await rateLimit(await clientKey("reports:item"), { limit: 120, windowSec: 60 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  // Probar las 4 vistas públicas en paralelo (id es PK). La vista filtra hidden
  // y omite PII por construcción. Primera que devuelve fila → ese es el reporte.
  const svc = getServerSupabase();
  const resources = RESOURCES as ReportResource[];
  const lookups = await Promise.allSettled(
    resources.map((r) => probeReportView(svc, r, id))
  );

  for (let i = 0; i < lookups.length; i++) {
    const out = lookups[i];
    if (out.status === "rejected") {
      logError("report_lookup_failed", out.reason, { scope: "api.reports.id.GET", view: RESOURCES[i].view });
      return NextResponse.json({ error: SERVICE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    if (out.value.error) {
      logError("report_lookup_failed", out.value.error, { scope: "api.reports.id.GET", view: RESOURCES[i].view });
      return NextResponse.json({ error: SERVICE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    const row = out.value.data as Record<string, unknown> | null;
    if (row) {
      const table = resources[i].table;
      return NextResponse.json(
        { report: { type: typeForResource(table, row), ...row } },
        { headers: { "Cache-Control": PUBLIC_CDN_CACHE } }
      );
    }
  }

  return NextResponse.json({ error: "Reporte no encontrado." }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Params) {
  const requestId = resolveRequestId(req.headers.get("x-request-id"));
  const rid = { "x-request-id": requestId };

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json(errorBody("id inválido (se espera un uuid).", requestId), { status: 400, headers: rid });
  }

  // Auth (igual que POST): 503 en fallo de DB, 401 sin partner, 403 sin scope.
  let partner: { partnerId: string; source: string; scopes: string[] } | null;
  try {
    partner = await authenticatePartner(req.headers.get("x-api-key"));
  } catch (err) {
    logError("partner_auth_failed", err, { scope: "api.reports.id.PATCH", request_id: requestId });
    return NextResponse.json(errorBody(SERVICE_UNAVAILABLE_MESSAGE, requestId), { status: 503, headers: rid });
  }
  if (!partner) {
    return NextResponse.json(errorBody("API key inválida o ausente.", requestId), { status: 401, headers: rid });
  }
  if (!partner.scopes?.includes("write")) {
    return NextResponse.json(errorBody("La key no tiene permiso de escritura.", requestId), { status: 403, headers: rid });
  }
  const source = partner.source;

  const rl = await rateLimit(`reports:write:${source}`, { limit: 120, windowSec: 60 });
  if (!rl.ok) {
    return NextResponse.json(
      errorBody("Demasiadas solicitudes.", requestId),
      { status: 429, headers: { ...rid, "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  // Content-Type JSON (415) + guard de tamaño (un patch es un objeto chico).
  if (!requireJsonContentType(req.headers.get("content-type"))) {
    return NextResponse.json(errorBody("Content-Type debe ser application/json.", requestId), { status: 415, headers: rid });
  }
  if (Number(req.headers.get("content-length") || 0) > MAX_PATCH_BODY_BYTES) {
    return NextResponse.json(errorBody("Payload demasiado grande.", requestId), { status: 413, headers: rid });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    logDebug("report_patch_bad_json", { scope: "api.reports.id.PATCH", request_id: requestId });
    void err;
    return NextResponse.json(errorBody("Cuerpo JSON inválido.", requestId), { status: 400, headers: rid });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(errorBody("El cuerpo debe ser un objeto con los campos a modificar.", requestId), { status: 400, headers: rid });
  }

  // Resolver la tabla/type del id contra las tablas base (service key). Se usa la
  // tabla base (no la vista) para poder editar incluso filas moderadas (hidden):
  // una corrección upstream de un socio es legítima; la moderación es un flag
  // interno, no una razón para bloquear el fix. Se selecciona `id` (+ `status`
  // en checkins, que desambigua missing_person vs checkin).
  const svc = getServerSupabase();
  const resources = RESOURCES as ReportResource[];
  const probes = await Promise.allSettled(
    resources.map((r) => probeReportTable(svc, r.table, id))
  );

  let table: string | null = null;
  let resolvedType: string | null = null;
  for (let i = 0; i < probes.length; i++) {
    const out = probes[i];
    if (out.status === "rejected" || out.value.error) {
      logError("report_probe_failed", out.status === "rejected" ? out.reason : out.value.error, {
        scope: "api.reports.id.PATCH",
        request_id: requestId,
        table: RESOURCES[i].table,
      });
      return NextResponse.json(errorBody(SERVICE_UNAVAILABLE_MESSAGE, requestId), { status: 503, headers: rid });
    }
    const row = out.value.data as Record<string, unknown> | null;
    if (row) {
      table = resources[i].table;
      resolvedType = typeForResource(table, row);
      break;
    }
  }
  if (!table || !resolvedType) {
    return NextResponse.json(errorBody("Reporte no encontrado.", requestId), { status: 404, headers: rid });
  }

  // El `type` del body (si viene) es solo confirmación del discriminador; debe
  // coincidir con el type real del id. No se puede reclasificar por la ruta.
  const bodyType = (body as { type?: unknown }).type;
  if (bodyType != null && bodyType !== resolvedType) {
    return NextResponse.json(
      errorBody(`El type del body (${String(bodyType)}) no coincide con el del reporte (${resolvedType}).`, requestId),
      { status: 400, headers: rid }
    );
  }

  const patch = buildPatch(resolvedType, body) as
    | { ok: true; table: string; patch: Record<string, unknown> }
    | { ok: false; error: string };
  if (!patch.ok) {
    return NextResponse.json(errorBody(patch.error, requestId), { status: 400, headers: rid });
  }

  const meta = requestMeta(req, requestId);
  const { data, error } = await svc.rpc("patch_report", {
    p_table: table,
    p_id: id,
    p_patch: patch.patch as Json,
    p_partner: partner.partnerId,
    p_source: source,
    p_request_id: meta.requestId,
    p_ip: meta.ip ?? "",
    p_user_agent: meta.userAgent ?? "",
  });
  if (error) {
    logError("report_patch_failed", error, { scope: "api.reports.id.PATCH", request_id: requestId, table });
    return NextResponse.json(errorBody(SERVICE_UNAVAILABLE_MESSAGE, requestId), { status: 503, headers: rid });
  }
  // RPC devuelve null si la fila desapareció entre el probe y el update (carrera).
  if (!data) {
    return NextResponse.json(errorBody("Reporte no encontrado.", requestId), { status: 404, headers: rid });
  }

  // Proyectar la fila resultante SIN PII antes de responder (el RPC devuelve la
  // fila cruda con phone_private/contact).
  return NextResponse.json(
    { report: projectPublic(table, data as Record<string, unknown>), request_id: requestId },
    { status: 200, headers: rid }
  );
}
