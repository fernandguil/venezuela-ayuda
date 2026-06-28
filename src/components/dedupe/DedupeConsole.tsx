// Top-level review console. Holds the queue + selected group, debounced
// search, pagination, and auto-advance: when a group's pairs are all decided,
// it marks it done and moves to the next pending group automatically.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { Menu, Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  listGroups,
  listDatasetOptions,
  addGroupMember,
  DEFAULT_DATASET_SLUG,
  type GroupSummary,
} from "@/lib/dedupeApi";
import {
  claimGroup,
  releaseGroup,
  listActiveLocks,
  type LockInfo,
} from "@/app/deduplicar/actions";
import GroupQueue from "./GroupQueue";
import GroupReview from "./GroupReview";
import DatasetSelector from "./DatasetSelector";
import RecordSearch from "./RecordSearch";

const PAGE = 50;
// Renew the lock on this cadence. Must be comfortably under LOCK_TTL_SECONDS
// (180s on the server) so a live tab never lets its claim lapse.
const HEARTBEAT_MS = 60_000;
// Refresh the "who has what" map this often so the queue reflects other
// reviewers' claims without a manual reload.
const LOCKS_POLL_MS = 15_000;

export default function DedupeConsole() {
  // Datasets the API exposes (env-configured). Usually just the default one,
  // in which case the selector is hidden.
  const datasetOptions = useMemo(() => listDatasetOptions(), []);
  const [dataset, setDataset] = useState(datasetOptions[0].slug);

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  // Queue filters (server-side via /api/groups params).
  const [hospitalOnly, setHospitalOnly] = useState(false);
  const [foundOnly, setFoundOnly] = useState(false);

  const [selected, setSelected] = useState<GroupSummary | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [reviewedCount, setReviewedCount] = useState(0);
  // Mobile: the queue lives in a slide-over drawer.
  const [queueOpen, setQueueOpen] = useState(false);
  // Record-search panel (add a stray record into the open group) + a nonce that
  // forces GroupReview to remount and refetch after a successful add.
  const [searchOpen, setSearchOpen] = useState(false);
  const [reviewNonce, setReviewNonce] = useState(0);

  // --- Locks: who is working which group ------------------------------------
  // groupId -> reviewer email, for every group locked by SOMEONE ELSE (mine are
  // filtered out below). Drives the "tomado por X" markers and auto-advance.
  const [lockedByOthers, setLockedByOthers] = useState<Map<string, string>>(
    new Map(),
  );
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  // The group this tab currently holds a claim on (released on switch/unmount).
  const heldRef = useRef<string | null>(null);

  // The dataset to qualify locks with: the default dataset keeps bare keys
  // (backward compatible), other datasets namespace their group ids. Held in a
  // ref so the lock callbacks always read the live dataset without re-binding.
  const lockDatasetRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    lockDatasetRef.current =
      dataset === DEFAULT_DATASET_SLUG ? undefined : dataset;
  }, [dataset]);

  // Build the "locked by others" map from the server, excluding my own claims.
  const refreshLocks = useCallback(async () => {
    try {
      const { meId, locks } = await listActiveLocks(lockDatasetRef.current);
      const map = new Map<string, string>();
      for (const l of locks as LockInfo[]) {
        if (l.lockedBy === meId) continue; // my own lock — not a conflict
        map.set(l.groupId, l.lockedByEmail ?? "otro revisor");
      }
      setLockedByOthers(map);
    } catch {
      /* transient — keep the last known map */
    }
  }, []);

  // Release whatever this tab holds (best-effort; used on switch/unmount).
  const releaseHeld = useCallback(() => {
    const gid = heldRef.current;
    if (!gid) return;
    heldRef.current = null;
    void releaseGroup(gid, lockDatasetRef.current);
  }, []);

  // Select a group: claim it first, only switch if we win the lock. Releases the
  // previously held group. Closes the mobile drawer (no-op on desktop).
  const selectGroup = useCallback(
    async (g: GroupSummary) => {
      if (g.group_id === selected?.group_id) {
        setQueueOpen(false);
        return;
      }
      const res = await claimGroup(g.group_id, lockDatasetRef.current);
      if (!res.ok) {
        setLockNotice(
          `Ese grupo lo está revisando ${res.heldBy ?? "otra persona"}. Te pasamos a otro.`,
        );
        // Mark it taken locally so the queue greys it out immediately.
        setLockedByOthers((prev) =>
          new Map(prev).set(g.group_id, res.heldBy ?? "otro revisor"),
        );
        await refreshLocks();
        return;
      }
      setLockNotice(null);
      if (heldRef.current && heldRef.current !== g.group_id) releaseHeld();
      heldRef.current = g.group_id;
      setSelected(g);
      setQueueOpen(false);
      void refreshLocks();
    },
    [selected?.group_id, refreshLocks, releaseHeld],
  );

  // Switch datasets: drop the current claim and reset the working state so the
  // queue reloads cleanly against the new dataset (the load effect re-runs on
  // `dataset`). Releasing uses the OLD dataset's lock namespace, so release
  // before updating the ref/state.
  const changeDataset = useCallback(
    (slug: string) => {
      if (slug === dataset) return;
      releaseHeld();
      setSelected(null);
      setLockNotice(null);
      setCompletedIds(new Set());
      setLockedByOthers(new Map());
      setSearch("");
      setDebounced("");
      setDataset(slug);
    },
    [dataset, releaseHeld],
  );

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load (or reload on search change).
  const reqId = useRef(0);
  useEffect(() => {
    const id = ++reqId.current;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    listGroups({
      search: debounced,
      limit: PAGE,
      offset: 0,
      hospitalMatchesOnly: hospitalOnly,
      foundOnly,
      dataset,
      signal: controller.signal,
    })
      .then((res) => {
        if (id !== reqId.current) return;
        setGroups(res.groups);
        setTotal(res.total);
        setOffset(res.groups.length);
        // Auto-select the first AVAILABLE group when nothing is selected yet —
        // claim it through selectGroup so two reviewers landing at once don't
        // both grab group #1.
        if (!heldRef.current) {
          const first = res.groups.find((g) => !lockedByOthers.has(g.group_id));
          if (first) void selectGroup(first);
        }
      })
      .catch((e) => {
        if (e?.name !== "AbortError" && id === reqId.current)
          setError(e instanceof Error ? e.message : "Error al cargar grupos");
      })
      .finally(() => id === reqId.current && setLoading(false));
    return () => controller.abort();
    // Re-run on a new search, filter change, or dataset switch.
    // selectGroup/lockedByOthers are read best-effort at call time (selectGroup
    // re-validates the claim server-side).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, hospitalOnly, foundOnly, dataset]);

  const loadMore = useCallback(() => {
    if (loading) return;
    const id = ++reqId.current;
    setLoading(true);
    listGroups({
      search: debounced,
      limit: PAGE,
      offset,
      hospitalMatchesOnly: hospitalOnly,
      foundOnly,
      dataset,
    })
      .then((res) => {
        if (id !== reqId.current) return;
        setGroups((prev) => [...prev, ...res.groups]);
        setOffset((prev) => prev + res.groups.length);
        setTotal(res.total);
      })
      .catch((e) =>
        id === reqId.current &&
        setError(e instanceof Error ? e.message : "Error al cargar más"),
      )
      .finally(() => id === reqId.current && setLoading(false));
  }, [debounced, offset, loading, hospitalOnly, foundOnly, dataset]);

  const advance = useCallback(
    (groupId: string) => {
      setCompletedIds((prev) => new Set(prev).add(groupId));
      setReviewedCount((n) => n + 1);
      // Done with this group — drop our claim so it doesn't sit locked.
      if (heldRef.current === groupId) releaseHeld();
      // Move to the next group that's neither completed nor held by someone
      // else, and claim it.
      setGroups((cur) => {
        const idx = cur.findIndex((g) => g.group_id === groupId);
        const next = cur
          .slice(idx + 1)
          .find(
            (g) =>
              !completedIds.has(g.group_id) &&
              g.group_id !== groupId &&
              !lockedByOthers.has(g.group_id),
          );
        if (next) void selectGroup(next);
        return cur;
      });
    },
    [completedIds, lockedByOthers, releaseHeld, selectGroup],
  );

  // Add a searched-up record into the currently open group, then force the
  // review pane to refetch so the new member shows. Returns an error message
  // for the search panel to display, or null on success.
  const addRecordToGroup = useCallback(
    async (recordId: string): Promise<string | null> => {
      const gid = selected?.group_id;
      if (!gid) return "No hay un grupo abierto.";
      try {
        await addGroupMember(gid, recordId, dataset);
        setReviewNonce((n) => n + 1);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "No se pudo agregar el registro";
      }
    },
    [selected?.group_id, dataset],
  );

  // Prev / next group navigation (← / → keys, and header buttons).
  const selectedIdx = useMemo(
    () => (selected ? groups.findIndex((g) => g.group_id === selected.group_id) : -1),
    [groups, selected],
  );
  const goPrev = useCallback(() => {
    if (selectedIdx > 0) void selectGroup(groups[selectedIdx - 1]);
  }, [groups, selectedIdx, selectGroup]);
  const goNext = useCallback(() => {
    if (selectedIdx >= 0 && selectedIdx < groups.length - 1)
      void selectGroup(groups[selectedIdx + 1]);
  }, [groups, selectedIdx, selectGroup]);

  useHotkeys(
    [
      { hotkey: "ArrowLeft", callback: () => goPrev() },
      { hotkey: "ArrowRight", callback: () => goNext() },
    ],
    { ignoreInputs: true, preventDefault: true },
  );

  // Heartbeat: renew the claim on the held group so a live tab never lets it
  // lapse. selected.group_id is the source of truth for what we're holding.
  // If the renewal is REJECTED — another reviewer took the group after a TTL
  // lapse or a race — stop showing it as ours: drop the selection and warn, so
  // two people never keep editing the same group.
  useEffect(() => {
    const gid = selected?.group_id;
    if (!gid) return;
    const t = setInterval(async () => {
      const res = await claimGroup(gid, lockDatasetRef.current);
      if (!res.ok) {
        heldRef.current = null;
        setSelected((cur) => (cur?.group_id === gid ? null : cur));
        setLockNotice(
          `${res.heldBy ?? "Otra persona"} tomó este grupo. Lo cerramos para evitar trabajo duplicado.`,
        );
        void refreshLocks();
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [selected?.group_id, refreshLocks]);

  // Poll the active-locks map so the queue reflects other reviewers in near
  // real time. Runs once on mount and on every interval tick.
  useEffect(() => {
    // Initial fetch syncs with the server (an external system); not a render
    // cascade despite the lint rule's heuristic.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshLocks();
    const t = setInterval(() => void refreshLocks(), LOCKS_POLL_MS);
    return () => clearInterval(t);
  }, [refreshLocks]);

  // Release the held lock when the tab closes or is hidden, and on unmount, so
  // a group never stays locked after its reviewer walks away. (The server TTL
  // is the backstop if the browser can't fire this.)
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") releaseHeld();
    };
    window.addEventListener("pagehide", releaseHeld);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", releaseHeld);
      document.removeEventListener("visibilitychange", onHide);
      releaseHeld();
    };
  }, [releaseHeld]);

  const canLoadMore = groups.length < total;

  // Shared queue UI (same instance rendered in the desktop sidebar and the
  // mobile drawer).
  const queue = (
    <GroupQueue
      groups={groups}
      total={total}
      selectedId={selected?.group_id ?? null}
      completedIds={completedIds}
      lockedByOthers={lockedByOthers}
      search={search}
      loading={loading}
      hospitalOnly={hospitalOnly}
      foundOnly={foundOnly}
      onSearch={setSearch}
      onToggleHospitalOnly={() => setHospitalOnly((v) => !v)}
      onToggleFoundOnly={() => setFoundOnly((v) => !v)}
      onSelect={selectGroup}
      onLoadMore={loadMore}
      canLoadMore={canLoadMore}
    />
  );

  return (
    // A solid, calm operational canvas. The site-wide rubble photo is right for
    // the public pages but must not bleed through a data workspace — so the
    // console lays its own opaque surface over it.
    <div className="grid h-[calc(100dvh-7rem)] grid-cols-1 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 shadow-sm lg:h-[calc(100dvh-8.5rem)] lg:grid-cols-[340px_1fr]">
      {/* Queue — fixed sidebar on desktop */}
      <aside className="hidden min-h-0 overflow-hidden bg-white lg:block">
        {queue}
      </aside>

      {/* Queue — slide-over drawer on mobile/tablet */}
      <Sheet open={queueOpen} onOpenChange={setQueueOpen}>
        <SheetContent side="left" className="w-[88vw] max-w-sm p-0">
          <SheetTitle className="sr-only">Lista de grupos</SheetTitle>
          {queue}
        </SheetContent>
      </Sheet>

      {/* Detail */}
      <section className="min-h-0 overflow-y-auto bg-slate-50 px-3 py-3 sm:px-4">
        {/* Toolbar: dataset picker (hidden when only one) + mobile group list */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <DatasetSelector
            options={datasetOptions}
            value={dataset}
            onChange={changeDataset}
          />
          {/* Record search — pull a stray record into the open group. Disabled
              until a group is open (add-member needs a target). */}
          <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                disabled={!selected}
                title={
                  selected
                    ? "Buscar un registro para agregar al grupo"
                    : "Abre un grupo primero"
                }
              >
                <SearchIcon className="size-4" />
                Buscar registro
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[92vw] max-w-md p-0">
              <SheetTitle className="border-b border-[#e6ecf2] px-4 py-3 text-base">
                Buscar registro
              </SheetTitle>
              <div className="h-[calc(100%-3.25rem)]">
                <RecordSearch
                  dataset={dataset}
                  currentGroupId={selected?.group_id ?? null}
                  onAddToGroup={addRecordToGroup}
                />
              </div>
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1 lg:hidden">
            <Sheet open={queueOpen} onOpenChange={setQueueOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                  <Menu className="size-4" />
                  Grupos
                  <span className="ml-auto text-xs text-muted-foreground">
                    {total.toLocaleString("es")}
                  </span>
                </Button>
              </SheetTrigger>
            </Sheet>
          </div>
        </div>

        {selected && (
          <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-extrabold text-[#14212e]">
                  {selected.group_id}
                </h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-[#5b6b7b]">
                  {selected.record_count} registros
                </span>
                {completedIds.has(selected.group_id) && (
                  <span className="rounded-full bg-[#2f9e6e]/10 px-2 py-0.5 text-xs font-semibold text-[#2f9e6e]">
                    ✓ revisado
                  </span>
                )}
              </div>
              <p className="truncate text-sm text-[#5b6b7b]">
                {selected.sample_names.slice(0, 3).join(" · ")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden text-sm text-[#5b6b7b] sm:inline">
                Sesión:{" "}
                <strong className="text-[#14212e] tabular-nums">
                  {reviewedCount}
                </strong>
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={goPrev}
                disabled={selectedIdx <= 0}
                aria-label="Grupo anterior"
              >
                ←
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={goNext}
                disabled={selectedIdx < 0 || selectedIdx >= groups.length - 1}
                aria-label="Grupo siguiente"
              >
                →
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-3 rounded-xl bg-[#e2603a]/10 px-4 py-3 text-sm text-[#c9483a]">
            {error}
          </div>
        )}

        {lockNotice && (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span>🔒 {lockNotice}</span>
            <button
              type="button"
              onClick={() => setLockNotice(null)}
              aria-label="Descartar aviso"
              className="shrink-0 text-amber-700/70 hover:text-amber-900"
            >
              ✕
            </button>
          </div>
        )}

        {selected ? (
          <GroupReview
            key={`${dataset}:${selected.group_id}:${reviewNonce}`}
            summary={selected}
            dataset={dataset}
            onComplete={advance}
          />
        ) : (
          !loading && (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-sm text-[#5b6b7b]">
              Selecciona un grupo para empezar.
            </div>
          )
        )}
      </section>
    </div>
  );
}
