import type { Kpis } from "@/lib/comercial/dashboard-kpis";

const fmt = (n: number) =>
  "$ " + (Math.abs(n) >= 1e6
    ? (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : Math.round(n).toLocaleString("es-AR"));

const PALETTE = ["#185FA5", "#1D9E75", "#B45309", "#7C3AED", "#64748B"];

export function PipelineDonut({ byPipeline }: { byPipeline: Kpis["byPipeline"] }) {
  const total = byPipeline.reduce((a, p) => a + p.active, 0);
  let acc = 0;
  const stops = byPipeline
    .map((p, i) => {
      const start = total ? (acc / total) * 100 : 0;
      acc += p.active;
      const end = total ? (acc / total) * 100 : 0;
      return `${PALETTE[i % PALETTE.length]} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-sm font-semibold">
        Distribución del pipeline <span className="text-[10px] font-normal text-slate-400">— pipeline vivo por línea</span>
      </h3>
      {total > 0 ? (
        <div className="flex items-center gap-4">
          <div className="relative h-28 w-28 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops})` }}>
            <div className="absolute inset-[20%] rounded-full bg-white dark:bg-slate-900" />
          </div>
          <div className="space-y-1.5">
            {byPipeline.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="text-slate-600 dark:text-slate-300">{p.name}</span>
                <span className="font-mono text-slate-400">{Math.round((p.active / total) * 100)}% · {fmt(p.active)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Sin pipeline vivo.</p>
      )}
    </div>
  );
}
