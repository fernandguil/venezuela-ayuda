export type CedulaPrefix = "V" | "E";

const DIGITS_RE = /^\d{6,9}$/;

/** Canonical form: `V-12345678` or `E-87654321`. */
export function normalizeCedula(
  raw: string | null | undefined,
  defaultPrefix: CedulaPrefix = "V",
): string | null {
  if (!raw?.trim()) return null;

  let s = raw.trim().toUpperCase().replace(/\s/g, "");
  let prefix: CedulaPrefix = defaultPrefix === "E" ? "E" : "V";

  if (/^[VE]/.test(s)) {
    prefix = s[0] as CedulaPrefix;
    s = s.slice(1);
  }

  s = s.replace(/[-.]/g, "");
  if (prefix !== "V" && prefix !== "E") return null;
  if (!DIGITS_RE.test(s)) return null;

  return `${prefix}-${s}`;
}

/** Preview string for UI hints (never includes full private storage semantics). */
export function cedulaPreview(
  prefix: CedulaPrefix,
  digits: string,
): string | null {
  const d = digits.replace(/\D/g, "");
  if (!d) return null;
  return `${prefix}-${d}`;
}

/** Parse optional form fields `cedula_prefix` + `cedula_number`. */
export function parseCedulaForm(
  prefixRaw: FormDataEntryValue | null | undefined,
  numberRaw: FormDataEntryValue | null | undefined,
): { normalized: string | null; invalid: boolean } {
  const numRaw = typeof numberRaw === "string" ? numberRaw.trim() : "";
  if (!numRaw) return { normalized: null, invalid: false };

  const p = String(prefixRaw || "V").toUpperCase();
  const defaultPrefix: CedulaPrefix = p === "E" ? "E" : "V";
  const normalized = normalizeCedula(numRaw, defaultPrefix);
  if (normalized) return { normalized, invalid: false };
  return { normalized: null, invalid: true };
}
