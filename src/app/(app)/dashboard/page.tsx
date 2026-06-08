import Link from "next/link";
import { Icon } from "@/components/Icon";
import { StatusBadge } from "@/components/StatusBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import { DepotChart } from "@/components/charts/DepotChart";
import { ServiceMixDonut } from "@/components/charts/ServiceMixDonut";
import { RealtimeRefresher } from "@/components/RealtimeRefresher";
import { CountUp } from "@/components/CountUp";
import { OperationalStatus } from "@/components/dashboard/OperationalStatus";
import { getDashboardKpis, listRecentOrders } from "@/lib/data/orders";
import { monthName } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [kpis, recent] = await Promise.all([getDashboardKpis(), listRecentOrders(6)]);
  const now = new Date();
  const greeting = greetingFor(now);

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <RealtimeRefresher />
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Panel de control · {monthName(now)} {now.getFullYear()}</div>
          <h1 className="page-title">{greeting}.</h1>
          <p className="page-subtitle">
            {kpis.byDepot.reduce((a, b) => a + b.count, 0)} órdenes gestionadas. Magaldi y Luján operando.
          </p>
          <OperationalStatus byDepot={kpis.byDepot} />
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm">
            <Icon name="export" size={14} />
            <span className="hidden sm:inline">Exportar mes</span>
          </button>
          <Link href="/orders/new" className="btn btn-primary btn-sm nx-cta">
            <Icon name="plus" size={14} stroke={2.2} />
            <span>Nueva orden</span>
          </Link>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi index={0} label="Órdenes del mes" countTo={kpis.ordersThisMonth} countFormat="int" delta={kpis.ordersDelta} spark={[12,14,11,16,15,17,20,18,22,24,28,32]} href="/orders" />
        <Kpi index={1} label="Horas operativas" countTo={kpis.hours} countFormat="int" unit="hs" delta={kpis.hoursDelta} spark={[20,22,21,28,26,29,32,28,34,38,40,44]} />
        <Kpi index={2} label="Facturación proyectada" countTo={kpis.revenueProjection} countFormat="currency" delta={kpis.revenueDelta} spark={[10,12,14,16,18,21,24,28,30,34,38,42]} accent href="/orders" />
        <Kpi index={3} label="Firma digital" value={kpis.signatureRate.toFixed(1).replace(".", ",")} unit="%" delta={kpis.signatureDelta} spark={[88,89,90,91,92,93,94,95,96,96,97,97]} href="/orders?status=FIRMADA" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4 mt-4 nx-stagger" style={{ animationDelay: "160ms" }}>
        <DepotChart magaldi={kpis.series30d.magaldi} lujan={kpis.series30d.lujan} />
        <ServiceMixDonut items={kpis.serviceMix} total={kpis.ordersThisMonth} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4 mt-4 nx-stagger" style={{ animationDelay: "220ms" }}>
        {/* Últimas órdenes */}
        <div className="card nx-surface">
          <div className="flex items-end justify-between p-5 border-b border-stroke-soft">
            <div>
              <div className="text-base font-bold text-fg-brand">Últimas órdenes</div>
              <div className="text-xs text-fg-secondary mt-0.5">Generadas hoy en Magaldi y Luján</div>
            </div>
            <Link href="/orders" className="btn btn-ghost btn-sm">
              Ver todas <Icon name="arrow-right" size={12} stroke={2.2} />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Cliente</th>
                  <th>Depósito</th>
                  <th>Servicio</th>
                  <th className="text-right">Horas</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id} className="nx-row">
                    <td>
                      <Link href={`/orders/${o.public_id}`} className="order-num">
                        {o.public_id}
                      </Link>
                    </td>
                    <td className="cell-cliente">
                      {o.client?.razon ?? "—"}
                      <span className="cuit">{o.client?.cuit}</span>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <Icon name="building" size={13} className="text-fg-muted" />
                        {o.depot === "MAGALDI" ? "Magaldi" : "Luján"}
                      </span>
                    </td>
                    <td>
                      <span className="text-xs text-fg-secondary">
                        {o.services?.slice(0, 2).map((s) => s.label).join(" · ") ?? "—"}
                        {o.services && o.services.length > 2 && (
                          <span className="text-fg-muted"> +{o.services.length - 2}</span>
                        )}
                      </span>
                    </td>
                    <td className="text-right tabular font-semibold">{o.hours} hs</td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top clientes */}
        <div className="card nx-surface">
          <div className="p-5 border-b border-stroke-soft">
            <div className="text-base font-bold text-fg-brand">Clientes más activos</div>
            <div className="text-xs text-fg-secondary mt-0.5">Por órdenes en lo que va del mes</div>
          </div>
          <div className="px-5 py-3">
            {kpis.topClients.map((c, i) => (
              <div
                key={c.name + i}
                className={`py-3 ${i === kpis.topClients.length - 1 ? "" : "border-b border-stroke-soft"}`}
              >
                <div className="flex items-center gap-3 mb-1.5">
                  <div
                    className="w-7 h-7 rounded-md text-white grid place-items-center text-xs font-bold"
                    style={{ background: c.color }}
                  >
                    {c.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{c.name}</div>
                    <div className="text-[10px] uppercase tracking-[0.06em] text-fg-muted font-bold">
                      {c.tag}
                    </div>
                  </div>
                  <div className="text-sm font-bold text-fg-brand tabular">{c.orders}</div>
                </div>
                <div className="h-1 bg-neutral-100 rounded overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{ width: `${Math.min(100, c.pct * 3.5)}%`, background: c.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  countTo,
  countFormat,
  unit,
  delta,
  spark,
  accent,
  index = 0,
  href,
}: {
  label: string;
  value?: string;
  countTo?: number;
  countFormat?: "int" | "currency";
  unit?: string;
  delta?: string;
  spark?: number[];
  accent?: boolean;
  index?: number;
  href?: string;
}) {
  const up = delta?.startsWith("+");
  const card = (
    <div
      className={`card kpi nx-surface nx-stagger ${accent ? "featured-stroke" : ""} h-full`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {countTo != null && countFormat ? <CountUp to={countTo} format={countFormat} /> : value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {delta && (
        <div className={`kpi-delta ${up ? "up" : "down"}`}>
          <Icon name={up ? "trend-up" : "trend-down"} size={13} stroke={2} />
          {delta}
          <span className="vs">vs mes anterior</span>
        </div>
      )}
      {spark && spark.length > 0 && <Sparkline data={spark} color={accent ? "#C90812" : "#214576"} />}
    </div>
  );
  if (!href) return card;
  return (
    <Link href={href} title={`Ver detalle · ${label}`}
      className="nx-interactive block rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700">
      {card}
    </Link>
  );
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 12) return "Buen día";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}
