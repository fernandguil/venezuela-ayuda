// Única fuente de verdad para los valores canónicos del dominio: enums de
// categorías/estados y límites de longitud de inputs. JS puro, sin deps, para
// que lo importen tanto el TS (vía allowJs) como los tests de `node --test`.
//
// constants.ts mantiene objetos de metadata (labels/emojis/colores de UI) cuyas
// CLAVES deben ser exactamente estos arrays, y re-exporta LIMITS desde acá;
// ingest.mjs consume estos arrays directo. No dupliques estas listas en ningún
// otro lado — agregá un valor acá y todo lo demás lo hereda. El test de paridad
// (scripts/canonical.test.mjs) falla si las claves de constants.ts divergen.

// Identidad de NUESTRA propia plataforma como socio del hub. La escritura interna
// del sitio (server actions) pasa por las MISMAS RPC que el API externo, atribuida
// a este socio → toda mutación (interna o externa) queda auditada y atribuida
// uniformemente. El id es FIJO y conocido: idéntico acá y en el seed de la
// migración 0015 (`api_partners`), para que el partner_id no dependa de leer la DB.
// VA_SOURCE es el `source` que ya estampan por DEFAULT las 4 tablas de reporte.
export const VA_PARTNER_ID = "11111111-1111-4111-8111-111111111111";
export const VA_SOURCE = "venezuela-ayuda.com";

export const HELP_CATEGORIES = ["medical", "food", "water", "shelter", "transportation", "electricity", "rescue", "tools"];
export const OFFER_CATEGORIES = ["transportation", "food", "shelter", "medical", "supplies", "translation"];
export const URGENCY = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const SEVERITY = ["CRACKS", "PARTIAL", "COLLAPSE_RISK", "COLLAPSED"];
export const CHECKIN_STATUS = ["SAFE", "NEEDS_HELP", "LOOKING_FOR_SOMEONE"];
export const REQUEST_STATUS = ["OPEN", "IN_PROGRESS", "RESOLVED"];

// Límites de longitud de inputs. Unión de los campos que necesitan el TS (UI:
// itemName/maxItems/maxQty) y la ingesta (source_url/photo_url). Mantener acá
// para que clamp y validación nunca diverjan.
export const LIMITS = {
  name: 80,
  city: 80,
  message: 500,
  description: 800,
  phone: 30,
  availability: 200,
  cedula: 15,
  place_name: 120,
  source_url: 500,
  photo_url: 500,
  itemName: 40,
  maxItems: 25,
  maxQty: 999,
};
