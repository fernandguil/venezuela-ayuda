import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCedula, cedulaHash } from "./cedula-lib.mjs";

test("normalizeCedula: digits only default V", () => {
  assert.equal(normalizeCedula("12345678"), "V-12345678");
});

test("normalizeCedula: V with delimiters", () => {
  assert.equal(normalizeCedula("V-12.345.678"), "V-12345678");
  assert.equal(normalizeCedula("V12345678"), "V-12345678");
});

test("normalizeCedula: E prefix", () => {
  assert.equal(normalizeCedula("E87654321"), "E-87654321");
  assert.equal(normalizeCedula("87654321", "E"), "E-87654321");
});

test("normalizeCedula: empty and invalid", () => {
  assert.equal(normalizeCedula(""), null);
  assert.equal(normalizeCedula("abc"), null);
  assert.equal(normalizeCedula("12345"), null);
});

test("cedulaHash: deterministic", () => {
  const h1 = cedulaHash("V-12345678", "test-secret");
  const h2 = cedulaHash("V-12345678", "test-secret");
  assert.equal(h1, h2);
  assert.notEqual(h1, cedulaHash("E-12345678", "test-secret"));
});
