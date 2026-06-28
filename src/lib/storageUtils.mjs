// Pure helpers for signed URL merging — no server-only imports, testable with
// node --test. Exported for use by storage.ts and scripts/storage.test.mjs.

/**
 * Merges Supabase-signed URL results back into the original paths array.
 * - null paths remain null
 * - http/https paths pass through unchanged (legacy public URLs)
 * - bare storage paths are replaced with their signed URL (or null on miss)
 *
 * @param {(string|null)[]} paths - original path array
 * @param {{ path: string; signedUrl: string | null }[]} signed - signed results
 * @returns {(string|null)[]}
 */
export function mergeSignedUrls(paths, signed) {
  const byPath = new Map(signed.map((d) => [d.path, d.signedUrl ?? null]));
  return paths.map((p) => {
    if (!p) return null;
    if (p.startsWith("http")) return p;
    return byPath.get(p) ?? null;
  });
}
