import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { PoStatusBadge } from "@/components/compras/PoStatusBadge";
import { Sparkline } from "@/components/compras/charts/Sparkline";
import { AmbaMap } from "@/components/ejecutivo/AmbaMap";
import { getCockpitData, type ActivityFeedItem } from "@/lib/ejecutivo/data";
import { fmtCurrency, truncate } from "@/lib/compras/format";
import { ORG, PRODUCT } from "@/lib/org";

export const metadata = { title: "Cockpit ejecutivo" };
export const dynamic = "force-dynamic";

export default async function CockpitPage() {
  const data = await getCockpitData();

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6">
      {/* Hero */}
      <section className="card overflow-hidden relative">
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
            <h1 className="page-title">Buen día, José Luis.</h1>
            <p className="page-subtitle max-w-xl">
              Cockpit corporativo · {ORG.legalName} desde {ORG.since}. Operaciones 3PL en{" "}
              {data.locations.length} locaciones · 15.000 m² · ANMAT vigente.
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

      {/* KPI Grid */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {data.kpis.map((k, i) => (
          <div key={i} className={`card kpi card-lift relative overflow-hidden ${k.featured ? "featured-stroke" : ""}`}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">{k.value}</div>
            {k.delta && (
              <div className={`kpi-delta ${k.delta.startsWith("-") ? "down" : "up"}`}>
                <Icon name={k.delta.startsWith("-") ? "trend-down" : "trend-up"} size={12} />
                {k.delta}
                <span className="vs">vs. mes ant.</span>
              </div>
            )}
            {k.trend && (
              <div className="absolute bottom-3 right-3">
                <Sparkline data={k.trend} color={k.featured ? "#C90812" : "#214576"} />
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Grid principal: Mapa + Locations + Activity */}
      <section className="grid gap-6" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}>
        {/* Mapa + ocupación */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-fg-primary">Mapa operativo · CABA</div>
              <div className="text-[11px] text-fg-secondary mt-0.5">
                {data.locations.length} sedes operativas · monitoreo Verisure 24/7
              </div>
            </div>
            <Link href="/operaciones/mapa" className="text-xs font-bold text-fg-link hover:underline">
              Ver mapa completo →
            </Link>
          </div>
          <div className="p-5">
            <AmbaMap locations={data.locations} />
          </div>
          <div className="border-t border-stroke-soft divide-y divide-stroke-soft">
            {data.locations.map((loc) => (
              <div key={loc.id} className="px-5 py-3 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)] flex-shrink-0" />
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
                  <div className="text-sm font-bold text-fg-brand tabular">{loc.occupancyPct}%</div>
                  <div className="text-[10px] text-fg-muted tabular">
                    {loc.m2.toLocaleString("es-AR")} m² · {loc.activeOps} ops
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity feed cross-module */}
        <div className="card overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-stroke-soft">
            <div className="text-sm font-bold text-fg-primary">Actividad reciente</div>
            <div className="text-[11px] text-fg-secondary mt-0.5">
              Eventos cross-módulo en tiempo real
            </div>
          </div>
          <ol className="flex-1 divide-y divide-stroke-soft overflow-y-auto" style={{ maxHeight: 520 }}>
            {data.activity.map((ev, i) => (
              <ActivityRow key={i} item={ev} />
            ))}
          </ol>
        </div>
      </section>

      {/* Quick links a módulos */}
      <section>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-muted mb-3">
          Módulos operativos
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <ModuleCard
            href="/compras"
            icon="cart"
            title="Compras"
            sub="OC a proveedores"
            stat={`${data.recentOrders.length} OC mes`}
          />
          <ModuleCard
            href="/dashboard"
            icon="orders"
            title="Servicios"
            sub="OS a clientes"
            stat="324 OS · 97% firma"
          />
          <ModuleCard
            href="/cctv"
            icon="eye"
            title="CCTV"
            sub="Hikvision · Verisure"
            stat="14 cámaras · uptime 99,8%"
            tag="LIVE"
          />
          <ModuleCard
            href="/anmat"
            icon="shield"
            title="ANMAT"
            sub="Compliance & RNE"
            stat="RNE vigente · 0 obs."
          />
          <ModuleCard
            href="/documental"
            icon="file-pdf"
            title="Documental"
            sub="Contratos · remitos · OC"
            stat="2.847 docs · SHA-256"
          />
          <ModuleCard
            href="/clients"
            icon="clients"
            title="Comercial"
            sub="CRM · Clientify"
            stat="42 clientes activos"
          />
          <ModuleCard
            href="/compras/drive"
            icon="drive"
            title="Drive sync"
            sub="Google Workspace"
            stat="324 OC · 19,8 MB"
          />
          <ModuleCard
            href="/reports"
            icon="report"
            title="Analytics"
            sub="KPIs corporativos"
            stat="6 reportes · realtime"
          />
        </div>
      </section>

      {/* Recent OC quick view */}
      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-fg-primary">Últimas OC firmadas</div>
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
              className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50 transition-colors"
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
    <li className="px-5 py-3 flex items-start gap-3 hover:bg-neutral-50 transition-colors">
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
  stat,
  tag,
}: {
  href: string;
  icon: IconName;
  title: string;
  sub: string;
  stat: string;
  tag?: string;
}) {
  return (
    <Link
      href={href}
      className="card card-lift p-4 relative overflow-hidden group"
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
      <div className="text-[11px] text-fg-muted mb-2">{sub}</div>
      <div className="text-[11px] font-bold text-fg-brand tabular">{stat}</div>
    </Link>
  );
}
