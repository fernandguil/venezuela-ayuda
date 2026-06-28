// Helpers del valor de gestión de reportes.
// Corre: node --test scripts/manage-token.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashManageToken, tokensMatch } from "../src/lib/manageToken.mjs";

test("hashManageToken: hex de 64 chars, determinístico", () => {
  const h = hashManageToken("abc");
  assert.equal(h, hashManageToken("abc"));
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("hashManageToken: deriva el mismo valor que la columna en SQL", () => {
  const raw = "11111111-1111-4111-8111-111111111111";
  const expected = createHash("sha256").update(raw).digest("hex");
  assert.equal(hashManageToken(raw), expected);
});

test("tokensMatch: true para el valor correcto", () => {
  const raw = "9e8d7c6b-aaaa-4bbb-8ccc-ddddeeeeffff";
  assert.equal(tokensMatch(raw, hashManageToken(raw)), true);
});

test("tokensMatch: false para valor incorrecto", () => {
  const raw = "9e8d7c6b-aaaa-4bbb-8ccc-ddddeeeeffff";
  assert.equal(tokensMatch("otro", hashManageToken(raw)), false);
});

test("tokensMatch: false (sin lanzar) ante vacíos o longitudes distintas", () => {
  assert.equal(tokensMatch("", hashManageToken("x")), false);
  assert.equal(tokensMatch("x", ""), false);
  assert.equal(tokensMatch("x", "abc"), false);
  assert.equal(tokensMatch(null, null), false);
});
