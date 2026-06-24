import { Icon } from "@/components/Icon";
import type { TrendPoint, Deltas } from "@/lib/comercial/dashboard-data";

const fmt = (n: number) =>
  Math.abs(n) >= 1e6
    ? "$ " + (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

interface Props {
  series: TrendPoint[];
  deltas: Deltas | null;
}

export function ForecastTrend({ series, deltas }: Props) {
  if (series.length < 2) {
    return (
      <div className="card card-pad flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Icon name="trend-up" size={40} />
        <p className="text-sm text-fg-muted max-w-xs">
          La tendencia se completará automáticamente con los próximos cortes diarios de Clientify a las 21 h.
        </p>
      </div>
    );
  }

  const last = series[series.length - 1];
  const lastForecast = last.forecast;

  // SVG geometry
  const W = 720;
  const H = 200;
  const pad = { l: 52, r: 20, t: 20, b: 32 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = series.length;

  const allForecast = series.map((p) => p.forecast);
  const allActive = series.map((p) => p.active);
  const maxVal = Math.max(...allForecast, ...allActive, 1);
  const minVal = Math.min(...allForecast, ...allActive, 0);
  const range = maxVal - minVal || 1;

  const xFor = (i: number) => pad.l + (i / (n - 1)) * innerW;
  const yFor = (v: number) => pad.t + innerH - ((v - minVal) / range) * innerH;

  const pathFor = (vals: number[]) =>
    vals.map((v, i) => (i === 0 ? `M${xFor(i)},${yFor(v)}` : `L${xFor(i)},${yFor(v)}`)).join(" ");

  const areaFor = (vals: number[]) =>
    pathFor(vals) +
    ` L${xFor(n - 1)},${pad.t + innerH} L${pad.l},${pad.t + innerH} Z`;

  // Y-axis tick labels: 4 ticks
  const yTicks = [0, 0.33, 0.66, 1].map((p) => ({
    v: minVal + range * (1 - p),
    y: pad.t + innerH * p,
  }));

  // X-axis: first and last date labels
  const firstDate = series[0].date;
  const lastDate = last.date;

  // Delta display
  const deltaForecast = deltas?.forecast ?? null;
  const deltaSign = deltaForecast !== null && deltaForecast >= 0;
  const deltaColor = deltaForecast === null ? "" : deltaForecast >= 0 ? "text-status-success" : "text-status-danger";

  return (
    <div className="card">
      <div className="flex flex-wrap items-end justify-between px-5 pt-5 pb-4 border-b border-stroke-soft gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Tendencia del forecast</div>
          <div className="text-2xl font-bold text-fg-brand tabular-nums mt-1">{fmt(lastForecast)}</div>
          {deltaForecast !== null && (
            <div className={`text-xs font-medium mt-0.5 ${deltaColor}`}>
              {deltaSign ? "▲" : "▼"} {fmt(Math.abs(deltaForecast))} vs. corte anterior
            </div>
          )}
        </div>
        <div className="flex gap-4 text-xs">
          <LegendItem color="#0E7C3A" label="Forecast" />
          <LegendItem color="#214576" label="Pipeline activo" />
        </div>
      </div>

      <div className="p-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-[180px] text-fg-muted"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="ftForecast" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0E7C3A" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#0E7C3A" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="ftActive" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#214576" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#214576" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Y-axis grid lines + labels */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={pad.l}
                y1={t.y}
                x2={W - pad.r}
                y2={t.y}
                stroke="currentColor"
                strokeOpacity="0.15"
                strokeWidth="1"
              />
              <text
                x={pad.l - 8}
                y={t.y + 4}
                fontSize="10"
                fill="currentColor"
                textAnchor="end"
              >
                {Math.abs(t.v) >= 1e6
                  ? (t.v / 1e6).toFixed(1) + "M"
                  : Math.round(t.v / 1000) + "k"}
              </text>
            </g>
          ))}

          {/* X-axis date labels */}
          <text x={pad.l} y={H - 4} fontSize="10" fill="currentColor" textAnchor="start">
            {firstDate}
          </text>
          <text x={W - pad.r} y={H - 4} fontSize="10" fill="currentColor" textAnchor="end">
            {lastDate}
          </text>

          {/* Active area + line */}
          <path d={areaFor(allActive)} fill="url(#ftActive)" />
          <path
            d={pathFor(allActive)}
            fill="none"
            stroke="#214576"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="4 3"
          />

          {/* Forecast area + line */}
          <path d={areaFor(allForecast)} fill="url(#ftForecast)" />
          <path
            d={pathFor(allForecast)}
            fill="none"
            stroke="#0E7C3A"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* End-point dot for forecast */}
          <circle
            cx={xFor(n - 1)}
            cy={yFor(lastForecast)}
            r="4"
            fill="#0E7C3A"
          />
        </svg>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-0.5 inline-block rounded" style={{ background: color }} />
      <span className="text-fg-secondary">{label}</span>
    </div>
  );
}
