import type { Kpis } from "@/lib/comercial/dashboard-kpis";

const fmt = (n: number) =>
  "$ " + (Math.abs(n) >= 1e6
    ? (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : Math.round(n).toLocaleString("es-AR"));

export function ConcretionBars({ bands }: { bands: Kpis["bands"] }) {
  const max = Math.max(1, ...bands.map((b) => b.amount));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-2 text-sm font-semibold">
        Pipeline vs forecast <span className="text-[10px] font-normal text-slate-400">— por banda de probabilidad</span>
      </h3>
      <div className="mb-3 flex gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-300" />Pipeline</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-700" />Forecast</span>
      </div>
      <div className="space-y-3">
        {bands.map((b) => (
          <div key={b.key}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-300">{b.label}</span>
              <span className="text-[10px] text-slate-400">{b.count} deal{b.count === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-1 space-y-1">
              <div className="h-3 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded bg-sky-300" style={{ width: `${(b.amount / max) * 100}%` }} />
              </div>
              <div className="h-3 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded bg-sky-700" style={{ width: `${(b.forecast / max) * 100}%` }} />
              </div>
            </div>
            <div className="mt-0.5 flex justify-between font-mono text-[10px] text-slate-400">
              <span>{fmt(b.amount)}</span>
              <span>fcast {fmt(b.forecast)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
