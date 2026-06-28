-- 0029 · RBAC — permisos atómicos → roles → usuarios (issue #31)
--
-- Replaces scattered email allowlists with a proper role/permission model.
-- This migration is ADDITIVE: admin_emails stays in place; existing auth code
-- keeps working. The new tables run in parallel until routes are refactored to
-- call the RBAC library (tracked in issue #31's follow-on PRs).
--
-- Design:
--   permissions  — atomic named capabilities (e.g. "admin.access")
--   roles        — named groupings of permissions (e.g. "admin")
--   role_permissions — many-to-many: which permissions belong to which role
--   user_roles   — many-to-many: which roles are assigned to which user email
--
-- All tables are server-only (RLS + no public grants). The `user_permissions`
-- SQL function is the single authoritative query: given an email it returns
-- every permission the user holds across all their roles.

-- ── permissions ───────────────────────────────────────────────────────────────

create table if not exists permissions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,  -- e.g. 'admin.access'
  description text,
  created_at  timestamptz not null default now()
);

alter table permissions enable row level security;
revoke insert, update, delete on permissions from anon, authenticated;

-- ── roles ─────────────────────────────────────────────────────────────────────

create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,  -- e.g. 'admin'
  description text,
  created_at  timestamptz not null default now()
);

alter table roles enable row level security;
revoke insert, update, delete on roles from anon, authenticated;

-- ── role_permissions ──────────────────────────────────────────────────────────

create table if not exists role_permissions (
  role_id       uuid not null references roles (id) on delete cascade,
  permission_id uuid not null references permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

alter table role_permissions enable row level security;
revoke insert, update, delete on role_permissions from anon, authenticated;

-- ── user_roles ────────────────────────────────────────────────────────────────

create table if not exists user_roles (
  email       text not null,
  role_id     uuid not null references roles (id) on delete cascade,
  granted_by  text,
  granted_at  timestamptz not null default now(),
  primary key (email, role_id)
);

create index if not exists user_roles_email_idx on user_roles (lower(email));
alter table user_roles enable row level security;
revoke insert, update, delete on user_roles from anon, authenticated;

-- ── Seed: permissions ─────────────────────────────────────────────────────────

insert into permissions (name, description) values
  ('admin.access',   'Access the /admin panel'),
  ('admin.super',    'Manage admins and API partner keys'),
  ('modupe.review',  'Review and resolve deduplication candidates'),
  ('center.manage',  'Create, edit, and verify collection centers'),
  ('partner.manage', 'Issue and revoke API partner keys')
on conflict (name) do nothing;

-- ── Seed: roles ───────────────────────────────────────────────────────────────

insert into roles (name, description) values
  ('admin',       'Standard admin — panel access and center management'),
  ('super_admin', 'Full privileges including admin and partner key management'),
  ('reviewer',    'Deduplication reviewer with admin panel access')
on conflict (name) do nothing;

-- ── Seed: role_permissions ────────────────────────────────────────────────────

insert into role_permissions (role_id, permission_id)
  select r.id, p.id
  from roles r, permissions p
  where
    (r.name = 'admin'       and p.name in ('admin.access', 'center.manage'))
    or
    (r.name = 'super_admin' and p.name in ('admin.access', 'admin.super', 'center.manage', 'partner.manage', 'modupe.review'))
    or
    (r.name = 'reviewer'    and p.name in ('admin.access', 'modupe.review'))
on conflict do nothing;

-- ── Backfill: migrate admin_emails → user_roles ───────────────────────────────
-- Existing super-admins get the super_admin role; regular admins get admin.
-- granted_by = 'migration/0029'; granted_at = their original created_at.

insert into user_roles (email, role_id, granted_by, granted_at)
  select
    ae.email,
    r.id,
    'migration/0029',
    ae.created_at
  from admin_emails ae
  join roles r on r.name = case when ae.is_super_admin then 'super_admin' else 'admin' end
on conflict do nothing;

-- ── user_permissions(email) — primary RBAC query ──────────────────────────────
-- Returns every distinct permission name held by the user across all roles.
-- Called by the RBAC library (src/lib/rbac.ts) on every protected request.
-- Stable: reads only, no side effects. service_role only.

create or replace function user_permissions(p_email text)
returns table (permission_name text)
language sql
stable
as $$
  select distinct p.name
  from user_roles ur
  join roles r on r.id = ur.role_id
  join role_permissions rp on rp.role_id = r.id
  join permissions p on p.id = rp.permission_id
  where lower(ur.email) = lower(p_email);
$$;

revoke execute on function user_permissions(text) from public;
grant  execute on function user_permissions(text) to service_role;

insert into applied_migrations (version) values ('0029') on conflict do nothing;
