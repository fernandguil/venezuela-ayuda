import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { PUBLIC_CDN_CACHE } from "@/lib/httpCache";
import { isUuid } from "@/lib/reports.mjs";
import { projectHistory } from "@/lib/audit.mjs";
import { SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/apiPolicy.mjs";

// GET /api/v1/reports/{id}/history — audit trail de un reporte.
//
// ABIERTO (sin API key), pero PROYECTADO: solo action, occurred_at, source y los
// campos PÚBLICOS que cambiaron (from→to). NUNCA PII (phone_private/contact/
// manage_token/risk_answers) ni forense (ip/user_agent). El audit_log completo
// (before/after crudos) es interno/admin. Un reporte sin mutaciones por la API
// (orgánico/preexistente) devuelve history vacío.

export const runtime = "nodejs";
export const maxDuration = 15;

type Params = { params: Promise<{ id: string }> };

type AuditRow = {
  action: string;
  occurred_at: string;
  source: string | null;
  resource_table: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "id inválido (se espera un uuid)." }, { status: 400 });
  }

  const rl = rateLimit(await clientKey("reports:history"), { limit: 120, windowSec: 60 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  // Lee el audit con el service key (RLS sin policy de select para anon). El
  // before/after crudo NUNCA sale de aquí: projectHistory whitelist-ea campos
  // públicos. Orden total por `seq` (cronológico inmutable).
  const svc = getServerSupabase();
  const { data, error } = await svc
    .from("audit_log")
    .select("action, occurred_at, source, resource_table, before, after")
    .eq("resource_id", id)
    .order("seq", { ascending: true });
  if (error) {
    return NextResponse.json({ error: SERVICE_UNAVAILABLE_MESSAGE }, { status: 503 });
  }

  // La tabla se deriva POR EVENTO (event.resource_table) dentro de projectHistory:
  // eventos de tablas no públicas se descartan. Si todo queda fuera, history vacío.
  const rows = (data ?? []) as AuditRow[];
  const history = projectHistory(rows);

  return NextResponse.json(
    { id, history },
    { headers: { "Cache-Control": PUBLIC_CDN_CACHE } }
  );
}
