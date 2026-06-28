// Drill-down for a single record's duplicate context (rendered inside a dialog
// from RecordSearch). Loads on open and shows: the group it belongs to, the
// records the engine thinks are the same person, the average match score, and
// any hospital matches — read-only, for the reviewer to understand a record
// before deciding to pull it into the open group.
"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getRecordDuplicateContext,
  formatPhone,
  type RecordDuplicateContext,
  type RecordSummary,
} from "@/lib/dedupeApi";

function RecordLine({ r }: { r: RecordSummary }) {
  const phone = formatPhone(r.contact_phone_e164);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-[#e6ecf2] bg-white px-3 py-2 text-sm">
      <span className="font-semibold text-[#14212e]">
        {r.person_name_raw || "Sin nombre"}
      </span>
      {r.last_seen_location_raw && (
        <span className="truncate text-xs text-[#5b6b7b]">
          📍 {r.last_seen_location_raw}
        </span>
      )}
      {phone && (
        <span className="text-xs tabular-nums text-[#5b6b7b]">📞 {phone}</span>
      )}
      {r.hospital_name && (
        <Badge className="bg-rose-100 text-[10px] font-medium text-rose-700">
          🏥 {r.hospital_name}
        </Badge>
      )}
    </li>
  );
}

export default function RecordContextDialog({
  recordId,
  dataset,
}: {
  recordId: string;
  dataset?: string | null;
}) {
  const [ctx, setCtx] = useState<RecordDuplicateContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Fetch-on-open against an external API; the lint rule's heuristic flags
    // this but it's the codebase's established data-fetch pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getRecordDuplicateContext(recordId, { dataset, signal: controller.signal })
      .then((c) => setCtx(c))
      .catch((e) => {
        if (e?.name !== "AbortError")
          setError(e instanceof Error ? e.message : "Error al cargar contexto");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [recordId, dataset]);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-10 rounded-lg" />
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-[#c9483a]">{error}</p>;
  }
  if (!ctx) return null;

  // The API returns scores on a 0–100 scale already (e.g. 100 = perfect match),
  // matching GroupSummary's *_score fields — so just round, don't ×100.
  const score =
    ctx.duplicate_average_score != null
      ? Math.round(ctx.duplicate_average_score)
      : null;

  return (
    <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
      {/* Summary badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        {ctx.group?.group_id && (
          <Badge variant="secondary" className="font-mono text-[10px]">
            {ctx.group.group_id}
          </Badge>
        )}
        {score != null && (
          <Badge className="bg-[#2563a8]/10 text-[10px] text-[#2563a8]">
            score medio {score}%
          </Badge>
        )}
        {ctx.has_hospital_match && (
          <Badge className="bg-rose-100 text-[10px] text-rose-700">
            🏥 match hospitalario
          </Badge>
        )}
        {ctx.has_found_duplicate && (
          <Badge className="bg-[#2f9e6e]/10 text-[10px] text-[#2f9e6e]">
            duplicado encontrado
          </Badge>
        )}
      </div>

      {/* The record itself */}
      <section>
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#5b6b7b]">
          Registro
        </h4>
        <ul className="space-y-1.5">
          <RecordLine r={ctx.record} />
        </ul>
      </section>

      {/* Records the engine proposes as the same person */}
      {ctx.duplicate_records.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#5b6b7b]">
            Posibles duplicados ({ctx.duplicate_records.length})
          </h4>
          <ul className="space-y-1.5">
            {ctx.duplicate_records.map((r) => (
              <RecordLine key={r.record_id} r={r} />
            ))}
          </ul>
        </section>
      )}

      {/* Other records in the same group (related but not necessarily dupes) */}
      {ctx.group_records.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#5b6b7b]">
            En el mismo grupo ({ctx.group_records.length})
          </h4>
          <ul className="space-y-1.5">
            {ctx.group_records.map((r) => (
              <RecordLine key={r.record_id} r={r} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
