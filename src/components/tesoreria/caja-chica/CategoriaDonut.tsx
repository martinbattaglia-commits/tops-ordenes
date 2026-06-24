// Donut de distribución por categorías (SVG propio, técnica de ServiceMixDonut). Server-safe.
import type { CategoriaSlice } from "@/lib/tesoreria/caja-chica/dashboard-logic";

const PALETTE = ["#050555", "#214576", "#3a6db0", "#C90812", "#0F6E56", "#BA7517", "#7F77DD", "#8A94A6"];

export function CategoriaDonut({ slices }: { slices: CategoriaSlice[] }) {
  const r = 64, c = 80, sw = 18, circ = 2 * Math.PI * r;
  const top = slices.slice(0, 8);
  let acc = 0;
  return (
    <div className="card">
      <div className="flex items-end justify-between p-5 border-b border-stroke-soft">
        <div>
          <div className="text-base font-bold text-fg-brand">Distribución por categorías</div>
          <div className="text-xs text-fg-secondary mt-0.5">gastos · participación %</div>
        </div>
      </div>
      <div className="p-5 flex flex-col sm:flex-row gap-5 items-center">
        <svg width="160" height="160" viewBox="0 0 160 160" className="shrink-0">
          <circle cx={c} cy={c} r={r} fill="none" stroke="#F7F8FB" strokeWidth={sw} />
          {top.map((it, i) => {
            const pct = it.pct / 100;
            const len = pct * circ;
            const offset = acc * circ;
            acc += pct;
            return (
              <circle
                key={it.categoria}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={sw}
                strokeDasharray={`${len} ${circ}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${c} ${c})`}
                strokeLinecap="butt"
              />
            );
          })}
          <text x={c} y={c - 2} textAnchor="middle" fontSize="15" fontWeight="700" fill="#050555">
            {top.length}
          </text>
          <text x={c} y={c + 13} textAnchor="middle" fontSize="9" fill="#8A94A6" letterSpacing="1">
            CATEGORÍAS
          </text>
        </svg>
        <div className="flex-1 w-full flex flex-col gap-2">
          {top.map((it, i) => (
            <div key={it.categoria} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="flex-1 text-fg-primary font-medium truncate">{it.categoria}</span>
              <span className="text-fg-secondary tabular">{it.pct}%</span>
            </div>
          ))}
          {top.length === 0 && <div className="text-xs text-fg-muted">Sin gastos en el período.</div>}
        </div>
      </div>
    </div>
  );
}
