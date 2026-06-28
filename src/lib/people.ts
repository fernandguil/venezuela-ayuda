// Unifies the three person-sources of "Buscar persona" (app check-ins, hospital
// registry sheet, desaparecidos API) and merges duplicates: when the same person
// is found in more than one source we collapse them into a single MergedPerson
// that carries the combined info + the contributing sources. Grouping uses
// `fuzzyKey` — the same conservative cross-source identity key the ingest uses.

import { fuzzyKey } from "@/lib/dedup";
import type { CheckinStatus } from "@/lib/constants";
import type {
  PublicCheckin,
  HospitalRegistryMatch,
  MissingPersonMatch,
} from "@/lib/types";

export type PersonSourceKind = "checkin" | "hospital" | "desaparecidos";

// One source that reported this person — rendered as the small "Fuente:" link.
export interface PersonSourceLink {
  label: string; // domain | "Cruz Roja (registro de hospitales)" | "la app"
  href: string | null; // external URL, internal /persona/{id}, or null
  external: boolean;
}

export interface MergedPerson {
  key: string; // fuzzyKey
  name: string; // most complete name in the group
  photoUrl: string | null;
  locations: string[]; // distinct union of city/location/direccion
  updated: string | null; // best ISO timestamp → timeAgo
  found: boolean; // any source located/found → ✅ Encontrado/a
  status: CheckinStatus; // derived display status when not found
  description: string | null; // quoted body (richest available)
  sources: PersonSourceLink[]; // primary = sources[0]; rest counted as "+N más"
}

// Internal normalized hit before grouping.
interface Hit {
  kind: PersonSourceKind;
  name: string;
  photoUrl: string | null;
  location: string | null;
  found: boolean;
  status: CheckinStatus;
  description: string | null;
  updated: string | null;
  source: PersonSourceLink;
}

// Priority for picking the single display status (when nobody is found).
const STATUS_RANK: Record<CheckinStatus, number> = {
  NEEDS_HELP: 3,
  LOOKING_FOR_SOMEONE: 2,
  SAFE: 1,
};

// Count of "significant" name tokens — used to pick the most complete name.
function nameWeight(name: string): number {
  return name.trim().split(/\s+/).filter((t) => t.length >= 2).length;
}

function checkinHit(c: PublicCheckin): Hit {
  return {
    kind: "checkin",
    name: c.name,
    photoUrl: c.photo_url,
    location: c.city ?? c.place_name,
    found: Boolean(c.found_at),
    status: c.status,
    description: c.message,
    updated: c.created_at,
    source: c.source
      ? { label: c.source, href: c.source_url, external: true }
      : { label: "la app", href: `/persona/${c.id}`, external: false },
  };
}

function hospitalHit(m: HospitalRegistryMatch): Hit {
  return {
    kind: "hospital",
    name: m.name,
    photoUrl: null,
    location: m.location,
    found: true, // listed in a hospital → located
    status: "SAFE",
    description:
      [m.hospital ? `En la lista de ${m.hospital}` : null, m.status]
        .filter(Boolean)
        .join(" · ") || null,
    updated: m.updated,
    source: {
      label: "Cruz Roja (registro de hospitales)",
      href: null,
      external: false,
    },
  };
}

function desaparecidoHit(p: MissingPersonMatch): Hit {
  return {
    kind: "desaparecidos",
    name: p.name,
    photoUrl: p.photoUrl,
    location: p.location,
    found: p.located,
    status: "LOOKING_FOR_SOMEONE",
    description: p.description,
    updated: p.date,
    source: {
      label: "desaparecidosterremotovenezuela.com",
      href: p.sourceUrl,
      external: true,
    },
  };
}

// First non-empty description, preferring the richest sources.
function pickDescription(bucket: Hit[]): string | null {
  const order: PersonSourceKind[] = ["desaparecidos", "checkin", "hospital"];
  for (const kind of order) {
    const d = bucket.find((h) => h.kind === kind && h.description?.trim());
    if (d) return d.description!.trim();
  }
  return null;
}

export function mergePeople(
  checkins: PublicCheckin[],
  registry: HospitalRegistryMatch[],
  desaparecidos: MissingPersonMatch[],
): MergedPerson[] {
  const hits: Hit[] = [
    ...checkins.map(checkinHit),
    ...registry.map(hospitalHit),
    ...desaparecidos.map(desaparecidoHit),
  ];

  const groups = new Map<string, Hit[]>();
  const order: string[] = []; // preserve first-seen order for stable output
  for (const hit of hits) {
    const key = fuzzyKey(hit.name);
    const bucket = groups.get(key);
    if (bucket) bucket.push(hit);
    else {
      groups.set(key, [hit]);
      order.push(key);
    }
  }

  const merged: MergedPerson[] = order.map((key) => {
    const bucket = groups.get(key)!;

    let name = bucket[0].name;
    for (const h of bucket) if (nameWeight(h.name) > nameWeight(name)) name = h.name;

    const photoUrl = bucket.find((h) => h.photoUrl)?.photoUrl ?? null;
    const updated = bucket.find((h) => h.updated)?.updated ?? null;
    const found = bucket.some((h) => h.found);

    const status = bucket
      .map((h) => h.status)
      .reduce((a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a));

    const locations: string[] = [];
    for (const h of bucket) {
      const loc = h.location?.trim();
      if (loc && !locations.some((l) => l.toLowerCase() === loc.toLowerCase()))
        locations.push(loc);
    }

    // Dedupe sources by label; put a linkable one first (the primary "Fuente:").
    const sources: PersonSourceLink[] = [];
    for (const h of bucket) {
      if (!sources.some((s) => s.label === h.source.label)) sources.push(h.source);
    }
    sources.sort((a, b) => Number(Boolean(b.href)) - Number(Boolean(a.href)));

    return {
      key,
      name,
      photoUrl,
      locations,
      updated,
      found,
      status,
      description: pickDescription(bucket),
      sources,
    };
  });

  // Multi-source matches first (the merge payoff), otherwise keep input order.
  return merged
    .map((m, i) => ({ m, i }))
    .sort((a, b) => b.m.sources.length - a.m.sources.length || a.i - b.i)
    .map(({ m }) => m);
}
