import "server-only";
import { getServerSupabase, isSupabaseConfigured, hasSecretKey } from "@/lib/supabase/server";
import { logWarn } from "@/lib/log.mjs";

const BUCKET = "checkin-photos";
const SIGNED_URL_TTL = 60 * 60; // 1 hour

// Private bucket signing requires the service-role key — anon key has no
// SELECT policy on storage.objects, so signing with it always fails silently.
// Guard both helpers so the misconfiguration is visible (logged) rather than
// quietly returning null (which renders all photos broken with no trace).
function canSign(): boolean {
  if (!isSupabaseConfigured()) return false;
  if (!hasSecretKey()) {
    logWarn("storage_sign_no_secret_key", { scope: "lib.storage", bucket: BUCKET });
    return false;
  }
  return true;
}

// Returns a signed URL for a photo stored in the private checkin-photos bucket.
// Handles the transition period: existing rows may still hold a full public URL
// (written before this migration). Those pass through unchanged until the DB
// backfill runs and the bucket is set to private in the Supabase dashboard.
export async function signedPhotoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  if (!canSign()) return null;
  const supabase = getServerSupabase();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  return error ? null : (data?.signedUrl ?? null);
}

// Batch variant for pages that display many photos at once (e.g. the gallery).
export async function signedPhotoUrls(
  paths: (string | null)[],
): Promise<(string | null)[]> {
  const toSign = paths.filter((p): p is string => Boolean(p) && !p.startsWith("http"));
  if (!toSign.length || !canSign()) {
    return paths.map((p) => (p?.startsWith("http") ? p : null));
  }
  const supabase = getServerSupabase();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(toSign, SIGNED_URL_TTL);
  if (error || !data) return paths.map(() => null);
  const signed = new Map(data.map((d): [string, string | null] => [d.path, d.signedUrl ?? null]));
  return paths.map((p) => {
    if (!p) return null;
    if (p.startsWith("http")) return p;
    return signed.get(p) ?? null;
  });
}
