import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import Header from "@/components/Header";
import ShareButtons from "@/components/ShareButtons";
import SourceBadge from "@/components/SourceBadge";
import ManageControls from "@/components/ManageControls";
import GuideInvitePopup from "@/components/GuideInvitePopup";
import RequestResponseForm from "@/components/RequestResponseForm";
import RequestResponsesInbox from "@/components/RequestResponsesInbox";
import { getHelpRequest } from "@/lib/data";
import { fullDate, timeAgo } from "@/lib/format";
import { siteUrl } from "@/lib/share";
import { formatItems } from "@/lib/validation";
import {
  HELP_CATEGORIES,
  URGENCY_LEVELS,
  REQUEST_STATUSES,
} from "@/lib/constants";

export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const r = await getHelpRequest(id);
  if (!r) return { title: "Solicitud no encontrada — Venezuela Ayuda" };
  const cat = HELP_CATEGORIES[r.category]?.label ?? r.category;
  return {
    title: `${r.place_name || cat} — Venezuela Ayuda`,
    description: r.description,
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
  const r = await getHelpRequest(id);
  if (!r) notFound();
  const canManage = Boolean((await cookies()).get(`mt_${r.id}`)?.value);

  const tr = await getTranslations("detail");
  const tD = await getTranslations("domain");

  const category = HELP_CATEGORIES[r.category];
  const categoryLabel = category ? tD(`category.${r.category}`) : r.category;
  const title = r.place_name || categoryLabel;
  const urgency = URGENCY_LEVELS[r.urgency];

  const url = siteUrl(`/solicitud/${r.id}`);
  const shareText = `🆘 Solicitud de ayuda en Venezuela Ayuda`;

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
            {tr("request.createdOk")}
          </p>
        )}

        <article className="mt-4 rounded-2xl bg-white p-6 ring-1 ring-black/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-3xl font-extrabold text-slate-900">{title}</h1>
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
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
              {category?.emoji} {categoryLabel}
            </span>
            {urgency && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold"
                style={{ backgroundColor: urgency.tintBg, color: urgency.color }}
              >
                {tD(`urgency.${r.urgency}`)}
              </span>
            )}
          </div>

          {r.description && (
            <blockquote className="mt-4 border-l-4 border-slate-200 pl-4 text-lg text-slate-800">
              “{r.description}”
            </blockquote>
          )}

          {r.items?.length ? (
            <div className="mt-5">
              <p className="mb-2 font-semibold text-slate-800">
                {tr("request.toolsNeeded")}
              </p>
              <ul className="grid gap-1 text-slate-700">
                {r.items.map((item, i) => (
                  <li key={i}>
                    {item.name} ×{item.qty}
                  </li>
                ))}
              </ul>
              <p className="sr-only">{formatItems(r.items)}</p>
            </div>
          ) : null}

          {r.city && <p className="mt-4 text-slate-600">📍 {r.city}</p>}

          <p className="mt-4 text-sm text-slate-400" title={fullDate(r.created_at)}>
            {tr("request.updated", { ago: timeAgo(r.created_at) })}
          </p>

          {r.source && (
            <p className="mt-2">
              <SourceBadge source={r.source} url={r.source_url} />
            </p>
          )}

          <div className="mt-6 border-t border-slate-100 pt-5">
            <p className="mb-2 font-semibold text-slate-800">{tr("request.shareThis")}</p>
            <ShareButtons text={shareText} url={url} compact />
          </div>
        </article>

        <ManageControls
          kind="request"
          id={r.id}
          resolved={r.status === "RESOLVED"}
          canManage={canManage}
          isNew={nuevo === "1"}
        />

        {r.status !== "RESOLVED" && (
          <div className="mt-6">
            {r.source ? (
              <section className="rounded-2xl border border-[#e6ecf2] bg-white p-4">
                <h2 className="font-semibold text-[#14212e]">{tr("request.canHelpTitle")}</h2>
                <p className="mt-1 text-sm text-[#5b6b7b]">
                  {tr("request.fromSource", { source: r.source })}
                </p>
                <p className="mt-2">
                  <SourceBadge source={r.source} url={r.source_url} />
                </p>
              </section>
            ) : (
              <>
                <RequestResponseForm requestId={r.id} />
                <RequestResponsesInbox requestId={r.id} canManage={canManage} />
              </>
            )}
          </div>
        )}

        <div className="mt-6 grid gap-2">
          <Link
            href="/mapa"
            className="rounded-xl bg-slate-900 px-5 py-3.5 text-center font-bold text-white"
          >
            {tr("request.viewMap")}
          </Link>
        </div>
      </main>
    </>
  );
}
