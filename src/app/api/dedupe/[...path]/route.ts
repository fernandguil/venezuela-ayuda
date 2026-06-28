import { NextResponse } from "next/server";
import { logError, logWarn } from "@/lib/log.mjs";
import { getReviewer } from "@/lib/reviewer";

// Server-side proxy for the deduplication review API.
//
// Why this exists: the dedupe review API now requires credentials
// (`x-api-key` + optional Bearer token) on every endpoint. The reviewer UI in
// `src/lib/dedupeApi.ts` runs in the BROWSER, so it cannot hold those secrets —
// anything `NEXT_PUBLIC_*` ships to the client and is visible in devtools.
//
// Instead, the browser calls this same-origin route (`/api/dedupe/...`) and we
// forward server-side to the real API, attaching the credentials from
// SERVER-ONLY env vars. The key never leaves the server. As a bonus, being
// same-origin removes the CORS preflight the direct-from-browser client had to
// tiptoe around.
//
// AUTH: this endpoint is the real security surface, not the /deduplicar page —
// a same-origin proxy that injects the maintainer's credential. So it MUST gate
// on a logged-in reviewer itself (the page's getReviewer() guard only protects
// the UI). Without this, any anonymous caller could read PII and mutate the
// shared dataset through `/api/dedupe/*`. We fail closed: no reviewer → 401,
// before any credential is attached or any upstream call is made.
//
// Contract: this is a transparent catch-all. Whatever path/query/body the
// client sends under `/api/dedupe/<rest>` is forwarded verbatim to
// `<DEDUPE_API_URL>/<rest>`, and the upstream status + JSON come straight back.
// So every existing call in dedupeApi.ts keeps working by just changing its
// base from the Azure host to `/api/dedupe`.

export const runtime = "nodejs";
// Proxied data is per-request and auth-gated; never cache it.
export const dynamic = "force-dynamic";

// Upstream base URL. Server-only (no NEXT_PUBLIC_ prefix). Falls back to the
// current production API so the proxy is a no-op swap until staging points it
// at the preview slot.
const UPSTREAM_BASE = (
  process.env.DEDUPE_API_URL ||
  "https://venezuela-terremoto-c4gafbfpc0dadpcj.eastus-01.azurewebsites.net"
).replace(/\/$/, "");

// Credentials, supplied out-of-band via env (see .env.example). Both are
// optional here so the proxy still boots without them; if the upstream rejects
// the call for missing auth, that 401/403 is surfaced to the caller as-is.
const API_KEY = process.env.DEDUPE_API_KEY || "";
const API_TOKEN = process.env.DEDUPE_API_TOKEN || "";

// Methods the reviewer flow actually uses (list/get/confirm/remove). Anything
// else is rejected rather than blindly proxied.
const ALLOWED_METHODS = new Set(["GET", "POST", "DELETE"]);

function buildUpstreamUrl(req: Request, pathParts: string[]): string {
  const path = pathParts.map(encodeURIComponent).join("/");
  const search = new URL(req.url).search; // includes leading "?" or ""
  return `${UPSTREAM_BASE}/${path}${search}`;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (API_KEY) headers["x-api-key"] = API_KEY;
  if (API_TOKEN) headers["Authorization"] = `Bearer ${API_TOKEN}`;
  return headers;
}

async function proxy(
  req: Request,
  pathParts: string[],
): Promise<NextResponse> {
  const method = req.method.toUpperCase();
  // `scope` is the only path-derived value we log: the first segment (e.g.
  // "groups", "duplicates") is enough to correlate without leaking ids/PII.
  const scope = `dedupe:${pathParts[0] ?? "root"}`;

  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json(
      { detail: `Method ${method} not allowed` },
      { status: 405 },
    );
  }

  // Reviewer gate — the whole point of the proxy is that it holds a privileged
  // credential, so it must only serve authenticated reviewers. getReviewer()
  // returns null for anonymous users, non-allowlisted users, AND when Supabase
  // isn't configured — all of which fail closed to 401 here.
  const reviewer = await getReviewer();
  if (!reviewer) {
    logWarn("dedupe_proxy_unauthorized", { scope, status: 401 });
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  if (!API_KEY && !API_TOKEN) {
    // Misconfiguration, not a per-request failure: warn once-per-call so it's
    // visible in logs but don't include any request detail.
    logWarn("dedupe_proxy_no_credentials", { scope, status: 502 });
  }

  // Only forward a body (and Content-Type) for methods that carry one.
  const hasBody = method === "POST";
  const body = hasBody ? await req.text() : undefined;

  const upstreamUrl = buildUpstreamUrl(req, pathParts);

  let res: Response;
  try {
    res = await fetch(upstreamUrl, {
      method,
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...authHeaders(),
      },
      body,
      // Edge between our server and Azure; never use Next's fetch cache.
      cache: "no-store",
    });
  } catch (err) {
    // Upstream unreachable. Log the error (no body, no key — only allow-listed
    // context) and surface a generic 502.
    logError("dedupe_proxy_upstream_unreachable", err, { scope, status: 502 });
    return NextResponse.json(
      { detail: "Dedupe API unreachable" },
      { status: 502 },
    );
  }

  // Pass the upstream response straight through. Some endpoints (downloads)
  // may return non-JSON or empty bodies, so forward raw text + content-type.
  const text = await res.text();
  if (!res.ok) {
    // Surface upstream failures with their status but log them so they're not
    // silent. Status only — never the response body (may echo input/PII).
    logWarn("dedupe_proxy_upstream_error", { scope, status: res.status });
  }

  const contentType = res.headers.get("content-type") || "application/json";
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": contentType },
  });
}

// Next.js passes route params as a Promise.
type Params = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, { params }: Params) {
  const { path } = await params;
  return proxy(req, path ?? []);
}

export async function POST(req: Request, { params }: Params) {
  const { path } = await params;
  return proxy(req, path ?? []);
}

export async function DELETE(req: Request, { params }: Params) {
  const { path } = await params;
  return proxy(req, path ?? []);
}
