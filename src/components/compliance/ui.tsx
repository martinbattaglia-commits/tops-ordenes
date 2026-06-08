/**
 * Compliance Cockpit · componentes presentacionales (server components, sin estado).
 * Reutilizan tokens Nexus (card, fg-*, bg-surface) + paleta de riesgo semántica.
 */
import type { CSSProperties } from "react";
import { Icon } from "@/components/Icon";
import {
  RISK_HEX, RISK_LABEL,
  type ComplianceItem, type Riesgo, type TimelineBucket,
} from "@/lib/compliance/data";

export function RiskBadge({ riesgo, children }: { riesgo: Riesgo; children?: React.ReactNode }) {
  const hex = RISK_HEX[riesgo];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-bold uppercase tracking-wide"
      style={{ color: hex, background: `${hex}22`, border: `1px solid ${hex}66` } as CSSProperties}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: hex }} />
      {children ?? RISK_LABEL[riesgo]}
    </span>
  );
}

/** Gauge circular genérico (Compliance o Risk). El color lo decide quien lo invoca. */
export function ScoreGauge({ score, hex, caption = "de 100", size = 184 }: { score: number; hex: string; caption?: string; size?: number }) {
  const sw = Math.round(size * 0.076);
  const cxy = size / 2, r = cxy - sw - 2;
  const c = 2 * Math.PI * r, off = c * (1 - score / 100);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cxy} cy={cxy} r={r} stroke="var(--bg-surface-alt)" strokeWidth={sw} fill="none" />
        <circle cx={cxy} cy={cxy} r={r} stroke={hex} strokeWidth={sw} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} style={{ filter: `drop-shadow(0 0 6px ${hex}88)` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-black tabular leading-none" style={{ color: hex, fontSize: Math.round(size * 0.27) }}>{score}</span>
        <span className="text-[11px] uppercase tracking-wide text-fg-muted mt-1">{caption}</span>
      </div>
    </div>
  );
}

/** Donut de distribución de riesgo (Sección 3). */
export function RiskDonut({ dist }: { dist: { riesgo: Riesgo; count: number; pct: number }[] }) {
  const total = dist.reduce((s, d) => s + d.count, 0) || 1;
  const r = 62, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="relative" style={{ width: 156, height: 156 }}>
        <svg width="156" height="156" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="78" cy="78" r={r} stroke="var(--bg-surface-alt)" strokeWidth="18" fill="none" />
          {dist.map((d) => {
            const len = (d.count / total) * c;
            const seg = <circle key={d.riesgo} cx="78" cy="78" r={r} stroke={RISK_HEX[d.riesgo]} strokeWidth="18" fill="none"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} />;
            acc += len; return seg;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-black tabular text-fg-primary">{total}</span>
          <span className="text-[10px] uppercase tracking-wide text-fg-muted">ítems</span>
        </div>
      </div>
      <div className="flex-1 min-w-[160px] space-y-1.5">
        {dist.map((d) => (
          <div key={d.riesgo} className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: RISK_HEX[d.riesgo] }} />
            <span className="text-fg-secondary flex-1">{RISK_LABEL[d.riesgo]}</span>
            <span className="tabular font-bold text-fg-primary">{d.count}</span>
            <span className="tabular text-fg-muted text-xs w-10 text-right">{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Barras apiladas por categoría (Sección 4). */
export function CategoryBars({ cats }: { cats: { categoria: string; Verde: number; Amarillo: number; Naranja: number; Rojo: number; total: number }[] }) {
  const max = Math.max(...cats.map((c) => c.total), 1);
  const order: Riesgo[] = ["Rojo", "Naranja", "Amarillo", "Verde"];
  return (
    <div className="space-y-2.5">
      {cats.sort((a, b) => b.total - a.total).map((c) => (
        <div key={c.categoria} className="flex items-center gap-3">
          <div className="w-32 text-xs text-fg-secondary truncate text-right flex-shrink-0">{c.categoria}</div>
          <div className="flex-1 flex h-5 rounded overflow-hidden bg-bg-surface-alt" style={{ width: `${(c.total / max) * 100}%` }}>
            {order.map((rg) => c[rg] > 0 && (
              <div key={rg} className="grid place-items-center text-[10px] font-bold text-white"
                style={{ flex: c[rg], background: RISK_HEX[rg] } as CSSProperties} title={`${rg}: ${c[rg]}`}>
                {c[rg]}
              </div>
            ))}
          </div>
          <div className="w-6 text-xs tabular font-bold text-fg-primary">{c.total}</div>
        </div>
      ))}
    </div>
  );
}

/** Timeline de vencimientos (Sección 5). */
export function TimelineView({ buckets }: { buckets: TimelineBucket[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
      {buckets.map((b) => (
        <div key={b.key} className="rounded-lg border border-stroke-soft overflow-hidden">
          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide flex items-center justify-between"
            style={{ color: RISK_HEX[b.riesgo], background: `${RISK_HEX[b.riesgo]}14` } as CSSProperties}>
            <span>{b.label}</span><span className="tabular">{b.items.length}</span>
          </div>
          <div className="p-2 space-y-2">
            {b.items.length === 0 && <div className="text-[11px] text-fg-muted px-1 py-2">—</div>}
            {b.items.map((i) => (
              <div key={i.id} className="rounded-md bg-bg-surface-alt px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono text-fg-muted">{i.id}</span>
                  <span className="text-[10px] tabular font-bold" style={{ color: RISK_HEX[i.riesgo] }}>
                    {i.dias !== null && i.dias < 0 ? `${Math.abs(i.dias)}d venc.` : `${i.dias}d`}
                  </span>
                </div>
                <div className="text-[11px] text-fg-primary font-semibold leading-tight mt-0.5 line-clamp-2">{i.documento}</div>
                <div className="text-[10px] text-fg-muted mt-0.5">{i.venc_fmt}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Centro de alertas estilo SOC (Sección 6). */
export function AlertCenter({ criticos, inmediatos, proximos }: { criticos: ComplianceItem[]; inmediatos: ComplianceItem[]; proximos: ComplianceItem[] }) {
  const Group = ({ title, riesgo, items }: { title: string; riesgo: Riesgo; items: ComplianceItem[] }) => (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: `${RISK_HEX[riesgo]}55` } as CSSProperties}>
      <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: `${RISK_HEX[riesgo]}16` } as CSSProperties}>
        <div className="flex items-center gap-2 text-sm font-bold" style={{ color: RISK_HEX[riesgo] }}>
          <Icon name="bell" size={14} /> {title}
        </div>
        <span className="tabular text-sm font-black" style={{ color: RISK_HEX[riesgo] }}>{items.length}</span>
      </div>
      <ul className="divide-y divide-stroke-soft/50">
        {items.length === 0 && <li className="px-4 py-3 text-xs text-fg-muted">Sin alertas en esta categoría.</li>}
        {items.map((i) => (
          <li key={i.id} className="px-4 py-2.5 flex items-start gap-3">
            <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: RISK_HEX[riesgo] }} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-fg-primary">{i.documento} <span className="text-[10px] font-mono text-fg-muted">· {i.sede}</span></div>
              <div className="text-[11px] text-fg-muted truncate">{i.organismo}</div>
            </div>
            <span className="text-[10px] tabular font-bold whitespace-nowrap" style={{ color: RISK_HEX[riesgo] }}>
              {i.dias === null ? "—" : i.dias < 0 ? `${Math.abs(i.dias)}d venc.` : `${i.dias}d`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <Group title="CRÍTICOS" riesgo="Rojo" items={criticos} />
      <Group title="INMEDIATOS" riesgo="Naranja" items={inmediatos} />
      <Group title="PRÓXIMOS" riesgo="Amarillo" items={proximos} />
    </div>
  );
}

/** Obligaciones recurrentes (Sección 9). */
export function RecurringGrid({ rows }: { rows: ReturnType<typeof import("@/lib/compliance/data").recurringObligations> }) {
  const Side = ({ item }: { item: ComplianceItem | null }) => {
    if (!item) return <span className="text-fg-muted text-xs">—</span>;
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-secondary">{item.emi_fmt}</span>
        <span className="text-[11px] tabular font-semibold" style={{ color: RISK_HEX[item.riesgo] }}>{item.venc_fmt}</span>
      </div>
    );
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map((r) => (
        <div key={r.label} className="card p-4">
          <div className="text-sm font-bold text-fg-primary mb-2">{r.label}</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-muted mb-1">Magaldi</div>
              <Side item={r.magaldi} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-muted mb-1">Luján</div>
              <Side item={r.lujan} />
            </div>
          </div>
          <div className="text-[10px] text-fg-muted mt-2">{r.ult} → {r.prox}</div>
        </div>
      ))}
    </div>
  );
}

/** Calendario regulatorio anual (Sección 8). */
export function CalendarView({ months, year }: { months: ReturnType<typeof import("@/lib/compliance/data").calendar>; year: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {months.map((m) => (
        <div key={m.mes} className={`rounded-lg border border-stroke-soft p-3 ${m.items.length ? "" : "opacity-60"}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-fg-primary">{m.mes} {year}</span>
            {m.items.length > 0 && <span className="text-[10px] tabular text-fg-muted">{m.items.length}</span>}
          </div>
          <div className="space-y-1.5">
            {m.items.length === 0 && <div className="text-[10px] text-fg-muted">—</div>}
            {m.items.map((i) => (
              <div key={i.id} className="flex items-start gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ background: RISK_HEX[i.riesgo] }} />
                <div className="min-w-0">
                  <div className="text-[10.5px] text-fg-primary leading-tight line-clamp-1">{i.documento}</div>
                  <div className="text-[9.5px] text-fg-muted">{i.venc_fmt} · {i.sede}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
