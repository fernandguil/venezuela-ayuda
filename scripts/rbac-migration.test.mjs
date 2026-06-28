// Static tests for 202606280003_rbac.sql — parse SQL, no DB required.
// Corre: node --test scripts/rbac-migration.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(__dir, "../supabase/migrations/202606280003_rbac.sql"),
  "utf8",
);

// Parse the role_permissions seed: returns Map<role_name, permission_name[]>.
function parseRolePermissions(sql) {
  const map = {};
  const re = /r\.name\s*=\s*'([^']+)'\s+and\s+p\.name\s+in\s*\(([^)]+)\)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const role = m[1];
    const perms = m[2].match(/'([^']+)'/g).map((p) => p.replace(/'/g, ""));
    map[role] = perms;
  }
  return map;
}

const roles = parseRolePermissions(src);

// --- Role permission assertions ---

test("admin role does NOT have admin.super (no privilege escalation)", () => {
  assert.ok(roles["admin"], "admin role must be seeded");
  assert.equal(roles["admin"].includes("admin.super"), false);
});

test("admin role has admin.access and modupe.review", () => {
  assert.ok(roles["admin"].includes("admin.access"), "admin must have admin.access");
  assert.ok(roles["admin"].includes("modupe.review"), "admin must have modupe.review");
});

test("super_admin is a superset of admin permissions", () => {
  for (const p of roles["admin"]) {
    assert.ok(roles["super_admin"].includes(p), `super_admin must include admin perm '${p}'`);
  }
});

test("reviewer has admin.access and modupe.review", () => {
  assert.ok(roles["reviewer"], "reviewer role must be seeded");
  assert.ok(roles["reviewer"].includes("admin.access"));
  assert.ok(roles["reviewer"].includes("modupe.review"));
});

test("every seeded role has admin.access", () => {
  for (const [role, perms] of Object.entries(roles)) {
    assert.ok(perms.includes("admin.access"), `'${role}' must have admin.access`);
  }
});

// --- RLS / REVOKE assertions (verify deny-all config) ---

test("RLS is enabled on all four RBAC tables", () => {
  const tables = ["permissions", "roles", "role_permissions", "user_roles"];
  for (const t of tables) {
    assert.ok(
      src.includes(`alter table ${t} enable row level security`),
      `'${t}' must have RLS enabled`,
    );
  }
});

test("user_roles has DML revoked from anon and authenticated", () => {
  assert.ok(
    src.includes("revoke insert, update, delete on user_roles from anon, authenticated") ||
    src.includes("revoke insert,update,delete on user_roles from anon,authenticated"),
    "user_roles must revoke insert/update/delete from anon and authenticated",
  );
});

test("user_permissions() execute revoked from public", () => {
  assert.ok(
    src.includes("revoke execute on function user_permissions(text) from public"),
    "user_permissions must not be callable by public/anon",
  );
});

test("applied_migrations insert uses timestamp version", () => {
  assert.ok(
    src.includes("values ('202606280003')"),
    "applied_migrations version must match timestamp-based filename",
  );
});
