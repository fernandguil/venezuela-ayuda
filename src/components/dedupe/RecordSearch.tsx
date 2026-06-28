// Record search panel — find an individual person-record anywhere in the
// dataset (independent of the group queue) and either:
//   • pull it INTO the currently-open group (add-member), or
//   • inspect its full duplicate context (drill-down dialog).
//
// This is the counterpart to the queue's group search: the queue finds clusters,
// this finds single records — needed when the engine didn't cluster a record
// with the group it actually belongs to.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Plus, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  searchRecords,
  formatPhone,
  type RecordSummary,
} from "@/lib/dedupeApi";
import RecordContextDialog from "./RecordContextDialog";

export default function RecordSearch({
  dataset,
  currentGroupId,
  onAddToGroup,
}: {
  dataset?: string | null;
  // The group currently open in the review pane, if any. Add-member targets it.
  currentGroupId?: string | null;
  // Add a record to the current group. Returns an error message on failure,
  // or null on success. The parent owns the actual API call so it can refresh
  // the open group afterwards.
  onAddToGroup?: (recordId: string) => Promise<string | null>;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<RecordSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // record_id currently being added → disables its button and shows progress.
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  // Debounce typing so we don't fire a search per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const reqId = useRef(0);
  useEffect(() => {
    if (debounced.length < 2) {
      // Clear any prior results once the query is too short. Guarded so we only
      // setState when there's something to reset (avoids a render cascade).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults((prev) => (prev.length ? [] : prev));
      setError((prev) => (prev ? null : prev));
      return;
    }
    const id = ++reqId.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    searchRecords({ q: debounced, dataset, signal: controller.signal })
      .then((recs) => {
        if (id === reqId.current) setResults(recs);
      })
      .catch((e) => {
        if (e?.name !== "AbortError" && id === reqId.current)
          setError(e instanceof Error ? e.message : "Error al buscar");
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
    return () => controller.abort();
  }, [debounced, dataset]);

  const handleAdd = useCallback(
    async (recordId: string) => {
      if (!onAddToGroup || adding) return;
      setAdding(recordId);
      setAddError(null);
      const err = await onAddToGroup(recordId);
      if (err) setAddError(err);
      setAdding(null);
    },
    [onAddToGroup, adding],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#e6ecf2] p-3">
        <label className="relative block">
          <span className="sr-only">Buscar registros</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#5b6b7b]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar un registro suelto…"
            className="w-full rounded-lg border border-[#e6ecf2] bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#2563a8]"
          />
        </label>
        <p className="mt-1.5 text-[11px] text-[#5b6b7b]">
          Encuentra una persona y agrégala al grupo abierto, o revisa su contexto.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {addError && (
          <div className="mb-2 rounded-lg bg-[#e2603a]/10 px-3 py-2 text-xs text-[#c9483a]">
            {addError}
          </div>
        )}
        {error && (
          <div className="mb-2 rounded-lg bg-[#e2603a]/10 px-3 py-2 text-xs text-[#c9483a]">
            {error}
          </div>
        )}
        {loading && (
          <p className="py-6 text-center text-sm text-[#5b6b7b]">Buscando…</p>
        )}
        {!loading && debounced.length >= 2 && results.length === 0 && !error && (
          <p className="py-6 text-center text-sm text-[#5b6b7b]">
            Sin resultados para “{debounced}”.
          </p>
        )}
        {debounced.length < 2 && (
          <p className="py-6 text-center text-sm text-[#5b6b7b]">
            Escribe al menos 2 caracteres.
          </p>
        )}

        <ul className="space-y-2">
          {results.map((r) => {
            const phone = formatPhone(r.contact_phone_e164);
            const name = r.person_name_raw || "Sin nombre";
            const inCurrentGroup =
              currentGroupId != null && r.group_id === currentGroupId;
            return (
              <li
                key={r.record_id}
                className="rounded-xl border border-[#e6ecf2] bg-white p-2.5"
              >
                <p className="truncate text-sm font-semibold text-[#14212e]">
                  {name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#5b6b7b]">
                  {r.last_seen_location_raw && (
                    <span className="truncate">📍 {r.last_seen_location_raw}</span>
                  )}
                  {phone && <span className="tabular-nums">📞 {phone}</span>}
                  {r.group_id && (
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {r.group_id}
                    </Badge>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {onAddToGroup && currentGroupId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={adding === r.record_id || inCurrentGroup}
                      onClick={() => handleAdd(r.record_id)}
                      title={
                        inCurrentGroup
                          ? "Ya pertenece a este grupo"
                          : "Agregar al grupo abierto"
                      }
                    >
                      <Plus className="size-3.5" />
                      {adding === r.record_id
                        ? "Agregando…"
                        : inCurrentGroup
                          ? "En este grupo"
                          : "Agregar al grupo"}
                    </Button>
                  )}
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button type="button" size="sm" variant="ghost">
                        <Info className="size-3.5" />
                        Contexto
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogTitle className="pr-8">
                        Contexto de duplicados — {name}
                      </DialogTitle>
                      <RecordContextDialog
                        recordId={r.record_id}
                        dataset={dataset}
                      />
                    </DialogContent>
                  </Dialog>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
