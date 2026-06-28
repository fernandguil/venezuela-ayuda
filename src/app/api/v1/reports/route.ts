import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { PUBLIC_CDN_CACHE } from "@/lib/httpCache";
import { authenticatePartner, requestMeta } from "@/lib/partnerAuth";
import { buildRow, INGEST_TABLES } from "@/lib/ingest.mjs";
import {
  resolveType,
  parseLimit,
  parseSince,
  buildNextCursor,
} from "@/lib/reports.mjs";
import {
  requireJsonContentType,
  resolveRequestId,
  errorBody,
  safeDbError,
  SERVICE_UNAVAILABLE_MESSAGE,
} from "@/lib/apiPolicy.mjs";
import type { Json } from "@/types/database.types.gen";
import { logError, logDebug } from "@/lib/log.mjs";

// Recurso único `reports` del hub central (v1).
//
// GET (abajo): LECTURA de la colección. ABIERTA (sin API key) para maximizar
// difusión; rate-limit best-effort por IP. Lee solo de las vistas `public_*`
// (sin PII — phone_private/contact nunca se exponen), nunca de las tablas crudas.
//
// POST (abajo): CREAR reportes (batch). Cerrado por API key (scope `write`);
// escribe con el service key vía RPC `ingest_reports` (upsert idempotente +
// audit CREATE, atómico por tabla). El `source` se estampa desde la key.
//
// CORS (lectura abierta `*`, escritura cerrada) se declara en next.config
// (API_CORS_HEADERS) y lo enforza el browser vía preflight — no en este código.
//
// El `type` es el MISMO conjunto cerrado en lectura y escritura (missing_person,
// checkin, help_request, help_offer, damaged_building). Paginación por cursor
// estable: `since` (created_at|id) + orden created_at asc, desempate por id.

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BATCH = 200;
const MAX_BODY_BYTES = 512 * 1024; // req.json() bufferea todo el body antes del cap de batch

export async function GET(req: Request) {
  // Rate-limit best-effort por IP (lectura abierta; el límite blunt-ea abuso).
  const rl = await rateLimit(await clientKey("reports"), { limit: 120, windowSec: 60 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const url = new URL(req.url);
  const resolved = resolveType(url.searchParams.get("type") ?? "");
  if (!resolved.ok) {
    return NextResponse.json(
      { error: "Parámetro 'type' inválido o ausente. Valores: missing_person, checkin, help_request, help_offer, damaged_building." },
      { status: 400 }
    );
  }

  const limit = parseLimit(url.searchParams.get("limit"));
  const since = parseSince(url.searchParams.get("since"));
  const city = url.searchParams.get("city")?.trim() || null;

  // Lectura por la vista pública. Columnas explícitas (resolved.select) → nunca
  // un campo privado. Orden estable created_at asc, desempate por id.
  const svc = getServerSupabase();
  let query = svc
    .from(resolved.view)
    .select(resolved.select)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);

  // missing_person/checkin comparten la vista public_checkins; se separan por status.
  if (resolved.status) query = query.in("status", resolved.status);

  // Cursor keyset: created_at > c OR (created_at = c AND id > cid). parseSince ya
  // validó createdAt (timestamp) e id (uuid) → seguro de interpolar (sin id cae a
  // un gt simple).
  if (since) {
    if (since.id) {
      query = query.or(
        `created_at.gt.${since.createdAt},and(created_at.eq.${since.createdAt},id.gt.${since.id})`
      );
    } else {
      query = query.gt("created_at", since.createdAt);
    }
  }

  if (city) query = query.ilike("city", `%${city}%`);

  const { data, error } = await query;
  if (error) {
    logError("reports_read_failed", error, { scope: "api.reports.GET", view: resolved.view });
    return NextResponse.json({ error: SERVICE_UNAVAILABLE_MESSAGE }, { status: 503 });
  }

  // Cache en el Edge de Vercel sólo en el camino feliz (200). Los errores
  // (400/429/503) ya retornaron arriba sin Cache-Control, a propósito.
  const reports = data ?? [];
  return NextResponse.json(
    { reports, next_cursor: buildNextCursor(reports, limit) },
    { headers: { "Cache-Control": PUBLIC_CDN_CACHE } }
  );
}

type IngestStatus = "upserted" | "rejected" | "error";
type IngestResult = { external_id: string | null; status: IngestStatus; error?: string; report_id?: string };
// buildRow es JS (.mjs); tipamos su retorno acá para que el narrowing por `ok` funcione.
type Built = { ok: true; table: string; row: Record<string, unknown> } | { ok: false; error: string };

// POST /api/v1/reports — crear reportes (batch). Cerrado por API key (scope
// `write`). Cada tabla del lote se escribe vía un RPC `ingest_reports` que hace
// upsert idempotente por (source, external_id) + audit CREATE de cada fila, todo
// en UNA transacción → la mutación y su rastro de auditoría son atómicos.
export async function POST(req: Request) {
  // request-id: se honra uno entrante (seguro) o se genera; va al audit_log y se
  // hace eco en TODAS las respuestas (correlación cliente↔logs↔audit).
  const requestId = resolveRequestId(req.headers.get("x-request-id"));
  const rid = { "x-request-id": requestId };

  // Auth. Un fallo de DB en el lookup → 503 (fail closed), nunca 200/escritura.
  let partner: { partnerId: string; source: string; scopes: string[] } | null;
  try {
    partner = await authenticatePartner(req.headers.get("x-api-key"));
  } catch (err) {
    logError("partner_auth_failed", err, { scope: "api.reports.POST", request_id: requestId });
    return NextResponse.json(errorBody(SERVICE_UNAVAILABLE_MESSAGE, requestId), { status: 503, headers: rid });
  }
  if (!partner) {
    return NextResponse.json(errorBody("API key inválida o ausente.", requestId), { status: 401, headers: rid });
  }
  if (!partner.scopes?.includes("write")) {
    return NextResponse.json(errorBody("La key no tiene permiso de escritura.", requestId), { status: 403, headers: rid });
  }
  const source = partner.source;

  // Content-Type y tamaño antes del rate-limit: requests malformados no consumen
  // el cupo legítimo del socio.
  if (!requireJsonContentType(req.headers.get("content-type"))) {
    return NextResponse.json(
      errorBody("Content-Type debe ser application/json.", requestId),
      { status: 415, headers: rid }
    );
  }
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return NextResponse.json(errorBody("Payload demasiado grande.", requestId), { status: 413, headers: rid });
  }

  // Rate-limit best-effort por socio (por-lambda; el tope de batch es el backstop real).
  const rl = await rateLimit(`reports:write:${source}`, { limit: 120, windowSec: 60 });
  if (!rl.ok) {
    return NextResponse.json(
      errorBody("Demasiadas solicitudes.", requestId),
      { status: 429, headers: { ...rid, "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let reports: unknown;
  try {
    reports = ((await req.json()) as { reports?: unknown })?.reports;
  } catch (err) {
    // Body malformado = error del cliente (400, no silencioso). Sólo en debug
    // para no dar amplificación de logs a requests basura.
    logDebug("reports_bad_json", { scope: "api.reports.POST", request_id: requestId });
    void err;
    return NextResponse.json(errorBody("Cuerpo JSON inválido.", requestId), { status: 400, headers: rid });
  }
  if (!Array.isArray(reports)) {
    return NextResponse.json(errorBody("Falta el arreglo 'reports'.", requestId), { status: 400, headers: rid });
  }
  if (reports.length > MAX_BATCH) {
    return NextResponse.json(errorBody(`Máximo ${MAX_BATCH} reportes por solicitud.`, requestId), { status: 413, headers: rid });
  }

  // Validar + rutear. Dedup intra-batch por external_id (el source es constante
  // en el request): Postgres ON CONFLICT no puede tocar la misma fila objetivo
  // dos veces en un comando, así que un external_id repetido en el lote abortaría
  // el upsert entero. Last-wins, coherente con la intención idempotente.
  const results: IngestResult[] = [];
  const byTable: Record<string, Map<string, Record<string, unknown>>> = {};
  for (const rep of reports) {
    const built = buildRow(rep, source) as Built;
    const extId = (rep as { external_id?: string })?.external_id ?? null;
    if (!built.ok) {
      results.push({ external_id: extId, status: "rejected", error: built.error });
      continue;
    }
    (byTable[built.table] ??= new Map()).set(built.row.external_id as string, built.row);
  }

  // Upsert + audit por tabla en paralelo (≤4) vía RPC atómico. Cada RPC es UNA
  // transacción (upsert idempotente + audit CREATE de cada fila): atómico por
  // tabla → se preserva la semántica de éxito-parcial-por-tabla del endpoint.
  const svc = getServerSupabase();
  const meta = requestMeta(req, requestId);
  const tables = (INGEST_TABLES as string[]).filter((t) => byTable[t]?.size);
  const outcomes = await Promise.allSettled(
    tables.map((t) =>
      svc.rpc("ingest_reports", {
        p_table: t,
        p_rows: [...byTable[t].values()] as Json,
        p_partner: partner!.partnerId,
        p_source: source,
        p_request_id: meta.requestId,
        p_ip: meta.ip ?? "",
        p_user_agent: meta.userAgent ?? "",
      })
    )
  );

  let accepted = 0;
  let dbErrors = 0;
  tables.forEach((t, i) => {
    const rows = [...byTable[t].values()];
    const outcome = outcomes[i];
    // Error de DB → mensaje GENÉRICO. El texto crudo de Postgres (constraint,
    // SQLSTATE, fragmentos de query) jamás llega al cliente (safeDbError).
    const rawDbError =
      outcome.status === "rejected"
        ? outcome.reason
        : outcome.value.error
          ? outcome.value.error
          : null;
    const dbError = rawDbError ? safeDbError(rawDbError) : null;
    if (dbError) {
      // El cliente sólo ve el mensaje genérico (safeDbError); el crudo va al log
      // server-side para que un fallo de escritura sea visible al operador.
      logError("reports_write_failed", rawDbError, {
        scope: "api.reports.POST",
        request_id: requestId,
        table: t,
      });
      dbErrors++;
      for (const row of rows) results.push({ external_id: (row.external_id as string) ?? null, status: "error", error: dbError });
    } else {
      accepted += rows.length;
      // El RPC devuelve los ids upserted EN EL MISMO ORDEN que rows (= p_rows) →
      // zip posicional rows[k] ↔ ids[k].
      const ids = (outcome.status === "fulfilled" ? (outcome.value.data as string[] | null) : null) ?? [];
      rows.forEach((row, k) =>
        results.push({ external_id: (row.external_id as string) ?? null, status: "upserted", report_id: ids[k] })
      );
    }
  });

  const rejected = results.filter((r) => r.status === "rejected").length;
  const errored = results.filter((r) => r.status === "error").length;
  // Falla total de DB (nada aceptado, hubo errores de DB) → 503 para que el
  // cliente reintente. Rechazos de validación NO disparan 503 (no son retryables).
  const httpStatus = dbErrors > 0 && accepted === 0 ? 503 : 200;
  return NextResponse.json(
    { accepted, rejected, errored, results, request_id: requestId },
    { status: httpStatus, headers: rid }
  );
}
