const DEPOT_LABEL: Record<string, string> = { MAGALDI: "Magaldi", LUJAN: "Luján" };

/**
 * Estado Operativo del header del Dashboard. Indicadores vivos y discretos
 * alimentados con datos reales (órdenes por depósito ya calculadas en los KPIs).
 * Corporativo y tecnológico, no decorativo. El pulso es CSS puro (nx-live-dot).
 */
export function OperationalStatus({ byDepot }: { byDepot: Array<{ depot: string; count: number }> }) {
  const total = byDepot.reduce((a, b) => a + b.count, 0);

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-fg-muted">
      <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-[0.08em] text-fg-secondary">
        <span className="nx-live-dot" aria-hidden />
        En vivo
      </span>
      <span className="inline-flex items-center gap-1.5">
        Órdenes activas
        <b className="tabular font-bold text-fg-brand">{total.toLocaleString("es-AR")}</b>
      </span>
      {byDepot.map((d) => (
        <span key={d.depot} className="inline-flex items-center gap-1.5">
          <span className="h-1 w-1 rounded-full bg-fg-muted/60" aria-hidden />
          {DEPOT_LABEL[d.depot] ?? d.depot}
          <b className="tabular font-semibold text-fg-secondary">{d.count.toLocaleString("es-AR")}</b>
        </span>
      ))}
    </div>
  );
}
