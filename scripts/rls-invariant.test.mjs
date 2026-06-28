// RLS invariant test.
//
// Reads every supabase/migrations/*.sql file and enforces a single security
// invariant: every base table created in the `public` schema must have Row
// Level Security (RLS) enabled via
//   `alter table <name> enable row level security;`
//
// Rationale: in this project all client access goes through Supabase with RLS
// as the primary access-control boundary. A public table created without RLS is
// world-readable/writable by anon/authenticated roles and is almost always a
// security bug. This test fails loudly if that ever happens.
//
// The parser is intentionally conservative/robust:
//   - Only `public` schema tables are considered. Tables qualified with another
//     schema (storage., auth., extensions., realtime., etc.) are ignored.
//   - Views and materialized views are NOT tables and are ignored (the table
//     regex never matches `create ... view`).
//   - Quoted identifiers ("My Table") and schema-qualified names
//     (public.foo / "public"."foo") are normalized with Postgres case-folding
//     semantics: UNQUOTED identifiers fold to lower case, QUOTED ones are
//     case-preserving, so `"Victims"` and `victims` are different objects and
//     never compare equal (a quoted create + unquoted RLS is NOT "protected").
//   - All table-creating DDL is detected, not just plain `create table`:
//       * `create table [if not exists]`
//       * `create [global|local] {temp|temporary|unlogged} table`
//       * `create table ... as ...` (CTAS) and `... partition of ...`
//       * `select ... into <name>` (also creates a table)
//   - SQL line (`--`) and block (`/* */`) comments are stripped before parsing
//     so commented-out DDL never produces false positives/negatives.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

// Tables that are legitimately allowed to exist in `public` without RLS.
// Keep this empty unless there is a documented, reviewed reason. Each entry
// MUST carry a comment explaining why RLS is not required for that table.
//
// As of this writing every public table enables RLS, so the allow-list is empty.
const KNOWN_NO_RLS = new Set([
  // (none) — all public tables currently enable RLS.
]);

/** Remove SQL line and block comments so DDL inside comments is ignored. */
function stripComments(sql) {
  // Block comments /* ... */ (non-greedy, across newlines).
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Line comments -- ... to end of line.
  out = out.replace(/--[^\n]*/g, " ");
  return out;
}

/**
 * Remove dollar-quoted bodies ($tag$ ... $tag$, tag optional) — i.e. PL/pgSQL
 * function/DO bodies. This matters for the `select ... into` detection: inside
 * a function body, `select ... into v_var` assigns into a VARIABLE (it does NOT
 * create a table), so leaving bodies in would produce false positives that
 * break CI. Top-level table DDL is never written inside a dollar body in this
 * repo's migrations (verified), so stripping bodies loses no real `create
 * table` / `enable row level security` statements. Any table created via
 * dynamic SQL inside a body uses EXECUTE on a string and is not statically
 * analyzable here regardless.
 */
function stripDollarBodies(sql) {
  return sql.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, " ");
}

/**
 * Normalize a possibly schema-qualified, possibly quoted table reference into
 * { schema, name }. Returns null if it cannot be parsed.
 *
 * Accepts forms like: foo, public.foo, "foo", "public"."foo", public."foo".
 *
 * Case folding mirrors Postgres exactly: UNQUOTED identifiers fold to lower
 * case; QUOTED identifiers are case-preserving. So `"Victims"` and `victims`
 * yield different canonical keys and never compare equal — otherwise a
 * `create table "Victims"` paired with an `alter table victims enable rls`
 * (which in real Postgres targets a different/non-existent object) would be
 * wrongly reported as protected.
 */
function parseQualifiedName(raw) {
  const trimmed = raw.trim();
  // Split on the first unquoted dot. Identifiers here are simple enough that a
  // regex capture of up to two parts is sufficient.
  const m = trimmed.match(
    /^("(?<qs>[^"]+)"|(?<bs>[A-Za-z_][A-Za-z0-9_$]*))?\s*(\.\s*("(?<qn>[^"]+)"|(?<bn>[A-Za-z_][A-Za-z0-9_$]*)))?$/,
  );
  if (!m || !m.groups) return null;
  const { qs, bs, qn, bn } = m.groups;
  // A quoted capture (qs/qn) is case-preserving; an unquoted capture (bs/bn)
  // folds to lower case.
  const first =
    qs !== undefined ? normIdent(qs, true)
    : bs !== undefined ? normIdent(bs, false)
    : undefined;
  const second =
    qn !== undefined ? normIdent(qn, true)
    : bn !== undefined ? normIdent(bn, false)
    : undefined;
  if (second !== undefined) {
    // first.second => schema.name
    return { schema: first, name: second };
  }
  if (first !== undefined) {
    // bare name => public schema by default
    return { schema: "public", name: first };
  }
  return null;
}

/**
 * Canonical comparison key for one identifier.
 *  - Unquoted (`quoted === false`): folded to lower case (Postgres semantics).
 *  - Quoted   (`quoted === true`):  case preserved AND tagged with surrounding
 *    quotes so it can never collide with an unquoted identifier of the same
 *    letters (`"Victims"` !== `victims`, and `"public"` !== `public`).
 *
 * The schema comparison in collectFromSql checks `=== "public"`, which only
 * matches an UNQUOTED `public`. That is intentional: Postgres treats an
 * unquoted `public` schema reference as the canonical public schema, while a
 * quoted `"Public"` would be a different (non-existent) schema and is correctly
 * ignored. An explicit quoted `"public"` is an extreme edge case not used in
 * this repo's migrations.
 */
function normIdent(ident, quoted) {
  return quoted ? `"${ident}"` : ident.toLowerCase();
}

// A (possibly schema-qualified, possibly quoted) identifier fragment, reused
// across the DDL patterns below.
const IDENT = `(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\\s*\\.\\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))?`;

// Any table-creating `create ... table` form. Optional persistence modifiers
// (`global`/`local` + `temp`/`temporary`/`unlogged`) precede `table`. This also
// matches CTAS (`create table foo as ...`) and partitions (`create table foo
// partition of ...`): both create a real relation that needs RLS, so detecting
// the name is the correct, fail-loud behavior.
const CREATE_TABLE_RE = new RegExp(
  `\\bcreate\\s+(?:(?:global|local)\\s+)?(?:(?:temp|temporary|unlogged)\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${IDENT})`,
  "gi",
);

// `select ... into [temp|temporary|unlogged] <name> from ...` also creates a
// table. `into` must not be preceded by `insert` (INSERT ... has no INTO-table
// semantics that create relations) — `select ... into` is the only CTAS-like
// form here. We anchor on `\bselect\b ... \binto\b` to avoid matching unrelated
// `into` keywords.
const SELECT_INTO_RE = new RegExp(
  `\\bselect\\b[\\s\\S]*?\\binto\\s+(?:(?:temp|temporary|unlogged)\\s+)?(${IDENT})`,
  "gi",
);

// `alter table [only] <name> ... enable row level security`
const ENABLE_RLS_RE = new RegExp(
  `\\balter\\s+table\\s+(?:only\\s+)?(${IDENT})\\s+enable\\s+row\\s+level\\s+security`,
  "gi",
);

function collectFromSql(sql, createdTables, rlsEnabled) {
  // Strip comments first, then dollar-quoted bodies (so PL/pgSQL `select ...
  // into v_var` assignments inside function bodies are never mistaken for a
  // table-creating `select ... into`).
  const clean = stripDollarBodies(stripComments(sql));

  for (const m of clean.matchAll(CREATE_TABLE_RE)) {
    const parsed = parseQualifiedName(m[1]);
    if (!parsed) continue;
    if (parsed.schema !== "public") continue; // ignore storage./auth./etc.
    createdTables.add(parsed.name);
  }

  for (const m of clean.matchAll(SELECT_INTO_RE)) {
    const parsed = parseQualifiedName(m[1]);
    if (!parsed) continue;
    if (parsed.schema !== "public") continue;
    createdTables.add(parsed.name);
  }

  for (const m of clean.matchAll(ENABLE_RLS_RE)) {
    const parsed = parseQualifiedName(m[1]);
    if (!parsed) continue;
    if (parsed.schema !== "public") continue;
    rlsEnabled.add(parsed.name);
  }
}

function loadMigrations() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort();
  const createdTables = new Set();
  const rlsEnabled = new Set();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    collectFromSql(sql, createdTables, rlsEnabled);
  }
  return { files, createdTables, rlsEnabled };
}

test("migrations directory exists and has SQL files", () => {
  const { files } = loadMigrations();
  assert.ok(files.length > 0, "expected at least one .sql migration");
});

test("parser distinguishes views and non-public schemas", () => {
  const created = new Set();
  const rls = new Set();
  collectFromSql(
    `
      create or replace view public_help_requests as select 1;
      create table public.foo (id int);
      alter table public.foo enable row level security;
      create table storage.objects (id int);
      create table "auth"."users" (id int);
      -- create table commented_out (id int);
      /* create table block_commented (id int); */
    `,
    created,
    rls,
  );
  assert.deepEqual([...created].sort(), ["foo"], "only public.foo is a table");
  assert.ok(rls.has("foo"));
});

test("parser detects table-creating DDL that plain `create table` misses", () => {
  // Each of these creates a real public relation that requires RLS. The guard
  // must FLAG them as missing RLS (i.e. they appear in createdTables but not in
  // rlsEnabled). Before this hardening these silently passed (false negatives).
  const variants = {
    "create temp table": `create temp table victims (id int);`,
    "create temporary table": `create temporary table victims (id int);`,
    "create global temp table": `create global temporary table victims (id int);`,
    "create local temp table": `create local temp table victims (id int);`,
    "create unlogged table": `create unlogged table victims (id int);`,
    "create table as (CTAS)": `create table victims as select * from src;`,
    "create table partition of": `create table victims_2024 partition of victims for values from ('2024-01-01') to ('2025-01-01');`,
    "select into": `select * into victims from src;`,
    "select into unlogged": `select * into unlogged victims from src;`,
  };
  for (const [label, sql] of Object.entries(variants)) {
    const created = new Set();
    const rls = new Set();
    collectFromSql(sql, created, rls);
    assert.ok(
      created.size > 0,
      `${label}: table-creating DDL was NOT detected (false negative)`,
    );
    const missing = [...created].filter((t) => !rls.has(t) && !KNOWN_NO_RLS.has(t));
    assert.ok(
      missing.length > 0,
      `${label}: created table without RLS should be flagged as missing`,
    );
  }
});

test("quoted identifiers are case-sensitive (no false 'protected')", () => {
  // In Postgres `"Victims"` (quoted) and `victims` (unquoted) are DIFFERENT
  // objects. A quoted create paired with an unquoted-named RLS does NOT protect
  // the quoted table, so the guard must still flag it as missing RLS.
  const created = new Set();
  const rls = new Set();
  collectFromSql(
    `create table "Victims" (id int);
     alter table victims enable row level security;`,
    created,
    rls,
  );
  assert.ok(created.has('"Victims"'), 'expected quoted "Victims" to be tracked');
  assert.ok(rls.has("victims"), "expected unquoted victims RLS to be tracked");
  assert.ok(
    !rls.has('"Victims"'),
    'unquoted RLS must NOT count as protecting quoted "Victims"',
  );
  const missing = [...created].filter((t) => !rls.has(t) && !KNOWN_NO_RLS.has(t));
  assert.deepEqual(
    missing,
    ['"Victims"'],
    'quoted "Victims" must be reported as missing RLS',
  );
});

test("matching quoted create + quoted RLS is recognized as protected", () => {
  // Conversely, when the RLS statement uses the SAME quoted identifier, it IS
  // protected and must not be flagged (guards against over-strict regressions).
  const created = new Set();
  const rls = new Set();
  collectFromSql(
    `create table "Victims" (id int);
     alter table "Victims" enable row level security;`,
    created,
    rls,
  );
  const missing = [...created].filter((t) => !rls.has(t) && !KNOWN_NO_RLS.has(t));
  assert.deepEqual(missing, [], 'quoted "Victims" with matching quoted RLS is protected');
});

test("PL/pgSQL `select ... into <var>` does not create false positives", () => {
  // Inside a function body, `select ... into v_var` assigns to a VARIABLE and
  // must NOT be treated as a table. Dollar-body stripping handles this.
  const created = new Set();
  const rls = new Set();
  collectFromSql(
    `create function f() returns bool language plpgsql as $$
       declare v_owner uuid;
       begin
         select locked_by into v_owner from group_locks where id = 1;
         select count(*) into strict v_owner from t;
         return true;
       end;
     $$;`,
    created,
    rls,
  );
  assert.deepEqual([...created], [], "no tables should be detected in function body");
});

test("every public table has RLS enabled", () => {
  const { createdTables, rlsEnabled } = loadMigrations();

  const missing = [...createdTables]
    .filter((t) => !rlsEnabled.has(t))
    .filter((t) => !KNOWN_NO_RLS.has(t))
    .sort();

  assert.deepEqual(
    missing,
    [],
    `Public tables missing 'enable row level security': ${missing.join(", ")}.\n` +
      `Add 'alter table <name> enable row level security;' in a migration, or, ` +
      `if intentional, add it to KNOWN_NO_RLS with a justifying comment.`,
  );

  // Sanity: ensure we actually parsed a meaningful set of tables.
  assert.ok(
    createdTables.size >= 1,
    "expected to discover at least one public table",
  );
});
