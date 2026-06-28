// Proyección PÚBLICA del audit trail (GET /api/v1/reports/{id}/history). Puro y
// testeable (`node --test`). El audit_log guarda snapshots COMPLETOS before/after
// (internos, pueden incluir PII y forense). Acá se proyecta SOLO lo público:
// action, occurred_at, source y los campos PÚBLICOS que cambiaron (from→to).
//
// La lista blanca de campos públicos es la MISMA de las vistas public_* (reusa
// VIEW_COLUMNS), así que PII (phone_private/contact/manage_token/risk_answers) y
// forense (ip/user_agent) jamás pueden filtrarse: no están en la whitelist.

import { VIEW_COLUMNS, VIEW_FOR_TABLE } from "./reports.mjs";

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
  "verified_by", // email del admin verificador (PII interna)
  "hidden", // moderación interna
  "verified", // estado de verificación interno
];

const FORBIDDEN_SET = new Set(FORBIDDEN_FIELDS);

// Metadata estática del reporte: no se reporta como "cambio" (id no cambia; el
// source ya va a nivel de evento; created_at/source_url no son ediciones útiles).
const META_FIELDS = new Set(["id", "created_at", "source", "source_url"]);

// Campos públicos "editables" de una tabla = columnas de su vista menos metadata.
function publicFields(table) {
  const view = VIEW_FOR_TABLE[table];
  const cols = VIEW_COLUMNS[view] ?? [];
  return cols.filter((c) => !META_FIELDS.has(c));
}

// Igualdad estructural barata (cubre primitivos y jsonb como items[]).
function eq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  return JSON.stringify(a) === JSON.stringify(b);
}

// Un evento crudo del audit_log → { action, occurred_at, source, changes } o null.
// La tabla se deriva del PROPIO evento (event.resource_table): si no es una de las
// 4 tablas públicas (checkins/help_requests/help_offers/damaged_reports) el evento
// se DESCARTA (null) — p.ej. collection_centers no se expone. changes = { campo:
// { from, to } } solo para los campos públicos que cambiaron. En CREATE (before
// null) los campos presentes en `after` aparecen como cambio desde null.
export function projectHistoryEvent(event) {
  const table = event.resource_table;
  if (!(table in VIEW_FOR_TABLE)) return null;
  const before = event.before ?? null;
  const after = event.after ?? {};
  const changes = {};
  for (const f of publicFields(table)) {
    // Defensa en profundidad: aunque publicFields ya excluye los FORBIDDEN (no
    // están en VIEW_COLUMNS), filtramos explícito para que la garantía no dependa
    // solo de la whitelist de la vista.
    if (FORBIDDEN_SET.has(f)) continue;
    const from = before == null ? null : (before[f] ?? null);
    const to = after[f] ?? null;
    if (!eq(from, to)) changes[f] = { from, to };
  }
  return {
    action: event.action,
    occurred_at: event.occurred_at,
    source: event.source ?? null,
    changes,
  };
}

// Lista de eventos (orden preservado) → lista proyectada, descartando los nulos
// (eventos de tablas no públicas).
export function projectHistory(events) {
  return (events ?? []).map(projectHistoryEvent).filter((e) => e !== null);
}
