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
      ? "eye"
      : action.kind === "pod"
        ? "file-pdf"
        : action.kind === "cerrado"
          ? "lock"
          : "bolt";

  const titulo = action.actionable
    ? "flex items-center gap-2 text-base font-bold"
    : "flex items-center gap-2 text-base font-bold text-fg-secondary";

  return (
    <section className="card mt-3 p-4" aria-labelledby="ahora-title" data-ahora={action.kind}>
      <p id="ahora-title" className="eyebrow-tiny">▸ Ahora</p>
      <p className={titulo}>
        <Icon name={icono as "eye"} size={16} aria-hidden="true" />
        <span data-ahora-label="true">{action.label}</span>
      </p>
      <p className="mt-1.5 text-sm text-fg-secondary" data-ahora-help="true">
        {action.help}
      </p>
    </section>
  );
}
