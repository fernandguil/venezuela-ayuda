import "server-only";
import { createHmac } from "crypto";

export { normalizeCedula, parseCedulaForm, cedulaPreview, type CedulaPrefix } from "./cedula";

export function cedulaHash(normalized: string, secret: string): string {
  return createHmac("sha256", secret).update(normalized).digest("hex");
}

export function getCedulaSecret(): string | null {
  const s = process.env.CEDULA_HMAC_SECRET?.trim();
  return s || null;
}
