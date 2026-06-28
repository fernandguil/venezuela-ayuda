// Tests for FR biometric indexing consent gate (pure logic, no FR-API calls).
// Corre: node --test scripts/fr-consent.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldIndexForFR, THIRD_PARTY_PHOTO_STATUSES } from "../src/lib/frConsent.mjs";

// --- Consent must be explicitly "1" ---

test("no consent (null) → no indexing", () => {
  assert.equal(shouldIndexForFR(null, "I_AM_OKAY"), false);
});

test("consent '0' → no indexing", () => {
  assert.equal(shouldIndexForFR("0", "I_AM_OKAY"), false);
});

test("consent '' → no indexing", () => {
  assert.equal(shouldIndexForFR("", "I_AM_OKAY"), false);
});

test("consent 'true' (wrong value) → no indexing", () => {
  assert.equal(shouldIndexForFR("true", "I_AM_OKAY"), false);
});

// --- Third-party photo statuses are blocked even with consent ---

for (const status of THIRD_PARTY_PHOTO_STATUSES) {
  test(`LOOKING_FOR_SOMEONE status '${status}' with consent → no indexing`, () => {
    assert.equal(shouldIndexForFR("1", status), false);
  });
}

// --- Valid consent + own photo → index ---

test("consent '1' + I_AM_OKAY → index", () => {
  assert.equal(shouldIndexForFR("1", "I_AM_OKAY"), true);
});

test("consent '1' + HOSPITALIZED → index", () => {
  assert.equal(shouldIndexForFR("1", "HOSPITALIZED"), true);
});

test("consent '1' + FOUND_SAFE → index", () => {
  assert.equal(shouldIndexForFR("1", "FOUND_SAFE"), true);
});
