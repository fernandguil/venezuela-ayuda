// Snapshots the live damaged-building feeds (KoboToolbox form + curated Google
// Sheet) into the damaged_reports table, so they become durable DB rows instead
// of being fetched live on every request. Mirrors the exact logic the map uses
// today (src/lib/koboBuildings.ts + src/lib/damagedBuildings.ts), including the
// 75 m Kobo-vs-sheet dedup, so the resulting count matches what the map shows.
//
// Idempotent: clears prior feed-sourced rows (external_id like 'kobo_%'/'sheet_%')
// and re-inserts. Re-run anytime to refresh from the sources. NEVER touches
// community-submitted rows (those have no such external_id).
//
//   node scripts/ingest-damaged-buildings.mjs --dry   # fetch + map + count, no DB
//   node scripts/ingest-damaged-buildings.mjs         # write to the target DB
//
// Target DB via env (point at staging first):
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/ingest-damaged-buildings.mjs
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry");
const DUP_RADIUS_KM = 0.075;

// --- sources (identical to the app's lib modules) ---------------------------
const KOBO_ASSET = "a8XWDsdUcpBzXGtgQmiiro";
const EVENTO = "edificio_colapsado___da_o_estructural";
const KOBO_URL =
  `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET}/data.json` +
  `?format=json&limit=30000&query=${encodeURIComponent(JSON.stringify({ Evento: EVENTO }))}`;
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS3i3R6bCeox2n9hPMrxTPY2cDBXYnnJtXIC74YrQ9q-lc1USCiQ9_4ksVWG1TiuFGXzKLGb6C8jcmR/pub?output=csv";

const ZONE_COORDS = [
  ["los palos grandes", 10.503, -66.844], ["los dos caminos", 10.509, -66.829],
  ["el paraiso", 10.479, -66.929], ["pinto salinas", 10.5, -66.895],
  ["el recreo", 10.501, -66.892], ["proceres", 10.476, -66.891],
  ["chacao", 10.497, -66.854], ["punta brisas", 10.6075, -66.886],
  ["15 letras", 10.608, -66.889], ["macuto", 10.6085, -66.8915],
  ["caraballeda", 10.613, -66.852], ["caribe", 10.612, -66.855],
  ["tucacas", 10.799, -68.316],
];
const CITY_COORDS = [
  ["la guaira", 10.601, -66.933], ["caracas", 10.488, -66.879], ["tucacas", 10.799, -68.316],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const inVE = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= 0 && lat <= 16 && lng >= -74 && lng <= -59;

function haversineKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Deterministic ~±150 m jitter (identical to damagedBuildings.ts).
function jitter(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return [((h % 1000) / 1000 - 0.5) * 0.0032, (((h >> 10) % 1000) / 1000 - 0.5) * 0.0032];
}

// Minimal CSV parser (quoted fields, embedded commas/newlines).
function parseCsv(text) {
  const rows = [], row = []; let cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = ""; if (row.some((x) => x !== "")) rows.push([...row]); row.length = 0;
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); if (row.some((x) => x !== "")) rows.push([...row]); }
  return rows;
}

async function geocode(query) {
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ve&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(u, { headers: { "User-Agent": "venezuela-ayuda-ingest/1.0 (relief map)" } });
    await sleep(1100);
    if (!res.ok) return null;
    const a = await res.json();
    if (!a[0]) return null;
    const lat = parseFloat(a[0].lat), lng = parseFloat(a[0].lon);
    return inVE(lat, lng) ? [lat, lng] : null;
  } catch { return null; }
}

function centroidBase(city, zone) {
  const z = norm(zone), c = norm(city);
  for (const [k, lat, lng] of ZONE_COORDS) if (z.includes(k)) return [lat, lng];
  for (const [k, lat, lng] of CITY_COORDS) if (c.includes(k)) return [lat, lng];
  return null;
}

// --- 1. Kobo records → rows (exact coords, severity COLLAPSED) ---------------
async function fetchKobo() {
  const res = await fetch(KOBO_URL, { headers: { "User-Agent": "venezuela-ayuda-ingest/1.0" } });
  if (!res.ok) throw new Error(`kobo ${res.status}`);
  const json = await res.json();
  const out = [];
  for (const r of json.results || []) {
    if (r.Evento !== EVENTO) continue;
    let coords = null;
    const g = r._geolocation;
    if (Array.isArray(g) && g.length >= 2 && inVE(Number(g[0]), Number(g[1]))) coords = [Number(g[0]), Number(g[1])];
    if (!coords && typeof r.Ubicaci_n === "string") {
      const [lat, lng] = r.Ubicaci_n.trim().split(/\s+/).map(Number);
      if (inVE(lat, lng)) coords = [lat, lng];
    }
    if (!coords) continue;
    const desc = (r.Descripci_n_del_evento ?? "").trim();
    out.push({
      external_id: `kobo_${r._id}`,
      place_name: desc.slice(0, 120) || "Edificio con daño estructural",
      description: desc || null,
      severity: "COLLAPSED",
      city: null,
      latitude: coords[0], longitude: coords[1],
      status: "OPEN",
      source: "KoboToolbox",
      source_url: `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET}/data/${r._id}`,
      dedup_key: `${coords[0].toFixed(4)},${coords[1].toFixed(4)}`,
    });
  }
  return out;
}

// --- 2. Sheet rows → rows (geocoded/centroid + jitter, approximate) ----------
async function fetchSheet() {
  const res = await fetch(SHEET_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`sheet ${res.status}`);
  const rows = parseCsv(await res.text());
  if (rows.length < 2) return [];
  const header = rows[0].map(norm);
  const col = (n) => header.findIndex((h) => h.includes(n));
  const iCity = col("ciudad"), iZone = col("zona"), iBuilding = col("edificio"),
    iReport = col("reporte"), iSource = col("cuenta"),
    iSearch = col("busqueda"), iNote = col("nota");
  if (iBuilding < 0) return [];
  const out = [];
  let idx = 0;
  for (const row of rows.slice(1)) {
    idx++;
    const get = (i) => (i >= 0 && i < row.length ? row[i].trim() : "");
    const building = get(iBuilding), zone = get(iZone), city = get(iCity);
    if (!building && !zone) continue;
    // locate(): online zone → online city → centroid, + jitter (same as the app)
    const zoneQuery = zone.split("/")[0].trim();
    let base = null;
    if (zoneQuery) base = await geocode(`${zoneQuery}, ${city}, Venezuela`);
    if (!base && city) base = await geocode(`${city}, Venezuela`);
    if (!base) base = centroidBase(city, zone);
    if (!base) continue;
    const [da, db] = jitter(`${building}|${zone}|${idx}`);
    const lat = base[0] + da, lng = base[1] + db;
    const report = get(iReport), note = get(iNote);
    const firstUrl = get(iSearch).split(/\s+/).find((s) => s.startsWith("http")) || null;
    out.push({
      // Row-index prefix guarantees uniqueness — multiple unnamed buildings in
      // the same city/source must not collide (damaged_reports now has a UNIQUE
      // index on (source, external_id), added by migration 0015_api_partners).
      external_id: `sheet_${idx}_${norm(building) || norm(zone) || "na"}_${norm(city)}`.replace(/\s+/g, "-").slice(0, 200),
      place_name: building || zone,
      description: [report, [zone, city].filter(Boolean).join(", "), note].filter(Boolean).join(" — ") || null,
      severity: "PARTIAL",
      city: city || null,
      latitude: lat, longitude: lng,
      status: "OPEN",
      source: get(iSource) || "Reporte curado (X)",
      source_url: firstUrl,
      dedup_key: `${norm(building)}|${norm(city)}`,
    });
  }
  return out;
}

// --- main --------------------------------------------------------------------
const kobo = await fetchKobo();
const sheet = await fetchSheet();
// Drop Kobo rows within 75 m of a sheet row (same dedup the map applies).
const koboNew = kobo.filter((k) =>
  !sheet.some((s) => haversineKm({ lat: k.latitude, lng: k.longitude }, { lat: s.latitude, lng: s.longitude }) <= DUP_RADIUS_KM));
const rows = [...sheet, ...koboNew];

console.log(`Kobo: ${kobo.length} · Sheet: ${sheet.length} · Kobo after dedup: ${koboNew.length}`);
console.log(`→ ${rows.length} damaged-building rows to persist`);

// damaged_reports has a UNIQUE index on (source, external_id) — fail loudly here
// rather than half-insert and trip the constraint.
const keys = new Set(), dups = [];
for (const r of rows) { const k = `${r.source}|${r.external_id}`; if (keys.has(k)) dups.push(k); else keys.add(k); }
if (dups.length) { console.error(`ABORT: ${dups.length} duplicate (source, external_id):`, dups.slice(0, 5)); process.exit(1); }

// Target DB creds (used for both the vs-existing dedup and the write).
let env = {};
try {
  env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
} catch {}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY || env.SUPABASE_SECRET_KEY;
const REST = URL_ && KEY ? `${URL_}/rest/v1` : null;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// Paginated fetch — never silently truncates at PostgREST's page cap.
async function fetchAll(path) {
  const out = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const res = await fetch(`${REST}/${path}`, { headers: { ...H, Range: `${from}-${from + page - 1}` } });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const chunk = await res.json();
    out.push(...chunk);
    if (chunk.length < page) return out;
  }
}

// Dedup against EXISTING rows already in the target DB (community reports + prior
// sister-site ingests). Drop a feed row when it sits within 75 m of an existing
// building (visual duplicate) or would collide on the (source, external_id)
// unique index from migration 0015. Excludes our own prior feed rows — the
// DELETE below replaces those. No-op when the DB has no pre-existing rows (staging).
let persist = rows;
if (REST) {
  const existing = await fetchAll(
    "damaged_reports?select=latitude,longitude,source,external_id" +
    "&or=(external_id.is.null,and(external_id.not.like.kobo_*,external_id.not.like.sheet_*))");
  const exKeys = new Set(existing.map((e) => `${e.source}|${e.external_id}`));
  const exGeo = existing.filter((e) => e.latitude != null && e.longitude != null);
  let dropGeo = 0, dropKey = 0;
  persist = rows.filter((r) => {
    if (exKeys.has(`${r.source}|${r.external_id}`)) { dropKey++; return false; }
    if (exGeo.some((e) => haversineKm({ lat: r.latitude, lng: r.longitude }, { lat: e.latitude, lng: e.longitude }) <= DUP_RADIUS_KM)) { dropGeo++; return false; }
    return true;
  });
  console.log(`Existing non-feed rows: ${existing.length} · dropped ${dropGeo} (within 75 m) + ${dropKey} (key collision) → ${persist.length} to persist`);
}

if (DRY) {
  console.log("\n--- DRY RUN samples ---");
  console.log("sheet[0]:", JSON.stringify(sheet[0]));
  console.log("kobo[0]: ", JSON.stringify(koboNew[0]));
  console.log(REST
    ? "(vs-existing dedup applied above — read-only, no writes)"
    : "(no creds → vs-existing dedup skipped; set env to preview the prod impact)");
  console.log("Re-run without --dry to ingest.");
  process.exit(0);
}

if (!REST) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY"); process.exit(1); }
console.log(`\nTarget: ${URL_}`);
// Idempotent: remove prior feed-sourced rows, then insert. Community rows (no
// kobo_/sheet_ external_id) are untouched.
const del = await fetch(`${REST}/damaged_reports?or=(external_id.like.kobo_*,external_id.like.sheet_*)`,
  { method: "DELETE", headers: { ...H, Prefer: "return=minimal" } });
if (!del.ok) { console.error(`delete failed: ${del.status} ${await del.text()}`); process.exit(1); }
const ins = await fetch(`${REST}/damaged_reports`,
  { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(persist) });
if (!ins.ok) { console.error(`insert failed: ${ins.status} ${await ins.text()}`); process.exit(1); }
console.log(`Ingested ${persist.length} damaged-building rows.`);
