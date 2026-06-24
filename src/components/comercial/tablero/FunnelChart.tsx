import type { EnrichedDeal } from "@/lib/comercial/dashboard-kpis";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-AR", { notation: "compact", style: "currency", currency: "ARS" }).format(n || 0);

export function FunnelChart({ deals }: { deals: EnrichedDeal[] }) {
  const live = deals.filter((d) => d.status === "open" || d.status === "other");
  const byStage = new Map<string, { count: number; amount: number }>();
  for (const d of live) {
    const k = d.stage ?? "—";
    const e = byStage.get(k) ?? { count: 0, amount: 0 };
    e.count += 1; e.amount += d.amount;
    byStage.set(k, e);
  }
  const rows = [...byStage.entries()].sort((a, b) => b[1].count - a[1].count);
  const max = Math.max(1, ...rows.map((r) => r[1].count));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-sm font-semibold">Funnel comercial (activos por etapa)</h3>
      <div className="space-y-2">
        {rows.map(([stage, v]) => (
          <div key={stage} className="flex items-center gap-2 text-xs">
            <span className="w-44 truncate text-slate-500" title={stage}>{stage}</span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded bg-[#1f33c8]" style={{ width: `${(v.count / max) * 100}%` }} />
            </div>
            <span className="w-10 text-right font-mono">{v.count}</span>
            <span className="w-20 text-right font-mono text-slate-400">{fmt(v.amount)}</span>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-400">Sin oportunidades activas.</p>}
      </div>
    </div>
  );
}
