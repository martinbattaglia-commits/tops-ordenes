import { Icon } from "@/components/Icon";
import type { NowAction } from "@/lib/custody/case-progress";

/**
 * §7 · EL BLOQUE `▸ AHORA` · UNA SOLA ACCIÓN VIVA.
 *
 * Es la pieza que convierte una pantalla de datos en una pantalla de trabajo:
 * el operario abre el caso y ve UNA cosa para hacer, con su explicación en
 * lenguaje llano debajo. El resto de los paneles siguen existiendo; dejan de
 * competir por la atención.
 *
 * No dispara nada por su cuenta: apunta al panel que tiene la acción, que es
 * donde vive la server action con su permiso. Duplicar el disparo acá sería
 * tener dos superficies que autorizan lo mismo.
 *
 * ─── D-4 ─────────────────────────────────────────────────────────────────
 *
 * Ningún texto de este bloque nombra el umbral, ni con cifra ni sin ella. El
 * fundamento se expresa como estándar —«según los estándares internacionales de
 * medición del mercado»— y la magnitud que sí sale es la concordancia.
 */
export function CaseNowBlock({ action }: { action: NowAction }) {
  const icono =
    action.kind === "foto_ingreso" || action.kind === "foto_egreso"
      ? "camera"
      : action.kind === "pod"
        ? "file-pdf"
        : action.kind === "cerrado"
          ? "lock"
          : "eye";

  // El mockup pinta el botón vivo en azul, salvo el POD final que va en verde
  // porque cierra el circuito. La acción muerta no simula un botón: se declara.
  const boton = !action.actionable
    ? "cd-cta cd-cta--dead"
    : action.kind === "pod"
      ? "cd-cta cd-cta--go"
      : "cd-cta";

  const rotulo = action.actionable ? "cd-nowlabel" : "cd-nowlabel cd-nowlabel--dead";

  return (
    <section className="cd-sec cd-sec--now" aria-labelledby="ahora-title" data-ahora={action.kind}>
      <p id="ahora-title" className={rotulo}>▸ Ahora</p>
      <span className={boton}>
        <Icon name={icono as "eye"} size={19} aria-hidden="true" />
        <span data-ahora-label="true">{action.label}</span>
      </span>
      <p className="cd-help" data-ahora-help="true">
        {action.help}
      </p>
    </section>
  );
}
