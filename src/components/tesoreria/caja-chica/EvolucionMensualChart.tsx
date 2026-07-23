// Barras de evolución mensual de Caja Chica: ingresos (verde) y egresos (rojo).
// SVG propio, mismo estilo Nexus que GastoMensualChart. Server-safe.
import type { MesBar } from "@/lib/tesoreria/caja-chica/native-logic";

export function EvolucionMensualChart({ data }: { data: MesBar[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.ingreso, d.egreso)));
  const W = 560, H = 210, padX = 24, padTop = 12, padBottom = 26;
  const slot = (W - padX * 2) / data.length;
  const plotH = H - padTop - padBottom;
  const bw = slot * 0.32;

  return (
    <div className="card p-5">
      <div className="text-base font-bold text-fg-brand">Evolución mensual</div>
      <div className="text-xs text-fg-secondary mt-0.5 mb-3">ingresos y egresos por mes · ARS</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ingresos y egresos por mes">
        <line x1={padX} y1={H - padBottom} x2={W - padX} y2={H - padBottom} stroke="#E6E9F0" strokeWidth={1} />
        {data.map((d, i) => {
          const hi = (d.ingreso / max) * plotH;
          const he = (d.egreso / max) * plotH;
          const x0 = padX + i * slot + slot * 0.17;
          return (
            <g key={d.mes}>
              <rect
                x={x0}
                y={H - padBottom - hi}
                width={bw}
                height={Math.max(hi, 0)}
                rx={3}
                fill="#0F6E56"
                opacity={d.ingreso ? 0.9 : 0.12}
              />
              <rect
                x={x0 + bw + 3}
                y={H - padBottom - he}
                width={bw}
                height={Math.max(he, 0)}
                rx={3}
                fill="#C90812"
                opacity={d.egreso ? 0.85 : 0.12}
              />
              <text x={x0 + bw + 1.5} y={H - padBottom + 13} textAnchor="middle" fontSize="9" fill="#8A94A6">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-4 mt-2 text-xs text-fg-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#0F6E56" }} />
          Ingresos
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#C90812" }} />
          Egresos
        </span>
      </div>
    </div>
  );
}
