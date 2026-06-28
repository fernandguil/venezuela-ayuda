"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase/server";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { stripImageMetadata } from "@/lib/stripExif.mjs";
import {
  cleanText,
  cleanOptional,
  parseLatLng,
  parseItems,
  isValidStatus,
} from "@/lib/validation";
import {
  LIMITS,
  HELP_CATEGORIES,
  OFFER_CATEGORIES,
  URGENCY_LEVELS,
  DAMAGE_SEVERITY,
  RISK_QUESTION_IDS,
  RISK_ANSWERS,
  type RiskAnswer,
} from "@/lib/constants";
import { computeRisk, type RiskAnswers } from "@/lib/risk";
import { VA_SOURCE } from "@/lib/canonical.mjs";
import { ingestArgs, patchArgs, buildCenterRow } from "@/lib/internalWrite.mjs";
import { frIndexPerson, frDeletePerson } from "@/lib/fr";
import { logError, logWarn } from "@/lib/log.mjs";
import type { Sighting, RequestResponse } from "@/lib/types";

export type ActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

// Shared guards -------------------------------------------------------------
function notConfigured(): ActionState {
  return {
    ok: false,
    error:
      "El servicio no está disponible en este momento. Intenta de nuevo más tarde.",
  };
}

// Honeypot: a hidden field real users never fill. Bots usually do.
function isBot(form: FormData): boolean {
  return cleanText(form.get("website"), 100).length > 0;
}

// Decode a (already client-downscaled) JPEG/PNG/WebP data URL and upload it to
// the public photo bucket. Non-blocking: returns null on any problem so a failed
// upload never blocks the report itself.
async function uploadCheckinPhoto(
  supabase: ReturnType<typeof getServerSupabase>,
  id: string,
  dataUrl: FormDataEntryValue | null
): Promise<string | null> {
  if (typeof dataUrl !== "string" || !dataUrl) return null;
  const m = dataUrl.match(/^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const contentType = m[1];
  const ext = m[2] === "jpeg" ? "jpg" : m[2];
  const buffer = Buffer.from(m[3], "base64");
  if (buffer.byteLength < 100 || buffer.byteLength > 3_000_000) return null;
  // Quita EXIF/GPS/metadatos antes de subir al bucket PÚBLICO (defensa en
  // profundidad: el picker ya re-encoda, pero una subida directa no pasaría
  // por ahí y podría filtrar la ubicación exacta de quien reporta).
  const clean = stripImageMetadata(buffer, contentType);
  try {
    const path = `${id}.${ext}`;
    const { error } = await supabase.storage
      .from("checkin-photos")
      .upload(path, clean, { contentType, upsert: true });
    if (error) {
      logWarn("photo_upload_failed", { scope: "actions.uploadCheckinPhoto" }, error);
      return null;
    }
    return supabase.storage.from("checkin-photos").getPublicUrl(path).data.publicUrl ?? null;
  } catch (err) {
    logWarn("photo_upload_failed", { scope: "actions.uploadCheckinPhoto" }, err);
    return null;
  }
}

// 1. Safety check-in --------------------------------------------------------
export async function submitCheckin(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  if (!isSupabaseConfigured()) return notConfigured();
  if (isBot(form)) return { ok: true }; // silently drop

  const limited = await rateLimit(await clientKey("checkin"), { limit: 6, windowSec: 60 });
  if (!limited.ok)
    return {
      ok: false,
      error: `Demasiados envíos. Espera ${limited.retryAfterSec}s e intenta de nuevo.`,
    };

  const name = cleanText(form.get("name"), LIMITS.name);
  const status = String(form.get("status") || "SAFE");
  const coords = parseLatLng(form.get("latitude"), form.get("longitude"));

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "Escribe un nombre.";
  if (!isValidStatus(status)) fieldErrors.status = "Selecciona un estado.";
  if (status !== "SAFE" && !coords)
    fieldErrors.location = "Indica la ubicación en el mapa.";
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  // Generate the id ourselves so we don't need to read the row back. Reading it
  // back would require a SELECT policy on `checkins`, which we deliberately omit
  // so private phone numbers stay unreadable via the public key.
  const id = crypto.randomUUID();
  const manageToken = crypto.randomUUID();
  // FR indexing requires explicit consent AND must not be a third-party photo.
  // LOOKING_FOR_SOMEONE = submitter uploads a photo of someone else → never index.
  const frConsent =
    form.get("fr_consent") === "1" && status !== "LOOKING_FOR_SOMEONE";
  try {
    const supabase = getServerSupabase();
    const photoUrl = await uploadCheckinPhoto(supabase, id, form.get("photo_data"));
    // Escritura interna por la MISMA RPC del API externo (audita CREATE + atribuye
    // a venezuela-ayuda.com). El id lo generamos acá (lo necesita el path de la
    // foto y el redirect); la RPC lo inserta y lo devuelve. external_id va null →
    // (source, external_id) NULLS DISTINCT → insert, no upsert.
    const { error } = await supabase.rpc(
      "ingest_reports",
      ingestArgs("checkins", [
        {
          id,
          source: VA_SOURCE,
          name,
          status,
          city: cleanOptional(form.get("city"), LIMITS.city),
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          message: cleanOptional(form.get("message"), LIMITS.message),
          phone_private: cleanOptional(form.get("phone"), LIMITS.phone),
          place_name: cleanOptional(form.get("place_name"), LIMITS.place_name),
          photo_url: photoUrl,
          manage_token: manageToken,
          fr_consent: frConsent,
        },
      ])
    );
    if (error) throw error;

    // FR indexing: only when submitter explicitly consented and photo is their own.
    if (photoUrl && frConsent) {
      await frIndexPerson({
        externalId: id,
        imageUrl: photoUrl,
        name,
        location:
          cleanOptional(form.get("city"), LIMITS.city) ||
          cleanOptional(form.get("place_name"), LIMITS.place_name) ||
          null,
      });
    }
  } catch (err) {
    logError("checkin_submit_failed", err, { scope: "actions.submitCheckin" });
    return {
      ok: false,
      error: "No pudimos guardar tu información. Revisa tu conexión e intenta de nuevo.",
    };
  }

  revalidatePath("/buscar");
  revalidatePath("/mapa");
  redirect(`/persona/${id}?nuevo=1&t=${manageToken}`);
}

// 3. Help request -----------------------------------------------------------
export async function submitHelpRequest(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  if (!isSupabaseConfigured()) return notConfigured();
  if (isBot(form)) return { ok: true };

  const limited = await rateLimit(await clientKey("request"), { limit: 8, windowSec: 60 });
  if (!limited.ok)
    return { ok: false, error: `Demasiados envíos. Espera ${limited.retryAfterSec}s.` };

  const category = String(form.get("category") || "");
  const urgency = String(form.get("urgency") || "MEDIUM");
  const description = cleanText(form.get("description"), LIMITS.description);

  const coords = parseLatLng(form.get("latitude"), form.get("longitude"));

  const fieldErrors: Record<string, string> = {};
  if (!(category in HELP_CATEGORIES)) fieldErrors.category = "Selecciona una categoría.";
  if (!(urgency in URGENCY_LEVELS)) fieldErrors.urgency = "Selecciona la urgencia.";
  if (description.length < 5) fieldErrors.description = "Describe brevemente la necesidad.";
  if (!coords) fieldErrors.location = "Indica la ubicación en el mapa.";
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  const items = parseItems(form.get("items"));

  const id = crypto.randomUUID();
  const manageToken = crypto.randomUUID();
  try {
    const supabase = getServerSupabase();
    const { error } = await supabase.rpc(
      "ingest_reports",
      ingestArgs("help_requests", [
        {
          id,
          source: VA_SOURCE,
          category,
          description,
          urgency,
          city: cleanOptional(form.get("city"), LIMITS.city),
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          contact: cleanOptional(form.get("contact"), LIMITS.phone),
          place_name: cleanOptional(form.get("place_name"), LIMITS.place_name),
          items: items.length ? items : null,
          manage_token: manageToken,
        },
      ])
    );
    if (error) throw error;
  } catch (err) {
    logError("help_request_submit_failed", err, { scope: "actions.submitHelpRequest" });
    return {
      ok: false,
      error: "No pudimos enviar tu solicitud. Revisa tu conexión e intenta de nuevo.",
    };
  }

  revalidatePath("/mapa");
  redirect(`/solicitud/${id}?nuevo=1&t=${manageToken}`);
}

// 3b. Damaged building report ----------------------------------------------
export async function submitDamagedReport(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  if (!isSupabaseConfigured()) return notConfigured();
  if (isBot(form)) return { ok: true };

  const limited = await rateLimit(await clientKey("damaged"), { limit: 8, windowSec: 60 });
  if (!limited.ok)
    return { ok: false, error: `Demasiados envíos. Espera ${limited.retryAfterSec}s.` };

  const place_name = cleanText(form.get("place_name"), LIMITS.place_name);
  const severity = String(form.get("severity") || "");
  const coords = parseLatLng(form.get("latitude"), form.get("longitude"));

  const fieldErrors: Record<string, string> = {};
  if (place_name.length < 2)
    fieldErrors.place_name = "Escribe el nombre del edificio o lugar.";
  if (!(severity in DAMAGE_SEVERITY)) fieldErrors.severity = "Selecciona la gravedad.";
  if (!coords) fieldErrors.location = "Indica la ubicación en el mapa.";

  // Optional structural-risk questionnaire. When enabled, all questions are
  // required and the result is computed server-side (never trust the client).
  const riskEnabled = form.get("risk_enabled") === "1";
  const validAnswers = new Set(RISK_ANSWERS.map((a) => a.value));
  let riskAnswers: RiskAnswers | null = null;
  if (riskEnabled) {
    const collected: RiskAnswers = {};
    let complete = true;
    for (const qid of RISK_QUESTION_IDS) {
      const v = String(form.get(`risk_${qid}`) || "");
      if (validAnswers.has(v as RiskAnswer)) collected[qid] = v as RiskAnswer;
      else complete = false;
    }
    if (!complete)
      fieldErrors.risk = "Responde todas las preguntas del cuestionario.";
    else riskAnswers = collected;
  }

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  const risk = riskAnswers ? computeRisk(riskAnswers) : null;

  const id = crypto.randomUUID();
  const manageToken = crypto.randomUUID();
  try {
    const supabase = getServerSupabase();
    const photoUrl = await uploadCheckinPhoto(supabase, id, form.get("photo_data"));
    const { error } = await supabase.rpc(
      "ingest_reports",
      ingestArgs("damaged_reports", [
        {
          id,
          source: VA_SOURCE,
          place_name,
          description: cleanOptional(form.get("description"), LIMITS.description),
          severity,
          city: cleanOptional(form.get("city"), LIMITS.city),
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          contact: cleanOptional(form.get("contact"), LIMITS.phone),
          photo_url: photoUrl,
          manage_token: manageToken,
          risk_level: risk?.level ?? null,
          risk_priority: risk?.priority ?? null,
          risk_answers: riskAnswers,
        },
      ])
    );
    if (error) throw error;
  } catch (err) {
    logError("damaged_report_submit_failed", err, { scope: "actions.submitDamagedReport" });
    return {
      ok: false,
      error: "No pudimos enviar el reporte. Revisa tu conexión e intenta de nuevo.",
    };
  }

  revalidatePath("/mapa");
  redirect(`/edificio/${id}?nuevo=1&t=${manageToken}`);
}

// 4. Help offer -------------------------------------------------------------
export async function submitHelpOffer(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  if (!isSupabaseConfigured()) return notConfigured();
  if (isBot(form)) return { ok: true };

  const limited = await rateLimit(await clientKey("offer"), { limit: 8, windowSec: 60 });
  if (!limited.ok)
    return { ok: false, error: `Demasiados envíos. Espera ${limited.retryAfterSec}s.` };

  const category = String(form.get("category") || "");
  const fieldErrors: Record<string, string> = {};
  if (!(category in OFFER_CATEGORIES)) fieldErrors.category = "Selecciona qué puedes ofrecer.";
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  const coords = parseLatLng(form.get("latitude"), form.get("longitude"));
  const city = cleanOptional(form.get("city"), LIMITS.city);

  try {
    const supabase = getServerSupabase();
    const { error } = await supabase.rpc(
      "ingest_reports",
      ingestArgs("help_offers", [
        {
          source: VA_SOURCE,
          category,
          description: cleanOptional(form.get("description"), LIMITS.description),
          city,
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          availability: cleanOptional(form.get("availability"), LIMITS.availability),
          contact: cleanOptional(form.get("contact"), LIMITS.phone),
        },
      ])
    );
    if (error) throw error;
  } catch (err) {
    logError("help_offer_submit_failed", err, { scope: "actions.submitHelpOffer" });
    return {
      ok: false,
      error: "No pudimos enviar tu oferta. Revisa tu conexión e intenta de nuevo.",
    };
  }

  revalidatePath("/mapa");
  // Route the volunteer straight to matching requests near them.
  const q = new URLSearchParams({ desde: "oferta", cat: category });
  if (coords) {
    q.set("lat", String(coords.lat));
    q.set("lng", String(coords.lng));
  }
  if (city) q.set("ciudad", city);
  redirect(`/solicitudes?${q.toString()}`);
}

// 5. Reporter-managed resolution -------------------------------------------
async function verifyManageToken(
  table: "checkins" | "help_requests" | "damaged_reports",
  id: string,
  token: string
): Promise<boolean> {
  if (!token) return false;
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from(table)
    .select("manage_token")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logWarn("manage_token_read_failed", { scope: "actions.verifyManageToken", table }, error);
    return false;
  }
  if (!data) return false;
  return data.manage_token != null && data.manage_token === token;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function markCheckinFound(
  id: string,
  token: string,
  found: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Servicio no disponible." };
  const limited = await rateLimit(await clientKey("manage"), { limit: 20, windowSec: 60 });
  if (!limited.ok)
    return { ok: false, error: `Demasiados intentos. Espera ${limited.retryAfterSec}s.` };
  if (!UUID_RE.test(id) || !token) return { ok: false, error: "No autorizado." };
  if (!(await verifyManageToken("checkins", id, token)))
    return { ok: false, error: "No autorizado." };
  try {
    const supabase = getServerSupabase();
    const { error } = await supabase.rpc(
      "patch_report",
      patchArgs("checkins", id, {
        found_at: found ? new Date().toISOString() : null,
      })
    );
    if (error) throw error;
  } catch (err) {
    logError("checkin_mark_found_failed", err, { scope: "actions.markCheckinFound" });
    return { ok: false, error: "No se pudo actualizar. Intenta de nuevo." };
  }
  revalidatePath("/mapa");
  revalidatePath("/buscar");
  revalidatePath(`/persona/${id}`);
  return { ok: true };
}

export async function resolveHelpRequest(
  id: string,
  token: string,
  resolved: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Servicio no disponible." };
  const limited = await rateLimit(await clientKey("manage"), { limit: 20, windowSec: 60 });
  if (!limited.ok)
    return { ok: false, error: `Demasiados intentos. Espera ${limited.retryAfterSec}s.` };
  if (!UUID_RE.test(id) || !token) return { ok: false, error: "No autorizado." };
  if (!(await verifyManageToken("help_requests", id, token)))
    return { ok: false, error: "No autorizado." };
  try {
    const supabase = getServerSupabase();
    const { error } = await supabase.rpc(
      "patch_report",
      patchArgs("help_requests", id, { status: resolved ? "RESOLVED" : "OPEN" })
    );
    if (error) throw error;
  } catch (err) {
    logError("help_request_resolve_failed", err, { scope: "actions.resolveHelpRequest" });
    return { ok: false, error: "No se pudo actualizar. Intenta de nuevo." };
  }
  revalidatePath("/mapa");
  revalidatePath("/buscar");
  revalidatePath(`/solicitud/${id}`);
  return { ok: true };
}

export async function resolveDamagedReport(
  id: string,
  token: string,
  resolved: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Servicio no disponible." };
  const limited = await rateLimit(await clientKey("manage"), { limit: 20, windowSec: 60 });
  if (!limited.ok)
    return { ok: false, error: `Demasiados intentos. Espera ${limited.retryAfterSec}s.` };
  if (!UUID_RE.test(id) || !token) return { ok: false, error: "No autorizado." };
  if (!(await verifyManageToken("damaged_reports", id, token)))
    return { ok: false, error: "No autorizado." };
  try {
    const supabase = getServerSupabase();
    const { error } = await supabase.rpc(
      "patch_report",
      patchArgs("damaged_reports", id, { status: resolved ? "RESOLVED" : "OPEN" })
    );
    if (error) throw error;
  } catch (err) {
    logError("damaged_report_resolve_failed", err, { scope: "actions.resolveDamagedReport" });
    return { ok: false, error: "No se pudo actualizar. Intenta de nuevo." };
  }
  revalidatePath("/mapa");
  revalidatePath("/buscar");
  revalidatePath(`/edificio/${id}`);
  return { ok: true };
}

// Withdraws FR consent and removes the checkin from the facial-recognition index.
// Requires the manage token so only the original submitter can opt out.
// fr.ts calls are best-effort — the DB flag is cleared regardless of FR API outcome.
export async function removeFrIndex(
  id: string,
  token: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Servicio no disponible." };
  const limited = await rateLimit(await clientKey("manage"), { limit: 20, windowSec: 60 });
  if (!limited.ok)
    return { ok: false, error: `Demasiados intentos. Espera ${limited.retryAfterSec}s.` };
  if (!UUID_RE.test(id) || !token) return { ok: false, error: "No autorizado." };
  if (!(await verifyManageToken("checkins", id, token)))
    return { ok: false, error: "No autorizado." };
  // Best-effort: delete from the FR index. A 404 (never indexed or already removed)
  // is treated as success inside frDeletePerson — the outcome is the same.
  await frDeletePerson(id);
  try {
    const supabase = getServerSupabase();
    const { error } = await supabase.rpc(
      "patch_report",
      patchArgs("checkins", id, { fr_consent: false })
    );
    if (error) throw error;
  } catch (err) {
    logError("fr_opt_out_failed", err, { scope: "actions.removeFrIndex" });
    return { ok: false, error: "No se pudo actualizar. Intenta de nuevo." };
  }
  revalidatePath(`/persona/${id}`);
  return { ok: true };
}

// --- Sightings (relay) -------------------------------------------------------
// Anyone who recognizes a missing person can leave a sighting with THEIR own
// contact. Only the original reporter (with the manage token) can read them.
export async function submitSighting(
  checkinId: string,
  finderName: string,
  finderContact: string,
  message: string,
  website = ""
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Servicio no disponible." };
  if (cleanText(website, 100)) return { ok: true }; // honeypot
  const limited = await rateLimit(await clientKey("sighting"), { limit: 10, windowSec: 60 });
  if (!limited.ok) return { ok: false, error: `Espera ${limited.retryAfterSec}s.` };
  if (!UUID_RE.test(checkinId)) return { ok: false, error: "Solicitud inválida." };

  const name = cleanText(finderName, LIMITS.name);
  const contact = cleanText(finderContact, LIMITS.phone);
  const msg = cleanText(message, LIMITS.message);
  if (!contact && !msg) return { ok: false, error: "Deja un contacto o un mensaje." };

  try {
    const supabase = getServerSupabase();
    // Relays only apply to reports created on this site (which have a manage
    // token). External reports point people to the original source instead.
    const { data: c, error: cErr } = await supabase
      .from("checkins")
      .select("status, found_at, source")
      .eq("id", checkinId)
      .maybeSingle();
    if (cErr) logWarn("sighting_probe_failed", { scope: "actions.submitSighting" }, cErr);
    if (!c || c.status !== "LOOKING_FOR_SOMEONE" || c.found_at || c.source)
      return { ok: false, error: "Este reporte no acepta avisos." };

    const { error } = await supabase.from("sightings").insert({
      checkin_id: checkinId,
      finder_name: name || null,
      finder_contact: contact || null,
      message: msg || null,
    });
    if (error) throw error;
  } catch (err) {
    logError("sighting_submit_failed", err, { scope: "actions.submitSighting" });
    return { ok: false, error: "No se pudo enviar. Intenta de nuevo." };
  }
  return { ok: true };
}

export async function fetchSightings(
  checkinId: string,
  token: string
): Promise<{ ok: boolean; sightings?: Sighting[]; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Servicio no disponible." };
  if (!UUID_RE.test(checkinId) || !token) return { ok: false, error: "No autorizado." };
  if (!(await verifyManageToken("checkins", checkinId, token)))
    return { ok: false, error: "No autorizado." };
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("sightings")
    .select("id, finder_name, finder_contact, message, created_at")
    .eq("checkin_id", checkinId)
    .order("created_at", { ascending: false });
  if (error) logWarn("sightings_read_failed", { scope: "actions.fetchSightings" }, error);
  return { ok: true, sightings: (data ?? []) as Sighting[] };
}

// --- Volunteer responses to help requests (relay) ----------------------------
// Mirrors sightings: a volunteer leaves THEIR contact; only the requester (with
// the manage token) can read it.
export async function respondToRequest(
  requestId: string,
  responderName: string,
  responderContact: string,
  message: string,
  website = ""
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Servicio no disponible." };
  if (cleanText(website, 100)) return { ok: true }; // honeypot
  const limited = await rateLimit(await clientKey("respond"), { limit: 10, windowSec: 60 });
  if (!limited.ok) return { ok: false, error: `Espera ${limited.retryAfterSec}s.` };
  if (!UUID_RE.test(requestId)) return { ok: false, error: "Solicitud inválida." };

  const name = cleanText(responderName, LIMITS.name);
  const contact = cleanText(responderContact, LIMITS.phone);
  const msg = cleanText(message, LIMITS.message);
  if (!contact && !msg) return { ok: false, error: "Deja un contacto o un mensaje." };

  try {
    const supabase = getServerSupabase();
    // Relays only apply to requests created on this site (which have a manage
    // token). External/ingested requests point people to the original source.
    const { data: r, error: rErr } = await supabase
      .from("help_requests")
      .select("status, source")
      .eq("id", requestId)
      .maybeSingle();
    if (rErr) logWarn("response_probe_failed", { scope: "actions.respondToRequest" }, rErr);
    if (!r || r.status === "RESOLVED" || r.source)
      return { ok: false, error: "Esta solicitud no acepta respuestas." };

    const { error } = await supabase.from("request_responses").insert({
      request_id: requestId,
      responder_name: name || null,
      responder_contact: contact || null,
      message: msg || null,
    });
    if (error) throw error;
  } catch (err) {
    logError("response_submit_failed", err, { scope: "actions.respondToRequest" });
    return { ok: false, error: "No se pudo enviar. Intenta de nuevo." };
  }
  return { ok: true };
}

export async function fetchRequestResponses(
  requestId: string,
  token: string
): Promise<{ ok: boolean; responses?: RequestResponse[]; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Servicio no disponible." };
  if (!UUID_RE.test(requestId) || !token) return { ok: false, error: "No autorizado." };
  if (!(await verifyManageToken("help_requests", requestId, token)))
    return { ok: false, error: "No autorizado." };
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("request_responses")
    .select("id, responder_name, responder_contact, message, created_at")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false });
  if (error) logWarn("responses_read_failed", { scope: "actions.fetchRequestResponses" }, error);
  return { ok: true, responses: (data ?? []) as RequestResponse[] };
}

// Postular un centro de acopio (público) → entra sin verificar (oculto hasta que
// un admin lo apruebe). El contacto de un centro SÍ es público (es una organización).
export async function submitCollectionCenter(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  if (!isSupabaseConfigured()) return notConfigured();
  if (isBot(form)) return { ok: true };

  const limited = await rateLimit(await clientKey("center"), { limit: 5, windowSec: 60 });
  if (!limited.ok)
    return { ok: false, error: `Demasiados envíos. Espera ${limited.retryAfterSec}s.` };

  const name = cleanOptional(form.get("name"), LIMITS.name);
  const country = cleanOptional(form.get("country"), LIMITS.city);
  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Indica el nombre del centro.";
  if (!country) fieldErrors.country = "Indica el país.";
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  const coords = parseLatLng(form.get("latitude"), form.get("longitude"));
  const ship = String(form.get("can_ship_to_venezuela") || "");
  const canShip = ship === "si" ? true : ship === "no" ? false : null;
  const needsVolunteers = form.get("needs_volunteers") === "si";
  const volRaw = parseInt(String(form.get("volunteers_count") || ""), 10);
  const volunteersCount =
    Number.isFinite(volRaw) && volRaw >= 0 ? Math.min(volRaw, 100000) : null;

  try {
    const supabase = getServerSupabase();
    // Insert vía la MISMA RPC (audita CREATE). collection_centers no tiene
    // external_id → la RPC hace insert simple por id. `source: 'user'` (origen de
    // la fila) lo pone buildCenterRow; la atribución del actor (venezuela-ayuda.com)
    // viaja aparte en el audit.
    const { error } = await supabase.rpc(
      "ingest_reports",
      ingestArgs("collection_centers", [
        buildCenterRow({
          name,
          country,
          state: cleanOptional(form.get("state"), LIMITS.city),
          city: cleanOptional(form.get("city"), LIMITS.city),
          address: cleanOptional(form.get("address"), 200),
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          resources: cleanOptional(form.get("resources"), LIMITS.description),
          organizers: cleanOptional(form.get("organizers"), LIMITS.name),
          contact: cleanOptional(form.get("contact"), 120),
          website: cleanOptional(form.get("website"), 500),
          can_ship_to_venezuela: canShip,
          volunteers_count: volunteersCount,
          needs_volunteers: needsVolunteers,
          manage_token: crypto.randomUUID(),
        }),
      ])
    );
    if (error) throw error;
  } catch (err) {
    logError("collection_center_submit_failed", err, { scope: "actions.submitCollectionCenter" });
    return {
      ok: false,
      error: "No pudimos enviar el centro. Revisa tu conexión e intenta de nuevo.",
    };
  }

  return { ok: true };
}
