-- 0031 · FR consent flag on checkins (issue #99)
--
-- Adds `fr_consent` to the checkins table so the app can:
--   1. Record whether the submitter explicitly consented to facial-recognition
--      indexing at submission time.
--   2. Drive the opt-out button on the persona page (show only when true).
--   3. Gate frIndexPerson() — no indexing without consent=true.
--
-- `fr_consent` is intentionally included in public_checkins so the persona
-- page (a public server component) can decide whether to render the opt-out
-- control without a privileged DB call. The value itself is not sensitive:
-- it only reveals that the submitter attached a photo and ticked a checkbox.

alter table checkins
  add column if not exists fr_consent boolean not null default false;

-- Recreate public_checkins adding fr_consent.
-- All other columns are kept identical to migration 0007.
create or replace view public_checkins as
  select id, name, status, city, latitude, longitude, message, photo_url,
         created_at, found_at, place_name, source, source_url, fr_consent
  from checkins
  where hidden = false;

insert into applied_migrations (version) values ('0031')
  on conflict do nothing;
