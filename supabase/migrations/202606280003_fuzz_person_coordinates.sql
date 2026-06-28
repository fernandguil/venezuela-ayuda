-- 202606280003 · Generalize (fuzz) person coordinates in public views
--
-- People-related reports (checkins, help requests, help offers) expose the exact
-- lat/lng of an individual, which is a privacy risk: an exact coordinate can
-- pinpoint a missing person, a household in need, or someone offering help from
-- their home. We round those coordinates to 3 decimal places (~110 m at the
-- equator) so the public map still shows a meaningful neighborhood-level cluster
-- without leaking a precise location.
--
-- Damaged-reports (public_damaged_reports) are about BUILDINGS / infrastructure,
-- not people, so they stay EXACT and are intentionally NOT touched here.
--
-- Type note: we cast back to double precision (float8). PostgREST serializes a
-- bare numeric as a JSON string, which would break the map and any consumer that
-- expects a number. round(...)::numeric keeps 3 decimals; ::double precision
-- restores the float8 wire type the views already advertised.
--
-- Each view is recreated with the SAME columns, in the SAME order and with the
-- SAME names as the latest definition (checkins/help_requests from
-- 0007_external_sources.sql, help_offers from 0015_api_partners.sql); only the
-- latitude/longitude expressions change.

create or replace view public_checkins as
  select id, name, status, city,
         round((latitude)::numeric, 3)::double precision as latitude,
         round((longitude)::numeric, 3)::double precision as longitude,
         message, photo_url,
         created_at, found_at, place_name, source, source_url
  from checkins where hidden = false;

create or replace view public_help_requests as
  select id, category, description, urgency, city,
         round((latitude)::numeric, 3)::double precision as latitude,
         round((longitude)::numeric, 3)::double precision as longitude,
         status, created_at, place_name, items, source, source_url
  from help_requests where hidden = false;

create or replace view public_help_offers as
  select id, category, description, city,
         round((latitude)::numeric, 3)::double precision as latitude,
         round((longitude)::numeric, 3)::double precision as longitude,
         availability, available, created_at, source, source_url
  from help_offers where hidden = false;

grant select on public_checkins, public_help_requests, public_help_offers
  to anon, authenticated;

insert into applied_migrations (version) values ('202606280003') on conflict do nothing;
