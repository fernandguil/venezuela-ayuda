import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import Header from "@/components/Header";
import StatusBadge from "@/components/StatusBadge";
import SourceBadge from "@/components/SourceBadge";
import ShareButtons from "@/components/ShareButtons";
import ManageControls from "@/components/ManageControls";
import GuideInvitePopup from "@/components/GuideInvitePopup";
import SightingForm from "@/components/SightingForm";
import SightingsInbox from "@/components/SightingsInbox";
import { getCheckin } from "@/lib/data";
import { fullDate, timeAgo } from "@/lib/format";
import { siteUrl } from "@/lib/share";
import { CHECKIN_STATUSES, FOUND_BADGE } from "@/lib/constants";

export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const c = await getCheckin(id);
  if (!c) return { title: "Persona no encontrada — Venezuela Ayuda" };
  const status = CHECKIN_STATUSES[c.status].label;
  return {
    title: `${c.name} — ${status} · Venezuela Ayuda`,
    description: c.message ?? `${c.name} se reportó como ${status}.`,
  };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nuevo?: string }>;
}) {
  const { id } = await params;
  const { nuevo } = await searchParams;
  const c = await getCheckin(id);
  if (!c) notFound();
  const canManage = Boolean((await cookies()).get(`mt_${c.id}`)?.value);

  const tr = await getTranslations("detail");
  const tD = await getTranslations("domain");

  const url = siteUrl(`/persona/${c.id}`);
  const statusLabel = tD(`checkinStatus.${c.status}`);
  const shareText = `${c.name} se reportó como "${statusLabel}" en Venezuela Ayuda.`;

  return (
    <>
      <Header />
      <main id="contenido" className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        {nuevo === "1" && <GuideInvitePopup />}
        <Link
          href="/buscar"
          className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-800"
        >
          {tr("backSearch")}
        </Link>

        {nuevo === "1" && (
          <p className="mt-3 rounded-xl bg-green-50 px-4 py-3 font-medium text-green-800">
            {tr("person.createdOk")}
          </p>
        )}

        <article className="mt-4 rounded-2xl bg-white p-6 ring-1 ring-black/5">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-3xl font-extrabold text-slate-900">{c.name}</h1>
            {c.found_at ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold"
                style={{ backgroundColor: FOUND_BADGE.tintBg, color: FOUND_BADGE.tintText }}
              >
                {FOUND_BADGE.emoji} {tD("foundBadge")}
              </span>
            ) : (
              <StatusBadge status={c.status} />
            )}
          </div>

          {c.photo_url && (
            <Image
              src={c.photo_url}
              alt={tr("person.photoAlt", { name: c.name })}
              width={800}
              height={600}
              className="mt-4 max-h-80 w-full rounded-xl object-cover ring-1 ring-slate-200"
            />
          )}

          {c.place_name && <p className="mt-2 text-slate-600">🏢 {c.place_name}</p>}
          {c.city && <p className="mt-2 text-slate-600">📍 {c.city}</p>}

          {c.found_at && (
            <p className="mt-2 text-sm font-medium text-green-700">
              {tr("person.foundOn", { date: fullDate(c.found_at) })}
            </p>
          )}

          {c.message && (
            <blockquote className="mt-4 border-l-4 border-slate-200 pl-4 text-lg text-slate-800">
              “{c.message}”
            </blockquote>
          )}

          <p className="mt-4 text-sm text-slate-400" title={fullDate(c.created_at)}>
            {tr("person.updated", { ago: timeAgo(c.created_at) })}
          </p>

          {c.source && (
            <p className="mt-2">
              <SourceBadge source={c.source} url={c.source_url} />
            </p>
          )}

          <div className="mt-6 border-t border-slate-100 pt-5">
            <p className="mb-2 font-semibold text-slate-800">{tr("person.shareThis")}</p>
            <ShareButtons text={shareText} url={url} compact />
          </div>
        </article>

        {c.status === "LOOKING_FOR_SOMEONE" && (
          <ManageControls
            kind="checkin"
            id={c.id}
            resolved={!!c.found_at}
            canManage={canManage}
            isNew={nuevo === "1"}
          />
        )}

        {c.status === "LOOKING_FOR_SOMEONE" && !c.found_at && (
          <div className="mt-6">
            {c.source ? (
              <section className="rounded-2xl border border-[#e6ecf2] bg-white p-4">
                <h2 className="font-semibold text-[#14212e]">
                  {tr("person.recognizeTitle")}
                </h2>
                <p className="mt-1 text-sm text-[#5b6b7b]">
                  {tr("person.recognizeFromSource", { source: c.source })}
                </p>
                <p className="mt-2">
                  <SourceBadge source={c.source} url={c.source_url} />
                </p>
              </section>
            ) : (
              <>
                <SightingForm checkinId={c.id} />
                <SightingsInbox checkinId={c.id} canManage={canManage} />
              </>
            )}
          </div>
        )}

        <p className="mt-3 text-center text-xs text-slate-400">
          {tr("person.phonePrivacy")}
        </p>

        <div className="mt-6 grid gap-2">
          <Link
            href="/a-salvo"
            className="rounded-xl bg-green-600 px-5 py-3.5 text-center font-bold text-white"
          >
            {tr("person.markMeSafe")}
          </Link>
          <Link
            href="/mapa"
            className="rounded-xl bg-slate-900 px-5 py-3.5 text-center font-bold text-white"
          >
            {tr("person.viewMap")}
          </Link>
        </div>
      </main>
    </>
  );
}
