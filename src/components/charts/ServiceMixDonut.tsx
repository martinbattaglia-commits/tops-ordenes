interface Item {
  slug: string;
  label: string;
  pct: number;
  color: string;
}

export function ServiceMixDonut({ items, total }: { items: Item[]; total: number }) {
  const r = 64;
  const c = 80;
  const sw = 18;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  const items100 = items.length ? items : fallback;
  return (
    <div className="card">
      <div className="flex items-end justify-between p-5 border-b border-stroke-soft">
        <div>
          <div className="text-base font-bold text-fg-brand">Mix de servicios</div>
          <div className="text-xs text-fg-secondary mt-0.5">Mes · participación %</div>
        </div>
      </div>
      <div className="p-5 flex flex-col sm:flex-row gap-5 items-center">
        <svg width="160" height="160" viewBox="0 0 160 160" className="shrink-0">
          <circle cx={c} cy={c} r={r} fill="none" stroke="#F7F8FB" strokeWidth={sw} />
          {items100.map((it, i) => {
            const pct = it.pct / 100;
            const len = pct * circ;
            const offset = acc * circ;
            acc += pct;
            return (
              <circle
                key={i}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={it.color}
                strokeWidth={sw}
                strokeDasharray={`${len} ${circ}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${c} ${c})`}
                strokeLinecap="butt"
              />
            );
          })}
          <text x={c} y={c - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill="#050555">
            {total}
          </text>
          <text x={c} y={c + 14} textAnchor="middle" fontSize="10" fill="#8A94A6" letterSpacing="1">
            ÓRDENES
          </text>
        </svg>
        <div className="flex-1 w-full flex flex-col gap-2">
          {items100.map((it) => (
            <div key={it.slug} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: it.color }} />
              <span className="flex-1 text-fg-primary font-medium truncate">{it.label}</span>
              <span className="text-fg-secondary tabular">{it.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const fallback: Item[] = [
  { slug: "autoelevador", label: "Autoelevador", pct: 28, color: "#050555" },
  { slug: "transporte", label: "Transporte AMBA", pct: 22, color: "#214576" },
  { slug: "picking", label: "Picking", pct: 18, color: "#3a6db0" },
  { slug: "desconsolidado", label: "Desconsolidado", pct: 12, color: "#C90812" },
  { slug: "peon", label: "Peón por hora", pct: 11, color: "#8A94A6" },
  { slug: "otros", label: "Otros", pct: 9, color: "#C2CAD6" },
];
