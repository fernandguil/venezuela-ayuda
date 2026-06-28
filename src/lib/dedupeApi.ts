// Client for the deduplication review API (FastAPI/Swagger backend).
//
// Mental model:
//  - A *group* (GRP-xxxxx) is a connected cluster of person-records the system
//    thinks might relate. There are thousands of them.
//  - Inside a group are *records* (one reported person: name, age, location,
//    phone, photo, source text, folio).
//  - Records are linked by *relationships* of two kinds:
//      proposed_duplicate    -> "same person" (tied to a duplicate_cluster_id)
//      same_group_or_family  -> "related but different people"
//  - The reviewer's job per group: confirm true duplicates, reject false ones.
//
// Calls go from the browser to a same-origin proxy (`/api/dedupe`), which
// forwards them to the real dedupe API server-side with the required
// credentials attached (see `src/app/api/dedupe/[...path]/route.ts`). The API
// key never reaches the browser. Override the base only for local testing via
// NEXT_PUBLIC_DEDUPE_API_BASE.

export const DEDUPE_API_URL = (
  process.env.NEXT_PUBLIC_DEDUPE_API_BASE || "/api/dedupe"
).replace(/\/$/, "");

// ---- Datasets --------------------------------------------------------------
//
// The API now hosts several datasets. Each one is addressed by a *slug*:
// requests go to `/{slug}/api/...`. The contingency app's data lives in the
// "default" dataset (slug `terremotovenezuelaapp`), which the API also exposes
// at the un-prefixed legacy paths `/api/...`. We treat that slug as the
// sentinel for "use the legacy paths" so nothing about the original flow
// changes.
//
// There is no list-datasets endpoint, so the available datasets are configured
// via env (NEXT_PUBLIC_DEDUPE_DATASETS = "slug:Label,slug2:Label2"). When unset
// we expose only the default. The slug ALONE may also be given (label = slug).

export const DEFAULT_DATASET_SLUG = "terremotovenezuelaapp";

export interface DatasetOption {
  slug: string;
  label: string;
}

export function listDatasetOptions(): DatasetOption[] {
  const raw = process.env.NEXT_PUBLIC_DEDUPE_DATASETS?.trim();
  const def: DatasetOption = {
    slug: DEFAULT_DATASET_SLUG,
    label: "Terremoto Venezuela",
  };
  if (!raw) return [def];

  const parsed: DatasetOption[] = [];
  for (const entry of raw.split(",")) {
    const [slug, ...labelParts] = entry.split(":");
    const s = slug?.trim();
    if (!s) continue;
    parsed.push({ slug: s, label: labelParts.join(":").trim() || s });
  }
  if (!parsed.length) return [def];
  // Ensure the default is always selectable (and first) without duplicating it.
  if (!parsed.some((d) => d.slug === DEFAULT_DATASET_SLUG)) {
    parsed.unshift(def);
  }
  return parsed;
}

// Build the base path for a dataset. The default dataset uses the legacy
// un-prefixed paths; every other dataset is scoped under its slug.
function basePath(dataset?: string | null): string {
  if (!dataset || dataset === DEFAULT_DATASET_SLUG) return "";
  return `/${encodeURIComponent(dataset)}`;
}

// ---- Types (mirrors the OpenAPI schemas) ----------------------------------

export type RelationshipType = "proposed_duplicate" | "same_group_or_family" | string;
export type ManualStatus = "proposed" | "confirmed" | "rejected" | string;

export interface RecordSummary {
  record_id: string;
  group_id: string | null;
  duplicate_cluster_id: string | null;
  proposed_primary_record_id: string | null;
  duplicate_role: "primary" | "secondary" | string | null;
  relationship_bucket: string | null;
  person_name_raw: string | null;
  age: number | string | null;
  last_seen_location_raw: string | null;
  contact_phone_e164: number | string | null;
  source_text_raw: string | null;
  image_public_path: string | null;
  status: string | null;
  folio: string | null;
  manual_group_status: string | null;
  // Hospital / patient match fields (set when this report matched a hospital's
  // admitted-patient list — i.e. the person may have been found).
  source_profile: string | null;
  hospital_id: string | null;
  hospital_name: string | null;
  hospital_state: string | null;
  hospital_municipality: string | null;
  hospital_address: string | null;
  patient_condition: string | null;
  patient_notes: string | null;
  // Timestamps come back as epoch millis (number) or ISO strings; treat both.
  patient_admitted_at: number | string | null;
  patient_updated_at: number | string | null;
}

export interface RelationshipSummary {
  id: string;
  group_id: string | null;
  duplicate_cluster_id: string | null;
  relationship_type: RelationshipType;
  primary_record_id: string;
  secondary_record_id: string;
  primary_person_name_raw: string | null;
  secondary_person_name_raw: string | null;
  primary_age: number | string | null;
  secondary_age: number | string | null;
  primary_last_seen_location_raw: string | null;
  secondary_last_seen_location_raw: string | null;
  primary_contact_phone_e164: number | string | null;
  secondary_contact_phone_e164: number | string | null;
  name_score: number | null;
  location_score: number | null;
  phone_match: boolean | null;
  overall_score: number | null;
  family_group_reason: string | null;
  manual_status: ManualStatus | null;
  manual_reason: string | null;
  source: string | null;
}

export interface GroupSummary {
  group_id: string;
  record_count: number;
  duplicate_record_count: number;
  family_record_count: number;
  duplicate_cluster_count: number;
  // Whether any record in the group has been "found" (e.g. matched at a
  // hospital) and how many. Drives the queue badges/filters.
  has_found_record: boolean;
  found_record_count: number;
  has_hospital_match: boolean;
  hospital_match_count: number;
  sample_names: string[];
  sample_locations: string[];
  sample_phones: string[];
  primary_record_ids: string[];
}

// A hospital patient record (from a hospital's admitted-patient list).
export interface PacientSummary {
  pacient_id: string;
  group_id: string | null;
  person_name_raw: string | null;
  age: number | string | null;
  last_seen_location_raw: string | null;
  contact_phone_e164: number | string | null;
  source_text_raw: string | null;
  image_public_path: string | null;
  status: string | null;
  source_profile: string | null;
  hospital_id: string | null;
  hospital_name: string | null;
  hospital_state: string | null;
  hospital_municipality: string | null;
  hospital_address: string | null;
  patient_condition: string | null;
  patient_notes: string | null;
  // Timestamps come back as epoch millis (number) or ISO strings; treat both.
  patient_admitted_at: number | string | null;
  patient_updated_at: number | string | null;
  best_match_record_id: string | null;
  best_match_group_id: string | null;
  best_overall_score: number | null;
  match_count: number;
}

// A hospital patient matched to one of the group's reported records.
export interface PacientMatchSummary {
  pacient: PacientSummary;
  record: RecordSummary | null;
  relationship: RelationshipSummary;
}

export interface GroupDetail {
  group: GroupSummary;
  records: RecordSummary[];
  relationships: RelationshipSummary[];
}

export interface ListGroupsResponse {
  groups: GroupSummary[];
  total: number;
}

// Full duplicate context for a single record (the drill-down view): the record
// itself, the group it belongs to, every other record in that group, and the
// duplicate relationships/records plus any hospital matches. Mirrors the API's
// RecordDuplicateContext schema.
export interface RecordDuplicateContext {
  record: RecordSummary;
  group: GroupSummary | null;
  group_records: RecordSummary[];
  duplicate_relationships: RelationshipSummary[];
  duplicate_records: RecordSummary[];
  pacient_matches: PacientMatchSummary[];
  duplicate_average_score: number | null;
  duplicate_mode_score: number | null;
  has_found_record: boolean;
  has_found_duplicate: boolean;
  has_hospital_match: boolean;
}

// ---- Low-level fetch -------------------------------------------------------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only send Content-Type when there's a body. Setting it on GET/DELETE makes
  // the cross-origin request "non-simple" → a CORS preflight (OPTIONS) on the
  // hot path, which the API may not answer for those routes.
  const headers: HeadersInit = {
    ...(init?.body != null ? { "Content-Type": "application/json" } : {}),
    ...(init?.headers || {}),
  };
  const res = await fetch(`${DEDUPE_API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.detail
        ? typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail)
        : "";
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new Error(`API ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  // Some endpoints (downloads) may return no JSON body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---- Endpoints -------------------------------------------------------------

export function listGroups(params: {
  search?: string;
  limit?: number;
  offset?: number;
  hospitalMatchesOnly?: boolean;
  foundOnly?: boolean;
  dataset?: string | null;
  signal?: AbortSignal;
}): Promise<ListGroupsResponse> {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  q.set("limit", String(params.limit ?? 50));
  q.set("offset", String(params.offset ?? 0));
  if (params.hospitalMatchesOnly) q.set("hospital_matches_only", "true");
  if (params.foundOnly) q.set("found_only", "true");
  return request<ListGroupsResponse>(
    `${basePath(params.dataset)}/api/groups?${q.toString()}`,
    { signal: params.signal },
  );
}

export function getGroup(
  groupId: string,
  opts?: { dataset?: string | null; signal?: AbortSignal },
): Promise<GroupDetail> {
  return request<GroupDetail>(
    `${basePath(opts?.dataset)}/api/groups/${encodeURIComponent(groupId)}`,
    { signal: opts?.signal },
  );
}

// Hospital patients matched to a group's reported records — i.e. evidence that
// someone in this group may have been found at a hospital.
export function getGroupPacients(
  groupId: string,
  opts?: { dataset?: string | null; signal?: AbortSignal },
): Promise<PacientMatchSummary[]> {
  return request<PacientMatchSummary[]>(
    `${basePath(opts?.dataset)}/api/groups/${encodeURIComponent(groupId)}/pacients`,
    { signal: opts?.signal },
  );
}

// Confirm two records are the same person.
export function confirmDuplicate(
  body: {
    primary_record_id: string;
    secondary_record_id: string;
    group_id?: string | null;
  },
  dataset?: string | null,
): Promise<RelationshipSummary> {
  return request<RelationshipSummary>(`${basePath(dataset)}/api/duplicates`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function removeGroupMember(
  groupId: string,
  recordId: string,
  dataset?: string | null,
): Promise<RecordSummary> {
  return request<RecordSummary>(
    `${basePath(dataset)}/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(recordId)}`,
    { method: "DELETE" },
  );
}

// Pull a stray record INTO a group. The counterpart to removeGroupMember: used
// when the reviewer searches up a record that belongs with this group but the
// engine didn't cluster it here.
export function addGroupMember(
  groupId: string,
  recordId: string,
  dataset?: string | null,
): Promise<RecordSummary> {
  return request<RecordSummary>(
    `${basePath(dataset)}/api/groups/${encodeURIComponent(groupId)}/members`,
    { method: "POST", body: JSON.stringify({ record_id: recordId }) },
  );
}

// Explicitly reject a proposed duplicate (two records are NOT the same person).
// The counterpart to confirmDuplicate — records a negative decision instead of
// silently dropping the pair.
export function rejectDuplicate(
  body: {
    primary_record_id: string;
    secondary_record_id: string;
    reason?: string | null;
  },
  dataset?: string | null,
): Promise<RelationshipSummary> {
  return request<RelationshipSummary>(
    `${basePath(dataset)}/api/duplicates/reject`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

// Reject a relationship by its id (e.g. a "same group/family" link that's
// wrong). Distinct from rejectDuplicate, which targets a record pair.
export function rejectRelationship(
  body: { relationship_id: string; reason?: string | null },
  dataset?: string | null,
): Promise<RelationshipSummary> {
  return request<RelationshipSummary>(
    `${basePath(dataset)}/api/relationships/reject`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

// Free-text search for individual records across the dataset (independent of
// the group queue). Used to find a record to pull into a group, or to inspect
// one person's duplicate context directly.
export function searchRecords(params: {
  q: string;
  limit?: number;
  dataset?: string | null;
  signal?: AbortSignal;
}): Promise<RecordSummary[]> {
  const qs = new URLSearchParams({ q: params.q });
  // API caps limit at 100 (default 25).
  qs.set("limit", String(Math.min(params.limit ?? 25, 100)));
  return request<RecordSummary[]>(
    `${basePath(params.dataset)}/api/records/search?${qs.toString()}`,
    { signal: params.signal },
  );
}

// Full duplicate context for one record: its group, the other records in it,
// the duplicate relationships/records, and any hospital matches.
export function getRecordDuplicateContext(
  recordId: string,
  opts?: { dataset?: string | null; signal?: AbortSignal },
): Promise<RecordDuplicateContext> {
  return request<RecordDuplicateContext>(
    `${basePath(opts?.dataset)}/api/records/${encodeURIComponent(recordId)}/duplicate-context`,
    { signal: opts?.signal },
  );
}

// Hospital patient matches for a single record (the per-record equivalent of
// getGroupPacients).
export function getRecordPacients(
  recordId: string,
  opts?: { dataset?: string | null; signal?: AbortSignal },
): Promise<PacientMatchSummary[]> {
  return request<PacientMatchSummary[]>(
    `${basePath(opts?.dataset)}/api/records/${encodeURIComponent(recordId)}/pacients`,
    { signal: opts?.signal },
  );
}

// ---- Helpers ---------------------------------------------------------------

export function formatPhone(phone: number | string | null | undefined): string | null {
  if (phone == null || phone === "") return null;
  // The API returns phones as floats/strings like 584123567129 or "584123567129.0".
  const digits = String(phone).replace(/\.0+$/, "").replace(/\D/g, "");
  if (!digits) return null;
  return `+${digits}`;
}

// Build the proposed-person clusters for a group's records. The API already
// pre-clusters: records sharing a duplicate_cluster_id are the "same person",
// and proposed_primary_record_id marks the keeper. Records with no cluster are
// treated as their own single-record person.
export interface PersonCluster {
  key: string; // cluster id, or the record id for singletons
  clusterId: string | null;
  primaryId: string | null;
  name: string; // best display name for the person
  records: RecordSummary[];
}

export function buildPersonClusters(records: RecordSummary[]): PersonCluster[] {
  const byCluster = new Map<string, RecordSummary[]>();
  const singletons: RecordSummary[] = [];

  for (const r of records) {
    if (r.duplicate_cluster_id) {
      const arr = byCluster.get(r.duplicate_cluster_id) ?? [];
      arr.push(r);
      byCluster.set(r.duplicate_cluster_id, arr);
    } else {
      singletons.push(r);
    }
  }

  const clusters: PersonCluster[] = [];
  for (const [clusterId, recs] of byCluster) {
    const primary =
      recs.find((r) => r.record_id === r.proposed_primary_record_id) ?? recs[0];
    clusters.push({
      key: clusterId,
      clusterId,
      primaryId: primary?.proposed_primary_record_id ?? primary?.record_id ?? null,
      name: primary?.person_name_raw || recs[0]?.person_name_raw || "Sin nombre",
      records: recs,
    });
  }
  for (const r of singletons) {
    clusters.push({
      key: r.record_id,
      clusterId: null,
      primaryId: r.record_id,
      name: r.person_name_raw || "Sin nombre",
      records: [r],
    });
  }
  return clusters;
}

// Commit a reviewed group: remove the records the reviewer marked as not
// belonging, then confirm the remaining duplicate clusters. Returns per-action
// results so the UI can surface partial failures.
export async function commitGroupReview(opts: {
  groupId: string;
  removedRecordIds: string[];
  clusters: PersonCluster[];
  dataset?: string | null;
}): Promise<{ removed: number; confirmed: number; errors: string[] }> {
  const errors: string[] = [];
  let removed = 0;
  let confirmed = 0;

  // 1) Remove records that don't belong.
  await Promise.all(
    opts.removedRecordIds.map(async (recordId) => {
      try {
        await removeGroupMember(opts.groupId, recordId, opts.dataset);
        removed += 1;
      } catch (e) {
        errors.push(`No se pudo quitar ${recordId}: ${msg(e)}`);
      }
    }),
  );

  const removedSet = new Set(opts.removedRecordIds);

  // 2) Confirm each surviving duplicate cluster (>=2 kept records = same person).
  await Promise.all(
    opts.clusters.map(async (cluster) => {
      if (!cluster.clusterId) return; // singletons need no confirmation
      const kept = cluster.records.filter((r) => !removedSet.has(r.record_id));
      const primary =
        kept.find((r) => r.record_id === cluster.primaryId) ?? kept[0];
      if (!primary || kept.length < 2) return;
      for (const r of kept) {
        if (r.record_id === primary.record_id) continue;
        try {
          await confirmDuplicate(
            {
              primary_record_id: primary.record_id,
              secondary_record_id: r.record_id,
              group_id: opts.groupId,
            },
            opts.dataset,
          );
          confirmed += 1;
        } catch (e) {
          errors.push(`No se pudo confirmar ${r.record_id}: ${msg(e)}`);
        }
      }
    }),
  );

  return { removed, confirmed, errors };
}

function msg(e: unknown) {
  return e instanceof Error ? e.message : "error";
}
