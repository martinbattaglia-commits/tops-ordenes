/**
 * ui.tsx — Primitivas de presentación del módulo Contratos.
 *
 * Tags y dots replican exactamente la paleta de la maqueta oficial (colores de
 * semáforo/riesgo/tipo por hex inline — los tokens CSS-var del tema no cubren la
 * escala de 6 colores del semáforo). Texto y superficies usan tokens del tema
 * (`fg-*`, `bg-surface`, `stroke-soft`) para respetar el modo oscuro.
 */

import {
  SEMAFORO_META,
  RIESGO_META,
  TIPO_META,
  type ContractSemaforo,
  type ContractRiesgo,
  type ContractTipo,
} from "@/lib/comercial/contracts-types";

/** Punto de semáforo (con tooltip de etiqueta). */
export function SemaforoDot({
  semaforo,
  size = 10,
  title,
}: {
  semaforo: ContractSemaforo;
  size?: number;
  title?: string;
}) {
  const meta = SEMAFORO_META[semaforo];
  return (
    <span
      className="inline-block rounded-full align-middle shrink-0"
      style={{ width: size, height: size, background: meta.color }}
      title={title ?? meta.label}
    />
  );
}

/** Pill de nivel de riesgo. */
export function RiesgoTag({ riesgo, size = "sm" }: { riesgo: ContractRiesgo; size?: "sm" | "xs" }) {
  return (
    <span
      className={`inline-block rounded-pill font-bold text-white ${
        size === "xs" ? "text-[9px] px-1.5 py-px" : "text-[10px] px-2 py-0.5"
      }`}
      style={{ background: RIESGO_META[riesgo].color }}
    >
      {riesgo}
    </span>
  );
}

/** Tag de unidad de negocio (ANMAT / C.G.). */
export function TipoTag({ tipo, full = false }: { tipo: ContractTipo; full?: boolean }) {
  const meta = TIPO_META[tipo];
  return (
    <span
      className="inline-block rounded font-bold text-white text-[10px] px-1.5 py-0.5"
      style={{ background: meta.color }}
    >
      {full ? tipo : meta.short}
    </span>
  );
}

type KpiAccent = "navy" | "gold" | "green" | "red" | "orange";

const KPI_BORDER: Record<KpiAccent, string> = {
  navy: "#15406B",
  gold: "#C8A24B",
  green: "#1F9D55",
  red: "#D14343",
  orange: "#E07A1F",
};

/** Tile de KPI con borde izquierdo de color (estilo maqueta). */
export function Kpi({
  value,
  label,
  accent = "navy",
}: {
  value: string | number;
  label: string;
  accent?: KpiAccent;
}) {
  return (
    <div
      className="card p-4 border-l-4"
      style={{ borderLeftColor: KPI_BORDER[accent] }}
    >
      <div className="text-[26px] leading-none font-extrabold text-fg-brand tabular">{value}</div>
      <div className="mt-1.5 text-[10.5px] uppercase tracking-wide text-fg-muted">{label}</div>
    </div>
  );
}
