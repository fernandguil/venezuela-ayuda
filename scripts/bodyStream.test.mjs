// Tests for readBodyUpTo in src/lib/bodyStream.mjs.
// No HTTP server or DB required — works with Node.js ReadableStream directly.
// Corre: node --test scripts/bodyStream.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readBodyUpTo } from "../src/lib/bodyStream.mjs";

function streamFrom(chunks) {
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(typeof c === "string" ? new TextEncoder().encode(c) : c);
      ctrl.close();
    },
  });
}

function streamError() {
  return new ReadableStream({
    start(ctrl) {
      ctrl.error(new Error("simulated stream error"));
    },
  });
}

// --- Null body ---

test("null body returns { text: '' }", async () => {
  const result = await readBodyUpTo(null, 1024);
  assert.deepEqual(result, { text: "" });
});

// --- Normal reads ---

test("body within cap returns { text }", async () => {
  const result = await readBodyUpTo(streamFrom(['{"ok":true}']), 1024);
  assert.deepEqual(result, { text: '{"ok":true}' });
});

test("empty stream returns { text: '' }", async () => {
  const result = await readBodyUpTo(streamFrom([]), 1024);
  assert.deepEqual(result, { text: "" });
});

test("multi-chunk body assembles correctly", async () => {
  const result = await readBodyUpTo(streamFrom(["hel", "lo"]), 1024);
  assert.deepEqual(result, { text: "hello" });
});

// --- Overflow detection ---

test("body exactly at cap (= maxBytes) is allowed", async () => {
  const cap = 10;
  const body = "a".repeat(cap);
  const result = await readBodyUpTo(streamFrom([body]), cap);
  assert.deepEqual(result, { text: body });
});

test("body one byte over cap returns { overflow: true }", async () => {
  const cap = 10;
  const body = "a".repeat(cap + 1);
  const result = await readBodyUpTo(streamFrom([body]), cap);
  assert.deepEqual(result, { overflow: true });
});

test("large body returns { overflow: true } without reading it all", async () => {
  const cap = 100;
  // Two chunks that together exceed cap
  const result = await readBodyUpTo(streamFrom(["a".repeat(60), "b".repeat(60)]), cap);
  assert.deepEqual(result, { overflow: true });
});

// --- Stream errors ---

test("stream error returns { error: true }", async () => {
  const result = await readBodyUpTo(streamError(), 1024);
  assert.deepEqual(result, { error: true });
});
