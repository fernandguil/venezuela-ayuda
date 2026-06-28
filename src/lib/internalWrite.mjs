// Puerta ÚNICA de escritura interna del sitio. Los server actions
// (src/app/actions.ts, src/app/admin/actions.ts) NO escriben directo a las tablas:
// pasan por las MISMAS RPC que usa el API externo (ingest_reports / patch_report /
// delete_report), atribuidas a NUESTRO socio (VA_PARTNER_ID / VA_SOURCE). Así toda
// mutación —interna o externa— queda auditada en `audit_log` y atribuida igual.
//
// Este módulo es PURO y testeable (`node --test`): solo arma el objeto de
// parámetros que el caller pasa a `svc.rpc(nombre, args)`. No toca Supabase. Lo
// importan tanto el TS (vía allowJs, como ingest.mjs) como los tests.

import { VA_PARTNER_ID, VA_SOURCE } from "./canonical.mjs";
import { hashManageToken } from "./manageToken.mjs";

// Contexto forense del request (request_id/ip/user_agent) para el audit. En un
// server action no hay objeto Request; si el caller no lo deriva, se deja null —
// no se inventa. Mismo shape que partnerAuth.requestMeta (requestId/ip/userAgent).
const EMPTY_CTX = { requestId: null, ip: null, userAgent: null };

function forensic(ctx) {
  const c = ctx ?? EMPTY_CTX;
  return {
    p_partner: VA_PARTNER_ID,
    p_source: VA_SOURCE,
    p_request_id: c.requestId ?? null,
    p_ip: c.ip ?? null,
    p_user_agent: c.userAgent ?? null,
  };
}

// Args para ingest_reports (CREATE). `rows` es el lote YA construido/validado de
// UNA tabla (las 4 de reporte upsertean por (source,external_id); collection_centers
// hace insert simple — lo decide la RPC por el nombre de tabla).
export function ingestArgs(table, rows, ctx) {
  return { p_table: table, p_rows: rows, ...forensic(ctx) };
}

// Args para patch_report (UPDATE). `patch` son SOLO las columnas a cambiar, ya
// validadas por el caller (las RPC aplican el patch tal cual vía jsonb).
export function patchArgs(table, id, patch, ctx) {
  return { p_table: table, p_id: id, p_patch: patch, ...forensic(ctx) };
}

// Args para delete_report (DELETE). La RPC captura el snapshot `before`, borra, y
// audita action=DELETE con after=null en la misma transacción.
export function deleteArgs(table, id, ctx) {
  return { p_table: table, p_id: id, ...forensic(ctx) };
}

// Fila de collection_centers para el insert vía ingest_reports. La tabla NO tiene
// external_id → el row no lo lleva (la RPC hace insert simple por id, sin upsert).
// `source` = 'user' es el ORIGEN de la fila (semántica propia de la tabla:
// 'seed'|'user'), distinto de la atribución del actor (VA_SOURCE/VA_PARTNER_ID que
// viajan en el audit). Los opcionales ausentes se normalizan a null (no undefined)
// para no romper el casteo de jsonb_populate_record.
export function buildCenterRow(input) {
  const needsVolunteers = Boolean(input.needs_volunteers);
  return {
    name: input.name,
    country: input.country,
    state: input.state ?? null,
    city: input.city ?? null,
    address: input.address ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    resources: input.resources ?? null,
    organizers: input.organizers ?? null,
    contact: input.contact ?? null,
    website: input.website ?? null,
    can_ship_to_venezuela: input.can_ship_to_venezuela ?? null,
    volunteers_count: input.volunteers_count ?? null,
    needs_volunteers: needsVolunteers,
    needs: ["centro-de-acopio", ...(needsVolunteers ? ["voluntarios"] : [])],
    verified: false,
    hidden: false,
    manage_token: input.manage_token ?? null,
    manage_token_hash: input.manage_token ? hashManageToken(input.manage_token) : null,
    source: "user",
  };
}
