"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAuthClient } from "@/lib/supabase/auth";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAdminEmail, isEmailAdmin, isSuperAdmin } from "@/lib/admin";
import { clientKey } from "@/lib/rateLimit";
import { generateApiKey, hashKey, parsePrefix } from "@/lib/apiAuth.mjs";
import { patchArgs, deleteArgs } from "@/lib/internalWrite.mjs";
import { buildRow, INGEST_TABLES } from "@/lib/ingest.mjs";
import { parseDump } from "@/lib/batchIngest.mjs";
import { VA_PARTNER_ID, VA_SOURCE, CHILD_STATUS } from "@/lib/canonical.mjs";
import type { Database, Json } from "@/types/database.types.gen";
import { logError, logWarn } from "@/lib/log.mjs";

export type AuthState = { error?: string };
type Result = { ok: boolean; error?: string };
type PartnerResult = Result & { key?: string; id?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODERATABLE = new Set(["checkins", "help_requests", "help_offers", "damaged_reports"]);

// Throttle durable del login (RPC 0021): hasta 8 intentos fallidos por IP en 15
// min; al superarlo, bloqueo de 15 min. Compartido entre instancias serverless.
const LOGIN_LIMIT = { p_limit: 8, p_window_sec: 900, p_lockout_sec: 900 } as const;
const MIN_PASSWORD = 12;

function emailOf(form: FormData) {
  return String(form.get("email") || "").trim().toLowerCase();
}

function lockedMsg(seconds: number) {
  return `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(seconds / 60)} min.`;
}

// --- Session -----------------------------------------------------------------
export async function adminSignIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: "Servicio no disponible." };
  const email = emailOf(form);
  const password = String(form.get("password") || "");
  if (!email || !password) return { error: "Escribe tu correo y contraseña." };

  const svc = getServerSupabase();
  const key = await clientKey("login");

  // Bloqueo durable por IP (anti fuerza bruta) ANTES de tocar el auth.
  const { data: lockedFor } = await svc.rpc("login_guard", { p_key: key });
  if (typeof lockedFor === "number" && lockedFor > 0) return { error: lockedMsg(lockedFor) };

  const auth = await getAuthClient();
  const { error } = await auth.auth.signInWithPassword({ email, password });
  if (error) {
    await svc.rpc("login_record_failure", { p_key: key, ...LOGIN_LIMIT });
    return { error: "Correo o contraseña incorrectos." };
  }

  if (!(await isEmailAdmin(email))) {
    await auth.auth.signOut();
    return { error: "Esta cuenta no tiene acceso de administrador." };
  }

  await svc.rpc("login_clear", { p_key: key }); // éxito → resetea el contador
  redirect("/admin");
}

// First-time: an allowlisted email sets its own password (created server-side
// with email pre-confirmed, so there's no email round-trip).
export async function adminSignUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: "Servicio no disponible." };
  const email = emailOf(form);
  const password = String(form.get("password") || "");
  if (!email || password.length < MIN_PASSWORD)
    return { error: `Usa una contraseña de al menos ${MIN_PASSWORD} caracteres.` };

  const svc = getServerSupabase();
  const key = await clientKey("login");
  const { data: lockedFor } = await svc.rpc("login_guard", { p_key: key });
  if (typeof lockedFor === "number" && lockedFor > 0) return { error: lockedMsg(lockedFor) };

  // Mensaje neutral: NO revela si un correo está o no en la allowlist de admins
  // (cierra el oráculo de enumeración). Los intentos no autorizados cuentan para
  // el throttle igual que un login fallido.
  const GENERIC = "No se pudo crear la cuenta. Verifica los datos o contacta a un administrador.";

  if (!(await isEmailAdmin(email))) {
    await svc.rpc("login_record_failure", { p_key: key, ...LOGIN_LIMIT });
    return { error: GENERIC };
  }

  const { error: createErr } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr && !/already|registered|exists/i.test(createErr.message)) {
    logWarn("admin_signup_create_failed", { scope: "admin.adminSignUp" }, createErr);
    return { error: GENERIC };
  }

  const auth = await getAuthClient();
  const { error: signErr } = await auth.auth.signInWithPassword({ email, password });
  if (signErr) {
    // `createErr` ⇒ la cuenta ya existía y la contraseña dada no coincide: flujo
    // esperado, no se loguea. Sólo el caso inesperado (creamos la cuenta recién y
    // aun así el sign-in falla) deja rastro.
    if (!createErr) logError("admin_signup_signin_failed", signErr, { scope: "admin.adminSignUp" });
    return {
      error: createErr
        ? "Ese correo ya tiene una cuenta. Usa Iniciar sesión."
        : GENERIC,
    };
  }
  await svc.rpc("login_clear", { p_key: key });
  redirect("/admin");
}

export async function adminSignOut() {
  const auth = await getAuthClient();
  await auth.auth.signOut();
  redirect("/admin");
}

// --- Guarded admin mutations -------------------------------------------------
async function requireAdmin(): Promise<string> {
  const email = await getAdminEmail();
  if (!email) throw new Error("No autorizado");
  return email;
}

// Stricter gate for privileged actions: managing admins, issuing API keys, and
// batch ingest. Throws unless the caller is a super-admin.
async function requireSuperAdmin(): Promise<string> {
  const email = await getAdminEmail();
  if (!email || !(await isSuperAdmin(email))) throw new Error("No autorizado");
  return email;
}

export async function verifyDamagedReport(id: string, verified: boolean): Promise<Result> {
  let email: string;
  try {
    email = await requireAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  if (!UUID_RE.test(id)) return { ok: false, error: "Id inválido." };
  const svc = getServerSupabase();
  const { error } = await svc.rpc(
    "patch_report",
    patchArgs("damaged_reports", id, {
      verified_at: verified ? new Date().toISOString() : null,
      verified_by: verified ? email : null,
    })
  );
  if (error) {
    logError("admin_verify_damaged_failed", error, { scope: "admin.verifyDamagedReport" });
    return { ok: false, error: "No se pudo actualizar." };
  }
  revalidatePath("/mapa");
  revalidatePath(`/edificio/${id}`);
  revalidatePath("/admin");
  return { ok: true };
}

// Correct partially-wrong info on a community damaged-building report (text,
// city, severity) before/after verifying it. Patches via the audited RPC.
const DAMAGE_SEVERITIES = new Set(["CRACKS", "PARTIAL", "COLLAPSE_RISK", "COLLAPSED"]);

export async function updateDamagedReport(
  id: string,
  fields: Record<string, unknown>,
): Promise<Result> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  if (!UUID_RE.test(id)) return { ok: false, error: "Id inválido." };

  const update: Record<string, unknown> = {};
  const TEXT: Record<string, number> = { place_name: 120, description: 800, city: 80 };
  for (const [k, max] of Object.entries(TEXT)) {
    if (!(k in fields)) continue;
    const v = String(fields[k] ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    if (k === "place_name" && !v)
      return { ok: false, error: "El nombre del lugar no puede quedar vacío." };
    update[k] = v || null;
  }
  if ("severity" in fields) {
    const s = String(fields.severity ?? "");
    if (!DAMAGE_SEVERITIES.has(s)) return { ok: false, error: "Severidad inválida." };
    update.severity = s;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  const svc = getServerSupabase();
  const { error } = await svc.rpc("patch_report", patchArgs("damaged_reports", id, update));
  if (error) {
    logError("admin_update_damaged_failed", error, { scope: "admin.updateDamagedReport" });
    return { ok: false, error: "No se pudo guardar." };
  }
  revalidatePath("/mapa");
  revalidatePath(`/edificio/${id}`);
  revalidatePath("/admin");
  return { ok: true };
}

export async function setHidden(table: string, id: string, hidden: boolean): Promise<Result> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  if (!MODERATABLE.has(table) || !UUID_RE.test(id))
    return { ok: false, error: "Solicitud inválida." };
  const svc = getServerSupabase();
  const { error } = await svc.rpc("patch_report", patchArgs(table, id, { hidden }));
  if (error) {
    logError("admin_set_hidden_failed", error, { scope: "admin.setHidden", table });
    return { ok: false, error: "No se pudo actualizar." };
  }
  revalidatePath("/mapa");
  revalidatePath("/buscar");
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteReport(table: string, id: string): Promise<Result> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  if (!MODERATABLE.has(table) || !UUID_RE.test(id))
    return { ok: false, error: "Solicitud inválida." };
  const svc = getServerSupabase();
  const { error } = await svc.rpc("delete_report", deleteArgs(table, id));
  if (error) {
    logError("admin_delete_report_failed", error, { scope: "admin.deleteReport", table });
    return { ok: false, error: "No se pudo eliminar." };
  }
  revalidatePath("/mapa");
  revalidatePath("/buscar");
  revalidatePath("/admin");
  return { ok: true };
}

// --- Collection centers (centros de acopio) ---------------------------------
export async function verifyCenter(id: string, verified: boolean): Promise<Result> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  if (!UUID_RE.test(id)) return { ok: false, error: "Id inválido." };
  const svc = getServerSupabase();
  const { error } = await svc.rpc("patch_report", patchArgs("collection_centers", id, { verified }));
  if (error) {
    logError("admin_verify_center_failed", error, { scope: "admin.verifyCenter" });
    return { ok: false, error: "No se pudo actualizar." };
  }
  revalidatePath("/mapa");
  revalidatePath("/ayudar-fuera");
  revalidatePath("/admin");
  return { ok: true };
}

export async function setCenterHidden(id: string, hidden: boolean): Promise<Result> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  if (!UUID_RE.test(id)) return { ok: false, error: "Id inválido." };
  const svc = getServerSupabase();
  const { error } = await svc.rpc("patch_report", patchArgs("collection_centers", id, { hidden }));
  if (error) {
    logError("admin_set_center_hidden_failed", error, { scope: "admin.setCenterHidden" });
    return { ok: false, error: "No se pudo actualizar." };
  }
  revalidatePath("/mapa");
  revalidatePath("/ayudar-fuera");
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteCenter(id: string): Promise<Result> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  if (!UUID_RE.test(id)) return { ok: false, error: "Id inválido." };
  const svc = getServerSupabase();
  const { error } = await svc.rpc("delete_report", deleteArgs("collection_centers", id));
  if (error) {
    logError("admin_delete_center_failed", error, { scope: "admin.deleteCenter" });
    return { ok: false, error: "No se pudo eliminar." };
  }
  revalidatePath("/mapa");
  revalidatePath("/ayudar-fuera");
  revalidatePath("/admin");
  return { ok: true };
}

export async function updateCenter(
  id: string,
  fields: Record<string, unknown>,
): Promise<Result> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  if (!UUID_RE.test(id)) return { ok: false, error: "Id inválido." };

  const LIMITS_BY_KEY: Record<string, number> = {
    name: 80, country: 80, state: 80, city: 80, address: 200,
    resources: 800, organizers: 80, contact: 120, website: 500,
  };
  const update: Record<string, unknown> = {};
  for (const [k, max] of Object.entries(LIMITS_BY_KEY)) {
    if (!(k in fields)) continue;
    const v = String(fields[k] ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    if ((k === "name" || k === "country") && !v)
      return { ok: false, error: "El nombre y el país no pueden quedar vacíos." };
    update[k] = v || null;
  }
  if ("can_ship_to_venezuela" in fields) {
    const v = fields.can_ship_to_venezuela;
    update.can_ship_to_venezuela = v === null || v === undefined ? null : Boolean(v);
  }
  if ("volunteers_count" in fields) {
    const n = Number(fields.volunteers_count);
    update.volunteers_count =
      Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 100000) : null;
  }
  if ("needs_volunteers" in fields) {
    const needsVol = Boolean(fields.needs_volunteers);
    update.needs_volunteers = needsVol;
    update.needs = ["centro-de-acopio", ...(needsVol ? ["voluntarios"] : [])];
  }
  if (Object.keys(update).length === 0) return { ok: true };

  const svc = getServerSupabase();
  const { error } = await svc.rpc("patch_report", patchArgs("collection_centers", id, update));
  if (error) {
    logError("admin_update_center_failed", error, { scope: "admin.updateCenter" });
    return { ok: false, error: "No se pudo guardar." };
  }
  revalidatePath("/mapa");
  revalidatePath("/ayudar-fuera");
  revalidatePath("/admin");
  return { ok: true };
}

// --- Manage admins -----------------------------------------------------------
export async function addAdmin(email: string): Promise<Result> {
  let me: string;
  try {
    me = await requireSuperAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean))
    return { ok: false, error: "Correo inválido." };
  const svc = getServerSupabase();
  const { error } = await svc
    .from("admin_emails")
    .upsert({ email: clean, added_by: me }, { onConflict: "email" });
  if (error) {
    logError("admin_add_failed", error, { scope: "admin.addAdmin" });
    return { ok: false, error: "No se pudo agregar." };
  }
  revalidatePath("/admin/admins");
  return { ok: true };
}

export async function removeAdmin(email: string): Promise<Result> {
  let me: string;
  try {
    me = await requireSuperAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  const clean = email.trim().toLowerCase();
  if (clean === me) return { ok: false, error: "No puedes quitarte a ti mismo." };
  const svc = getServerSupabase();
  const { error } = await svc.from("admin_emails").delete().eq("email", clean);
  if (error) {
    logError("admin_remove_failed", error, { scope: "admin.removeAdmin" });
    return { ok: false, error: "No se pudo quitar." };
  }
  revalidatePath("/admin/admins");
  return { ok: true };
}

// Promote/demote another admin to super-admin. Super-admin only; can't demote
// yourself (avoids locking out the last super-admin by accident).
export async function setSuperAdmin(email: string, value: boolean): Promise<Result> {
  let me: string;
  try {
    me = await requireSuperAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  const clean = email.trim().toLowerCase();
  if (clean === me && !value)
    return { ok: false, error: "No puedes quitarte el rol de super-admin a ti mismo." };
  const svc = getServerSupabase();
  const { error } = await svc
    .from("admin_emails")
    .update({ is_super_admin: value })
    .eq("email", clean);
  if (error) {
    logError("admin_set_super_failed", error, { scope: "admin.setSuperAdmin" });
    return { ok: false, error: "No se pudo actualizar el rol." };
  }
  revalidatePath("/admin/admins");
  return { ok: true };
}

// --- Manage collaborators (API partners) -------------------------------------
const SOURCE_RE = /^[a-z0-9][a-z0-9.\-]{1,80}$/; // dominio/identificador del socio

// Crea un colaborador y le emite su API key. La key se devuelve EN CLARO una
// sola vez (en la DB solo queda el hash + prefix). El `source` identifica al
// socio en cada reporte que ingrese con esta key.
export async function createPartner(input: {
  name: string;
  source: string;
  contact?: string;
}): Promise<PartnerResult> {
  try {
    await requireSuperAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  const name = String(input.name || "").trim();
  const source = String(input.source || "").trim().toLowerCase();
  const contact = String(input.contact || "").trim() || null;
  if (!name) return { ok: false, error: "Escribe el nombre del colaborador." };
  if (!SOURCE_RE.test(source))
    return { ok: false, error: "Source inválido (ej: cruzroja.org)." };

  const key = generateApiKey();
  const svc = getServerSupabase();
  const { data, error } = await svc
    .from("api_partners")
    .insert({
      name,
      source,
      key_hash: hashKey(key),
      key_prefix: parsePrefix(key),
      scopes: ["write"],
      contact,
    })
    .select("id")
    .single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, error: "Ya existe un colaborador con ese source." };
    logError("admin_create_partner_failed", error, { scope: "admin.createPartner" });
    return { ok: false, error: "No se pudo crear el colaborador." };
  }
  revalidatePath("/admin/colaboradores");
  return { ok: true, key, id: data.id }; // key visible una sola vez; id no es secreto
}

// --- Batch ingest (super-admin) ----------------------------------------------
// Ingest an external data dump (JSON / CSV / SQL INSERT statements). The dump is
// PARSED into canonical reports (never executed), validated by buildRow, and
// upserted through the SAME audited RPC as the public API. Rows are stamped with
// `source` (idempotent on (source, external_id)); audit is attributed to the hub.
const MAX_BATCH_ROWS = 2000;

type BatchResult = Result & {
  accepted?: number;
  rejected?: number;
  errored?: number;
  sample?: Array<{ external_id: string | null; status: string; error?: string }>;
};

export async function ingestBatch(input: {
  text: string;
  format?: "auto" | "json" | "csv" | "sql";
  source: string;
}): Promise<BatchResult> {
  try {
    await requireSuperAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  const source = String(input.source || "").trim().toLowerCase();
  if (!SOURCE_RE.test(source))
    return { ok: false, error: "Source inválido (ej: cruzroja-dump)." };

  let reports: unknown[];
  try {
    reports = parseDump(String(input.text || ""), input.format ?? "auto");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo leer el dump." };
  }
  if (!reports.length) return { ok: false, error: "El dump no contiene filas." };
  if (reports.length > MAX_BATCH_ROWS)
    return { ok: false, error: `Máximo ${MAX_BATCH_ROWS} filas por carga (recibidas ${reports.length}).` };

  // Validate + route + dedup intra-batch by external_id (same as /api/v1/reports).
  const results: Array<{ external_id: string | null; status: string; error?: string }> = [];
  const byTable: Record<string, Map<string, Record<string, unknown>>> = {};
  for (const rep of reports) {
    const built = buildRow(rep, source) as
      | { ok: true; table: string; row: Record<string, unknown> }
      | { ok: false; error: string };
    const extId = (rep as { external_id?: string })?.external_id ?? null;
    if (!built.ok) { results.push({ external_id: extId, status: "rejected", error: built.error }); continue; }
    (byTable[built.table] ??= new Map()).set(built.row.external_id as string, built.row);
  }

  const svc = getServerSupabase();
  const tables = (INGEST_TABLES as string[]).filter((t) => byTable[t]?.size);
  const outcomes = await Promise.allSettled(
    tables.map((t) =>
      svc.rpc("ingest_reports", {
        p_table: t,
        p_rows: [...byTable[t].values()] as Json,
        p_partner: VA_PARTNER_ID,
        p_source: source,
        p_request_id: "",
        p_ip: "",
        p_user_agent: "",
      }),
    ),
  );

  let accepted = 0;
  tables.forEach((t, i) => {
    const rows = [...byTable[t].values()];
    const o = outcomes[i];
    const dbErr = o.status === "rejected" ? o.reason : o.value.error;
    if (dbErr) {
      logError("admin_batch_ingest_failed", dbErr, { scope: "admin.ingestBatch", table: t, source });
      for (const row of rows)
        results.push({ external_id: (row.external_id as string) ?? null, status: "error", error: "Error de base de datos." });
    } else {
      accepted += rows.length;
      for (const row of rows)
        results.push({ external_id: (row.external_id as string) ?? null, status: "upserted" });
    }
  });

  const rejected = results.filter((r) => r.status === "rejected").length;
  const errored = results.filter((r) => r.status === "error").length;
  revalidatePath("/admin/ingesta");
  return {
    ok: accepted > 0 || (rejected === 0 && errored === 0),
    accepted, rejected, errored,
    sample: results.filter((r) => r.status !== "upserted").slice(0, 20),
  };
}

export async function revokePartner(id: string): Promise<Result> {
  try {
    await requireSuperAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  if (!UUID_RE.test(id)) return { ok: false, error: "Id inválido." };
  const svc = getServerSupabase();
  const { error } = await svc
    .from("api_partners")
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    logError("admin_revoke_partner_failed", error, { scope: "admin.revokePartner" });
    return { ok: false, error: "No se pudo revocar." };
  }
  revalidatePath("/admin/colaboradores");
  return { ok: true };
}

// --- Niños no acompañados (super-admin) -------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const trimOrNull = (v: FormDataEntryValue | null, max: number): string | null => {
  const s = String(v ?? "").trim().slice(0, max);
  return s.length ? s : null;
};

// Agrega un evento al historial de paradero/custodia y refresca last_custody_at
// (y el estado actual del niño, si el evento lo trae). Append-only: solo inserta.
export async function addChildCustodyEvent(_prev: Result, form: FormData): Promise<Result> {
  let email: string;
  try {
    email = await requireSuperAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }

  const childId = String(form.get("child_id") || "");
  if (!UUID_RE.test(childId)) return { ok: false, error: "Id inválido." };

  const statusRaw = String(form.get("status") || "");
  const status = ((CHILD_STATUS as string[]).includes(statusRaw)
    ? statusRaw
    : null) as Database["public"]["Enums"]["child_status"] | null;
  const eventDateRaw = trimOrNull(form.get("event_date"), 10);
  const event_date = eventDateRaw && ISO_DATE.test(eventDateRaw) ? eventDateRaw : null;
  const placement = trimOrNull(form.get("placement"), 200);
  const facility_name = trimOrNull(form.get("facility_name"), 200);
  const custodian = trimOrNull(form.get("custodian"), 80);
  const note = trimOrNull(form.get("note"), 800);
  if (!placement && !facility_name && !custodian && !note && !status)
    return { ok: false, error: "Indica al menos un dato del evento." };

  const svc = getServerSupabase();
  const { error } = await svc.from("child_custody_events").insert({
    child_id: childId,
    event_date,
    placement,
    facility_name,
    custodian,
    status,
    note,
    source: VA_SOURCE,
    recorded_by: email,
  });
  if (error) {
    logError("admin_child_custody_insert_failed", error, { scope: "admin.addChildCustodyEvent", childId });
    return { ok: false, error: "No se pudo registrar el evento." };
  }

  const patch: Database["public"]["Tables"]["unaccompanied_children"]["Update"] = {
    last_custody_at: new Date().toISOString(),
  };
  if (status) patch.status = status;
  const { error: updateErr } = await svc
    .from("unaccompanied_children")
    .update(patch)
    .eq("id", childId);
  if (updateErr) {
    logError("admin_child_custody_update_failed", updateErr, { scope: "admin.addChildCustodyEvent", childId });
  }

  revalidatePath("/admin/ninos");
  revalidatePath(`/nino/${childId}`);
  return { ok: true };
}

// Oculta / restaura un registro de niño (moderación). Usa patch_report para que
// la acción quede en audit_log con actor/before/after.
export async function setChildHidden(id: string, hidden: boolean): Promise<Result> {
  try {
    await requireSuperAdmin();
  } catch {
    return { ok: false, error: "No autorizado." };
  }
  if (!UUID_RE.test(id)) return { ok: false, error: "Id inválido." };
  const svc = getServerSupabase();
  const { error } = await svc.rpc("patch_report", patchArgs("unaccompanied_children", id, { hidden }));
  if (error) {
    logError("admin_set_child_hidden_failed", error, { scope: "admin.setChildHidden", id });
    return { ok: false, error: "No se pudo actualizar." };
  }
  revalidatePath("/admin/ninos");
  revalidatePath("/ninos");
  revalidatePath(`/nino/${id}`);
  return { ok: true };
}
