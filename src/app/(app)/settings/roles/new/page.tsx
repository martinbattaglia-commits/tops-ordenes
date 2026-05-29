import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listPermissions } from "@/lib/rbac/data";
import { MODULE_LABELS } from "@/lib/rbac/types";

export const metadata = { title: "Nuevo rol" };
export const dynamic = "force-dynamic";

export default async function NewRolePage() {
  const permissions = await listPermissions();
  const byModule = new Map<string, typeof permissions>();
  for (const p of permissions) {
    const arr = byModule.get(p.module) ?? [];
    arr.push(p);
    byModule.set(p.module, arr);
  }

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6 max-w-4xl mx-auto">
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2 text-xs text-fg-secondary mb-1">
            <Link href="/settings/roles" className="hover:text-fg-primary">
              Roles
            </Link>
            <Icon name="chevron-right" size={12} />
            <span className="font-mono text-fg-primary">nuevo</span>
          </div>
          <h1 className="page-title">Crear rol custom</h1>
          <p className="page-subtitle">
            Combiná permisos de los 9 módulos del Operating System. Los roles del sistema no se
            pueden editar — siempre podés crear uno custom y asignarlo a usuarios.
          </p>
        </div>
      </div>

      <div className="card p-4 bg-status-warning/5 border-status-warning/30 flex items-start gap-3">
        <Icon name="bolt" size={18} className="text-status-warning mt-0.5 flex-shrink-0" />
        <div className="text-xs text-fg-primary">
          <strong>Creación en vivo se habilita en Fase 3</strong>. Por ahora el formulario es
          read-only y muestra la estructura de creación. La persistencia bidireccional con
          Supabase está pendiente.
        </div>
      </div>

      {/* Form preview */}
      <div className="card p-6 space-y-5">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Nombre del rol" placeholder="Ej. Compras Senior, Operario Magaldi…" />
          <Field label="Slug (auto)" placeholder="compras_senior" mono />
        </div>
        <Field label="Descripción" placeholder="¿Qué responsabilidades tiene este rol?" textarea />

        <div>
          <label className="field-label mb-2 block">Color del chip</label>
          <div className="flex gap-2">
            {["#C90812", "#214576", "#050555", "#0E7C3A", "#B45309", "#3a6db0", "#8A94A6"].map((c) => (
              <button
                key={c}
                type="button"
                className="w-8 h-8 rounded-md border-2 border-stroke-soft hover:scale-110 transition-transform"
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-stroke-soft">
          <label className="field-label mb-3 block">Permisos asignados ({permissions.length} disponibles)</label>
          <div className="space-y-3">
            {Array.from(byModule.entries()).map(([mod, perms]) => (
              <div key={mod} className="card overflow-hidden">
                <div className="px-4 py-2 border-b border-stroke-soft bg-neutral-50 flex items-center justify-between">
                  <span className="text-sm font-bold text-fg-primary">
                    {MODULE_LABELS[mod as keyof typeof MODULE_LABELS] ?? mod}
                  </span>
                  <button type="button" className="text-[11px] text-fg-link font-semibold">
                    Marcar todos
                  </button>
                </div>
                <ul className="divide-y divide-stroke-soft">
                  {perms.map((p) => (
                    <li key={p.id} className="px-4 py-2 flex items-center gap-3">
                      <input
                        type="checkbox"
                        disabled
                        className="w-4 h-4 cursor-not-allowed accent-tops-blue-700"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-fg-primary truncate">
                          {p.label}
                        </div>
                      </div>
                      <code className="text-[10px] font-mono text-fg-muted bg-neutral-100 px-1.5 py-0.5 rounded">
                        {p.slug}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-4 border-t border-stroke-soft">
          <Link href="/settings/roles" className="btn btn-ghost btn-sm">
            <Icon name="arrow-left" size={14} />
            Cancelar
          </Link>
          <button type="button" className="btn btn-primary btn-sm ml-auto" disabled>
            <Icon name="check" size={14} stroke={2.2} />
            Crear rol (F3)
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  placeholder,
  mono,
  textarea,
}: {
  label: string;
  placeholder?: string;
  mono?: boolean;
  textarea?: boolean;
}) {
  return (
    <div>
      <label className="field-label mb-1.5 block">{label}</label>
      {textarea ? (
        <textarea className="textarea" placeholder={placeholder} disabled rows={2} />
      ) : (
        <input
          type="text"
          placeholder={placeholder}
          disabled
          className={`input ${mono ? "font-mono" : ""}`}
        />
      )}
    </div>
  );
}
