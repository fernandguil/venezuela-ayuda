import { NextResponse } from "next/server";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { requireJsonContentType } from "@/lib/apiPolicy.mjs";
import { FR_BASE, frHeaders, frConfigured } from "@/lib/fr";
import { logWarn, logDebug } from "@/lib/log.mjs";

// Anti-duplicado al registrar una persona. PÚBLICO: el formulario manda la foto
// (data URL ya reducida en el cliente) y aquí la reenviamos al FR-API con la
// clave del servidor. Si el FR no está configurado o falla, respondemos "sin
// duplicado" para NO bloquear nunca el registro (es asistivo).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 256 KB cap for a base64-encoded reduced photo. A 192 KB JPEG (generous for a
// face crop at reduced quality) encodes to ~256 KB in base64 with the data URL
// prefix. Prevents buffering multi-MB uploads before the regex rejects them.
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(req: Request) {
  if (!frConfigured())
    return NextResponse.json({ ok: true, possible_duplicate: false, disabled: true });

  // Content-Type before rate-limit so malformed requests don't burn the budget.
  if (!requireJsonContentType(req.headers.get("content-type"))) {
    return NextResponse.json({ ok: true, possible_duplicate: false });
  }

  const rl = await rateLimit(await clientKey("fr-check"), { limit: 30, windowSec: 60 });
  if (!rl.ok) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  let photo = "";
  try {
    const reader = req.body?.getReader();
    if (reader) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel();
          return NextResponse.json({ ok: true, possible_duplicate: false });
        }
        chunks.push(value);
      }
      reader.releaseLock();
      const buf = new Uint8Array(total);
      let pos = 0;
      for (const c of chunks) { buf.set(c, pos); pos += c.byteLength; }
      // Photo is PII — never log the body, only the event on failure.
      photo = (JSON.parse(new TextDecoder().decode(buf)))?.photo || "";
    }
  } catch {
    // Body malformado = error del cliente. Sólo en debug y SIN el body (la foto
    // es PII): no amplificamos logs con requests basura, pero queda traza opcional.
    logDebug("fr_check_bad_json", { scope: "api.fr.check-duplicate" });
  }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(photo);
  if (!m) return NextResponse.json({ ok: true, possible_duplicate: false });

  try {
    const buf = Buffer.from(m[2], "base64");
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: m[1] }), "foto.jpg");
    const r = await fetch(`${FR_BASE}/v1/check-duplicate`, {
      method: "POST",
      headers: frHeaders(),
      body: fd,
    });
    if (r.status === 422)
      return NextResponse.json({ ok: true, possible_duplicate: false, no_face: true });
    return new NextResponse(await r.text(), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    // Asistivo: nunca bloquea el registro (degradamos a "sin duplicado"). Pero SÍ
    // dejamos rastro del FR caído: sin este log el anti-duplicado se apaga en silencio.
    logWarn("fr_proxy_failed", { scope: "api.fr.check-duplicate" }, err);
    return NextResponse.json({ ok: true, possible_duplicate: false, error: "fr_unreachable" });
  }
}
