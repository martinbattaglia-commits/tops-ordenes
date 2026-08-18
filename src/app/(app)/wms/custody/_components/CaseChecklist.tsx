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
    <section className="cd-sec" aria-labelledby="checklist-title" data-checklist="true">
      <h2 id="checklist-title" className="cd-label">Para poder decidir</h2>
      <ul className="cd-check" role="list">
        {items.map((it) => {
          const fila = it.done ? "cd-check__item" : "cd-check__item cd-check__item--todo";
          const caja = it.done ? "cd-check__box cd-check__box--ok" : "cd-check__box cd-check__box--todo";
          return (
            <li key={it.label} className={fila}>
              <span className={caja} aria-hidden="true">{it.done ? "✓" : "!"}</span>
              <span>
                {it.label}
                {it.hint && <small className="cd-check__hint">{it.hint}</small>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
