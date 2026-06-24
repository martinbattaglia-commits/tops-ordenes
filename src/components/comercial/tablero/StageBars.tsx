import type { StageRow } from "@/lib/comercial/dashboard-insights";

const fmt = (n: number) =>
  "$ " +
  (Math.abs(n) >= 1e6
    ? (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : Math.round(n || 0).toLocaleString("es-AR"));

const fmtCompact = (n: number) =>
  Math.abs(n) >= 1e6
    ? "$ " + (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

export function StageBars({ stages }: { stages: StageRow[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));

  return (
    <div className="card card-pad">
      <div className="mb-3 text-sm font-semibold text-fg-primary">
        Funnel por etapa
        <span className="ml-2 text-[10px] font-normal text-fg-muted">— deals por etapa del pipeline</span>
      </div>

      {stages.length > 0 ? (
        <div className="space-y-2.5">
          {stages.map((s) => (
            <div key={s.stage} className="flex items-center gap-3 text-xs">
              {/* Stage label */}
              <span
                className="w-44 shrink-0 truncate text-fg-secondary"
                title={s.stage}
              >
                {s.stage}
              </span>

              {/* Bar track */}
              <div className="relative flex-1 overflow-hidden rounded bg-bg-surface-alt" style={{ height: "10px" }}>
                <div
                  className="h-full rounded"
                  style={{
                    width: `${(s.count / max) * 100}%`,
                    background: "#214576",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>

              {/* Right-side stats */}
              <div className="flex shrink-0 items-center gap-2">
                <span className="w-5 text-right font-semibold tabular-nums text-fg-primary">
                  {s.count}
                </span>
                <span className="hidden text-fg-muted sm:inline">{fmt(s.amount)}</span>
                <span className="text-fg-muted">
                  <span className="text-[10px]">fcast {fmtCompact(s.forecast)}</span>
                </span>
                <span className="hidden w-9 text-right text-[10px] text-fg-muted tabular-nums lg:inline">
                  {s.pct}%
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Sin etapas registradas.</p>
      )}
    </div>
  );
}
