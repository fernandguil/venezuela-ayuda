import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { FR_BASE, frHeaders, frConfigured } from "@/lib/fr";
import { logWarn } from "@/lib/log.mjs";

// Búsqueda 1:N por rostro. SOLO admin (consume cuota del FR-API). El admin sube
// una foto y reenviamos el multipart al FR-API con la clave del servidor.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "no_autorizado" }, { status: 401 });
  if (!frConfigured())
    return NextResponse.json({ ok: false, error: "FR no configurado" }, { status: 503 });

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob))
      return NextResponse.json({ ok: false, error: "falta_imagen" }, { status: 400 });
    const fd = new FormData();
    fd.append("file", file, "foto.jpg");
    const r = await fetch(`${FR_BASE}/v1/search`, { method: "POST", headers: frHeaders(), body: fd, redirect: "error" });
    return new NextResponse(await r.text(), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    // FR-API caído/timeout: sin este log la búsqueda por rostro falla en silencio.
    logWarn("fr_proxy_failed", { scope: "api.fr.search" }, err);
    return NextResponse.json({ ok: false, error: "No se pudo conectar con el FR-API." }, { status: 502 });
  }
}
