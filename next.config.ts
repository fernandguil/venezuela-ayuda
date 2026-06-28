import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import {
  SECURITY_HEADERS,
  API_SECURITY_HEADERS,
  API_CORS_HEADERS,
  contentSecurityPolicy,
} from "./src/lib/apiPolicy.mjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// CSP. Por defecto se ENFORZA; con CSP_REPORT_ONLY=1 se emite como Report-Only
// para validar en staging sin romper (recomendado en el primer despliegue: ver
// la consola por violaciones de map/forms/GA//docs antes de enforzar).
const CSP_HEADER = {
  key: process.env.CSP_REPORT_ONLY === "1"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy",
  value: contentSecurityPolicy(),
};

const nextConfig: NextConfig = {
  experimental: {
    // Photos are downscaled client-side (~150-400 KB) but leave headroom.
    serverActions: { bodySizeLimit: "3mb" },
  },
  images: {
    remotePatterns: [
      // Supabase Storage photos. We pin to the exact project host from the env
      // var to avoid serving/optimizing images from any supabase.co project.
      // Covers both public (/object/public/) and signed (/object/sign/) paths.
      {
        protocol: "https",
        hostname: process.env.NEXT_PUBLIC_SUPABASE_URL
          ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
          : "*.supabase.co", // fallback for local dev without env
        pathname: "/storage/v1/object/**",
      },
    ],
  },
  // Security headers que Vercel NO pone automático. HTTPS-redirect (308) y HSTS
  // base los da la plataforma; acá reforzamos lo que falta. Globales = seguros
  // también para el sitio HTML; el lockdown de Permissions-Policy va sólo a /api.
  async headers() {
    return [
      // CSP + headers base en todo el sitio. En /api el CSP es inerte para el
      // fetch programático (no estorba) y evitamos un `source` con regex frágil.
      { source: "/:path*", headers: [...SECURITY_HEADERS, CSP_HEADER] },
      { source: "/api/:path*", headers: API_SECURITY_HEADERS },
      // CORS del API público v1. El split lectura/escritura lo enforza el browser
      // (preflight), no nuestro código — ver API_CORS_HEADERS en apiPolicy.mjs.
      { source: "/api/v1/:path*", headers: API_CORS_HEADERS },
    ];
  },
};

export default withNextIntl(nextConfig);
