"use client";

import { fmtCurrencyShort } from "@/lib/compras/format";

interface Props {
  months: string[];
  emitidas: number[];
  conciliadas: number[];
}

/**
 * Bar chart agrupado (2 series) — últimos 6 meses.
 * SVG inline, sin dependencias, responsive.
 */
export function SpendChart({ months, emitidas, conciliadas }: Props) {
  const max = Math.max(...emitidas, ...conciliadas, 1);
  const W = 520;
  const H = 220;
  const PAD = { l: 44, r: 12, t: 10, b: 28 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const groupW = innerW / months.length;
  const barW = Math.min(18, (groupW - 8) / 2);

  const yTicks = 4;
  const yVals = Array.from({ length: yTicks + 1 }, (_, i) => max - (max / yTicks) * i);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* Grid */}
      {yVals.map((v, i) => {
        const y = PAD.t + (innerH / yTicks) * i;
        return (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="#EEF1F6" strokeWidth={1} />
            <text x={PAD.l - 6} y={y + 4} fill="#8A94A6" fontSize={9} textAnchor="end" fontFamily="ui-monospace, Menlo">
              {fmtCurrencyShort(v).replace("$ ", "")}
            </text>
          </g>
        );
      })}

      {months.map((m, i) => {
        const gx = PAD.l + groupW * i + (groupW - barW * 2 - 4) / 2;
        const eH = (emitidas[i] / max) * innerH;
        const cH = (conciliadas[i] / max) * innerH;
        return (
          <g key={m}>
            <rect
              x={gx}
              y={PAD.t + innerH - eH}
              width={barW}
              height={eH}
              fill="#050555"
              rx={2}
            >
              <title>{`${m}: emitidas ${fmtCurrencyShort(emitidas[i])}`}</title>
            </rect>
            <rect
              x={gx + barW + 4}
              y={PAD.t + innerH - cH}
              width={barW}
              height={cH}
              fill="#C90812"
              rx={2}
            >
              <title>{`${m}: conciliadas ${fmtCurrencyShort(conciliadas[i])}`}</title>
            </rect>
            <text
              x={gx + barW + 2}
              y={H - 8}
              fill="#5A6577"
              fontSize={10}
              textAnchor="middle"
              fontWeight={600}
            >
              {m}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
