/**
 * charts.tsx — Gráficos del tablero en SVG puro (sin librerías), siguiendo la
 * convención de la app (`src/components/charts/*`). Reproducen los gráficos de la
 * maqueta: 3 donuts (estado/riesgo/tipo), barras de vencimientos (12 meses) y
 * barras horizontales de facturación. Colores por hex (paleta de la maqueta);
 * el texto usa `currentColor`/tokens para respetar el modo oscuro.
 */

export interface Segment {
  label: string;
  value: number;
  color: string;
}

const TAU = Math.PI * 2;

function arcPath(cx: number, cy: number, rO: number, rI: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + rO * Math.cos(a0);
  const y0 = cy + rO * Math.sin(a0);
  const x1 = cx + rO * Math.cos(a1);
  const y1 = cy + rO * Math.sin(a1);
  const x2 = cx + rI * Math.cos(a1);
  const y2 = cy + rI * Math.sin(a1);
  const x3 = cx + rI * Math.cos(a0);
  const y3 = cy + rI * Math.sin(a0);
  return [
    `M ${x0} ${y0}`,
    `A ${rO} ${rO} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${rI} ${rI} 0 ${large} 0 ${x3} ${y3}`,
    "Z",
  ].join(" ");
}

/** Donut con leyenda lateral y total centrado. */
export function Donut({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: Segment[];
  centerLabel: string;
  centerValue: number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const cx = 70;
  const cy = 70;
  const rO = 66;
  const rI = rO * 0.62;
  let a = -Math.PI / 2;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const a0 = a;
      const a1 = a + (s.value / total) * TAU;
      a = a1;
      return { d: arcPath(cx, cy, rO, rI, a0, a1 - 0.012), color: s.color, key: s.label };
    });
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 140 140" className="w-[140px] h-[140px] shrink-0" role="img" aria-label={centerLabel}>
        {arcs.map((arc) => (
          <path key={arc.key} d={arc.d} fill={arc.color} stroke="var(--bg-surface)" strokeWidth={2} />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-fg-brand" style={{ fontSize: 26, fontWeight: 800 }}>
          {centerValue}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="fill-fg-muted" style={{ fontSize: 10 }}>
          {centerLabel}
        </text>
      </svg>
      <ul className="text-xs space-y-1.5 min-w-0">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="text-fg-secondary truncate">{s.label}</span>
            <span className="ml-auto font-bold text-fg-primary tabular pl-2">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barras verticales: vencimientos por mes (ventana de 12 meses). */
export function VencimientosBars({ data }: { data: { label: string; count: number }[] }) {
  const W = 520;
  const H = 210;
  const PAD = { l: 26, r: 12, t: 12, b: 34 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const max = Math.max(...data.map((d) => d.count), 1);
  const step = innerW / data.length;
  const bw = Math.min(step * 0.6, 30);
  const ticks = max <= 4 ? max : 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Vencimientos por mes">
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = Math.round((max / ticks) * i);
        const y = PAD.t + innerH - (v / max) * innerH;
        return (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="var(--stroke-soft)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y + 3} textAnchor="end" className="fill-fg-muted" style={{ fontSize: 9 }}>
              {v}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (d.count / max) * innerH;
        const x = PAD.l + i * step + (step - bw) / 2;
        const y = PAD.t + innerH - h;
        return (
          <g key={d.label}>
            {d.count > 0 && <rect x={x} y={y} width={bw} height={h} rx={3} fill="#15406B" />}
            <text
              x={PAD.l + i * step + step / 2}
              y={H - PAD.b + 14}
              textAnchor="middle"
              className="fill-fg-muted"
              style={{ fontSize: 8.5 }}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Barras horizontales con valor formateado (facturación por tipo / por contrato). */
export function HBars({
  items,
  format,
}: {
  items: { label: string; value: number; color: string }[];
  format: (v: number) => string;
}) {
  const rows = items.filter((i) => i.value > 0);
  const W = 520;
  const rowH = 34;
  const H = Math.max(rows.length * rowH + 12, 60);
  const labelW = 116;
  const valueW = 96;
  const trackX = labelW + 8;
  const trackW = W - trackX - valueW;
  const max = Math.max(...rows.map((i) => i.value), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Facturación">
      {rows.map((it, i) => {
        const y = i * rowH + 6;
        const bw = (it.value / max) * trackW;
        return (
          <g key={it.label}>
            <text x={labelW} y={y + rowH / 2} textAnchor="end" className="fill-fg-secondary" style={{ fontSize: 11 }}>
              {it.label}
            </text>
            <rect x={trackX} y={y + 5} width={trackW} height={rowH - 16} rx={4} fill="var(--bg-surface-alt)" />
            <rect x={trackX} y={y + 5} width={bw} height={rowH - 16} rx={4} fill={it.color} />
            <text
              x={W - 4}
              y={y + rowH / 2}
              textAnchor="end"
              className="fill-fg-primary"
              style={{ fontSize: 11, fontWeight: 700 }}
            >
              {format(it.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
