"use client";

import { fmtCurrencyShort } from "@/lib/compras/format";

interface Slice {
  label: string;
  pct: number;
  color: string;
  amount: number;
}

interface Props {
  data: Slice[];
  totalLabel?: string;
  totalValue: number;
}

export function CategoryDonut({ data, totalLabel = "MILLONES", totalValue }: Props) {
  const SIZE = 180;
  const R = 70;
  const inner = 50;
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  let acc = 0;
  const segments = data.map((s) => {
    const startA = acc;
    acc += (s.pct / 100) * Math.PI * 2;
    const endA = acc;
    return { ...s, startA, endA };
  });

  const arc = (sa: number, ea: number, r: number) => {
    const x1 = cx + Math.sin(sa) * r;
    const y1 = cy - Math.cos(sa) * r;
    const x2 = cx + Math.sin(ea) * r;
    const y2 = cy - Math.cos(ea) * r;
    const large = ea - sa > Math.PI ? 1 : 0;
    return `M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} A ${r} ${r} 0 0 1 ${cx} ${cy - r} Z` /* fallback full */
      || `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const segPath = (sa: number, ea: number) => {
    const x1 = cx + Math.sin(sa) * R;
    const y1 = cy - Math.cos(sa) * R;
    const x2 = cx + Math.sin(ea) * R;
    const y2 = cy - Math.cos(ea) * R;
    const x3 = cx + Math.sin(ea) * inner;
    const y3 = cy - Math.cos(ea) * inner;
    const x4 = cx + Math.sin(sa) * inner;
    const y4 = cy - Math.cos(sa) * inner;
    const large = ea - sa > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
  };

  void arc; // silence

  return (
    <div className="flex items-center gap-5">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ width: 180, height: 180 }}>
        {segments.map((s, i) => (
          <path key={i} d={segPath(s.startA, s.endA)} fill={s.color}>
            <title>{`${s.label}: ${s.pct}% · ${fmtCurrencyShort(s.amount)}`}</title>
          </path>
        ))}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize={20}
          fontWeight={700}
          fill="#050555"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {fmtCurrencyShort(totalValue).replace(" M", "")}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize={8}
          fontWeight={700}
          letterSpacing={2}
          fill="#8A94A6"
        >
          {totalLabel}
        </text>
      </svg>
      <ul className="flex flex-col gap-2 text-xs flex-1 min-w-0">
        {segments.map((s, i) => (
          <li key={i} className="flex items-center gap-2.5">
            <span
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ background: s.color }}
            />
            <span className="font-semibold text-fg-primary flex-1 truncate">{s.label}</span>
            <span className="tabular text-fg-secondary text-[11px]">{s.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
