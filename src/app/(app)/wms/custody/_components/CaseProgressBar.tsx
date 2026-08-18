import type { CaseProgress } from "@/lib/custody/case-progress";

/**
 * §7 · LA BARRA DE CINCO PASOS.
 *
 * Le dice al operario dónde está parado. Es la primera pieza de la
 * especificación visual y la que ordena todo lo demás: sin ella, la pantalla es
 * una lista de paneles sin secuencia.
 *
 * Estilo tomado literal del mockup corporativo: cinco segmentos de 4px, verde
 * lo cumplido, azul el actual, ámbar el que espera al operario, y debajo el
 * rótulo monoespaciado `PASO n DE 5 · …`.
 */
export function CaseProgressBar({ progress }: { progress: CaseProgress }) {
  return (
    <div data-progreso="true" aria-label={progress.caption}>
      <ol className="cd-steps" role="list">
        {progress.steps.map((s) => {
          const seg =
            s.state === "done"
              ? "cd-step cd-step--done"
              : s.state === "current"
                ? "cd-step cd-step--current"
                : s.state === "blocked"
                  ? "cd-step cd-step--blocked"
                  : "cd-step";
          return (
            <li
              key={s.index}
              className={seg}
              title={s.label}
              aria-current={s.state === "current" ? "step" : undefined}
            />
          );
        })}
      </ol>
      <p className="cd-stepcaption" data-progreso-caption="true">
        {progress.caption}
      </p>
    </div>
  );
}
