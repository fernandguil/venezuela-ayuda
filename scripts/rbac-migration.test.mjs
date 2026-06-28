// Static assertions about the RBAC migration seed (202606280003_rbac.sql).
// Parses the SQL file directly — no database required.
// This test file lives in PR #103 but the migration it reads lives in PR #97
// (feat/rbac-foundation). Run after PR #97 has merged or is on the same branch.
//
// Run: node --test scripts/rbac-migration.test.mjs
import { test, skip } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(__dir, "../supabase/migrations/202606280003_rbac.sql");
const migrationExists = existsSync(migrationPath);
const sql = migrationExists ? readFileSync(migrationPath, "utf8") : "";

// Parse every   (r.name = '<role>'  and p.name in (...))  clause.
function parseRolePermissions(src) {
  const map = {};
  const blockRe = /r\.name\s*=\s*'([^']+)'\s+and\s+p\.name\s+in\s*\(([^)]+)\)/gi;
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const role = m[1];
    const perms = m[2].match(/'([^']+)'/g).map((p) => p.replace(/'/g, ""));
    map[role] = perms;
  }
  return map;
}

const rolePerms = parseRolePermissions(sql);
const runTest = migrationExists ? test : (name, _fn) => skip(name);

// ── Regression guard: admin role must include modupe.review ──────────────────
// In staging, isEmailAdmin → isEmailReviewer was always true (admins are
// reviewers). The RBAC migration preserves this via data (not hardcoded logic).
// If this permission is missing, existing admins lose /deduplicar access silently.
runTest("admin role includes modupe.review (no regression for existing admins)", () => {
  assert.ok(rolePerms.admin, "admin role block not found in role_permissions seed");
  assert.ok(
    rolePerms.admin.includes("modupe.review"),
    `admin role is missing 'modupe.review'. Got: [${rolePerms.admin.join(", ")}]`,
  );
});

// ── Super-admin is a strict superset of admin permissions ────────────────────
runTest("super_admin has all permissions that admin has", () => {
  assert.ok(rolePerms.super_admin, "super_admin role block not found");
  for (const perm of (rolePerms.admin ?? [])) {
    assert.ok(
      rolePerms.super_admin.includes(perm),
      `super_admin is missing '${perm}' which admin has`,
    );
  }
});

// ── Reviewer role has the right minimal set ───────────────────────────────────
runTest("reviewer role has admin.access and modupe.review", () => {
  assert.ok(rolePerms.reviewer, "reviewer role block not found");
  assert.ok(rolePerms.reviewer.includes("admin.access"), "reviewer missing admin.access");
  assert.ok(rolePerms.reviewer.includes("modupe.review"), "reviewer missing modupe.review");
});

// ── All roles have admin.access (needed to enter the admin panel) ─────────────
runTest("every role has admin.access", () => {
  for (const [role, perms] of Object.entries(rolePerms)) {
    assert.ok(
      perms.includes("admin.access"),
      `role '${role}' is missing 'admin.access'. Got: [${perms.join(", ")}]`,
    );
  }
});
