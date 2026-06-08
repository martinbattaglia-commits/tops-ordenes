import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { CountUp } from "@/components/CountUp";
import { PoStatusBadge } from "@/components/compras/PoStatusBadge";
import { AmbaMap } from "@/components/ejecutivo/AmbaMap";
import { TodayStrip } from "@/components/ejecutivo/TodayStrip";
import { getCockpitData, type ActivityFeedItem, type CockpitKpi } from "@/lib/ejecutivo/data";
import { fmtCurrency, truncate } from "@/lib/compras/format";
import { ORG, PRODUCT } from "@/lib/org";

export const metadata = { title: "Cockpit ejecutivo" };
export const dynamic = "force-dynamic";

export default async function CockpitPage() {
  const data = await getCockpitData();
  const totalM2 = data.locations.reduce((a, l) => a + l.m2, 0);

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6 nx-page-fade">
      {/* Hero */}
      <section className="nx-surface card overflow-hidden relative">
        <div
          className="absolute inset-0 pointer-events-none opacity-90"
          style={{
            background:
              "radial-gradient(ellipse at top right, rgba(201,8,18,0.08), transparent 60%), radial-gradient(ellipse at bottom left, rgba(33,69,118,0.12), transparent 60%)",
          }}
        />
        <div className="relative p-6 md:p-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="eyebrow-tiny">
              {PRODUCT.name} · {PRODUCT.shortTagline}
            </div>
            <h1 className="page-title">Buen día.</h1>
            <p className="page-subtitle max-w-xl">
              Cockpit corporativo · {ORG.legalName} desde {ORG.since}. Operaciones 3PL en{" "}
              {data.locations.length} locaciones · {totalM2.toLocaleString("es-AR")} m² de huella.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/compras/nueva" className="btn btn-danger btn-sm">
              <Icon name="plus" size={14} stroke={2.2} />
              <span>Nueva OC</span>
            </Link>
            <Link href="/orders/new" className="btn btn-primary btn-sm">
              <Icon name="plus" size={14} stroke={2.2} />
              <span>Nueva OS</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Información del día — contexto ejecutivo (fecha/hora/clima) */}
      <TodayStrip />

      {/* KPI Grid */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {data.kpis.map((k, i) => (
          <KpiCard key={i} kpi={k} index={i} />
        ))}
      </section>

      {/* Grid principal: Mapa + Locations + Activity */}
      <section className="grid gap-6" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}>
        {/* Mapa + ocupación */}
        <div className="nx-surface card overflow-hidden">
          <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-fg-primary">Mapa operativo · CABA</div>
              <div className="text-[11px] text-fg-secondary mt-0.5">
                {data.locations.length} sedes operativas
              </div>
            </div>
          </div>
          <div className="p-5">
            <AmbaMap locations={data.locations} />
          </div>
          <div className="border-t border-stroke-soft divide-y divide-stroke-soft">
            {data.locations.map((loc) => (
              <div key={loc.id} className="px-5 py-3 flex items-center gap-3">
                <span className="nx-live-dot flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-fg-primary">
                    {loc.name}{" "}
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wider ml-1 ${
                        loc.tag === "ANMAT" ? "text-tops-red" : "text-fg-muted"
                      }`}
                    >
                      {loc.tag}
                    </span>
                  </div>
                  <div className="text-[11px] text-fg-muted truncate">{loc.address}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-fg-brand tabular">
                    {loc.occupancyPct !== null ? `${loc.occupancyPct}%` : "—"}
                  </div>
                  <div className="text-[10px] text-fg-muted tabular">
                    {loc.m2.toLocaleString("es-AR")} m²
                    {loc.activeOps !== null && <> · {loc.activeOps} ops</>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-stroke-soft px-5 py-2.5 text-[10px] text-fg-muted text-center">
            Ocupación real-time y operaciones activas: pendientes de integración operativa.
          </div>
        </div>

        {/* Activity feed cross-module */}
        <div className="nx-surface card overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-stroke-soft">
            <div className="text-sm font-bold text-fg-primary">Actividad reciente</div>
            <div className="text-[11px] text-fg-secondary mt-0.5">
              Eventos cross-módulo en tiempo real
            </div>
          </div>
          {data.activity.length > 0 ? (
            <ol className="flex-1 divide-y divide-stroke-soft overflow-y-auto" style={{ maxHeight: 520 }}>
              {data.activity.map((ev, i) => (
                <ActivityRow key={i} item={ev} />
              ))}
            </ol>
          ) : (
            <div className="flex-1 p-6 flex flex-col items-center justify-center text-center">
              <Icon name="wand" size={24} className="text-fg-muted mb-2" />
              <div className="text-sm font-bold text-fg-primary">Sin actividad disponible</div>
              <div className="text-[11px] text-fg-secondary mt-1 max-w-xs">
                {data.activityPendingIntegration
                  ? "Pendiente de integración con el event log cross-módulo (planificado Fase 2)."
                  : "No hay eventos recientes."}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Quick links a módulos */}
      <section>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-muted mb-3">
          Módulos operativos
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <ModuleCard href="/compras" icon="cart" title="Compras" sub="OC a proveedores" index={0} />
          <ModuleCard href="/dashboard" icon="orders" title="Servicios" sub="OS a clientes" index={1} />
          <ModuleCard href="/cctv" icon="eye" title="CCTV" sub="Hikvision · Verisure" tag="LIVE" index={2} />
          <ModuleCard href="/anmat" icon="shield" title="ANMAT" sub="Compliance & RNE" index={3} />
          <ModuleCard href="/comercial/pipeline" icon="trend-up" title="Comercial" sub="CRM · Clientify" index={4} />
          <ModuleCard href="/compras/drive" icon="drive" title="Drive sync" sub="Google Workspace" index={5} />
          <ModuleCard href="/reports" icon="report" title="Analytics" sub="KPIs corporativos" index={6} />
        </div>
      </section>

      {/* Recent OC quick view */}
      {data.recentOrders.length > 0 && (
        <section className="nx-surface card overflow-hidden">
          <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-fg-primary">Últimas órdenes de compra</div>
              <div className="text-[11px] text-fg-secondary mt-0.5">Top 6 más recientes del módulo Compras</div>
            </div>
            <Link href="/compras/ordenes" className="text-xs font-bold text-fg-link hover:underline">
              Ver todas →
            </Link>
          </div>
          <div className="divide-y divide-stroke-soft">
            {data.recentOrders.map((o) => (
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
                <div className="text-right text-sm tabular font-bold text-fg-brand w-28">
                  {fmtCurrency(o.total)}
                </div>
                <PoStatusBadge status={o.status} className="hidden sm:inline-flex" />
                <Icon name="chevron-right" size={14} className="text-fg-muted hidden md:block" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function KpiCard({ kpi, index }: { kpi: CockpitKpi; index: number }) {
  const isPending = kpi.value === null;
  return (
    <div
      style={{ animationDelay: `${index * 45}ms` }}
      className={`nx-surface nx-stagger card kpi relative overflow-hidden ${kpi.featured ? "featured-stroke" : ""}`}
      title={kpi.pendingReason ?? undefined}
    >
      <div className="kpi-label">{kpi.label}</div>
      {isPending ? (
        <>
          <div className="kpi-value text-fg-muted text-xl">Dato no disponible</div>
          {kpi.pendingReason && (
            <div className="text-[10px] text-fg-muted mt-1.5 leading-tight">{kpi.pendingReason}</div>
          )}
        </>
      ) : (
        <>
          <div className="kpi-value">
            {kpi.value && /^\d+$/.test(kpi.value) ? (
              <CountUp to={Number(kpi.value)} format="int" />
            ) : (
              kpi.value
            )}
          </div>
          {kpi.delta && (
            <div className={`kpi-delta ${kpi.delta.startsWith("-") ? "down" : "up"}`}>
              <Icon name={kpi.delta.startsWith("-") ? "trend-down" : "trend-up"} size={12} />
              {kpi.delta}
              <span className="vs">vs. mes ant.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityFeedItem }) {
  const kindMeta: Record<ActivityFeedItem["kind"], { icon: IconName; color: string; bg: string }> = {
    oc_signed: { icon: "check-circle", color: "text-status-success", bg: "bg-status-success/10" },
    oc_created: { icon: "cart", color: "text-tops-blue-700", bg: "bg-tops-blue-700/10" },
    os_signed: { icon: "pen", color: "text-status-success", bg: "bg-status-success/10" },
    anmat_event: { icon: "shield", color: "text-tops-red", bg: "bg-tops-red/10" },
    cctv_event: { icon: "eye", color: "text-status-warning", bg: "bg-status-warning/10" },
    doc_uploaded: { icon: "file-pdf", color: "text-tops-blue-700", bg: "bg-tops-blue-700/10" },
  };
  const meta = kindMeta[item.kind];
  return (
    <li className="px-5 py-3 flex items-start gap-3">
      <div className={`w-8 h-8 rounded-md grid place-items-center flex-shrink-0 ${meta.bg} ${meta.color}`}>
        <Icon name={meta.icon} size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-fg-primary truncate">{item.title}</div>
        <div className="text-[11px] text-fg-secondary truncate">{item.detail}</div>
        <div className="text-[10px] text-fg-muted mt-0.5">
          {item.actor} · {item.ts}
        </div>
      </div>
    </li>
  );
}

function ModuleCard({
  href,
  icon,
  title,
  sub,
  tag,
  index = 0,
}: {
  href: string;
  icon: IconName;
  title: string;
  sub: string;
  tag?: string;
  index?: number;
}) {
  return (
    <Link
      href={href}
      style={{ animationDelay: `${index * 45}ms` }}
      className="nx-interactive nx-stagger card p-4 relative overflow-hidden group"
    >
      {tag && (
        <span className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider text-tops-red bg-tops-red/10 px-1.5 py-0.5 rounded">
          {tag}
        </span>
      )}
      <div className="w-10 h-10 rounded-md bg-tops-blue-900 text-white grid place-items-center mb-2.5 group-hover:bg-tops-blue-700 transition-colors">
        <Icon name={icon} size={18} />
      </div>
      <div className="text-sm font-bold text-fg-primary">{title}</div>
      <div className="text-[11px] text-fg-muted">{sub}</div>
    </Link>
  );
}
