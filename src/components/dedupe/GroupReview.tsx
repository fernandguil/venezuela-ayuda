// Group-level cleaning canvas. The whole group is one screen: records are laid
// out grouped by the person the API proposes (duplicate clusters). Everything
// is KEPT by default; the reviewer removes the records that don't belong, then
// confirms — which fires the API writes and auto-advances.
//
// Keyboard:
//   1..9   toggle remove/keep on the Nth record
//   Enter  confirm group & next
//   F      flag whole group: nothing here is a duplicate (remove all but first)
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildPersonClusters,
  commitGroupReview,
  getGroup,
  getGroupPacients,
  rejectDuplicate,
  type GroupDetail,
  type GroupSummary,
  type PacientMatchSummary,
  type PersonCluster,
  type RecordSummary,
} from "@/lib/dedupeApi";
import RecordCard from "./RecordCard";
import HospitalMatches from "./HospitalMatches";

const TINTS = ["#2563a8", "#7c5cbf", "#0f8a8a", "#c2682e", "#b5446a", "#2f9e6e"];

export default function GroupReview({
  summary,
  dataset,
  onComplete,
}: {
  summary: GroupSummary;
  dataset?: string | null;
  onComplete?: (groupId: string) => void;
}) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  // Clusters the reviewer has explicitly rejected as "not the same person"
  // (cluster key → true). These are recorded via the API immediately and the
  // cluster is greyed out; on commit they're skipped so no merge is confirmed.
  const [rejectedClusters, setRejectedClusters] = useState<Set<string>>(
    new Set(),
  );
  const [rejecting, setRejecting] = useState<string | null>(null);
  // Hospital patient matches for this group (if any). Loaded best-effort; a
  // failure here never blocks the dedup workflow.
  const [pacients, setPacients] = useState<PacientMatchSummary[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    getGroup(summary.group_id, { dataset, signal: controller.signal })
      .then((d) => setDetail(d))
      .catch((e) => {
        if (e?.name !== "AbortError")
          setError(e instanceof Error ? e.message : "Error al cargar el grupo");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [summary.group_id, dataset]);

  // Always fetch hospital matches: the group summary's `has_hospital_match`
  // flag is unreliable on the search path (the API returns false there even
  // when matches exist), so we ask directly. It's a cheap call that returns an
  // empty list when there's nothing, and a failure must not break the review.
  // (The component is keyed by group+dataset in the parent, so `pacients`
  // starts empty on each group.)
  useEffect(() => {
    const controller = new AbortController();
    getGroupPacients(summary.group_id, { dataset, signal: controller.signal })
      .then((m) => setPacients(m))
      .catch(() => {
        /* best-effort: leave the group's records as the source of truth */
      });
    return () => controller.abort();
  }, [summary.group_id, dataset]);

  const clusters = useMemo(
    () => buildPersonClusters(detail?.records ?? []),
    [detail],
  );

  // Flat, stable record order so digit hotkeys map to a visible number.
  const ordered = useMemo<RecordSummary[]>(
    () => clusters.flatMap((c) => c.records),
    [clusters],
  );
  const indexOf = useMemo(() => {
    const m = new Map<string, number>();
    ordered.forEach((r, i) => m.set(r.record_id, i + 1));
    return m;
  }, [ordered]);

  const toggle = useCallback((recordId: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }, []);

  // Explicitly reject a duplicate cluster: tell the API each secondary is NOT
  // the same person as the primary. Records a negative decision (vs. the
  // confirm path) so the engine won't re-propose the pair. On success the
  // cluster is marked rejected and skipped at commit time.
  const rejectCluster = useCallback(
    async (cluster: PersonCluster) => {
      if (!cluster.clusterId || rejecting) return;
      const primary =
        cluster.records.find((r) => r.record_id === cluster.primaryId) ??
        cluster.records[0];
      if (!primary) return;
      const secondaries = cluster.records.filter(
        (r) => r.record_id !== primary.record_id,
      );
      if (!secondaries.length) return;

      setRejecting(cluster.key);
      setError(null);
      try {
        await Promise.all(
          secondaries.map((r) =>
            rejectDuplicate(
              {
                primary_record_id: primary.record_id,
                secondary_record_id: r.record_id,
              },
              dataset,
            ),
          ),
        );
        setRejectedClusters((prev) => new Set(prev).add(cluster.key));
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "No se pudo rechazar el duplicado",
        );
      } finally {
        setRejecting(null);
      }
    },
    [rejecting, dataset],
  );

  const keptCount = ordered.length - removed.size;

  const confirm = useCallback(async () => {
    if (!detail || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await commitGroupReview({
        groupId: summary.group_id,
        removedRecordIds: Array.from(removed),
        // Skip clusters already rejected via the API — they must not be
        // re-confirmed as merges at commit time.
        clusters: clusters.filter((c) => !rejectedClusters.has(c.key)),
        dataset,
      });
      if (res.errors.length) {
        setError(res.errors.slice(0, 2).join(" · "));
        setCommitting(false);
        return;
      }
      onComplete?.(summary.group_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar");
      setCommitting(false);
    }
  }, [detail, committing, summary.group_id, removed, clusters, rejectedClusters, dataset, onComplete]);

  // Flag the whole group as "not duplicates": keep only the first record of
  // each cluster, remove the rest (so no merges are confirmed).
  const flagNotDuplicates = useCallback(() => {
    const toRemove = new Set<string>();
    clusters.forEach((c) => {
      c.records.slice(1).forEach((r) => toRemove.add(r.record_id));
    });
    setRemoved(toRemove);
  }, [clusters]);

  // Keyboard handling via TanStack Hotkeys. `ignoreInputs` keeps the search box
  // usable. Digit hotkeys are built dynamically from the records, plus Enter to
  // confirm and F to flag the whole group. Arrows (prev/next group) live in the
  // parent console.
  const hotkeys = useMemo<UseHotkeyDefinition[]>(
    () => [
      { hotkey: "Enter", callback: () => confirm() },
      { hotkey: "F", callback: () => flagNotDuplicates() },
      ...ordered.slice(0, 9).map(
        (rec, i): UseHotkeyDefinition => ({
          hotkey: `${i + 1}` as UseHotkeyDefinition["hotkey"],
          callback: () => toggle(rec.record_id),
        }),
      ),
    ],
    [confirm, flagNotDuplicates, ordered, toggle],
  );
  useHotkeys(hotkeys, { ignoreInputs: true, preventDefault: true });

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="font-semibold text-destructive">{error}</p>
      </div>
    );
  }
  if (!detail) return null;

  const multiPersonNote =
    clusters.length > 1
      ? `Parece ${clusters.length} personas distintas`
      : clusters.length === 1
        ? "Parece 1 persona"
        : "";

  return (
    <div className="space-y-4">
      {/* Hospital matches — surfaced first: if the missing person was found at a
          hospital, the reviewer should see it before deciding anything. */}
      {pacients.length > 0 && <HospitalMatches matches={pacients} />}

      {/* Person blocks */}
      {clusters.map((cluster, ci) => {
        const tint = cluster.clusterId ? TINTS[ci % TINTS.length] : "#94a3b8";
        const isDuplicate = cluster.records.length > 1;
        const isRejected = rejectedClusters.has(cluster.key);
        return (
          <Card
            key={cluster.key}
            className={cn(
              "gap-0 overflow-hidden border-slate-200 bg-white py-0 shadow-none",
              isRejected && "opacity-60",
            )}
          >
            <header
              className="flex items-center justify-between gap-2 px-4 py-3"
              style={{ boxShadow: `inset 4px 0 0 ${tint}` }}
            >
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold text-foreground">
                  {cluster.name}
                </h3>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {isDuplicate
                    ? `${cluster.records.length} reportes · misma persona`
                    : "1 reporte"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isDuplicate && !isRejected && (
                  <Badge
                    style={{ backgroundColor: `${tint}1a`, color: tint }}
                  >
                    duplicado
                  </Badge>
                )}
                {/* Explicit reject: only meaningful for proposed duplicate
                    clusters (2+ records). Records a negative decision so the
                    engine won't re-propose this merge. */}
                {isDuplicate &&
                  (isRejected ? (
                    <Badge className="bg-destructive/10 text-destructive">
                      rechazado
                    </Badge>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={rejecting === cluster.key}
                      onClick={() => rejectCluster(cluster)}
                    >
                      {rejecting === cluster.key
                        ? "Rechazando…"
                        : "No es duplicado"}
                    </Button>
                  ))}
              </div>
            </header>
            <div className="space-y-2 px-3 pb-3">
              {cluster.records.map((r) => (
                <RecordCard
                  key={r.record_id}
                  record={r}
                  index={indexOf.get(r.record_id) ?? 0}
                  removed={removed.has(r.record_id)}
                  onToggle={() => toggle(r.record_id)}
                />
              ))}
            </div>
          </Card>
        );
      })}

      {multiPersonNote && (
        <p className="px-1 text-sm text-muted-foreground">{multiPersonNote}.</p>
      )}

      {error && (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Sticky action bar */}
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            <strong className="text-foreground tabular-nums">{keptCount}</strong> a
            conservar
          </span>
          {removed.size > 0 && (
            <span className="text-destructive">· {removed.size} a quitar</span>
          )}
          <KbdGroup className="hidden text-[11px] text-muted-foreground/80 lg:flex">
            <Kbd>1–9</Kbd> quitar · <Kbd>Enter</Kbd> confirmar · <Kbd>F</Kbd> no son
            duplicados
          </KbdGroup>
        </div>
        <div className="flex items-center gap-2">
          {removed.size > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setRemoved(new Set())}
              className="flex-1 sm:flex-none"
            >
              Deshacer
            </Button>
          )}
          <Button
            type="button"
            variant="success"
            size="lg"
            onClick={confirm}
            disabled={committing}
            className="flex-1 font-bold sm:flex-none"
          >
            {committing ? "Guardando…" : "Confirmar grupo →"}
          </Button>
        </div>
      </div>
    </div>
  );
}
