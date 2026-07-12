import { Icon } from "@/components/Icon";

/**
 * Banner permanente del módulo Contabilidad durante el piloto.
 *
 * El motor contable opera en modo SIMULATION (P6 · dry-run permanente):
 * ningún asiento real se genera ni se persiste. Este banner NO se quita
 * hasta que Dirección habilite el posteo real (requiere ratificación de
 * Contadora Pública matriculada + decisión formal — fuera del piloto).
 */
export function SimulationBanner() {
  return (
    <div
      className="card mb-4 flex items-start gap-3"
      style={{
        padding: "12px 16px",
        borderLeft: "4px solid var(--status-warning-400, #f59e0b)",
      }}
    >
      <Icon name="eye" size={16} className="mt-0.5 shrink-0" />
      <div>
        <div className="text-sm font-semibold text-fg-primary">
          Modo SIMULACIÓN — sin asientos reales
        </div>
        <p className="text-xs text-fg-muted mt-0.5">
          El motor contable está en dry-run permanente: todo lo que se muestra es
          consulta o simulación, nada se registra en el libro. La activación del
          posteo real requiere validación de la Contadora y decisión de Dirección.
        </p>
      </div>
    </div>
  );
}
