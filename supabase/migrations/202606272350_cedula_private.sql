-- 202606272350 · Private national ID (cédula) for exact family search
--
-- cedula_private: normalized V-/E- prefixed value, NEVER exposed publicly.
-- cedula_hash: HMAC-SHA256(normalized, CEDULA_HMAC_SECRET), computed app-side.
-- Non-unique: external/unverified rows may share hashes until human review.

-- The old branch version of this migration extended the now-removed SQL dedup
-- engine. Clean up those stale functions if a local DB already saw that version.
drop function if exists run_dedup_engine(real, real);
drop function if exists score_checkin_pair(checkins, checkins);

alter table checkins
  add column if not exists cedula_private text,
  add column if not exists cedula_hash text;

create index if not exists checkins_cedula_hash_idx
  on checkins (cedula_hash)
  where cedula_hash is not null;

-- Recreate public view explicitly without private cédula columns.
create or replace view public_checkins as
  select id, name, status, city, latitude, longitude, message, photo_url,
         created_at, found_at, place_name, source, source_url
  from checkins
  where hidden = false;

grant select on public_checkins to anon, authenticated;

insert into applied_migrations (version) values ('202606272350') on conflict do nothing;
