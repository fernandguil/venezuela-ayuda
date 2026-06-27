-- 0017 · Private national ID (cédula) for exact family search + dedup signal
--
-- cedula_private: normalized V-/E- prefixed value, NEVER exposed publicly.
-- cedula_hash: HMAC-SHA256(normalized, CEDULA_HMAC_SECRET) — computed app-side.
-- Non-unique index: external/unverified rows may share hashes until admin review.

alter table checkins
  add column if not exists cedula_private text,
  add column if not exists cedula_hash text;

create index if not exists checkins_cedula_hash_idx
  on checkins (cedula_hash)
  where cedula_hash is not null;

-- Recreate public view without private ID columns.
create or replace view public_checkins as
  select id, name, status, city, latitude, longitude, message, photo_url,
         created_at, found_at, place_name, source, source_url
  from checkins
  where hidden = false;

grant select on public_checkins to anon, authenticated;

-- Extend dedup scorer: same cedula_hash + compatible name → HARD tier candidate.
create or replace function score_checkin_pair(a checkins, b checkins)
returns table (score real, hard boolean, risk text, evidence jsonb)
language plpgsql stable as $$
declare
  s          real := 0;
  v_name_sim real := 0;
  v_phon     boolean := false;
  v_samezone boolean := false;
  v_dist_km  double precision := null;
  v_cos      real := null;
  v_risk     text := 'text';
  v_hard     boolean := false;
begin
  v_name_sim := similarity(coalesce(a.name_normalized, ''), coalesce(b.name_normalized, ''));

  -- National ID: identifies the person (not the reporter). Same rule shape as phone.
  if a.cedula_hash is not null and a.cedula_hash = b.cedula_hash then
    if a.name_normalized is null or b.name_normalized is null or v_name_sim >= 0.6 then
      return query select 1.0::real, true, 'text',
        jsonb_build_object('cedula_match', true, 'name_sim', round(v_name_sim::numeric, 3));
      return;
    else
      return query select 0.80::real, false, 'field_conflict',
        jsonb_build_object('cedula_match', true, 'name_sim', round(v_name_sim::numeric, 3),
                           'note', 'same cedula hash, different names');
      return;
    end if;
  end if;

  -- Reporter-phone rule.
  if a.phone_last7 is not null and a.phone_last7 = b.phone_last7 then
    if a.name_normalized is null or b.name_normalized is null or v_name_sim >= 0.6 then
      return query select 1.0::real, true, 'text',
        jsonb_build_object('phone_match', true, 'name_sim', round(v_name_sim::numeric, 3));
      return;
    else
      return query select 0.80::real, false, 'field_conflict',
        jsonb_build_object('phone_match', true, 'name_sim', round(v_name_sim::numeric, 3),
                           'note', 'same reporter phone, different names');
      return;
    end if;
  end if;

  v_phon := a.name_phonetic_codes && b.name_phonetic_codes;
  if v_phon then s := s + 0.35; end if;

  s := s + 0.40 * v_name_sim;

  if a.geohash6 is not null and a.geohash6 = b.geohash6 then
    v_samezone := true; s := s + 0.15;
  elsif a.location is not null and b.location is not null then
    v_dist_km := st_distance(a.location, b.location) / 1000.0;
    if v_dist_km <= 2 then v_samezone := true; s := s + 0.10; end if;
  end if;

  if a.embedding is not null and b.embedding is not null then
    v_cos := (1 - (a.embedding <=> b.embedding))::real;
    if v_cos < 0.45 then
      return query select least(0.40, s)::real, false, 'semantic_mismatch',
        jsonb_build_object('name_sim', round(v_name_sim::numeric, 3),
                           'cosine', round(v_cos::numeric, 3), 'veto', 'cosine');
      return;
    end if;
    s := s + 0.30 * greatest(0, v_cos);
  end if;

  return query select least(1.0, greatest(0, s))::real, v_hard, v_risk,
    jsonb_build_object(
      'name_sim',  round(v_name_sim::numeric, 3),
      'phonetic',  v_phon,
      'same_zone', v_samezone,
      'dist_km',   case when v_dist_km is null then null else round(v_dist_km::numeric, 2) end,
      'cosine',    case when v_cos is null then null else round(v_cos::numeric, 3) end,
      'method',    'sql_cross'
    );
end $$;

-- Block pairs that share cedula_hash in addition to phonetic/geo/phone.
create or replace function run_dedup_engine(p_min_review real default 0.75, p_auto real default 0.90)
returns table (scanned int, queued int)
language plpgsql security definer set search_path = public as $$
declare
  a checkins;
  b checkins;
  sc record;
  v_scanned int := 0;
  v_queued  int := 0;
  v_keep uuid; v_dup uuid; v_tier merge_tier;
begin
  for a in
    select * from checkins where source is not null and hidden = false
  loop
    v_scanned := v_scanned + 1;
    for b in
      select * from checkins c
      where c.id <> a.id
        and c.source is not null and c.hidden = false
        and c.id > a.id
        and (
              (a.name_phonetic_codes is not null and c.name_phonetic_codes && a.name_phonetic_codes)
           or (a.geohash6 is not null and c.geohash6 = a.geohash6)
           or (a.phone_last7 is not null and c.phone_last7 = a.phone_last7)
           or (a.cedula_hash is not null and c.cedula_hash = a.cedula_hash)
        )
    loop
      select * into sc from score_checkin_pair(a, b);
      if sc.score < p_min_review then continue; end if;

      if a.dedup_key is not null and a.dedup_key = b.dedup_key then continue; end if;

      v_tier := case
        when sc.hard then 'HARD'::merge_tier
        when sc.score >= p_auto then 'STRONG'::merge_tier
        else 'REVIEW'::merge_tier end;

      if (case when a.photo_url is not null then 1 else 0 end,
          coalesce(length(a.message), 0), b.created_at)
         >= (case when b.photo_url is not null then 1 else 0 end,
             coalesce(length(b.message), 0), a.created_at)
      then v_keep := a.id; v_dup := b.id;
      else v_keep := b.id; v_dup := a.id;
      end if;

      insert into merge_candidates (table_name, keep_id, dup_id, confidence, reason, tier, evidence)
        values ('checkins', v_keep, v_dup, sc.score, 'engine', v_tier, sc.evidence)
        on conflict (table_name, pair_lo, pair_hi) do nothing;
      if found then v_queued := v_queued + 1; end if;
    end loop;
  end loop;

  return query select v_scanned, v_queued;
end $$;

insert into applied_migrations (version) values ('0017') on conflict do nothing;
