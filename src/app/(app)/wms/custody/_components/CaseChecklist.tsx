import { Icon } from "@/components/Icon";
import type { ChecklistItem } from "@/lib/custody/case-progress";

/**
 * §7 · «PARA PODER DECIDIR».
 *
 * Las mismas condiciones que `release.blockers` ya transporta, presentadas como
 * el operario las piensa: cuatro tildes y una cosa por hacer. No reemplaza a los
 * blockers —que siguen diciendo el motivo exacto y guiado— sino que los ordena.
 *
 * Nada de esto calcula elegibilidad: se deriva del view-model en un módulo puro
 * (`case-progress.ts`) y acá sólo se pinta.
 */
export function CaseChecklist({ items }: { items: ChecklistItem[] }) {
  return (
    <section className="card p-4" aria-labelledby="checklist-title" data-checklist="true">
      <h2 id="checklist-title" className="eyebrow-tiny">Para poder decidir</h2>
      <ul className="mt-2 space-y-1.5" role="list">
        {items.map((it) => {
          const texto = it.done ? "text-sm text-fg-secondary" : "text-sm font-bold";
          const icono = it.done ? "check-circle" : "clock";
          const iconoCls = it.done ? "text-status-success" : "text-status-warning";
          return (
            <li key={it.label} className="flex items-start gap-2">
              <span className={iconoCls} aria-hidden="true">
                <Icon name={icono as "check-circle"} size={13} />
              </span>
              <span>
                <span className={texto}>{it.label}</span>
                {it.hint && <span className="block text-xs text-fg-muted">{it.hint}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
