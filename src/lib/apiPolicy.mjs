// Concerns HTTP transversales de la superficie pública del API (v1). Puro y
// testeable (`node --test`): sin dependencias de Next/Supabase. Las rutas sólo
// cablean estas decisiones; toda la lógica vive y se prueba aquí.

import { randomUUID } from "node:crypto";

// ── Content-Type enforcement ─────────────────────────────────────────────────
// POST/PATCH deben declarar JSON. Sin esto, un cliente puede mandar form-data o
// text/plain y forzar parseos ambiguos. → 415 si esto da false.
export function requireJsonContentType(header) {
  if (typeof header !== "string") return false;
  // Sólo el media type (antes del `;` de parámetros como charset), trim + lower.
  const mediaType = header.split(";")[0].trim().toLowerCase();
  return mediaType === "application/json";
}

// ── Request ID (tracing + audit_log.request_id) ──────────────────────────────
// Un trace id entrante (x-request-id) sólo se honra si es SEGURO: token acotado
// sin CRLF ni espacios → cierra header-injection (eco en la respuesta) y
// log-injection (va al audit_log). Si falta o es inseguro, generamos uno propio.
const SAFE_TRACE_ID_RE = /^[A-Za-z0-9._-]{8,200}$/;

export function resolveRequestId(incoming, gen = randomUUID) {
  if (typeof incoming === "string" && SAFE_TRACE_ID_RE.test(incoming)) return incoming;
  return gen();
}

// ── Shape de error consistente + sin leak ────────────────────────────────────
export const SERVICE_UNAVAILABLE_MESSAGE = "Servicio no disponible.";
export const DB_WRITE_FAILED_MESSAGE = "No se pudo guardar el reporte.";

// Todo error del API responde con este shape. request_id se añade si lo tenemos
// (correlación con logs/audit). NUNCA se mete el mensaje crudo de un error de DB.
/**
 * @param {string} message
 * @param {string | null} [requestId]
 * @returns {{ error: string, request_id?: string }}
 */
export function errorBody(message, requestId = null) {
  return requestId ? { error: message, request_id: requestId } : { error: message };
}

// Colapsa CUALQUIER error de escritura de DB a un mensaje genérico. El mensaje
// crudo de Postgres (nombres de constraint/tabla, SQLSTATE, fragmentos de query)
// jamás llega al cliente. Acepta (e ignora) el error crudo para que el call-site
// documente qué se está colapsando.
/**
 * @param {unknown} [rawErr]
 * @returns {string}
 */
export function safeDbError(rawErr) {
  void rawErr;
  return DB_WRITE_FAILED_MESSAGE;
}

// ── Security headers (cableados en next.config `headers()`) ───────────────────
// Sólo lo que Vercel NO pone solo (ver investigación de plataforma):
//   - HTTPS redirect (308) y HSTS base: los pone Vercel. Reforzamos HSTS con
//     includeSubDomains/preload en el dominio propio (Vercel sólo da max-age).
//   - X-Content-Type-Options: Vercel NO lo pone → lo seteamos.
//   - X-Frame-Options / Referrer-Policy: tampoco → los seteamos.
// Globales y seguros también para el sitio HTML (no rompen maps/GA).
// CSP en modo SOLO-REPORTE a propósito. El sitio carga tiles de OpenStreetMap y
// fotos desde Supabase Storage; arrancar en `Report-Only` recopila violaciones
// reales en la consola del navegador SIN bloquear nada en producción. Cuando la
// política esté afinada con esos reportes, se promueve a enforcing (renombrar la
// cabecera a `Content-Security-Policy` y, opcionalmente, añadir `report-to`).
// Es defensa-en-profundidad ante un XSS futuro (dependencia comprometida, popup de
// maplibre, markdown): React ya escapa por defecto y no hay dangerouslySetInnerHTML,
// pero hoy no hay ninguna barrera de CSP. Ajustar los orígenes (Supabase/tiles/, y
// el host de MAP_STYLE_URL si se usa MapTiler) antes de enforcing.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.tile.openstreetmap.org",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

// Extra SÓLO para /api/*: el API no usa ninguna feature de browser, así que se
// apagan todas (no se aplica al sitio para no romper el geolocation del picker).
export const API_SECURITY_HEADERS = [
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

// ── CORS del API público (cableado en next.config `headers()` → /api/v1/*) ────
// Declarativo, en la capa de plataforma. El split lectura/escritura NO lo hacemos
// en código: lo hace el browser siguiendo el algoritmo de CORS.
//   · Allow-Origin `*`: la LECTURA (GET, dato público sin credenciales) es un
//     "simple request" → ni preflight → cualquier sitio socio la lee.
//   · Allow-Methods sólo GET/OPTIONS + Allow-Headers sólo Content-Type (NUNCA
//     x-api-key): una ESCRITURA cross-origin manda la key en x-api-key → dispara
//     preflight → el browser ve que ni el método (POST/PATCH) ni el header
//     (x-api-key) están permitidos → BLOQUEA antes de mandar la request.
// El candado real del write es la API key (server-to-server); esto es la higiene
// que evita que una key se use desde un browser. Vercel pone HTTPS/HSTS/DDoS; esto
// es lo único de CORS que el API necesita declarar.
export const API_CORS_HEADERS = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type" },
];
