import { NextResponse } from "next/server";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { FR_BASE, frHeaders, frConfigured } from "@/lib/fr";
import { logWarn, logDebug } from "@/lib/log.mjs";

// Anti-duplicado al registrar una persona. PÚBLICO: el formulario manda la foto
// (data URL ya reducida en el cliente) y aquí la reenviamos al FR-API con la
// clave del servidor. Si el FR no está configurado o falla, respondemos "sin
// duplicado" para NO bloquear nunca el registro (es asistivo).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!frConfigured())
    return NextResponse.json({ ok: true, possible_duplicate: false, disabled: true });

  const rl = await rateLimit(await clientKey("fr-check"), { limit: 30, windowSec: 60 });
  if (!rl.ok) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  let photo = "";
  try {
    photo = (await req.json())?.photo || "";
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
      redirect: "error",
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
