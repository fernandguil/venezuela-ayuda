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
import { VA_PARTNER_ID } from "@/lib/canonical.mjs";
import type { Json } from "@/types/database.types.gen";
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
  const fail = async () => {
    await svc.rpc("login_record_failure", { p_key: key, ...LOGIN_LIMIT });
    return { error: GENERIC };
  };

  // Cierre del oráculo de TIMING (B5, ronda 2): NO hacemos short-circuit por
  // allowlist antes del auth. Todo correo —esté o no en la allowlist— paga el
  // mismo round-trip a GoTrue + verificación bcrypt vía signInWithPassword. Así
  // el tiempo de respuesta deja de depender de la pertenencia a la allowlist.
  const auth = await getAuthClient();
  const { error: signErr } = await auth.auth.signInWithPassword({ email, password });
  if (!signErr) {
    // La cuenta ya existe y la contraseña coincide. La decisión de admin se toma
    // AL FINAL (igual que adminSignIn): un correo válido no-admin recibe la misma
    // respuesta genérica, sin revelar que la cuenta existe.
    if (!(await isEmailAdmin(email))) {
      await auth.auth.signOut();
      return fail();
    }
    await svc.rpc("login_clear", { p_key: key });
    redirect("/admin");
  }

  // Sign-in falló: la cuenta no existe o la contraseña no coincide. Sólo a partir
  // de aquí distinguimos por allowlist. Igualamos un segundo round-trip de auth en
  // AMBAS ramas para reducir la señal de timing por pertenencia a la allowlist.
  //
  // Limitación conocida (B5): la rama allowlist usa svc.auth.admin.createUser
  // (endpoint admin/v1/users + bcrypt-HASH al crear), mientras el padding de la
  // rama no-allowlist usa un signInWithPassword dummy (bcrypt-VERIFY, y solo si la
  // cuenta existe). Son costes de orden similar pero NO idénticos: queda un residuo
  // de timing entre ambos endpoints que no es eliminable sin mover toda la lógica a
  // una RPC server-side de tiempo constante, fuera del alcance mínimo de B5. El
  // oráculo POR MENSAJE/STATUS sí queda cerrado (respuesta GENERIC indistinguible).
  if (!(await isEmailAdmin(email))) {
    // Padding de coste: sign-in dummy con contraseña aleatoria, para aproximar el
    // segundo round-trip de auth que el camino allowlist gasta en createUser.
    await auth.auth.signInWithPassword({ email, password: generateApiKey() });
    return fail();
  }

  const { error: createErr } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  // Detección ESTRUCTURADA de "la cuenta ya existe" vía el código de error de la
  // API (no por regex sobre el mensaje, que cambia entre versiones). Si ya existe,
  // significa que el sign-in de arriba falló por contraseña incorrecta: respuesta
  // genérica INDISTINGUIBLE, sin revelar que el correo ya tenía cuenta.
  if (createErr) {
    const ALREADY_EXISTS = new Set(["email_exists", "user_already_exists"]);
    if (!ALREADY_EXISTS.has(createErr.code ?? ""))
      logWarn("admin_signup_create_failed", { scope: "admin.adminSignUp" }, createErr);
    return fail();
  }

  // Cuenta recién creada para un admin allowlisted: iniciamos sesión.
  const { error: postCreateErr } = await auth.auth.signInWithPassword({ email, password });
  if (postCreateErr) {
    // Caso inesperado: creamos la cuenta y aun así el sign-in falla. Se loguea
    // porque no es un flujo esperado; la respuesta sigue siendo genérica.
    logError("admin_signup_signin_failed", postCreateErr, { scope: "admin.adminSignUp" });
    return fail();
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
