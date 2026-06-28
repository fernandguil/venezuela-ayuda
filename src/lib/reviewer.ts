import "server-only";
import { getAuthClient } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/rbac";

// Reviewer identity for the /deduplicar console.
// Authorization is now RBAC-backed: a user is a reviewer if they hold the
// `modupe.review` permission (via the `reviewer` or `admin` role in user_roles).
// Admins are reviewers by data (the `admin` role includes `modupe.review` in
// role_permissions), not by hardcoded logic.

export interface Reviewer {
  id: string; // auth.users.id — used as the lock owner (locked_by)
  email: string;
}

// Returns the logged-in reviewer (id + email), or null if not authenticated
// or not authorized.
export async function getReviewer(): Promise<Reviewer | null> {
  if (!isSupabaseConfigured()) return null;
  const auth = await getAuthClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  const email = user?.email?.toLowerCase();
  if (!user || !email) return null;
  return (await isEmailReviewer(email)) ? { id: user.id, email } : null;
}

export async function isEmailReviewer(email: string): Promise<boolean> {
  return hasPermission(email.toLowerCase(), "modupe.review");
}
