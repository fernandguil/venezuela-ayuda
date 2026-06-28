-- 0023 · Add manage_token_hash columns (additive, forward-only)
--
-- Adds manage_token_hash alongside manage_token on the tables that issue one and
-- populates it from the existing value. Additive only; no column is dropped.
-- pgcrypto (digest) is available since 0001.

alter table checkins           add column if not exists manage_token_hash text;
alter table help_requests      add column if not exists manage_token_hash text;
alter table damaged_reports    add column if not exists manage_token_hash text;
alter table collection_centers add column if not exists manage_token_hash text;

update checkins
  set manage_token_hash = encode(digest(manage_token, 'sha256'), 'hex')
  where manage_token is not null and manage_token_hash is null;
update help_requests
  set manage_token_hash = encode(digest(manage_token, 'sha256'), 'hex')
  where manage_token is not null and manage_token_hash is null;
update damaged_reports
  set manage_token_hash = encode(digest(manage_token, 'sha256'), 'hex')
  where manage_token is not null and manage_token_hash is null;
update collection_centers
  set manage_token_hash = encode(digest(manage_token, 'sha256'), 'hex')
  where manage_token is not null and manage_token_hash is null;

insert into applied_migrations (version) values ('0023') on conflict do nothing;
