import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import { getAdminSession } from "@/lib/admin";
import { listUserRoles, listRoles, grantRole, revokeRole } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const session = await getAdminSession();
  if (!session?.isSuper) redirect("/admin");

  const [assignments, roles] = await Promise.all([listUserRoles(), listRoles()]);

  // Group assignments by email for a tidy display.
  const byEmail = new Map<string, typeof assignments>();
  for (const a of assignments) {
    if (!byEmail.has(a.email)) byEmail.set(a.email, []);
    byEmail.get(a.email)!.push(a);
  }

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm font-medium text-action hover:underline"
        >
          ← Volver al panel
        </Link>
        <h1 className="mt-3 text-xl font-bold text-ink">
          Roles y permisos
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Cada rol agrupa un conjunto de permisos. Un usuario puede tener varios
          roles; el conjunto efectivo es la unión.
        </p>

        {/* Role reference */}
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Roles disponibles
          </h2>
          <div className="rounded-xl border border-line divide-y divide-line bg-white">
            {roles.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-700">
                  {r.name}
                </code>
                {r.description && (
                  <span className="text-sm text-slate-600">{r.description}</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Grant a new role */}
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Asignar rol
          </h2>
          <form
            action={async (fd: FormData) => {
              "use server";
              const email = String(fd.get("email") || "");
              const roleName = String(fd.get("role") || "");
              await grantRole(email, roleName);
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              name="email"
              type="email"
              required
              placeholder="correo@ejemplo.com"
              className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm"
            />
            <select
              name="role"
              required
              className="rounded-xl border border-line px-4 py-2.5 text-sm"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-xl bg-action px-5 py-2.5 text-sm font-semibold text-white"
            >
              Asignar
            </button>
          </form>
        </section>

        {/* Current assignments */}
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Usuarios con roles asignados
          </h2>
          {byEmail.size === 0 ? (
            <p className="text-sm text-slate-400">Sin asignaciones todavía.</p>
          ) : (
            <div className="rounded-xl border border-line divide-y divide-line bg-white">
              {[...byEmail.entries()].map(([email, rows]) => (
                <div key={email} className="px-4 py-3">
                  <p className="text-sm font-medium text-ink">{email}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {rows.map((r) => (
                      <form
                        key={r.role_id}
                        action={async () => {
                          "use server";
                          await revokeRole(email, r.role_id);
                        }}
                        className="inline-flex"
                      >
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-700"
                          title="Quitar rol"
                        >
                          {r.role_name} ×
                        </button>
                      </form>
                    ))}
                  </div>
                  {rows[0]?.granted_by && (
                    <p className="mt-1 text-xs text-slate-400">
                      Asignado por {rows[0].granted_by}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
