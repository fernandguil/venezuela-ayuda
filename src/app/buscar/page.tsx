import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import PageShell from "@/components/PageShell";
import PersonResultCard from "@/components/PersonResultCard";
import CedulaSearchForm from "@/components/CedulaSearchForm";
import SourcesNote from "@/components/SourcesNote";
import {
  searchCheckins,
  searchHelpRequests,
  searchHospitalRegistry,
  searchMissingPersonsApi,
} from "@/lib/data";
import { mergePeople } from "@/lib/people";
import { HELP_CATEGORIES, URGENCY_LEVELS } from "@/lib/constants";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = {
  title: "Buscar persona — Venezuela Ayuda",
  description: "Busca a un familiar o amigo por nombre, edificio o ciudad.",
};

// Re-fetch frequently; this list changes during an emergency.
export const revalidate = 30;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ciudad?: string }>;
}) {
  const sp = await searchParams;
  const qStr = sp.q?.trim() || "";
  const city = sp.ciudad?.trim() || "";
  const hasQuery = qStr.length >= 2 || city.length >= 2;

  const [checkins, places, registry, desaparecidos] = hasQuery
    ? await Promise.all([
        searchCheckins({ q: qStr, city }),
        searchHelpRequests({ q: qStr, city }),
        searchHospitalRegistry({ q: qStr, city }),
        searchMissingPersonsApi({ q: qStr, city }),
      ])
    : [[], [], [], []];

  // Collapse the same person found across sources into one merged result.
  const people = mergePeople(checkins, registry, desaparecidos);
  const total = people.length + places.length;

  const t = await getTranslations("search");
  const tCommon = await getTranslations("common");
  const tD = await getTranslations("domain");

  return (
    <PageShell
      emoji="🔎"
      title={t("title")}
      intro={t("intro")}
    >
      <form method="get" className="space-y-3" role="search">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            name="q"
            defaultValue={qStr}
            placeholder={t("nameOrBuilding")}
            aria-label={t("nameOrBuilding")}
            maxLength={80}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base"
          />
          <input
            name="ciudad"
            defaultValue={city}
            placeholder={tCommon("city")}
            aria-label={tCommon("city")}
            maxLength={80}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base"
          />
        </div>
        <button
          type="submit"
          className="min-h-[56px] w-full rounded-[15px] px-5 py-3.5 text-lg font-semibold text-white active:scale-[0.99]"
          style={{ backgroundColor: "#2563a8" }}
        >
          {t("searchButton")}
        </button>
      </form>

      <CedulaSearchForm />

      <Link
        href="/galeria"
        className="mt-4 block rounded-2xl border border-[#e6ecf2] bg-white p-3 text-center text-sm font-semibold text-[#2563a8]"
      >
        {t("galleryLink")}
      </Link>

      <div className="mt-6">
        {!hasQuery ? (
          <div className="rounded-2xl bg-white p-6 text-center text-slate-600 ring-1 ring-black/5">
            <p className="font-semibold text-slate-800">
              {t("promptTitle")}
            </p>
            <p className="mt-1 text-sm">
              {t("promptPrivacy")}
            </p>
            <div className="mt-5 border-t border-slate-100 pt-5">
              <p className="text-sm">{t("promptNotListed")}</p>
              <Link
                href="/a-salvo?modo=desaparecido"
                className="mt-3 inline-block rounded-[15px] bg-[#2563a8] px-5 py-3 font-semibold text-white"
              >
                {t("reportMissing")}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-500">
              {t("results", { count: total })}
              {qStr && t("resultsFor", { q: qStr })}
              {city && t("resultsIn", { city })}
            </p>

            {total === 0 ? (
              <div className="rounded-2xl bg-white p-6 text-center text-slate-600 ring-1 ring-black/5">
                <p className="font-semibold text-slate-800">{t("noneTitle")}</p>
                <p className="mt-1 text-sm">
                  {t("noneBody")}
                </p>
                <Link
                  href="/a-salvo?modo=desaparecido"
                  className="mt-4 inline-block rounded-[15px] bg-[#2563a8] px-5 py-3 font-semibold text-white"
                >
                  {t("reportMissing")}
                </Link>
              </div>
            ) : (
              <div className="space-y-6">
                {people.length > 0 && (
                  <section>
                    <h2 className="mb-2 text-sm font-semibold text-slate-700">
                      {t("peopleHeading")}{" "}
                      <span className="font-normal text-slate-400">({people.length})</span>
                    </h2>
                    <div className="grid grid-cols-1 gap-3">
                      {people.map((p) => (
                        <PersonResultCard key={p.key} p={p} />
                      ))}
                    </div>
                  </section>
                )}

                {places.length > 0 && (
                  <section>
                    <h2 className="mb-2 text-sm font-semibold text-slate-700">
                      {t("placesHeading")}{" "}
                      <span className="font-normal text-slate-400">({places.length})</span>
                    </h2>
                    <div className="grid grid-cols-1 gap-3">
                      {places.map((r) => {
                        const cat = HELP_CATEGORIES[r.category];
                        const urgency = URGENCY_LEVELS[r.urgency];
                        return (
                          <Link
                            key={r.id}
                            href={`/solicitud/${r.id}`}
                            className="block rounded-2xl border border-[#e6ecf2] bg-white p-4 transition hover:border-[#c9d6e3]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-[#14212e]">
                                {r.place_name || (cat ? tD(`category.${r.category}`) : "")}
                              </h3>
                              {urgency && (
                                <span
                                  className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
                                  style={{
                                    backgroundColor: urgency.tintBg,
                                    color: urgency.color,
                                  }}
                                >
                                  {tD(`urgency.${r.urgency}`)}
                                </span>
                              )}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#8190a0]">
                              {cat && (
                                <span className="rounded-full bg-[#eef3fa] px-2.5 py-1 font-medium text-[#2563a8]">
                                  {cat.emoji} {tD(`category.${r.category}`)}
                                </span>
                              )}
                              {r.city && <span>📍 {r.city}</span>}
                              <span>{t("updated", { time: timeAgo(r.created_at) })}</span>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            )}
          </>
        )}

        <div className="mt-8 rounded-2xl bg-slate-100 p-4 text-center text-sm text-slate-600">
          {t("notFoundPrompt")}{" "}
          <Link href="/a-salvo" className="font-semibold text-blue-700 underline">
            {t("reportSafe")}
          </Link>{" "}
          {t("or")}{" "}
          <Link href="/mapa" className="font-semibold text-blue-700 underline">
            {t("seeMap")}
          </Link>
          .
        </div>

        <SourcesNote />
      </div>
    </PageShell>
  );
}
