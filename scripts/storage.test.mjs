// Tests for the pure URL-merge logic in storageUtils.mjs (no Supabase required).
// Corre: node --test scripts/storage.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSignedUrls } from "../src/lib/storageUtils.mjs";

test("null paths remain null regardless of signed results", () => {
  const result = mergeSignedUrls([null, null], []);
  assert.deepEqual(result, [null, null]);
});

test("http/https paths pass through unchanged (legacy public URLs)", () => {
  const url = "https://example.supabase.co/public/checkin-photos/foo.jpg";
  const result = mergeSignedUrls([url], []);
  assert.deepEqual(result, [url]);
});

test("bare path replaced by its signed URL", () => {
  const path = "abc/photo.jpg";
  const signed = "https://project.supabase.co/storage/v1/object/sign/checkin-photos/abc/photo.jpg?token=xyz";
  const result = mergeSignedUrls([path], [{ path, signedUrl: signed }]);
  assert.deepEqual(result, [signed]);
});

test("bare path with missing signed entry returns null", () => {
  const result = mergeSignedUrls(["abc/missing.jpg"], []);
  assert.deepEqual(result, [null]);
});

test("mixed array: null, http, bare (success), bare (miss)", () => {
  const http = "https://example.com/photo.jpg";
  const bare = "abc/photo.jpg";
  const signed = "https://signed.example.com/photo.jpg?token=x";
  const result = mergeSignedUrls(
    [null, http, bare, "abc/notfound.jpg"],
    [{ path: bare, signedUrl: signed }],
  );
  assert.deepEqual(result, [null, http, signed, null]);
});

test("signedUrl null in result maps to null", () => {
  const result = mergeSignedUrls(["abc/photo.jpg"], [{ path: "abc/photo.jpg", signedUrl: null }]);
  assert.deepEqual(result, [null]);
});
