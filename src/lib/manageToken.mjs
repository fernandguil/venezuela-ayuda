// Helpers para el valor de gestión de reportes: derivar su forma almacenada y
// comparar un candidato contra ella. Puro y testeable (`node --test`); solo
// node:crypto. La derivación coincide con la que puebla la columna en SQL, de
// modo que un valor escrito por la app y uno poblado en SQL comparan igual.

import { timingSafeEqual } from "node:crypto";
import { hashKey } from "./apiAuth.mjs";

// Forma almacenada del valor.
export function hashManageToken(raw) {
  return hashKey(raw);
}

// Compara un candidato contra la forma almacenada. Devuelve false (sin lanzar)
// ante valores vacíos o longitudes distintas.
export function tokensMatch(raw, hash) {
  if (!raw || !hash) return false;
  const a = Buffer.from(hashManageToken(raw), "utf8");
  const b = Buffer.from(String(hash), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
