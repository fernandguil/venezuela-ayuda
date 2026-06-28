import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { FR_BASE, frHeaders, frConfigured } from "@/lib/fr";
import { logWarn } from "@/lib/log.mjs";

// Conciliación entre bases DISTINTAS: la misma persona reportada en varias
// plataformas, con sus imágenes de cada base. SOLO admin.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "no_autorizado" }, { status: 401 });
  if (!frConfigured())
    return NextResponse.json({ ok: false, error: "FR no configurado" }, { status: 503 });

  const u = new URL(req.url);
  const min = u.searchParams.get("min_score") || "0.55";
  const limit = u.searchParams.get("limit") || "800";
  const sources = u.searchParams.get("sources") || "";
  const qs = new URLSearchParams({ min_score: min, limit });
  if (sources) qs.set("sources", sources);
  try {
    const r = await fetch(`${FR_BASE}/v1/reconcile?${qs.toString()}`, { headers: frHeaders(), redirect: "error" });
    return new NextResponse(await r.text(), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    // FR-API caído/timeout: sin este log la conciliación admin falla en silencio.
    logWarn("fr_proxy_failed", { scope: "api.fr.reconcile" }, err);
    return NextResponse.json({ ok: false, error: "No se pudo conectar con el FR-API." }, { status: 502 });
  }
}
