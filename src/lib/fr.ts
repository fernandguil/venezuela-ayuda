import "server-only";
import { logWarn } from "@/lib/log.mjs";

// Integración con el FR-API (reconocimiento facial asistivo para reunificación).
// La clave vive SOLO en el servidor; el navegador nunca la ve. Todo es asistivo:
// las coincidencias siempre requieren verificación humana.
const RAW = process.env.FR_API_URL || "https://fr-api.reportavnzla.com:8443";
export const FR_BASE = (/^https?:\/\//i.test(RAW) ? RAW : `https://${RAW}`).replace(/\/+$/, "");
export const FR_KEY = process.env.FR_API_KEY || "";
// Etiqueta de origen de esta plataforma en el índice compartido.
export const FR_SOURCE = "venezuela-ayuda.com";

export function frConfigured(): boolean {
  return Boolean(FR_KEY);
}

// Cabecera de autenticación para llamadas servidor-a-servidor.
export function frHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "X-API-Key": FR_KEY, ...(extra || {}) };
}

// Indexa una persona en el FR-API para que sea buscable/conciliable por rostro.
// Best-effort: nunca lanza (el registro no debe romperse si el FR falla) y NO
// envía datos privados (el teléfono queda fuera); solo nombre, ubicación pública
// y la URL pública de la foto (que ya es pública en el bucket).
export async function frIndexPerson(p: {
  externalId: string;
  imageUrl: string | null;
  name?: string | null;
  location?: string | null;
}): Promise<void> {
  if (!frConfigured() || !p.imageUrl) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const fd = new FormData();
    fd.append("external_id", p.externalId);
    fd.append("image_url", p.imageUrl);
    fd.append("source", FR_SOURCE);
    if (p.name) fd.append("person_name", p.name);
    if (p.location) fd.append("last_seen_location", p.location);
    const res = await fetch(`${FR_BASE}/v1/index`, {
      method: "POST",
      headers: frHeaders(),
      body: fd,
      signal: ctrl.signal,
      redirect: "error", // Never follow redirects — prevents credential leak if FR-API is compromised
    });
    // fetch NO lanza en 401/500: un FR caído o una key inválida devuelve un
    // res no-ok que, sin este chequeo, dejaría la persona sin indexar en silencio.
    if (!res.ok) {
      logWarn("fr_index_failed", { scope: "data.frIndexPerson", status: res.status });
    }
  } catch (err) {
    // Asistivo: nunca bloquea el registro. Pero SÍ dejamos rastro (timeout/abort
    // o error de red): sin este log los registros no se indexan en silencio.
    logWarn("fr_index_failed", { scope: "data.frIndexPerson" }, err);
  } finally {
    clearTimeout(timer);
  }
}
