// Donut Ingresos vs Egresos (CCN-001B · F3). Reemplaza la distribución por
// categorías: el MVP no tiene categorías (decisión de Dirección 2026-07-22).
// Misma técnica SVG que CategoriaDonut. Server-safe.
import { fmtCurrency } from "@/lib/utils";
import type { IngresoEgresoSplit } from "@/lib/tesoreria/caja-chica/native-logic";

const VERDE = "#0F6E56";
const ROJO = "#C90812";

export function IngresoEgresoDonut({ split }: { split: IngresoEgresoSplit }) {
  const r = 64, c = 80, sw = 18, circ = 2 * Math.PI * r;
  const total = split.ingresos + split.egresos;
  const egresoLen = total > 0 ? (split.egresos / total) * circ : 0;
  const ingresoLen = total > 0 ? (split.ingresos / total) * circ : 0;

  return (
    <div className="card">
      <div className="flex items-end justify-between p-5 border-b border-stroke-soft">
        <div>
          <div className="text-base font-bold text-fg-brand">Ingresos vs Egresos</div>
          <div className="text-xs text-fg-secondary mt-0.5">participación del período</div>
        </div>
      </div>
      <div className="p-5 flex flex-col sm:flex-row gap-5 items-center">
        <svg width="160" height="160" viewBox="0 0 160 160" className="shrink-0" role="img" aria-label="Ingresos vs egresos">
          <circle cx={c} cy={c} r={r} fill="none" stroke="#F7F8FB" strokeWidth={sw} />
          {total > 0 && (
            <>
              <circle
                cx={c} cy={c} r={r} fill="none" stroke={ROJO} strokeWidth={sw}
                strokeDasharray={`${egresoLen} ${circ}`} strokeDashoffset={0}
                transform={`rotate(-90 ${c} ${c})`} strokeLinecap="butt"
              />
              <circle
                cx={c} cy={c} r={r} fill="none" stroke={VERDE} strokeWidth={sw}
                strokeDasharray={`${ingresoLen} ${circ}`} strokeDashoffset={-egresoLen}
                transform={`rotate(-90 ${c} ${c})`} strokeLinecap="butt"
              />
            </>
          )}
          <text x={c} y={c - 2} textAnchor="middle" fontSize="15" fontWeight="700" fill="#050555">
            {split.movimientos}
          </text>
          <text x={c} y={c + 13} textAnchor="middle" fontSize="9" fill="#8A94A6" letterSpacing="1">
            MOVIM.
          </text>
        </svg>
        <div className="flex-1 w-full flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: VERDE }} />
            <span className="flex-1 text-fg-primary font-medium">Ingresos</span>
            <span className="text-fg-secondary tabular">{fmtCurrency(split.ingresos)}</span>
            <span className="text-fg-muted tabular w-12 text-right">{split.pctIngresos}%</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ROJO }} />
            <span className="flex-1 text-fg-primary font-medium">Egresos</span>
            <span className="text-fg-secondary tabular">{fmtCurrency(split.egresos)}</span>
            <span className="text-fg-muted tabular w-12 text-right">{split.pctEgresos}%</span>
          </div>
          {total === 0 && <div className="text-xs text-fg-muted mt-1">Sin movimientos en el período.</div>}
        </div>
      </div>
    </div>
  );
}
