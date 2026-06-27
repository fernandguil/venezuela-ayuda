// External-source ingestion for Venezuela Ayuda.
//
//   node scripts/ingest.mjs            # import (idempotent)
//   node scripts/ingest.mjs --dry      # fetch + transform + dedup, no writes
//
// Pulls from sister sites (all public APIs), maps to our checkins /
// damaged_reports / help_requests, geocodes location-less missing-person
// registries to a city/zone centroid, dedups hard (cross-source + cross-run),
// keeps external contacts in PRIVATE fields, and stamps source + source_url.
// Requires migration 0007 applied. Reads keys from .env.local.

import { readFileSync } from "node:fs";
import { norm, personKey } from "./dedup-lib.mjs";

const DRY = process.argv.includes("--dry");
const DEDUP = process.argv.includes("--dedup"); // run the fuzzy dedup cleanup pass

// --- env (process.env wins; falls back to .env.local for local runs) ---------
let fileEnv = {};
try {
  fileEnv = Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
} catch {
  /* no .env.local (e.g. CI) — rely on process.env */
}
const getEnv = (k) => process.env[k] || fileEnv[k];
const SUPA_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const SECRET = getEnv("SUPABASE_SECRET_KEY");
if (!SUPA_URL || !SECRET) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}
const REST = `${SUPA_URL}/rest/v1`;
const H = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

// --- helpers -----------------------------------------------------------------
// norm / fuzzyKey / clusterKeys viven en ./dedup-lib.mjs (puro, testeable con node --test).
// Sanitize for Postgres text + valid JSON: strip control chars / null bytes
// (Postgres text can't store NUL), collapse whitespace, cap length without
// leaving a lone surrogate (which would be invalid UTF-8 / JSON).
const clean = (s, n = 500) =>
  String(s ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n)
    .replace(/[\uD800-\uDBFF]$/, "")
    .trim() || null;

const VE = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat > 0 && lat < 16 && lng > -74 && lng < -59;

// Venezuela city/zone centroids (coast + Caracas + major cities). Used to place
// missing-person reports that only have free-text locations.
const PLACES = [
  ["los palos grandes", 10.503, -66.844], ["altamira", 10.4965, -66.849],
  ["los dos caminos", 10.509, -66.829], ["el paraiso", 10.479, -66.929],
  ["pinto salinas", 10.5, -66.895], ["san bernardino", 10.506, -66.894],
  ["bello monte", 10.492, -66.858], ["sabana grande", 10.493, -66.866],
  ["chacao", 10.497, -66.854], ["petare", 10.477, -66.81], ["catia", 10.512, -66.93],
  ["el valle", 10.45, -66.905], ["antimano", 10.46, -66.95], ["baruta", 10.433, -66.875],
  ["el hatillo", 10.42, -66.82], ["la candelaria", 10.503, -66.902],
  ["santa monica", 10.46, -66.88], ["montalban", 10.47, -66.95],
  ["los corales", 10.6, -66.86], ["caraballeda", 10.613, -66.852],
  ["macuto", 10.6085, -66.8915], ["punta brisas", 10.6075, -66.886],
  ["catia la mar", 10.595, -67.02], ["maiquetia", 10.6, -66.98],
  ["la guaira", 10.601, -66.933], ["naiguata", 10.61, -66.74], ["tanaguarena", 10.615, -66.83],
  ["carayaca", 10.55, -67.1], ["caribe", 10.612, -66.855], ["playa grande", 10.61, -66.9],
  ["vargas", 10.6, -66.93], ["caracas", 10.488, -66.879], ["los teques", 10.34, -67.04],
  ["guarenas", 10.47, -66.61], ["guatire", 10.47, -66.54],
  ["maracay", 10.2469, -67.5958], ["valencia", 10.162, -68.008],
  ["barquisimeto", 10.0647, -69.3471], ["maracaibo", 10.654, -71.64],
  ["barcelona", 10.13, -64.69], ["puerto la cruz", 10.21, -64.62], ["cumana", 10.45, -64.18],
  ["merida", 8.59, -71.14], ["san cristobal", 7.77, -72.22], ["maturin", 9.75, -63.18],
  ["puerto ordaz", 8.3, -62.72], ["ciudad guayana", 8.35, -62.65], ["coro", 11.4, -69.68],
  ["punto fijo", 11.69, -70.2], ["tucacas", 10.799, -68.316], ["yumare", 10.62, -68.69],
  ["moron", 10.48, -68.19],
];
function geocode(text, seed) {
  const t = norm(text);
  if (!t) return null;
  let base = null;
  for (const [k, la, ln] of PLACES) if (t.includes(k)) { base = [la, ln]; break; }
  if (!base) return null;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const j = (x) => ((x % 1000) / 1000 - 0.5) * 0.01;
  return { lat: +(base[0] + j(h)).toFixed(6), lng: +(base[1] + j(h >> 10)).toFixed(6) };
}

async function fetchJson(url, headers = {}) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- source adapters ---------------------------------------------------------
// Each returns { table, row, dedupKey }. row already shaped for our schema.

const SEV = { total: "COLLAPSED", severo: "COLLAPSE_RISK", parcial: "CRACKS" };

async function srcTvComBuildings() {
  const key = "sb_publishable_i7iEDrCVZcSt0k3RGFrY4g_WrtZBB4w";
  const data = await fetchJson(
    "https://jckifxsdlnsvbztxydes.supabase.co/rest/v1/buildings?select=*",
    { apikey: key, Authorization: `Bearer ${key}` }
  );
  return data.map((b) => ({
    table: "damaged_reports",
    dedupKey: `${norm(b.name)}|${norm(b.city)}`,
    row: {
      place_name: clean(b.name, 120) || "Edificio",
      description: clean([b.notes, b.address, b.zone].filter(Boolean).join(" · "), 800),
      severity: SEV[b.damage_level] || "PARTIAL",
      city: clean(b.city, 80),
      latitude: VE(b.lat, b.lng) ? b.lat : null,
      longitude: VE(b.lat, b.lng) ? b.lng : null,
      photo_url: clean(b.main_photo_url, 500),
      source: "terremotovenezuela.com",
      source_url: "https://terremotovenezuela.com",
      external_id: `tvcom:${b.id}`,
    },
  }));
}

// Paginated Supabase range fetch with retries + backoff + inter-page delay.
// Their upstream sometimes returns a non-JSON timeout body; we retry, and on
// repeated failure we keep whatever we already have (partial > nothing).
async function pagedRange(base, key, pageSize = 500) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    let chunk = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(base, {
          headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + pageSize - 1}` },
        });
        if (!r.ok) { await sleep(1000 * (attempt + 1)); continue; }
        const j = await r.json();
        if (!Array.isArray(j)) { await sleep(1000 * (attempt + 1)); continue; }
        chunk = j;
        break;
      } catch {
        await sleep(1000 * (attempt + 1));
      }
    }
    if (chunk === null) {
      console.log(`  (partial: stopped at offset ${from} after retries)`);
      break;
    }
    if (!chunk.length) break;
    out.push(...chunk);
    if (chunk.length < pageSize) break;
    await sleep(250);
  }
  return out;
}

async function srcTeBusca() {
  const key =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloY25idmt3a2l5eGxraHV3YXB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNDQxNzcsImV4cCI6MjA5NzkyMDE3N30.-0hKS1VFaMFFpnCTzrl4Wj7XwfUVAfos6a0QTGzDtEY";
  const data = await pagedRange(
    "https://ihcnbvkwkiyxlkhuwapu.supabase.co/rest/v1/desaparecidos?select=*&order=created_at.desc",
    key
  );
  return data.map((p) => {
    const name = clean([p.nombre, p.apellido].filter(Boolean).join(" "), 80) || "Sin nombre";
    const found = p.estado === "encontrado";
    const g = geocode(p.ultima_ubicacion, `vtb:${p.id}`);
    return {
      table: "checkins",
      dedupKey: personKey(name, g?.lat, g?.lng),
      row: {
        name,
        status: "LOOKING_FOR_SOMEONE", // found ones keep this status + found_at set
        city: clean(p.ultima_ubicacion, 80),
        latitude: g?.lat ?? null,
        longitude: g?.lng ?? null,
        message: clean(p.descripcion, 500),
        phone_private: clean(p.reportado_por_telefono, 30),
        photo_url: clean(p.foto_url, 500),
        place_name: clean(p.ultima_ubicacion, 120),
        found_at: found ? p.fecha_encontrado || new Date().toISOString() : null,
        source: "venezuelatebusca.com",
        source_url: "https://venezuelatebusca.com",
        external_id: `vtb:${p.id}`,
      },
    };
  });
}

// Kept (commented out of SOURCES) so the desaparecidos scrape can be re-enabled
// quickly if/when the source is trustworthy again. See the note on SOURCES.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function srcDesaparecidos() {
  const out = [];
  for (let page = 1; ; page++) {
    // Retry with backoff (longer on 429); inter-page delay to avoid rate limits.
    let d = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await fetch(
          `https://desaparecidos-terremoto-api.theempire.tech/api/personas?page=${page}&pageSize=200`
        );
        if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
        if (!r.ok) { await sleep(1000 * (attempt + 1)); continue; }
        d = await r.json();
        break;
      } catch {
        await sleep(1000 * (attempt + 1));
      }
    }
    if (!d) { console.log(`  (partial: stopped at page ${page} after retries)`); break; }
    const items = d.items || [];
    if (!items.length) break;
    out.push(...items);
    if (page >= (d.totalPages || 1)) break;
    await sleep(400);
  }
  return out.map((p) => {
    const name = clean(p.nombre, 80) || "Sin nombre";
    const g = geocode(p.ubicacion, `dtv:${p.id}`);
    return {
      table: "checkins",
      dedupKey: personKey(name, g?.lat, g?.lng),
      row: {
        name,
        // SECURITY: do NOT trust this source's "localizado"/found status — it was
        // compromised (2026-06-25) and mass-marked people as found. We import
        // everyone as still-searching; a found state must come from our own users
        // (the reporter's manage link) or a source we trust. `p.estado` ignored.
        status: "LOOKING_FOR_SOMEONE",
        city: clean(p.ubicacion, 80),
        latitude: g?.lat ?? null,
        longitude: g?.lng ?? null,
        message: clean([p.descripcion, p.localizadoNota].filter(Boolean).join(" · "), 500),
        phone_private: clean(p.contacto, 30),
        photo_url: clean(p.foto, 500),
        place_name: clean(p.ubicacion, 120),
        found_at: null,
        source: "desaparecidosterremotovenezuela.com",
        source_url: "https://desaparecidosterremotovenezuela.com",
        external_id: `dtv:${p.id}`,
      },
    };
  });
}

async function srcAppEmergencia() {
  const recs = [];
  const missing = (await fetchJson("https://terremotovenezuela.app/api/missing?status=all")).people || [];
  for (const m of missing) {
    const name = clean(m.name, 80) || "Sin nombre";
    const g = geocode(m.lastSeen, `app:m:${m.id}`);
    recs.push({
      table: "checkins",
      dedupKey: personKey(name, g?.lat, g?.lng),
      row: {
        name,
        status: "LOOKING_FOR_SOMEONE", // found ones keep this status + found_at set
        city: clean(m.lastSeen, 80),
        latitude: g?.lat ?? null,
        longitude: g?.lng ?? null,
        message: clean([m.description, m.lastSeen, m.resolutionNote].filter(Boolean).join(" · "), 500),
        phone_private: clean(m.contact, 30),
        photo_url: m.photoUrl ? `https://terremotovenezuela.app${m.photoUrl}` : null,
        place_name: clean(m.lastSeen, 120),
        found_at:
          m.status === "found"
            ? new Date(m.resolvedAt || Date.now()).toISOString()
            : null,
        source: "terremotovenezuela.app",
        source_url: "https://terremotovenezuela.app",
        external_id: `app:m:${m.id}`,
      },
    });
  }
  const reports = (await fetchJson("https://terremotovenezuela.app/api/reports")).reports || [];
  for (const r of reports) {
    const coords = VE(r.lat, r.lng) ? { lat: r.lat, lng: r.lng } : null;
    const photo = r.photoUrl ? `https://terremotovenezuela.app${r.photoUrl}` : null;
    if (r.type === "missing") {
      const name = clean((r.needs || "").split(/[.,]/)[0], 80) || clean(r.place, 80) || "Sin nombre";
      recs.push({
        table: "checkins",
        dedupKey: personKey(name, coords?.lat, coords?.lng),
        row: {
          name, status: "LOOKING_FOR_SOMEONE",
          city: clean(r.place, 80), latitude: coords?.lat ?? null, longitude: coords?.lng ?? null,
          message: clean(r.needs, 500), place_name: clean(r.place, 120), photo_url: photo,
          source: "terremotovenezuela.app", source_url: "https://terremotovenezuela.app",
          external_id: `app:r:${r.id}`,
        },
      });
    } else if (r.type === "building") {
      recs.push({
        table: "damaged_reports",
        dedupKey: `${norm(r.place)}|${norm(r.place)}`,
        row: {
          place_name: clean(r.place, 120) || "Edificio", description: clean(r.needs, 800),
          severity: "PARTIAL", city: clean(r.place, 80),
          latitude: coords?.lat ?? null, longitude: coords?.lng ?? null, photo_url: photo,
          source: "terremotovenezuela.app", source_url: "https://terremotovenezuela.app",
          external_id: `app:r:${r.id}`,
        },
      });
    } else if (r.type === "critical" || r.type === "supplies" || r.type === "nopower") {
      const cat = r.type === "critical" ? "rescue" : r.type === "nopower" ? "electricity" : "food";
      if (!coords) continue; // help requests need a location
      recs.push({
        table: "help_requests",
        dedupKey: null,
        row: {
          category: cat, description: clean(r.needs, 800) || "Sin descripción",
          urgency: r.type === "critical" ? "CRITICAL" : "MEDIUM",
          city: clean(r.place, 80), latitude: coords.lat, longitude: coords.lng,
          place_name: clean(r.place, 120),
          source: "terremotovenezuela.app", source_url: "https://terremotovenezuela.app",
          external_id: `app:r:${r.id}`,
        },
      });
    }
  }
  return recs;
}

// Order matters for dedup: richest/photo-bearing sources first so the kept copy
// is the most complete.
// (terremotovenezuela2026 removed — its API now returns 410 Gone.)
const SOURCES = [
  ["terremotovenezuela.com (edificios)", srcTvComBuildings],
  ["venezuelatebusca.com (desaparecidos)", srcTeBusca],
  // ["desaparecidosterremotovenezuela.com", srcDesaparecidos],
  ["terremotovenezuela.app", srcAppEmergencia],
];

// --- existing keys (idempotency) --------------------------------------------
async function existingSet(table, col) {
  const set = new Set();
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${REST}/${table}?select=${col}&${col}=not.is.null`, {
      headers: { ...H, Range: `${from}-${from + 999}` },
    });
    if (!r.ok) break; // column not present yet (pre-migration) → treat as empty
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    for (const x of rows) if (x[col]) set.add(x[col]);
    if (rows.length < 1000) break;
  }
  return set;
}

// Fixed column set per table. PostgREST bulk insert requires every object in a
// batch to have identical keys, and rejects unknown columns — so we project
// each row onto exactly these columns (null-filling) before sending.
const COLS = {
  checkins: ["name", "status", "city", "latitude", "longitude", "message", "phone_private", "cedula_private", "cedula_hash", "photo_url", "place_name", "found_at", "source", "source_url", "external_id", "dedup_key"],
  damaged_reports: ["place_name", "description", "severity", "city", "latitude", "longitude", "photo_url", "source", "source_url", "external_id", "dedup_key"],
  help_requests: ["category", "description", "urgency", "city", "latitude", "longitude", "place_name", "source", "source_url", "external_id"],
};
const project = (table, row) => Object.fromEntries(COLS[table].map((c) => [c, row[c] ?? null]));

async function insertBatch(table, rows) {
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => project(table, r));
    const res = await insertChunk(table, batch);
    inserted += res.inserted;
    skipped += res.skipped;
    process.stdout.write(`  ${table}: +${inserted}/${rows.length}\r`);
  }
  process.stdout.write("\n");
  if (skipped) console.log(`  (${table}: skipped ${skipped} bad row(s))`);
}

// Insert a chunk; on failure, bisect to isolate and skip only the bad row(s)
// instead of dropping the whole batch (one malformed value used to abort the
// entire insert).
async function insertChunk(table, batch) {
  if (batch.length === 0) return { inserted: 0, skipped: 0 };
  const r = await fetch(`${REST}/${table}`, {
    method: "POST",
    headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify(batch),
  });
  if (r.ok) return { inserted: batch.length, skipped: 0 };

  if (batch.length === 1) {
    console.log(`\n  skipped 1 bad ${table} row (${r.status}): ${(await r.text()).slice(0, 140)}`);
    return { inserted: 0, skipped: 1 };
  }
  const mid = Math.floor(batch.length / 2);
  const a = await insertChunk(table, batch.slice(0, mid));
  const b = await insertChunk(table, batch.slice(mid));
  return { inserted: a.inserted + b.inserted, skipped: a.skipped + b.skipped };
}

// --- run ---------------------------------------------------------------------
async function main() {
  console.log(`Ingest ${DRY ? "(DRY RUN)" : ""} → ${SUPA_URL}\n`);

  // Gather all records.
  let all = [];
  for (const [name, fn] of SOURCES) {
    try {
      const recs = await fn();
      console.log(`fetched ${recs.length.toString().padStart(5)}  ${name}`);
      all.push(...recs);
    } catch (e) {
      console.log(`FAILED  ${name}: ${e.message}`);
    }
  }

  // Dedup: external_id (idempotency) + dedup_key (cross-source).
  const seenExt = {
    checkins: await existingSet("checkins", "external_id"),
    damaged_reports: await existingSet("damaged_reports", "external_id"),
    help_requests: await existingSet("help_requests", "external_id"),
  };
  const seenKey = {
    checkins: await existingSet("checkins", "dedup_key"),
    damaged_reports: await existingSet("damaged_reports", "dedup_key"),
    help_requests: new Set(),
  };

  const toInsert = { checkins: [], damaged_reports: [], help_requests: [] };
  let dupExt = 0, dupKey = 0;
  for (const rec of all) {
    const ext = rec.row.external_id;
    if (ext && seenExt[rec.table].has(ext)) { dupExt++; continue; }
    if (rec.dedupKey) {
      if (seenKey[rec.table].has(rec.dedupKey)) { dupKey++; continue; }
      seenKey[rec.table].add(rec.dedupKey);
    }
    if (ext) seenExt[rec.table].add(ext);
    toInsert[rec.table].push({ ...rec.row, dedup_key: rec.dedupKey ?? null });
  }

  console.log(`\nskipped: ${dupExt} already-imported, ${dupKey} cross-source duplicates`);
  for (const t of Object.keys(toInsert))
    console.log(`new ${t}: ${toInsert[t].length}`);

  if (DRY) {
    console.log("\n(dry run — nothing written)");
    console.log("sample:", JSON.stringify(toInsert.checkins[0] || toInsert.damaged_reports[0], null, 2));
    return;
  }

  for (const t of Object.keys(toInsert)) {
    if (!toInsert[t].length) continue;
    try {
      await insertBatch(t, toInsert[t]);
    } catch (e) {
      console.log(`\ninsert ${t} FAILED (others still ran): ${e.message}`);
    }
  }
  console.log("\nDone.");
}

// --- fuzzy dedup cleanup over existing data ----------------------------------
// Scans external missing-person rows, groups by fuzzy name key, keeps the
// richest record (photo > longer message > earliest), deletes the rest.
async function dedupExisting() {
  console.log(`Fuzzy dedup ${DRY ? "(DRY RUN)" : ""} → ${SUPA_URL}\n`);
  // Personas: foto > fuente más detallada > mensaje más largo.
  const PERSON_RANK = {
    "desaparecidosterremotovenezuela.com": 5,
    "venezuelatebusca.com": 4,
    "terremotovenezuela.app": 3,
    "terremotovenezuela2026": 2,
    "terremotovenezuela.com": 1,
  };
  await dedupTable({
    table: "checkins",
    select: "id,dedup_key,photo_url,message,created_at,found_at,source",
    score: (r) => (r.photo_url ? 1e5 : 0) + (PERSON_RANK[r.source] ?? 0) * 1000 + (r.message ? r.message.length : 0),
  });
  // Edificios dañados: foto > descripción más larga. (Antes no se dedup-eaban.)
  await dedupTable({
    table: "damaged_reports",
    select: "id,dedup_key,photo_url,description,created_at,source",
    score: (r) => (r.photo_url ? 1e5 : 0) + (r.description ? r.description.length : 0),
  });
}

// Dedup genérico de una tabla: agrupa nombres por identidad probable (clusterNames,
// confianza >= 0.95 con veto de discriminadores) y borra duplicados dejando el
// registro más rico (score). Conservador a propósito: ante la duda, deja el duplicado.
async function dedupTable({ table, select, score }) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${REST}/${table}?select=${select}&source=not.is.null`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    if (!r.ok) break;
    const chunk = await r.json();
    if (!Array.isArray(chunk) || !chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  console.log(`[${table}] scanned ${rows.length} rows`);

  // Group by the EXACT dedup_key (= personKey: name + region) — the same key the
  // import uses. This makes import and cleanup agree on what a duplicate is, so the
  // kept row is always one the import recognizes → no re-insertion churn / drift.
  // Only true exact collisions (cross-source / legacy) are removed; the richest is
  // kept. Fuzzy near-name merging is intentionally dropped (a visible duplicate is
  // recoverable; a wrongly-deleted person is not).
  const byKey = new Map();
  for (const r of rows) {
    if (!r.dedup_key) continue;
    if (!byKey.has(r.dedup_key)) byKey.set(r.dedup_key, []);
    byKey.get(r.dedup_key).push(r);
  }

  const deleteIds = [];
  let dupGroups = 0;
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    dupGroups++;
    list.sort((a, b) => score(b) - score(a) || String(a.created_at).localeCompare(String(b.created_at)));
    for (const r of list.slice(1)) deleteIds.push(r.id);
  }
  console.log(`[${table}] ${dupGroups} duplicate groups → ${deleteIds.length} rows to remove`);

  if (DRY || !deleteIds.length) { console.log(DRY ? "  (dry run — nothing deleted)" : "  nothing to remove"); return; }
  for (let i = 0; i < deleteIds.length; i += 80) {
    const ids = deleteIds.slice(i, i + 80);
    const r = await fetch(`${REST}/${table}?id=in.(${ids.join(",")})`, { method: "DELETE", headers: { ...H, Prefer: "return=minimal" } });
    if (!r.ok) throw new Error(`delete: ${r.status} ${await r.text()}`);
    process.stdout.write(`  [${table}] deleted ${Math.min(i + 80, deleteIds.length)}/${deleteIds.length}\r`);
  }
  console.log(`\n[${table}] done.`);
}

(DEDUP ? dedupExisting() : main()).catch((e) => { console.error(e); process.exit(1); });
