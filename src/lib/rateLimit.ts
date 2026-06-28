import "server-only";
import { headers } from "next/headers";
import { getServerSupabase, hasSecretKey } from "@/lib/supabase/server";

// Rate limiter con dos backends, misma interfaz `rateLimit(key, opts)`:
//   - DURABLE (default en prod): contador en Postgres vía RPC `rate_limit_hit`
//     (migración 0022). Compartido entre instancias serverless → el límite es
//     GLOBAL y no se evade repartiendo requests entre lambdas. Cierra #38.
//   - IN-MEMORY (fallback): se usa cuando no hay service key (dev) o si la DB
//     falla, para no bloquear tráfico legítimo por un problema de infra.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Periodically drop expired buckets so memory stays bounded.
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

// Fallback in-memory (por proceso). Ventana fija: hasta `limit` por `windowSec`.
function rateLimitMemory(
  key: string,
  { limit, windowSec }: { limit: number; windowSec: number }
): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { ok: true, retryAfterSec: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

export async function rateLimit(
  key: string,
  opts: { limit: number; windowSec: number }
): Promise<RateLimitResult> {
  // Durable cuando hay service key (la RPC tiene execute solo para service_role).
  if (hasSecretKey()) {
    try {
      const { data, error } = await getServerSupabase().rpc("rate_limit_hit", {
        p_key: key,
        p_limit: opts.limit,
        p_window_sec: opts.windowSec,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!error && row && typeof row.allowed === "boolean") {
        return { ok: row.allowed, retryAfterSec: row.retry_after ?? 0 };
      }
    } catch {
      // Cae al fallback in-memory ante cualquier fallo de DB (nunca bloquea por infra).
    }
  }
  return rateLimitMemory(key, opts);
}

// Best-effort client identifier from proxy headers (Vercel sets these).
// x-real-ip is set by Vercel to the observed client IP and cannot be spoofed
// by the caller — unlike the first entry of x-forwarded-for, which is
// client-supplied and trivially faked.
export async function clientKey(scope: string): Promise<string> {
  const h = await headers();
  const ip =
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  return `${scope}:${ip}`;
}
