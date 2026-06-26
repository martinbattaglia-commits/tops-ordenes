export default function TableroLoading() {
  return (
    <div
      className="mx-auto max-w-[1500px] space-y-6 p-4 md:p-8 animate-pulse"
      aria-busy="true"
      aria-label="Cargando tablero comercial"
    >
      {/* Header */}
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="h-3 w-28 rounded bg-fg-muted/20" />
          <div className="h-7 w-72 rounded bg-fg-muted/20" />
        </div>
        <div className="h-3 w-40 rounded bg-fg-muted/20" />
      </div>

      {/* Vista Dirección — 3 cols */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-52 rounded-xl bg-fg-muted/10" />
        ))}
      </div>

      {/* KPI cards — 3×4 grid (12 cards) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-fg-muted/10" />
        ))}
      </div>

      {/* Forecast blocks row — 3 cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-xl bg-fg-muted/10" />
        ))}
      </div>

      {/* Alerts */}
      <div className="h-32 rounded-xl bg-fg-muted/10" />

      {/* Top Oportunidades */}
      <div className="h-48 rounded-xl bg-fg-muted/10" />

      {/* Embudo comercial */}
      <div className="h-40 rounded-xl bg-fg-muted/10" />

      {/* 3 more blocks: Source performance + Stagnant + Data quality */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-36 rounded-xl bg-fg-muted/10" />
      ))}

      {/* Tabla de oportunidades skeleton */}
      <div className="space-y-2">
        {/* Table header */}
        <div className="h-10 rounded-lg bg-fg-muted/10" />
        {/* Table rows */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-fg-muted/10" />
        ))}
      </div>
    </div>
  );
}
