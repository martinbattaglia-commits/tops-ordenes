import Link from "next/link";
import { Icon } from "@/components/Icon";
import { CountUp } from "@/components/CountUp";
import { PoStatusBadge } from "@/components/compras/PoStatusBadge";
import { SpendChart } from "@/components/compras/charts/SpendChart";
import { CategoryDonut } from "@/components/compras/charts/CategoryDonut";
import { Sparkline } from "@/components/compras/charts/Sparkline";
import { getDashboardKpis } from "@/lib/compras/data";
import { fmtCurrency, fmtCurrencyShort, fmtRel, truncate } from "@/lib/compras/format";

export const metadata = { title: "Compras · Dashboard" };
export const dynamic = "force-dynamic";

export default async function ComprasDashboardPage() {
  const k = await getDashboardKpis();

  return (
    <div className="p-4 md:p-7 lg:p-8 nx-page-fade">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Compras inteligentes · 2026</div>
          <h1 className="page-title">Buen día, José Luis.</h1>
          <p className="page-subtitle">
            {k.ocThisMonth} órdenes de compra emitidas este mes ·{" "}
            {fmtCurrencyShort(k.spendThisMonth)} comprometidos.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/compras/ordenes" className="btn btn-ghost btn-sm">
            <Icon name="export" size={14} />
            <span className="hidden sm:inline">Exportar mes</span>
          </Link>
          <Link href="/compras/nueva" className="btn btn-danger btn-sm">
            <Icon name="plus" size={14} stroke={2.2} />
            <span>Nueva OC</span>
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Kpi
          label="OC emitidas mes"
          value={String(k.ocThisMonth)}
          delta={k.ocDelta}
          spark={[3, 5, 4, 7, 9, 8, 11]}
          index={0}
        />
        <Kpi
          label="Monto comprometido"
          value={fmtCurrencyShort(k.spendThisMonth)}
          delta={k.spendDelta}
          featured
          spark={[8, 10, 7, 12, 14, 18, 16]}
          index={1}
        />
        <Kpi
          label="% conciliadas"
          value={`${k.reconciledPct}%`}
          delta={k.reconciledDelta}
          spark={[60, 64, 68, 72, 78, 81, 84]}
          index={2}
        />
        <Kpi
          label="% firmadas en el día"
          value={`${k.signaturePct}%`}
          delta={k.signatureDelta}
          spark={[80, 85, 90, 92, 94, 96, 97]}
          index={3}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }}>
        <div className="nx-surface card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-stroke-soft">
            <div>
              <div className="text-sm font-bold text-fg-primary">Gasto últimos 6 meses</div>
              <div className="text-[11px] text-fg-secondary mt-0.5">
                Emitidas vs. conciliadas contra factura
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-semibold">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#050555" }} />
                Emitidas
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#C90812" }} />
                Conciliadas
              </span>
            </div>
          </div>
          <div className="p-5">
            <SpendChart
              months={k.serie6m.months}
              emitidas={k.serie6m.emitidas}
              conciliadas={k.serie6m.conciliadas}
            />
          </div>
        </div>

        <div className="nx-surface card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-stroke-soft">
            <div>
              <div className="text-sm font-bold text-fg-primary">Mix de categorías</div>
              <div className="text-[11px] text-fg-secondary mt-0.5">YTD por categoría</div>
            </div>
          </div>
          <div className="p-5">
            <CategoryDonut data={k.categoryMix} totalValue={k.spendThisMonth} />
          </div>
        </div>
      </div>

      {/* Bottom */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }}>
        <RecentOrdersCard rows={k.recentOrders} />
        <AlertsCard />
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  delta,
  featured,
  spark,
  index = 0,
}: {
  label: string;
  value: string;
  delta: string;
  featured?: boolean;
  spark?: number[];
  index?: number;
}) {
  const up = !delta.startsWith("-");
  return (
    <div
      style={{ animationDelay: `${index * 45}ms` }}
      className={`nx-surface nx-stagger card kpi ${featured ? "featured-stroke" : ""} relative overflow-hidden`}
    >
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {/^\d+$/.test(value) ? <CountUp to={Number(value)} format="int" /> : value}
      </div>
      <div className={`kpi-delta ${up ? "up" : "down"}`}>
        <Icon name={up ? "trend-up" : "trend-down"} size={12} />
        {delta}
        <span className="vs">vs. mes ant.</span>
      </div>
      {spark && (
        <div className="absolute bottom-3 right-3 opacity-90">
          <Sparkline data={spark} color={featured ? "#C90812" : "#214576"} />
        </div>
      )}
    </div>
  );
}

function RecentOrdersCard({ rows }: { rows: Awaited<ReturnType<typeof getDashboardKpis>>["recentOrders"] }) {
  return (
    <div className="nx-surface card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-stroke-soft">
        <div>
          <div className="text-sm font-bold text-fg-primary">Últimas órdenes de compra</div>
          <div className="text-[11px] text-fg-secondary mt-0.5">Top 6 más recientes</div>
        </div>
        <Link href="/compras/ordenes" className="text-xs font-bold text-fg-link hover:underline">
          Ver todas →
        </Link>
      </div>
      <div className="divide-y divide-stroke-soft">
        {rows.map((o) => (
          <Link
            key={o.id}
            href={`/compras/ordenes/${o.public_id}`}
            className="nx-row flex items-center gap-3 px-5 py-3"
          >
            <div className="font-mono text-[11px] text-fg-muted w-28 flex-shrink-0">{o.public_id}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-fg-primary truncate">
                {truncate(o.vendor?.razon ?? "—", 32)}
              </div>
              <div className="text-[11px] text-fg-muted font-mono">{o.vendor?.cuit}</div>
            </div>
            <div className="hidden md:block text-[11px] text-fg-secondary w-32 truncate">
              {o.vendor?.categoria ?? "—"}
            </div>
            <div className="text-right text-sm tabular font-bold text-fg-brand w-28">
              {fmtCurrency(o.total)}
            </div>
            <PoStatusBadge status={o.status} className="hidden sm:inline-flex" />
            <Icon name="chevron-right" size={14} className="text-fg-muted hidden md:block" />
          </Link>
        ))}
      </div>
    </div>
  );
}

function AlertsCard() {
  const alerts = [
    {
      kind: "warn" as const,
      icon: "wallet" as const,
      title: "Factura faltante",
      detail: "OC-2026-0339 sin remito hace 14 d.",
      count: "14d",
    },
    {
      kind: "info" as const,
      icon: "pen" as const,
      title: "Pendientes de firma",
      detail: "2 OC en cola del Director",
      count: "2",
    },
    {
      kind: "danger" as const,
      icon: "bolt" as const,
      title: "Diferencia vs factura",
      detail: "OC-2026-0331 difiere $ 18.420",
      count: "$",
    },
    {
      kind: "ok" as const,
      icon: "cloud-check" as const,
      title: "Drive sync",
      detail: "324 OC sincronizadas",
      count: "OK",
    },
  ];
  const colors: Record<string, string> = {
    warn: "bg-status-warning/10 text-status-warning",
    info: "bg-tops-blue-700/10 text-tops-blue-700",
    danger: "bg-tops-red/10 text-tops-red",
    ok: "bg-status-success/10 text-status-success",
  };
  return (
    <div className="nx-surface card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-stroke-soft">
        <div>
          <div className="text-sm font-bold text-fg-primary">Alertas</div>
          <div className="text-[11px] text-fg-secondary mt-0.5">Accionables esta semana</div>
        </div>
      </div>
      <ul className="divide-y divide-stroke-soft">
        {alerts.map((a, i) => (
          <li key={i} className="flex items-center gap-3 px-5 py-3">
            <div className={`w-9 h-9 rounded-lg grid place-items-center ${colors[a.kind]}`}>
              <Icon name={a.icon} size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-fg-primary">{a.title}</div>
              <div className="text-[11px] text-fg-muted">{a.detail}</div>
            </div>
            <span className="text-[11px] font-bold text-fg-muted tabular">{a.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// helper para silenciar unused
void fmtRel;
