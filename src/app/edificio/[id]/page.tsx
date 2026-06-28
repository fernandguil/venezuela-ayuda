import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import Header from "@/components/Header";
import ShareButtons from "@/components/ShareButtons";
import SourceBadge from "@/components/SourceBadge";
import ManageControls from "@/components/ManageControls";
import RiskResult from "@/components/RiskResult";
import GuideInvitePopup from "@/components/GuideInvitePopup";
import { getDamagedReport } from "@/lib/data";
import { fullDate, timeAgo } from "@/lib/format";
import { siteUrl } from "@/lib/share";
import { DAMAGE_SEVERITY, REQUEST_STATUSES } from "@/lib/constants";

export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const r = await getDamagedReport(id);
  if (!r) return { title: "Reporte no encontrado — Venezuela Ayuda" };
  return { title: `${r.place_name} — Venezuela Ayuda` };
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
  const r = await getDamagedReport(id);
  if (!r) notFound();
  const canManage = Boolean((await cookies()).get(`mt_${r.id}`)?.value);

  const tr = await getTranslations("detail");
  const tD = await getTranslations("domain");

  const severity = DAMAGE_SEVERITY[r.severity];
  const url = siteUrl(`/edificio/${r.id}`);
  const shareText = `🏚️ Reporte de edificio dañado en Venezuela Ayuda`;

  return (
    <>
      <Header />
      <main id="contenido" className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        {nuevo === "1" && <GuideInvitePopup />}
        <Link
          href="/mapa"
          className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-800"
        >
          {tr("backMap")}
        </Link>

        {nuevo === "1" && (
          <p className="mt-3 rounded-xl bg-green-50 px-4 py-3 font-medium text-green-800">
            {tr("building.createdOk")}
          </p>
        )}

        <article className="mt-4 rounded-2xl bg-white p-6 ring-1 ring-black/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-3xl font-extrabold text-slate-900">{r.place_name}</h1>
            {r.status === "RESOLVED" && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold"
                style={{ backgroundColor: "#eaf3ec", color: REQUEST_STATUSES.RESOLVED.color }}
              >
                ✅ {tD("requestStatus.RESOLVED")}
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {severity && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold"
                style={{ backgroundColor: severity.tintBg, color: severity.color }}
              >
                {tD(`severity.${r.severity}`)}
              </span>
            )}
          </div>

          {r.risk_level && (
            <RiskResult
              level={r.risk_level}
              priority={r.risk_priority}
              shareUrl={url}
              shareText={shareText}
            />
          )}

          {r.photo_url && (
            <Image
              src={r.photo_url}
              alt=""
              width={800}
              height={600}
              className="mt-4 max-h-80 w-full rounded-xl object-cover ring-1 ring-slate-200"
            />
          )}

          {r.description && (
            <blockquote className="mt-4 border-l-4 border-slate-200 pl-4 text-lg text-slate-800">
              “{r.description}”
            </blockquote>
          )}

          {r.city && <p className="mt-4 text-slate-600">📍 {r.city}</p>}

          <p className="mt-4 text-sm text-slate-400" title={fullDate(r.created_at)}>
            {tr("building.updated", { ago: timeAgo(r.created_at) })}
          </p>

          <p className="mt-4 text-sm text-slate-500">
            {tr("building.communityNote")}
          </p>

          {r.source && (
            <p className="mt-2">
              <SourceBadge source={r.source} url={r.source_url} />
            </p>
          )}

          <div className="mt-6 border-t border-slate-100 pt-5">
            <p className="mb-2 font-semibold text-slate-800">{tr("building.shareThis")}</p>
            <ShareButtons text={shareText} url={url} compact />
          </div>
        </article>

        <ManageControls
          kind="damaged"
          id={r.id}
          resolved={r.status === "RESOLVED"}
          canManage={canManage}
          isNew={nuevo === "1"}
        />

        <div className="mt-6 grid gap-2">
          <Link
            href="/mapa"
            className="rounded-xl bg-slate-900 px-5 py-3.5 text-center font-bold text-white"
          >
            {tr("building.viewMap")}
          </Link>
        </div>
      </main>
    </>
  );
}
