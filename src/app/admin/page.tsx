import Link from "next/link";
import Header from "@/components/Header";
import AdminLogin from "@/components/admin/AdminLogin";
import DamagedAdminRow from "@/components/admin/DamagedAdminRow";
import ModerationRow from "@/components/admin/ModerationRow";
import CenterAdminRow from "@/components/admin/CenterAdminRow";
import {
  getAdminSession,
  listDamagedReportsAdmin,
  listModerationItems,
  listCollectionCentersAdmin,
} from "@/lib/admin";
import { adminSignOut } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

type AdminTab = "centros" | "danados" | "moderacion";

// Status/type chips within a tab, each showing how many items match.
function SubFilters<T>({
  tab,
  estado,
  opts,
  data,
}: {
  tab: AdminTab;
  estado?: string;
  opts: Array<{ key?: string; label: string; test: (x: T) => boolean }>;
  data: T[];
}) {
  return (
    <div className="mt-4 mb-1 flex flex-wrap gap-2">
      {opts.map((o) => {
        const active = estado === o.key || (!estado && !o.key);
        const count = data.filter(o.test).length;
        return (
          <Link
            key={o.label}
            href={`/admin?tab=${tab}${o.key ? `&estado=${o.key}` : ""}`}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              active ? "bg-[#14212e] text-white" : "bg-slate-100 text-[#5b6b7b] hover:bg-slate-200"
            }`}
          >
            {o.label}
            <span
              className={`rounded-full px-1.5 text-[11px] font-bold ${
                active ? "bg-white/25 text-white" : "bg-white text-[#8190a0]"
              }`}
            >
              {count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; estado?: string }>;
}) {
  const session = await getAdminSession();

  if (!session) {
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
          <AdminLogin />
        </main>
      </>
    );
  }

  const { email, isSuper } = session;
  const [damaged, mod, centers] = await Promise.all([
    listDamagedReportsAdmin(),
    listModerationItems(),
    listCollectionCentersAdmin(),
  ]);
  const pendingCenters = centers.filter((c) => !c.verified).length;

  const sp = await searchParams;
  const tab: AdminTab =
    sp.tab === "danados" || sp.tab === "moderacion" ? sp.tab : "centros";
  const estado = sp.estado;
  const pendingDamaged = damaged.filter((d) => !d.verified_at && !d.hidden).length;

  const TABS: Array<{ value: AdminTab; label: string; badge?: number }> = [
    { value: "centros", label: "Centros de acopio", badge: pendingCenters || undefined },
    { value: "danados", label: "Edificios dañados", badge: pendingDamaged || undefined },
    { value: "moderacion", label: "Moderación", badge: mod.length || undefined },
  ];

  // Per-tab status/type sub-filters. Each option carries a predicate; we filter
  // the already-fetched list and show a count so admins see how much is pending.
  const centerOpts = [
    { key: undefined, label: "Todos", test: () => true },
    { key: "pendientes", label: "Pendientes", test: (c: typeof centers[number]) => !c.verified && !c.hidden },
    { key: "verificados", label: "Verificados", test: (c: typeof centers[number]) => c.verified && !c.hidden },
    { key: "ocultos", label: "Ocultos", test: (c: typeof centers[number]) => c.hidden },
  ];
  const damagedOpts = [
    { key: undefined, label: "Todos", test: () => true },
    { key: "pendientes", label: "Sin verificar", test: (d: typeof damaged[number]) => !d.verified_at && !d.hidden },
    { key: "verificados", label: "Verificados", test: (d: typeof damaged[number]) => !!d.verified_at && !d.hidden },
    { key: "ocultos", label: "Ocultos", test: (d: typeof damaged[number]) => d.hidden },
  ];
  const modOpts = [
    { key: undefined, label: "Todos", test: () => true },
    { key: "personas", label: "Personas", test: (m: typeof mod[number]) => m.table === "checkins" },
    { key: "solicitudes", label: "Solicitudes", test: (m: typeof mod[number]) => m.table === "help_requests" },
    { key: "ofertas", label: "Ofertas", test: (m: typeof mod[number]) => m.table === "help_offers" },
    { key: "ocultos", label: "Ocultos", test: (m: typeof mod[number]) => m.hidden },
  ];

  const centersActive = centerOpts.find((o) => o.key === estado) ?? centerOpts[0];
  const centersList = centers.filter(centersActive.test);
  const damagedActive = damagedOpts.find((o) => o.key === estado) ?? damagedOpts[0];
  const damagedList = damaged.filter(damagedActive.test);
  const modActive = modOpts.find((o) => o.key === estado) ?? modOpts[0];
  const modList = mod.filter(modActive.test);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e6ecf2] bg-white p-4">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-[#14212e]">
              🛡️ Panel de administración
            </h1>
            <p className="mt-0.5 flex items-center gap-2 truncate text-sm text-[#5b6b7b]">
              {email}
              {isSuper && (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">
                  super-admin
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSuper && (
              <>
                <Link
                  href="/admin/ingesta"
                  className="rounded-lg border border-[#e6ecf2] px-3 py-2 text-sm font-medium text-[#14212e] transition hover:bg-slate-50"
                >
                  Ingesta
                </Link>
                <Link
                  href="/admin/colaboradores"
                  className="rounded-lg border border-[#e6ecf2] px-3 py-2 text-sm font-medium text-[#14212e] transition hover:bg-slate-50"
                >
                  Colaboradores
                </Link>
                <Link
                  href="/admin/admins"
                  className="rounded-lg border border-[#e6ecf2] px-3 py-2 text-sm font-medium text-[#14212e] transition hover:bg-slate-50"
                >
                  Administradores
                </Link>
                <Link
                  href="/admin/roles"
                  className="rounded-lg border border-[#e6ecf2] px-3 py-2 text-sm font-medium text-[#14212e] transition hover:bg-slate-50"
                >
                  Roles
                </Link>
              </>
            )}
            <form action={adminSignOut}>
              <button
                type="submit"
                className="rounded-lg border border-[#e6ecf2] px-3 py-2 text-sm font-medium text-[#5b6b7b] transition hover:bg-slate-50"
              >
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>

        {/* Tabs — switch category to validate without scrolling a long page */}
        <div className="mt-6 flex flex-wrap gap-2 border-b border-[#e6ecf2] pb-2">
          {TABS.map((t) => {
            const active = tab === t.value;
            return (
              <Link
                key={t.value}
                href={t.value === "centros" ? "/admin" : `/admin?tab=${t.value}`}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-[#2563a8] text-white"
                    : "text-[#5b6b7b] hover:bg-slate-50"
                }`}
              >
                {t.label}
                {t.badge != null && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      active ? "bg-white/25 text-white" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {t.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {tab === "centros" && (
          <section>
            <SubFilters tab="centros" estado={estado} opts={centerOpts} data={centers} />
            <p className="mb-3 text-xs text-[#8190a0]">
              Centros enviados por el público entran <strong>sin verificar</strong> y no
              se muestran hasta aprobarlos. Verifica para publicarlos.
            </p>
            {centersList.length === 0 ? (
              <p className="mt-3 text-sm text-[#8190a0]">Nada en esta vista.</p>
            ) : (
              <div className="space-y-3">
                {centersList.map((c) => (
                  <CenterAdminRow item={c} key={c.id} />
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "danados" && (
          <section>
            <SubFilters tab="danados" estado={estado} opts={damagedOpts} data={damaged} />
            <p className="mb-3 text-xs text-[#8190a0]">
              Reportes de edificios dañados de la comunidad. <strong>Verificar</strong>{" "}
              marca el reporte como confirmado por un administrador.
            </p>
            {damagedList.length === 0 ? (
              <p className="mt-3 text-sm text-[#8190a0]">Nada en esta vista.</p>
            ) : (
              <div className="space-y-3">
                {damagedList.map((d) => (
                  <DamagedAdminRow item={d} key={d.id} />
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "moderacion" && (
          <section>
            <SubFilters tab="moderacion" estado={estado} opts={modOpts} data={mod} />
            <div className="mb-3 rounded-xl border border-[#e6ecf2] bg-[#f7fafd] p-3 text-xs text-[#5b6b7b]">
              <strong className="text-[#14212e]">Qué estás revisando:</strong> las
              últimas publicaciones del público (personas, solicitudes y ofertas).
              Aquí se busca y se retira contenido falso o spam. <strong>Ocultar</strong>{" "}
              lo quita de la vista pública sin borrarlo; <strong>Eliminar</strong> lo
              borra definitivamente.
            </div>
            {modList.length === 0 ? (
              <p className="mt-3 text-sm text-[#8190a0]">Nada en esta vista.</p>
            ) : (
              <div className="space-y-3">
                {modList.map((m) => (
                  <ModerationRow item={m} key={m.table + m.id} />
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
