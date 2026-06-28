// Proyección PÚBLICA del audit trail (GET /api/v1/reports/{id}/history). Puro y
// testeable (`node --test`). El audit_log guarda snapshots COMPLETOS before/after
// (internos, pueden incluir PII y forense). Acá se proyecta SOLO lo público:
// action, occurred_at, source y los campos PÚBLICOS que cambiaron (from→to).
//
// La lista blanca de campos públicos es la MISMA de las vistas public_* (reusa
// VIEW_COLUMNS), así que PII (phone_private/contact/manage_token/risk_answers) y
// forense (ip/user_agent) jamás pueden filtrarse: no están en la whitelist.

import { VIEW_COLUMNS, VIEW_FOR_TABLE, PERSON_COORD_TABLES, COORD_FIELDS, roundCoord } from "./reports.mjs";

// Campos que NUNCA se exponen en el history, ni como cambio ni como metadata. La
// proyección los excluye por construcción (no están en VIEW_COLUMNS); este set es
// la aserción explícita de esa garantía (lo usan los tests).
export const FORBIDDEN_FIELDS = [
  "phone_private",
  "contact",
  "manage_token",
  "risk_answers",
  "ip",
  "user_agent",
];

// Metadata estática del reporte: no se reporta como "cambio" (id no cambia; el
// source ya va a nivel de evento; created_at/source_url no son ediciones útiles).
const META_FIELDS = new Set(["id", "created_at", "source", "source_url"]);

// Campos públicos "editables" de una tabla = columnas de su vista menos metadata.
function publicFields(table) {
  const view = VIEW_FOR_TABLE[table];
  const cols = VIEW_COLUMNS[view] ?? [];
  return cols.filter((c) => !META_FIELDS.has(c));
}

// Conjunto de campos-coordenada, para test O(1).
const COORD_FIELD_SET = new Set(COORD_FIELDS);

// ¿Hay que redondear este campo de esta tabla? Solo lat/lng de tablas de
// personas (B3). Los snapshots before/after del audit_log son CRUDOS (coord
// exacta); sin esto, el /history público (sin API key) filtraría la ubicación
// precisa de un desaparecido vía changes.latitude.to. Edificios = exacto.
function isFuzzedCoordField(table, field) {
  return PERSON_COORD_TABLES.has(table) && COORD_FIELD_SET.has(field);
}

// Igualdad estructural barata (cubre primitivos y jsonb como items[]).
function eq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  return JSON.stringify(a) === JSON.stringify(b);
}

// Un evento crudo del audit_log → { action, occurred_at, source, changes }.
// changes = { campoPúblico: { from, to } } solo para los que cambiaron. En CREATE
// (before null) los campos presentes en `after` aparecen como cambio desde null.
export function projectHistoryEvent(event, table) {
  const before = event.before ?? null;
  const after = event.after ?? {};
  const changes = {};
  for (const f of publicFields(table)) {
    let from = before == null ? null : (before[f] ?? null);
    let to = after[f] ?? null;
    // B3: redondear lat/lng de personas igual que la vista pública. Se compara
    // y se emite el valor ya redondeado, así el /history nunca filtra la coord
    // exacta y un cambio sub-3-decimales no aparece como "edición" espuria.
    if (isFuzzedCoordField(table, f)) {
      from = roundCoord(from);
      to = roundCoord(to);
    }
    if (!eq(from, to)) changes[f] = { from, to };
  }
  return {
    action: event.action,
    occurred_at: event.occurred_at,
    source: event.source ?? null,
    changes,
  };
}

// Lista de eventos (orden preservado) → lista proyectada.
export function projectHistory(events, table) {
  return (events ?? []).map((e) => projectHistoryEvent(e, table));
}
