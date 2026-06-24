// Barras de gasto mensual (SVG propio, estilo Nexus). Server-safe.
import type { MonthBar } from "@/lib/tesoreria/caja-chica/dashboard-logic";

export function GastoMensualChart({ data }: { data: MonthBar[] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const W = 560, H = 210, padX = 24, padTop = 12, padBottom = 26;
  const bw = (W - padX * 2) / data.length;
  const plotH = H - padTop - padBottom;
  return (
    <div className="card p-5">
      <div className="text-base font-bold text-fg-brand">Evolución de gastos mensuales</div>
      <div className="text-xs text-fg-secondary mt-0.5 mb-3">por mes · ARS</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gasto mensual por mes">
        <line x1={padX} y1={H - padBottom} x2={W - padX} y2={H - padBottom} stroke="#E6E9F0" strokeWidth={1} />
        {data.map((d, i) => {
          const h = (d.total / max) * plotH;
          const x = padX + i * bw + bw * 0.18;
          const y = H - padBottom - h;
          return (
            <g key={d.mes}>
              <rect x={x} y={y} width={bw * 0.64} height={Math.max(h, 0)} rx={3} fill="#C90812" opacity={d.total ? 0.85 : 0.12} />
              <text x={x + bw * 0.32} y={H - padBottom + 13} textAnchor="middle" fontSize="9" fill="#8A94A6">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
