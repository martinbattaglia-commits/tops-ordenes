export default function TableroLoading() {
  return (
    <div className="space-y-6 p-4 md:p-8 animate-pulse" aria-busy="true" aria-label="Cargando tablero comercial">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="h-3 w-28 rounded bg-bg-surface-alt" />
          <div className="h-7 w-72 rounded bg-bg-surface-alt" />
        </div>
        <div className="h-3 w-40 rounded bg-bg-surface-alt" />
      </div>

      {/* Hero KPI grid (8) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg border border-stroke-soft bg-bg-surface" />
        ))}
      </div>

      {/* Top opportunities */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-44 rounded-lg border border-stroke-soft bg-bg-surface" />
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-lg border border-stroke-soft bg-bg-surface" />
        <div className="h-64 rounded-lg border border-stroke-soft bg-bg-surface" />
      </div>

      {/* Intelligence row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-52 rounded-lg border border-stroke-soft bg-bg-surface" />
        ))}
      </div>

      {/* Table */}
      <div className="h-80 rounded-lg border border-stroke-soft bg-bg-surface" />
    </div>
  );
}
