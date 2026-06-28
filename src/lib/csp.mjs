// Edge-runtime-safe: no Node.js imports. Imported by both middleware.ts and
// apiPolicy.mjs so the CSP directives have a single source of truth.

// Resolve the exact Supabase project host from the public env var so the CSP
// allows only this project's storage/realtime, not all *.supabase.co projects.
// Falls back to the wildcard when the var is absent (local dev without .env).
function resolveSupabaseHost() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return "*.supabase.co";
  try {
    return new URL(raw).hostname;
  } catch {
    return "*.supabase.co";
  }
}

const STATIC_DIRECTIVES = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    "https://www.googletagmanager.com",
    "https://*.google-analytics.com",
    "https://cdn.jsdelivr.net",
  ],
  "style-src": ["'self'", "'unsafe-inline'"],
  "font-src": ["'self'", "data:", "https://cdn.jsdelivr.net"],
  "worker-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
  "media-src": ["'self'", "data:", "blob:"],
};

export function contentSecurityPolicy() {
  const sbHost = resolveSupabaseHost();
  const directives = {
    ...STATIC_DIRECTIVES,
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      `https://${sbHost}`,
      "https://*.tile.openstreetmap.org",
      "https://api.maptiler.com",
      "https://*.maptiler.com",
      "https://www.google-analytics.com",
    ],
    "connect-src": [
      "'self'",
      `https://${sbHost}`,
      `wss://${sbHost}`,
      "https://nominatim.openstreetmap.org",
      "https://*.tile.openstreetmap.org",
      "https://api.maptiler.com",
      "https://*.maptiler.com",
      "https://www.googletagmanager.com",
      "https://www.google-analytics.com",
      "https://*.google-analytics.com",
      "https://cdn.jsdelivr.net",
    ],
  };
  const body = Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
  return `${body}; upgrade-insecure-requests`;
}
