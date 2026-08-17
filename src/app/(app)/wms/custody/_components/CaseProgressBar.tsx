import type { CaseProgress } from "@/lib/custody/case-progress";

/**
 * §7 · LA BARRA DE CINCO PASOS.
 *
 * Le dice al operario dónde está parado. Es la primera pieza de la
 * especificación visual y la que ordena todo lo demás: sin ella, la pantalla es
 * una lista de paneles sin secuencia.
 *
 * Las clases condicionales se calculan en variables y se pasan como
 * `className={cls}` — el patrón que este módulo ya usa y el que el guard de
 * clases sabe leer (I6).
 */
export function CaseProgressBar({ progress }: { progress: CaseProgress }) {
  return (
    <div className="mt-3" data-progreso="true" aria-label={progress.caption}>
      <ol className="flex gap-1.5" role="list">
        {progress.steps.map((s) => {
          const barra =
            s.state === "done"
              ? "h-1 w-full rounded-full bg-status-success"
              : s.state === "current"
                ? "h-1 w-full rounded-full bg-accent"
                : s.state === "blocked"
                  ? "h-1 w-full rounded-full bg-status-danger"
                  : "h-1 w-full rounded-full bg-bg-surface-alt";
          return (
            <li key={s.index} className="flex-1" title={s.label} aria-current={s.state === "current" ? "step" : undefined}>
              <span className={barra} aria-hidden="true" />
            </li>
          );
        })}
      </ol>
      <p className="mt-1.5 text-[11px] uppercase tracking-wide text-fg-muted" data-progreso-caption="true">
        {progress.caption}
      </p>
    </div>
  );
}
