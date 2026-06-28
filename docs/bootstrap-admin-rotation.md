# Bootstrap admin — setup and rotation

The bootstrap super-admin account is seeded with a script that reads from
environment variables, **not** from hardcoded values in SQL migrations.

## Initial setup (new deployment)

```bash
BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SECRET_KEY=<service-role-key> \
node scripts/seed-bootstrap-admin.mjs
```

The script is idempotent: running it again with the same email is a no-op.
It upserts both `admin_emails` (legacy) and `user_roles` (RBAC, once
migration `0029` is applied).

## Rotating the bootstrap super-admin

1. **Grant** the `super_admin` role to the new email — either via the
   `/admin/roles` page (requires an existing super-admin session) or by
   running the script with the new address:

   ```bash
   BOOTSTRAP_ADMIN_EMAIL=new-admin@example.com node scripts/seed-bootstrap-admin.mjs
   ```

2. **Verify** the new account can sign in and access `/admin`.

3. **Revoke** the old super-admin role from the previous email via
   `/admin/roles` (Revoke button) or with SQL:

   ```sql
   delete from user_roles
     where email = 'old-admin@example.com'
       and role_id = (select id from roles where name = 'super_admin');
   ```

4. Remove the old email from `admin_emails` if you are still on the legacy
   table:

   ```sql
   delete from admin_emails where email = 'old-admin@example.com';
   ```

## Adding or revoking other admin roles

Use the `/admin/roles` page (super-admin only) or the SQL pattern in
[`docs/rbac.md`](rbac.md).

## Note on legacy migrations

Migrations `0006`, `0020`, and `202606280002` contain hardcoded seed emails
from the project's early history. Those entries cannot be removed from git
history, but they carry no operational weight once the accounts are managed
via `user_roles` and the hardcoded addresses are revoked as described above.
New deployments should use `seed-bootstrap-admin.mjs` and never hardcode an
email in SQL.
