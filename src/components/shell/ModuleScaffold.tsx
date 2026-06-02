import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";

/**
 * Placeholder estructural para módulos en construcción (FASE 3 — estructura de
 * navegación sin lógica). Deja la ruta viva y con identidad visual del sistema,
 * sin conectar datos, Supabase ni tablas. La funcionalidad real se entrega en
 * una fase próxima del plan de expansión controlada (WMS / Pedidos / Mapa).
 *
 * 100% presentacional: no hace fetch, no lee estado, no muta nada.
 */
export function ModuleScaffold({
  eyebrow,
  title,
  subtitle,
  icon,
  planned,
  phase = "FASE 3 · Estructura de navegación",
  backHref,
  backLabel,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  icon: IconName;
  /** Capacidades previstas para este módulo (se muestran como checklist inerte). */
  planned?: string[];
  /** Etiqueta de fase del roadmap. */
  phase?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="p-4 lg:p-8 max-w-3xl">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">{eyebrow}</div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        {backHref && (
          <Link href={backHref} className="btn btn-ghost btn-sm mt-1">
            <Icon name="arrow-left" size={12} /> {backLabel ?? "Volver"}
          </Link>
        )}
      </div>

      <div className="card card-pad mb-4 flex items-start gap-3 border-status-warning/30 bg-status-warning/5">
        <Icon name="bolt" size={18} className="text-status-warning mt-0.5 flex-shrink-0" />
        <div className="text-sm text-fg-secondary">
          <strong className="text-fg-brand">En construcción.</strong> Esta pantalla deja la estructura
          lista dentro de Nexus. Todavía no carga datos ni se conecta a la base; la lógica y la
          integración se entregan en una fase próxima del plan de expansión controlada.
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex items-center gap-2 text-base font-bold text-fg-brand mb-1">
          <Icon name={icon} size={16} className="text-fg-muted" />
          {title}
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted mb-4">
          {phase}
        </div>

        {planned && planned.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {planned.map((item) => (
              <li
                key={item}
                className="flex items-center gap-2.5 py-2 border-b border-stroke-soft/60 last:border-0 text-sm text-fg-secondary"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-fg-muted/40 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-stroke-soft p-6 text-center">
            <div className="w-10 h-10 rounded-lg bg-bg-surface-alt text-fg-muted grid place-items-center mx-auto mb-2">
              <Icon name={icon} size={18} />
            </div>
            <div className="text-sm font-semibold text-fg-secondary">Módulo en construcción</div>
            <p className="text-xs text-fg-muted mt-1">
              La funcionalidad de este bloque se habilita en una fase próxima.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
