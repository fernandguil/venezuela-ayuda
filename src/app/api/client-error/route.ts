import { NextResponse } from "next/server";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { requireJsonContentType } from "@/lib/apiPolicy.mjs";
import { logError } from "@/lib/log.mjs";

// Sumidero de errores del error boundary del cliente (`src/app/error.tsx`). Un
// `console.error` en el cliente sólo llega al browser, nunca a los logs de Vercel;
// este endpoint server-side los recoge para que un crash de render sea observable.
//
// Público (no hay sesión en un crash genérico) y rate-limited para que no sea un
// amplificador de logs. SÓLO usamos `digest` (el hash de React, sin PII) para
// agrupar. NO se loguea `message`: error.message puede traer texto libre del
// usuario o contenido controlado por un atacante, y truncarlo no lo vuelve seguro.
// Nunca el stack ni el payload del usuario.

export const runtime = "nodejs";
export const maxDuration = 5;

const MAX_BODY_BYTES = 4 * 1024;

export async function POST(req: Request) {
  // Apagado por defecto: el round-trip de errores del cliente sólo opera con
  // NEXT_PUBLIC_CLIENT_ERROR_LOGGING="true" (la misma bandera que gatea el envío
  // en error.tsx). Sin ella, no recibimos ni logueamos nada.
  if (process.env.NEXT_PUBLIC_CLIENT_ERROR_LOGGING !== "true") {
    return new NextResponse(null, { status: 204 });
  }

  // Content-Type check before rate-limit: invalid media type must not consume
  // the caller's rate-limit budget.
  if (!requireJsonContentType(req.headers.get("content-type"))) {
    return new NextResponse(null, { status: 204 });
  }

  const rl = await rateLimit(await clientKey("client-error"), { limit: 30, windowSec: 60 });
  if (!rl.ok) {
    // 204: el cliente no debe reintentar ni mostrar nada; es telemetría best-effort.
    return new NextResponse(null, { status: 204 });
  }

  // Stream body with a hard byte cap; content-length is client-controlled.
  let body: { digest?: unknown };
  try {
    const reader = req.body?.getReader();
    if (!reader) return new NextResponse(null, { status: 204 });
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); return new NextResponse(null, { status: 204 }); }
      chunks.push(value);
    }
    reader.releaseLock();
    const buf = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) { buf.set(c, pos); pos += c.byteLength; }
    body = JSON.parse(new TextDecoder().decode(buf)) as { digest?: unknown };
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  // Sólo el `digest` (hash de React, sin PII, acotado) — basta para agrupar el
  // crash. El `message` del cliente NO se loguea (puede traer texto libre o
  // contenido de un atacante). El logger descarta cualquier otro campo.
  const digest = typeof body?.digest === "string" ? body.digest.slice(0, 100) : undefined;
  logError("client_boundary", { name: "ClientError", digest }, { scope: "app.error" });

  return new NextResponse(null, { status: 204 });
}
