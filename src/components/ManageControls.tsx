"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  exchangeManageToken,
  markCheckinFound,
  resolveHelpRequest,
  resolveDamagedReport,
} from "@/app/actions";
import { siteUrl } from "@/lib/share";

const HASH_RE =
  /^#t=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Reporter-only management. On a fresh report the value arrives in the URL
// fragment and is exchanged once for a scoped HttpOnly cookie; later visits rely
// on that cookie (`canManage`). A random visitor with only the public id sees
// nothing.
export default function ManageControls({
  kind,
  id,
  resolved,
  canManage = false,
  isNew = false,
}: {
  kind: "checkin" | "request" | "damaged";
  id: string;
  resolved: boolean;
  canManage?: boolean;
  isNew?: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("components.manageControls");
  const tc = useTranslations("common");
  // `linkValue` is the raw value, kept in memory only to build the share link
  // right after creation. `granted` gates the controls (cookie or fresh claim).
  const [linkValue, setLinkValue] = useState<string | null>(null);
  const [granted, setGranted] = useState(canManage);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (canManage) return;
    const m = window.location.hash.match(HASH_RE);
    if (!m) return;
    const value = m[1];
    exchangeManageToken(kind, id, value)
      .then((r) => {
        if (r.ok) {
          setLinkValue(value);
          setGranted(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        try {
          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search
          );
        } catch {
          /* ignore */
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!granted && !isNew) return null;

  const path = `/${
    kind === "checkin" ? "persona" : kind === "request" ? "solicitud" : "edificio"
  }/${id}`;

  async function copyManageLink() {
    if (!linkValue) return;
    try {
      await navigator.clipboard.writeText(siteUrl(`${path}#t=${linkValue}`));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const result =
        kind === "checkin"
          ? await markCheckinFound(id, !resolved)
          : kind === "request"
            ? await resolveHelpRequest(id, !resolved)
            : await resolveDamagedReport(id, !resolved);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? t("updateFailed"));
      }
    } catch {
      setError(t("updateFailedRetry"));
    } finally {
      setPending(false);
    }
  }

  const actionLabel =
    kind === "checkin"
      ? resolved
        ? t("checkinReopen")
        : t("checkinResolve")
      : kind === "request"
        ? resolved
          ? t("requestReopen")
          : t("requestResolve")
        : resolved
          ? t("damagedReopen")
          : t("damagedResolve");

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      {isNew && linkValue && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="font-bold text-amber-900">
            {t("saveLinkNotice")}
          </p>
          <button
            type="button"
            onClick={copyManageLink}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-200 px-4 py-3 font-bold text-amber-900 active:scale-[0.99]"
          >
            <span aria-hidden>🔗</span>{" "}
            {copied ? tc("copied") : t("copyManageLink")}
          </button>
        </div>
      )}

      {granted && (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          style={
            resolved
              ? undefined
              : { backgroundColor: "#1f7a52" }
          }
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-3 font-bold active:scale-[0.99] disabled:opacity-60 ${
            resolved
              ? "bg-slate-200 text-slate-800"
              : "text-white"
          }`}
        >
          {pending ? t("saving") : actionLabel}
        </button>
      )}

      {error && <p className="mt-3 text-sm font-bold text-red-600">{error}</p>}
    </section>
  );
}
