import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listRoles, listPermissions, listUserAssignments } from "@/lib/rbac/data";
import { MODULE_LABELS } from "@/lib/rbac/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { RestrictedAccess } from "@/components/shell/RestrictedAccess";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { canAccess } from "@/lib/rbac/guard";
import { isCurrentUserAdmin } from "@/lib/auth/roles";

export const metadata = { title: "Sistema · Roles y permisos" };
export const dynamic = "force-dynamic";

export default async function RolesPage() {
  // RBAC sistema.view: bloquea la sección Sistema a roles sin ese permiso
  // (gerencia_comercial / administracion_finanzas). Defensa por URL directa.
  if (!(await canAccess("sistema.view"))) return <AccesoRestringido modulo="Sistema · Roles y permisos" />;
  // Gate 5.5: gestión de roles/permisos solo para admin (antes no tenía guard;
  // quedaba oculta solo porque 0009_rbac no estaba aplicada — riesgo latente F-04).
  if (!(await isCurrentUserAdmin())) {
    return <RestrictedAccess message="Solo los administradores pueden ver y gestionar roles y permisos." />;
  }

  // Las tablas RBAC (roles/permissions/user_roles, migración 0009_rbac) pueden
  // no estar aplicadas en prod. Degradar con gracia en vez de romper el shell.
  let roles: Awaited<ReturnType<typeof listRoles>>;
  let permissions: Awaited<ReturnType<typeof listPermissions>>;
  let assignments: Awaited<ReturnType<typeof listUserAssignments>>;
  try {
    [roles, permissions, assignments] = await Promise.all([
      listRoles(),
      listPermissions(),
      listUserAssignments(),
    ]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Roles y permisos no disponibles"
        migration="0009_rbac"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const totalUsers = new Set(assignments.map((a) => a.user_id)).size;

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Sistema · Control de accesos</div>
          <h1 className="page-title">Roles, permisos & asignaciones</h1>
          <p className="page-subtitle">
            {roles.length} roles · {permissions.length} permisos · {totalUsers} usuarios asignados
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/settings/roles/new" className="btn btn-primary btn-sm">
            <Icon name="plus" size={14} stroke={2.2} />
            <span>Nuevo rol</span>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Roles activos" value={String(roles.length)} sub={`${roles.filter((r) => r.is_system).length} del sistema`} />
        <Stat label="Permisos disponibles" value={String(permissions.length)} sub={`en ${new Set(permissions.map((p) => p.module)).size} módulos`} />
        <Stat label="Usuarios asignados" value={String(totalUsers)} sub="staff Logística TOPS" />
        <Stat label="Asignaciones totales" value={String(assignments.length)} sub="incluye multi-rol" />
      </div>

      {/* Roles grid */}
      <section>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-muted mb-3">
          Roles
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {roles.map((r) => (
            <Link
              key={r.id}
              href={`/settings/roles/${r.slug}`}
              className="card p-4 hover:shadow-md hover:-translate-y-px transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div
                  className="w-10 h-10 rounded-md grid place-items-center text-white font-bold flex-shrink-0"
                  style={{ background: r.color }}
                >
                  {r.name
                    .split(" ")
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
                {r.is_system && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-fg-muted bg-neutral-100 px-1.5 py-0.5 rounded">
                    Sistema
                  </span>
                )}
              </div>
              <div className="text-sm font-bold text-fg-primary">{r.name}</div>
              <div className="text-[11px] text-fg-muted line-clamp-2 mt-1 min-h-[2lh]">{r.description}</div>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-stroke-soft">
                <span className="text-[10px] text-fg-secondary">
                  <strong className="text-fg-primary tabular">{r.permission_count ?? 0}</strong> permisos
                </span>
                <span className="text-[10px] text-fg-secondary">
                  <strong className="text-fg-primary tabular">{r.user_count ?? 0}</strong> usuarios
                </span>
                <Icon name="chevron-right" size={12} className="text-fg-muted ml-auto" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Permissions catalog */}
      <section>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-muted mb-3">
          Catálogo de permisos por módulo
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from(
            permissions.reduce<Map<string, typeof permissions>>((m, p) => {
              const arr = m.get(p.module) ?? [];
              arr.push(p);
              m.set(p.module, arr);
              return m;
            }, new Map())
          ).map(([mod, perms]) => (
            <div key={mod} className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-stroke-soft bg-neutral-50">
                <div className="text-sm font-bold text-fg-primary">
                  {MODULE_LABELS[mod as keyof typeof MODULE_LABELS] ?? mod}
                </div>
                <div className="text-[11px] text-fg-muted">{perms.length} permisos</div>
              </div>
              <ul className="divide-y divide-stroke-soft">
                {perms.map((p) => (
                  <li key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-fg-primary truncate">
                        {p.label}
                      </div>
                      {p.description && (
                        <div className="text-[10px] text-fg-muted truncate">{p.description}</div>
                      )}
                    </div>
                    <code className="text-[10px] font-mono text-fg-secondary bg-neutral-100 px-1.5 py-0.5 rounded flex-shrink-0">
                      {p.slug}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Assignments table */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-muted">
            Asignaciones de usuarios
          </div>
          <Link href="/settings/users" className="text-xs font-bold text-fg-link hover:underline">
            Gestionar usuarios →
          </Link>
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Cargo</th>
                  <th>Rol</th>
                  <th>Depósito</th>
                  <th>Asignado</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={`${a.user_id}-${a.role_id}`}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-tops-blue-700 text-white grid place-items-center font-bold text-xs flex-shrink-0">
                          {(a.user_name ?? "?")
                            .split(" ")
                            .map((s) => s[0])
                            .slice(0, 2)
                            .join("")
                            .toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-fg-primary truncate">{a.user_name ?? "—"}</div>
                          <div className="text-[11px] text-fg-muted font-mono truncate">{a.user_email ?? "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-xs text-fg-secondary">{a.position_title ?? "—"}</td>
                    <td>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: `${a.role?.color}15`, color: a.role?.color }}
                      >
                        {a.role?.name}
                      </span>
                    </td>
                    <td className="text-xs text-fg-secondary">{a.depot ?? "—"}</td>
                    <td className="text-[11px] text-fg-muted">
                      {new Date(a.assigned_at).toLocaleDateString("es-AR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-5">
      <div className="kpi-label">{label}</div>
      <div className="text-3xl font-bold tabular leading-none mt-1 text-fg-brand">{value}</div>
      <div className="text-[11px] text-fg-muted mt-1">{sub}</div>
    </div>
  );
}
