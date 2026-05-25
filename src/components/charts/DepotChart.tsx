interface Props {
  magaldi: number[];
  lujan: number[];
}

export function DepotChart({ magaldi, lujan }: Props) {
  const w = 720;
  const h = 240;
  const pad = { l: 38, r: 16, t: 16, b: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const days = Math.max(magaldi.length, lujan.length);
  const max = Math.max(...magaldi, ...lujan, 22);
  const xStep = innerW / Math.max(1, days - 1);
  const yFor = (v: number) => pad.t + innerH - (v / max) * innerH;
  const xFor = (i: number) => pad.l + i * xStep;
  const pathFor = (data: number[]) =>
    data.map((v, i) => (i === 0 ? `M${xFor(i)},${yFor(v)}` : `L${xFor(i)},${yFor(v)}`)).join(" ");
  const areaFor = (data: number[]) =>
    pathFor(data) + ` L${xFor(days - 1)},${pad.t + innerH} L${pad.l},${pad.t + innerH} Z`;

  const magaldiTotal = magaldi.reduce((a, b) => a + b, 0);
  const lujanTotal = lujan.reduce((a, b) => a + b, 0);

  return (
    <div className="card">
      <div className="flex flex-wrap items-end justify-between p-5 border-b border-stroke-soft gap-2">
        <div>
          <div className="text-base font-bold text-fg-brand">Servicios por depósito</div>
          <div className="text-xs text-fg-secondary mt-0.5">Últimos 30 días · órdenes por día</div>
        </div>
        <div className="flex gap-4 text-xs">
          <Legend color="#050555" label="Magaldi" value={magaldiTotal} />
          <Legend color="#C90812" label="Luján" value={lujanTotal} />
        </div>
      </div>
      <div className="p-3">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[200px] md:h-[240px]" preserveAspectRatio="none">
          <defs>
            <linearGradient id="depMag" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#050555" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#050555" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="depLuj" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#C90812" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#C90812" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
            <g key={i}>
              <line x1={pad.l} y1={pad.t + innerH * p} x2={w - pad.r} y2={pad.t + innerH * p} stroke="#EEF1F6" strokeWidth="1" />
              <text x={pad.l - 8} y={pad.t + innerH * p + 4} fontSize="10" fill="#8A94A6" textAnchor="end">
                {Math.round(max * (1 - p))}
              </text>
            </g>
          ))}
          <path d={areaFor(magaldi)} fill="url(#depMag)" />
          <path d={pathFor(magaldi)} fill="none" stroke="#050555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d={areaFor(lujan)} fill="url(#depLuj)" />
          <path d={pathFor(lujan)} fill="none" stroke="#C90812" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      <span className="text-fg-secondary">{label}</span>
      <strong className="text-fg-primary ml-0.5">{value}</strong>
    </div>
  );
}
