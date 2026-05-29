import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { getRole, listPermissions } from "@/lib/rbac/data";
import { MODULE_LABELS, ACTION_LABELS } from "@/lib/rbac/types";

export const metadata = { title: "Rol · Permisos" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
}

export default async function RoleDetailPage({ params }: PageProps) {
  const [role, allPermissions] = await Promise.all([
    getRole(params.slug),
    listPermissions(),
  ]);
  if (!role) notFound();

  const enabledSlugs = new Set(role.permissions.map((p) => p.slug));

  // Agrupar permisos por módulo
  const byModule = new Map<string, typeof allPermissions>();
  for (const p of allPermissions) {
    const arr = byModule.get(p.module) ?? [];
    arr.push(p);
    byModule.set(p.module, arr);
  }

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6">
      <div className="page-header">
        <div className="flex items-start gap-4">
          <div
            className="w-14 h-14 rounded-md grid place-items-center text-white font-bold text-lg flex-shrink-0"
            style={{ background: role.color }}
          >
            {role.name
              .split(" ")
              .map((s) => s[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs text-fg-secondary mb-1">
              <Link href="/settings/roles" className="hover:text-fg-primary">
                Roles
              </Link>
              <Icon name="chevron-right" size={12} />
              <span className="font-mono text-fg-primary">{role.slug}</span>
              {role.is_system && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-fg-muted bg-neutral-100 px-1.5 py-0.5 rounded ml-2">
                  Sistema
                </span>
              )}
            </div>
            <h1 className="page-title">{role.name}</h1>
            <p className="page-subtitle">{role.description}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {!role.is_system && (
            <button className="btn btn-ghost btn-sm" type="button">
              <Icon name="trash" size={14} />
              <span className="hidden sm:inline">Borrar rol</span>
            </button>
          )}
          <button className="btn btn-primary btn-sm" type="button" disabled>
            <Icon name="check" size={14} stroke={2.2} />
            <span>Guardar cambios (F3)</span>
          </button>
        </div>
      </div>

      {/* Banner: edición pendiente F3 */}
      {role.is_system ? (
        <div className="card p-4 bg-tops-blue-700/5 border-tops-blue-700/20 flex items-start gap-3">
          <Icon name="shield" size={18} className="text-tops-blue-700 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-fg-primary">
            Este es un <strong>rol del sistema</strong>. Podés ver los permisos asignados pero
            no editarlos para mantener la coherencia operativa. En Fase 3 habilitamos clonar a
            un rol custom para ajustes.
          </div>
        </div>
      ) : (
        <div className="card p-4 bg-status-warning/5 border-status-warning/30 flex items-start gap-3">
          <Icon name="bolt" size={18} className="text-status-warning mt-0.5 flex-shrink-0" />
          <div className="text-xs text-fg-primary">
            La edición de permisos en vivo se habilita en <strong>Fase 3</strong>. Por ahora
            podés ver el estado actual; los cambios se aplican vía migration SQL.
          </div>
        </div>
      )}

      {/* Permissions matrix */}
      <section>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-muted mb-3">
          Permisos por módulo ({role.permissions.length}/{allPermissions.length})
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from(byModule.entries()).map(([mod, perms]) => {
            const enabledInModule = perms.filter((p) => enabledSlugs.has(p.slug)).length;
            return (
              <div key={mod} className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-stroke-soft bg-neutral-50 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-fg-primary">
                      {MODULE_LABELS[mod as keyof typeof MODULE_LABELS] ?? mod}
                    </div>
                    <div className="text-[11px] text-fg-muted">
                      {enabledInModule}/{perms.length} permisos
                    </div>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      enabledInModule === perms.length
                        ? "bg-status-success"
                        : enabledInModule > 0
                          ? "bg-status-warning"
                          : "bg-neutral-300"
                    }`}
                  />
                </div>
                <ul className="divide-y divide-stroke-soft">
                  {perms.map((p) => {
                    const enabled = enabledSlugs.has(p.slug);
                    return (
                      <li key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                        <span
                          className={`w-5 h-5 rounded-md grid place-items-center flex-shrink-0 ${
                            enabled
                              ? "bg-status-success/20 text-status-success"
                              : "bg-neutral-100 text-fg-muted"
                          }`}
                        >
                          <Icon name={enabled ? "check" : "x"} size={11} stroke={2.4} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-fg-primary truncate">
                            {p.label}
                          </div>
                          {p.description && (
                            <div className="text-[10px] text-fg-muted truncate">{p.description}</div>
                          )}
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-fg-muted">
                          {ACTION_LABELS[p.action]}
                        </span>
                        <code className="text-[10px] font-mono text-fg-secondary bg-neutral-100 px-1.5 py-0.5 rounded">
                          {p.slug}
                        </code>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
