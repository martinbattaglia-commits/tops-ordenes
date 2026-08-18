import type { CaseProgress, StepState } from "@/lib/custody/case-progress";

/**
 * §7 · LA BARRA DE CINCO PASOS.
 *
 * Le dice al operario dónde está parado. Es la primera pieza de la
 * especificación visual y la que ordena todo lo demás: sin ella, la pantalla es
 * una lista de paneles sin secuencia.
 *
 * Estilo tomado literal del mockup corporativo: cinco segmentos de 4px, verde
 * lo cumplido, azul el actual, ámbar el que espera al operario, y debajo el
 * rótulo monoespaciado `Paso n de 5 · …`.
 *
 * ─── POR QUÉ LA CLASE VA EN EL `<li>` Y NO EN UN `<span>` ────────────────
 *
 * La primera versión colgaba las dimensiones de un `<span>` VACÍO dentro del
 * `<li>`. El `flex` estaba en el `<ol>`, así que el `<li>` era un flex item
 * pero NO un contenedor flex: el `<span>` quedaba `display: inline`, y en una
 * caja en línea no reemplazada `width` y `height` no aplican. Las cinco barras
 * medían cero. La pieza que este mismo docblock llama «la que ordena todo lo
 * demás» no se dibujaba.
 *
 * Ahora la clase va en el `<li>`, que es hijo directo de `.cd-steps`
 * —`display: flex`— y por lo tanto un flex item blockificado: `height: 4px` y
 * `flex: 1` aplican. `tests/wms-ui/custody-ui-classes.test.ts` compila el CSS
 * real y comprueba que estas reglas existen; el render de muestra las dibuja.
 *
 * ─── ACCESIBILIDAD (C4 · L-4) ────────────────────────────────────────────
 *
 * Los cinco segmentos son cajas vacías: para quien no ve el color, la barra no
 * decía absolutamente nada. Cada paso lleva ahora su rótulo y su estado en
 * texto, oculto en pantalla y disponible para el lector. El color dejó de ser
 * el único portador de la información.
 */

/** El estado del paso, dicho con palabras. */
const ESTADO_TEXTO: Record<StepState, string> = {
  done: "cumplido",
  current: "en curso",
  pending: "pendiente",
  blocked: "bloqueado",
};

export function CaseProgressBar({ progress }: { progress: CaseProgress }) {
  return (
    <div data-progreso="true">
      <ol className="cd-steps" role="list" aria-label={progress.caption}>
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
              title={`${s.label} · ${ESTADO_TEXTO[s.state]}`}
              aria-current={s.state === "current" ? "step" : undefined}
              data-paso={s.index}
              data-estado={s.state}
            >
              <span className="sr-only">
                {`Paso ${s.index} de ${progress.total}: ${s.label} · ${ESTADO_TEXTO[s.state]}`}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="cd-stepcaption" data-progreso-caption="true">
        {progress.caption}
      </p>
    </div>
  );
}
