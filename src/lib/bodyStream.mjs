// Streaming body helper — reads at most maxBytes from a ReadableStream before
// accepting or rejecting the body. Used by POST/PATCH route handlers to enforce
// a byte cap without trusting the caller-provided Content-Length header.
//
// Returns a discriminated union so callers can produce distinct HTTP statuses:
//   { text }      — success, body fits within cap
//   { overflow }  — body exceeded maxBytes, caller should return 413
//   { error }     — stream or decode error, caller should return 400

/**
 * @param {ReadableStream<Uint8Array> | null} body
 * @param {number} maxBytes
 * @returns {Promise<{ text: string } | { overflow: true } | { error: true }>}
 */
export async function readBodyUpTo(body, maxBytes) {
  if (!body) return { text: "" };
  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return { overflow: true };
      chunks.push(value);
    }
  } catch {
    return { error: true };
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { combined.set(c, pos); pos += c.byteLength; }
  try {
    return { text: new TextDecoder().decode(combined) };
  } catch {
    return { error: true };
  }
}
