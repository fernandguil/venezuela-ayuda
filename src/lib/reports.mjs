// Lógica de lectura del hub: mapea el `type` público (el mismo conjunto cerrado
// del ingest) a una vista `public_*` (sin PII) + filtro de status, y arma el
// cursor de paginación. Puro y testeable (`node --test`): no toca Supabase.
//
// Las vistas ya omiten phone_private/contact (ver migraciones 0006/0007/0012/0015).
// Acá nunca seleccionamos esas columnas — pedimos columnas explícitas por vista.

// type público → { view, status? }. `status` (cuando existe) se aplica como
// filtro server-side: missing_person y checkin comparten la tabla checkins y se
// separan por el status, igual que en la escritura (src/lib/ingest.mjs).
const TYPE_MAP = {
  missing_person: { view: "public_checkins", status: ["LOOKING_FOR_SOMEONE"] },
  checkin: { view: "public_checkins", status: ["SAFE", "NEEDS_HELP"] },
  help_request: { view: "public_help_requests" },
  help_offer: { view: "public_help_offers" },
  damaged_building: { view: "public_damaged_reports" },
};

export const REPORT_TYPES = Object.keys(TYPE_MAP);

// Columnas expuestas por cada vista (sin PII). Pedimos explícito en lugar de `*`
// para no filtrar nunca un campo privado si una vista cambiara.
export const VIEW_COLUMNS = {
  public_checkins: ["id", "name", "status", "city", "latitude", "longitude", "message", "photo_url", "created_at", "found_at", "place_name", "source", "source_url"],
  public_help_requests: ["id", "category", "description", "urgency", "city", "latitude", "longitude", "status", "created_at", "place_name", "items", "source", "source_url"],
  public_help_offers: ["id", "category", "description", "city", "latitude", "longitude", "availability", "available", "created_at", "source", "source_url"],
  // verified_at señala que el reporte fue verificado; verified_by se OMITE a
  // propósito — es el email del admin verificador (interno), no debe salir al API
  // público ni al /history de terceros.
  public_damaged_reports: ["id", "place_name", "description", "severity", "city", "latitude", "longitude", "photo_url", "status", "created_at", "verified_at", "source", "source_url", "risk_level", "risk_priority"],
};

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

// ── Generalización (fuzz) de coordenadas de personas (B3) ───────────────────
// Las vistas public_checkins / public_help_requests / public_help_offers
// redondean lat/lng a COORD_DP decimales (migración 202606280003) para no
// filtrar la ubicación EXACTA de una persona (desaparecido, hogar en riesgo,
// alguien ofreciendo ayuda desde su casa). Edificios (damaged_reports) quedan
// EXACTOS: son infraestructura, no personas.
//
// Estas constantes/funciones son la FUENTE ÚNICA del redondeo del lado app,
// para las rutas que NO pasan por la vista fuzzeada: el /history (audit.mjs lee
// snapshots crudos del audit_log) y el PATCH (el RPC patch_report devuelve la
// fila base cruda). Mantienen el mismo nº de decimales que la vista SQL.
export const COORD_DP = 3;

// Tablas cuyas coordenadas pertenecen a PERSONAS → se redondean. damaged_reports
// queda fuera a propósito (edificios = exacto).
export const PERSON_COORD_TABLES = new Set(["checkins", "help_requests", "help_offers"]);

// Campos de coordenada a redondear.
export const COORD_FIELDS = ["latitude", "longitude"];

// Redondea un valor de coordenada a COORD_DP decimales conservando el tipo
// number (float8 en el wire). Pasa null/undefined/no-numérico sin tocar.
export function roundCoord(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const f = 10 ** COORD_DP;
  return Math.round(value * f) / f;
}

// Devuelve una copia de `row` con lat/lng redondeadas SI `table` es de personas.
// No muta el original. Tablas de edificios y filas sin coords se devuelven igual.
export function fuzzPersonCoords(table, row) {
  if (!row || typeof row !== "object" || !PERSON_COORD_TABLES.has(table)) return row;
  const out = { ...row };
  for (const f of COORD_FIELDS) {
    if (f in out) out[f] = roundCoord(out[f]);
  }
  return out;
}

// type → { ok, view, status?, select } | { ok:false }. select es el string para
// PostgREST (columnas explícitas, csv).
export function resolveType(type) {
  const m = TYPE_MAP[type];
  if (!m) return { ok: false };
  return { ok: true, view: m.view, status: m.status ?? null, select: VIEW_COLUMNS[m.view].join(",") };
}

// ── Resolución por id global (GET/PATCH /reports/{id}) ──────────────────────
// El id de un reporte es un uuid global y único; vive en una de las 4 tablas. Se
// resuelve probando las tablas (id es PK). Estos mapas son la fuente única del
// ruteo type↔tabla↔vista compartida por lectura y escritura.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// uuid canónico (8-4-4-4-12 hex). Gate antes de tocar la DB: evita castear basura
// a uuid (error 22P02) y acota la superficie de query.
export function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

// type (wire) → tabla destino. Espeja el switch de ingest.mjs.
export const TABLE_FOR_TYPE = {
  missing_person: "checkins",
  checkin: "checkins",
  help_request: "help_requests",
  help_offer: "help_offers",
  damaged_building: "damaged_reports",
};

// tabla → vista pública (sin PII).
export const VIEW_FOR_TABLE = {
  checkins: "public_checkins",
  help_requests: "public_help_requests",
  help_offers: "public_help_offers",
  damaged_reports: "public_damaged_reports",
};

// Tablas a probar para resolver un id, con su vista y columnas públicas (reusa
// VIEW_COLUMNS → nunca incluye PII). Orden estable.
export const RESOURCES = ["checkins", "help_requests", "help_offers", "damaged_reports"].map((table) => {
  const view = VIEW_FOR_TABLE[table];
  return { table, view, columns: VIEW_COLUMNS[view] };
});

// tabla (+ fila pública) → type (wire). checkins comparte missing_person/checkin,
// se desambigua por status, igual que en lectura/escritura.
export function typeForResource(table, row) {
  if (table === "checkins") {
    return row?.status === "LOOKING_FOR_SOMEONE" ? "missing_person" : "checkin";
  }
  return { help_requests: "help_request", help_offers: "help_offer", damaged_reports: "damaged_building" }[table] ?? null;
}

// limit crudo (string|number|null) → entero acotado [1, MAX_LIMIT], default DEFAULT_LIMIT.
export function parseLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// next_cursor estable: `created_at|id` del último item, o null si la página no
// se llenó (no hay más). El id desempata cuando dos filas comparten created_at,
// para que `since` no salte ni repita filas en el límite del lote.
export function buildNextCursor(rows, limit) {
  if (!rows || rows.length < limit) return null;
  const last = rows[rows.length - 1];
  if (!last || last.created_at == null) return null;
  return `${last.created_at}|${last.id}`;
}

// Timestamp permisivo estilo Postgres/ISO-8601: `YYYY-MM-DD[ T]HH:MM:SS[.frac][tz]`.
// El tz puede ser Z, ±HH, ±HH:MM o ±HHMM. NO contiene metacaracteres de filtro
// PostgREST (paréntesis, comas), así que un valor que pase esto es seguro de
// interpolar en `created_at.gt.<v>`.
const TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/;

// Parsea el cursor `since` (sea un ISO solo, o `created_at|id`) → { createdAt, id }.
//
// SEGURIDAD: createdAt e id se interpolan crudos en un filtro `.or(...)` de
// PostgREST. Sin validar, un atacante inyecta sintaxis de filtro y altera/escapa
// el query (p.ej. saltarse el filtro de status). Por eso:
//   - createdAt DEBE ser un timestamp válido; si no, se descarta el cursor entero
//     (null → la lectura cae a la primera página, comportamiento seguro).
//   - id DEBE ser un uuid; si no, se neutraliza (id:null) sin tirar la paginación
//     por timestamp.
export function parseSince(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const [createdAt, id] = raw.split("|");
  if (!createdAt || !TIMESTAMP_RE.test(createdAt)) return null;
  return { createdAt, id: isUuid(id) ? id : null };
}
