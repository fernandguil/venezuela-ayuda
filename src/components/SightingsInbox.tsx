"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { exchangeManageToken, fetchSightings } from "@/app/actions";
import type { Sighting } from "@/lib/types";
import { timeAgo } from "@/lib/format";

const HASH_RE =
  /^#t=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Only the original reporter sees the avisos. Access is a scoped HttpOnly cookie
// (`canManage`); on a fresh report the value arrives in the URL fragment and is
// exchanged for that cookie before loading.
export default function SightingsInbox({
  checkinId,
  canManage = false,
}: {
  checkinId: string;
  canManage?: boolean;
}) {
  const t = useTranslations("components.sightingsInbox");
  const tc = useTranslations("common");
  const [granted, setGranted] = useState(canManage);
  const [sightings, setSightings] = useState<Sighting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // On a fresh report, exchange the fragment value for the cookie before loading.
  useEffect(() => {
    if (canManage) return;
    const m = window.location.hash.match(HASH_RE);
    if (!m) return;
    exchangeManageToken("checkin", checkinId, m[1])
      .then((r) => {
        if (r.ok) setGranted(true);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load avisos once access is granted.
  useEffect(() => {
    if (!granted || loaded) return;
    let active = true;
    fetchSightings(checkinId).then((res) => {
      if (!active) return;
      setLoaded(true);
      if (res.ok) {
        setSightings(res.sightings ?? []);
      } else {
        setError(res.error ?? t("loadFailed"));
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkinId, granted, loaded]);

  if (!granted) return null;

  const count = sightings?.length ?? 0;

  return (
    <section className="mt-4 rounded-2xl border border-[#e6ecf2] bg-white p-4">
      <h2 className="font-semibold text-[#14212e]">{t("title", { count })}</h2>

      {error ? (
        <p className="mt-2 text-sm font-medium text-red-600">{error}</p>
      ) : !sightings ? (
        <p className="mt-2 text-sm text-[#8190a0]">{tc("loading")}</p>
      ) : sightings.length === 0 ? (
        <p className="mt-2 text-sm text-[#8190a0]">{t("empty")}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {sightings.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-[#e6ecf2] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[#14212e]">
                  {s.finder_name || t("anonymous")}
                </span>
                <span className="text-xs text-[#8190a0]">
                  {timeAgo(s.created_at)}
                </span>
              </div>
              {s.finder_contact && (
                <p className="mt-1 text-sm font-bold text-[#14212e]">
                  {s.finder_contact}
                </p>
              )}
              {s.message && (
                <p className="mt-1 text-sm text-[#5b6b7b]">{s.message}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
