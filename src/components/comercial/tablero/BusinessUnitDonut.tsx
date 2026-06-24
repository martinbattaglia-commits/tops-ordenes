import type { BusinessUnit } from "@/lib/comercial/dashboard-insights";

const PALETTE = ["#214576", "#1D9E75", "#B45309", "#7C3AED", "#64748B"];

const fmt = (n: number) =>
  "$ " +
  (Math.abs(n) >= 1e6
    ? (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : Math.round(n || 0).toLocaleString("es-AR"));

const fmtCompact = (n: number) =>
  Math.abs(n) >= 1e6
    ? "$ " + (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

export function BusinessUnitDonut({ units }: { units: BusinessUnit[] }) {
  const total = units.reduce((a, u) => a + u.amount, 0);

  let acc = 0;
  const stops = units
    .map((u, i) => {
      const start = total ? (acc / total) * 100 : 0;
      acc += u.amount;
      const end = total ? (acc / total) * 100 : 0;
      return `${PALETTE[i % PALETTE.length]} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <div className="card card-pad">
      <div className="mb-3 text-sm font-semibold text-fg-primary">
        Distribución por unidad de negocio
        <span className="ml-2 text-[10px] font-normal text-fg-muted">— pipeline por área</span>
      </div>

      {total > 0 ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {/* Donut */}
          <div
            className="relative mx-auto h-32 w-32 shrink-0 rounded-full sm:mx-0"
            style={{ background: `conic-gradient(${stops})` }}
          >
            <div className="absolute inset-[22%] rounded-full bg-bg-surface" />
          </div>

          {/* Legend */}
          <div className="min-w-0 flex-1 space-y-2">
            {units.map((u, i) => (
              <div key={u.name} className="flex items-start gap-2 text-xs">
                <span
                  className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: PALETTE[i % PALETTE.length] }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-fg-primary" title={u.name}>
                      {u.name}
                    </span>
                    <span className="shrink-0 font-semibold text-fg-primary tabular-nums">
                      {u.pct}%
                    </span>
                  </div>
                  <div className="text-fg-muted">
                    {fmt(u.amount)}{" "}
                    <span className="text-[10px]">
                      ({u.count} deal{u.count === 1 ? "" : "s"} · fcast {fmtCompact(u.forecast)})
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Sin unidades de negocio con pipeline activo.</p>
      )}
    </div>
  );
}
