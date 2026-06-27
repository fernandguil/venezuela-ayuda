// Shared cédula normalization for Node scripts (ingest). Keep in sync with src/lib/cedula.ts.

import { createHmac } from "node:crypto";

const DIGITS_RE = /^\d{6,9}$/;

/** @param {string | null | undefined} raw @param {"V" | "E"} [defaultPrefix] */
export function normalizeCedula(raw, defaultPrefix = "V") {
  if (!raw?.trim()) return null;

  let s = raw.trim().toUpperCase().replace(/\s/g, "");
  let prefix = defaultPrefix === "E" ? "E" : "V";

  if (/^[VE]/.test(s)) {
    prefix = s[0];
    s = s.slice(1);
  }

  s = s.replace(/[-.]/g, "");
  if (prefix !== "V" && prefix !== "E") return null;
  if (!DIGITS_RE.test(s)) return null;

  return `${prefix}-${s}`;
}

/** @param {string} normalized @param {string} secret */
export function cedulaHash(normalized, secret) {
  return createHmac("sha256", secret).update(normalized).digest("hex");
}
