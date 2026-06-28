// Seeds the bootstrap super-admin from env vars instead of hardcoded SQL.
// Run once after a fresh database setup; idempotent (upserts).
//
//   BOOTSTRAP_ADMIN_EMAIL=admin@example.com node scripts/seed-bootstrap-admin.mjs
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY from the env or .env.local.
// The BOOTSTRAP_ADMIN_EMAIL env var (or the --email flag) sets the target account.
//
// Once the RBAC migration (0029) is applied, this script also assigns the
// super_admin role in user_roles so the account has full permissions via RBAC.

import { readFileSync } from "node:fs";

let fileEnv = {};
try {
  fileEnv = Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
} catch {
  /* no .env.local */
}
const getEnv = (k) => process.env[k] || fileEnv[k];

const SUPABASE_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const SECRET = getEnv("SUPABASE_SECRET_KEY");
const email = (
  getEnv("BOOTSTRAP_ADMIN_EMAIL") ||
  process.argv.find((a) => a.startsWith("--email="))?.split("=")[1]
)?.trim().toLowerCase();

if (!SUPABASE_URL || !SECRET) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}
if (!email || !email.includes("@")) {
  console.error("Error: provide the admin email via BOOTSTRAP_ADMIN_EMAIL env var or --email=addr@domain.");
  process.exit(1);
}

const rest = (path, method, body) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(body),
  });

console.log(`Seeding bootstrap super-admin: ${email}`);

// 1. Upsert into admin_emails (legacy table; kept until RBAC migration fully rolls out).
const r1 = await rest("admin_emails", "POST", { email, added_by: "seed-script", is_super_admin: true });
if (!r1.ok) {
  console.error(`admin_emails upsert failed: ${r1.status} ${await r1.text()}`);
  process.exit(1);
}
console.log("  ✓ admin_emails");

// 2. Upsert into user_roles (RBAC — only if the table exists, i.e. migration 0029 is applied).
const roleRes = await fetch(`${SUPABASE_URL}/rest/v1/roles?name=eq.super_admin&select=id`, {
  headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
});
if (roleRes.ok) {
  const roles = await roleRes.json();
  if (roles.length > 0) {
    const roleId = roles[0].id;
    const r2 = await rest("user_roles", "POST", { email, role_id: roleId, granted_by: "seed-script" });
    if (!r2.ok) {
      console.warn(`user_roles upsert failed (non-fatal): ${r2.status} ${await r2.text()}`);
    } else {
      console.log("  ✓ user_roles (super_admin role)");
    }
  } else {
    console.log("  ⏭  super_admin role not found in roles table — skipping user_roles seed.");
  }
} else {
  console.log("  ⏭  RBAC tables not yet applied — skipping user_roles seed.");
}

console.log("Done. Bootstrap admin seeded successfully.");
