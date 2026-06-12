import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { CountUp } from "@/components/CountUp";
import { getCommandCenter, type SystemState, type HealthLevel, type CriticalAlert, type ExecKpi } from "@/lib/ejecutivo/command-center";
import { canViewExecutiveFinancialBlocks } from "@/lib/rbac/cockpit-visibility";
import { ORG, PRODUCT } from "@/lib/org";

export const metadata = { title: "Cockpit ejecutivo" };
export const dynamic = "force-dynamic";

const HEALTH_META: Record<HealthLevel, { dot: string; ring: string; text: string; label: string }> = {
  normal: { dot: "bg-status-success", ring: "ring-status-success/30", text: "text-status-success", label: "NORMAL" },
  atencion: { dot: "bg-status-warning", ring: "ring-status-warning/30", text: "text-status-warning", label: "ATENCIÓN" },
  critico: { dot: "bg-tops-red", ring: "ring-tops-red/30", text: "text-tops-red", label: "CRÍTICO" },
};

const STATUS_DOT: Record<SystemState["status"], string> = {
  operative: "bg-status-success",
  degraded: "bg-status-warning",
  offline: "bg-tops-red",
};

// KPIs financieros — sólo visibles con permiso ejecutivo (cockpit.view).
const FINANCIAL_KPI_LABELS = new Set(["Facturación del mes", "Cobranza pendiente"]);

// BLOQUE 3 — módulos estratégicos. RRHH se incorpora automáticamente seteando `enabled:true`
// (el grid auto-fluye; no requiere cambiar el layout).
const MODULES: { href: string; icon: IconName; title: string; sub: string; enabled?: boolean; exec?: boolean }[] = [
  { href: "/comercial/pipeline", icon: "trend-up", title: "Comercial", sub: "CRM · Clientify" },
  { href: "/compras", icon: "cart", title: "Compras", sub: "OC a proveedores" },
  { href: "/dashboard", icon: "orders", title: "Operaciones", sub: "OS · servicios" },
  { href: "/anmat", icon: "shield", title: "Compliance ANMAT", sub: "RNE · regulatorio" },
  { href: "/operaciones/tracking", icon: "truck", title: "Tracking", sub: "Flota en vivo" },
  { href: "/cctv", icon: "eye", title: "CCTV", sub: "Hikvision NVR" },
  { href: "/analytics", icon: "report", title: "Analytics", sub: "KPIs corporativos", exec: true },
  { href: "/drive", icon: "drive", title: "Drive Corporativo", sub: "Documental · Google" },
  // { href: "/rrhh", icon: "users", title: "RRHH", sub: "Recursos Humanos", enabled: true },
];

export default async function CockpitPage() {
  const [cc, canExec] = await Promise.all([getCommandCenter(), canViewExecutiveFinancialBlocks()]);
  // Visibilidad condicional (mismo Cockpit, sin split): se ocultan bloques
  // financieros/ejecutivos a quien no tenga permiso ejecutivo.
  const modules = MODULES.filter((m) => m.enabled !== false && (canExec || !m.exec));
  const kpis = canExec ? cc.kpis : cc.kpis.filter((k) => !FINANCIAL_KPI_LABELS.has(k.label));

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6 nx-page-fade max-w-[1400px] mx-auto">
      {/* Header presidencial — slim. Cockpit = monitoreo/análisis/supervisión:
          sin CTAs transaccionales (Nueva OC/OS viven en sus módulos). */}
      <header className="flex flex-col gap-1">
        <div className="eyebrow-tiny">{PRODUCT.name} · Command Center</div>
        <h1 className="page-title">Estado de la compañía</h1>
        <p className="page-subtitle">
          {ORG.legalName} · ahora mismo
        </p>
      </header>

      {/* BLOQUE 1 + 1A — Estado General TOPS + Salud Corporativa */}
      <EstadoGeneral cc={cc} />

      {/* BLOQUE 1B — Centro de Alertas Críticas (no se renderiza si no hay alertas) */}
      {cc.alerts.length > 0 && <AlertasCriticas alerts={cc.alerts} />}

      {/* BLOQUE 2 — KPIs Ejecutivos */}
      <section className="space-y-4">
        {/* KPI maestro (Cash Flow) — financiero: sólo con permiso ejecutivo */}
        {canExec && <MasterKpi master={cc.master} />}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {kpis.map((k, i) => (
            <KpiCard key={i} kpi={k} index={i} />
          ))}
        </div>
      </section>

      {/* BLOQUE 3 — Centro de Módulos Estratégicos */}
      <section>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-muted mb-3">
          Módulos estratégicos
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {modules.map((m, i) => (
            <ModuleCard key={m.href} {...m} index={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

function EstadoGeneral({ cc }: { cc: Awaited<ReturnType<typeof getCommandCenter>> }) {
  const h = HEALTH_META[cc.health];
  return (
    <section className={`nx-surface card overflow-hidden relative ring-1 ${h.ring}`}>
      <div className="p-5 md:p-7 flex flex-col lg:flex-row lg:items-center gap-6">
        {/* Indicador global (1A) */}
        <div className="flex items-center gap-4 lg:min-w-[300px]">
          <span className={`relative grid place-items-center w-16 h-16 rounded-full ${h.dot}/12`}>
            <span className={`w-9 h-9 rounded-full ${h.dot}`} />
            <span className={`absolute inset-0 rounded-full ring-4 ${h.ring} animate-pulse`} />
          </span>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-fg-muted">Salud corporativa</div>
            <div className={`text-2xl md:text-3xl font-black leading-tight ${h.text}`}>{h.label}</div>
            <div className="text-sm font-bold text-fg-primary mt-0.5">{cc.headline}</div>
          </div>
        </div>

        {/* Resumen + sistemas (1) */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-3xl md:text-4xl font-black text-fg-primary tabular">
              <CountUp to={cc.operativeCount} format="int" />/{cc.totalSystems}
            </span>
            <span className="text-sm font-bold text-fg-secondary">sistemas operativos</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
            {cc.systems.map((s) => (
              <Link
                key={s.id}
                href={s.href}
                title={`${s.detail} · Ir al módulo`}
                className="group flex items-center gap-2 min-w-0 rounded-md px-1.5 py-1 -mx-1.5 cursor-pointer transition-colors duration-200 hover:bg-fg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700/40"
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[s.status]} ${s.status !== "operative" ? "animate-pulse" : ""}`} />
                <span className={`text-[13px] font-semibold truncate ${s.status !== "operative" ? (s.critical ? "text-tops-red" : "text-status-warning") : "text-fg-primary"}`}>{s.label}</span>
                <Icon
                  name="chevron-right"
                  size={12}
                  className="flex-shrink-0 text-fg-muted opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0"
                />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AlertasCriticas({ alerts }: { alerts: CriticalAlert[] }) {
  return (
    <section className="nx-surface card overflow-hidden">
      <div className="px-5 py-3 border-b border-stroke-soft flex items-center gap-2">
        <Icon name="bell" size={15} className="text-tops-red" />
        <span className="text-sm font-bold text-fg-primary">Centro de alertas críticas</span>
        <span className="text-[11px] font-bold text-tops-red bg-tops-red/10 px-1.5 py-0.5 rounded ml-auto">
          {alerts.length}
        </span>
      </div>
      <ul className="divide-y divide-stroke-soft">
        {alerts.map((a) => (
          <li key={a.id}>
            <Link
              href={a.href}
              title="Ir al sistema de origen"
              className="group px-5 py-3 flex items-start gap-3 cursor-pointer transition-colors duration-200 hover:bg-fg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tops-blue-700/40"
            >
              <span
                className={`w-8 h-8 rounded-md grid place-items-center flex-shrink-0 ${
                  a.severity === "critical" ? "bg-tops-red/10 text-tops-red" : "bg-status-warning/10 text-status-warning"
                }`}
              >
                <Icon name="bell" size={14} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-fg-primary">{a.title}</div>
                <div className="text-[11px] text-fg-secondary">{a.detail}</div>
              </div>
              <Icon
                name="arrow-right"
                size={14}
                className="flex-shrink-0 self-center text-fg-muted opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MasterKpi({ master }: { master: { label: string; value: string | null; pendingReason?: string; href: string } }) {
  return (
    <Link
      href={master.href}
      title={`Ir a ${master.label}`}
      className="nx-interactive card featured-stroke relative overflow-hidden p-5 md:p-6 flex items-center justify-between gap-4 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700"
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-90"
        style={{ background: "radial-gradient(ellipse at right, rgba(33,69,118,0.10), transparent 65%)" }}
      />
      <div className="relative">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-muted">Resultado operativo</div>
        <div className="text-sm font-bold text-fg-secondary">{master.label}</div>
      </div>
      <div className="relative text-right flex items-center gap-3">
        {master.value !== null ? (
          <div className="text-3xl md:text-4xl font-black text-fg-brand tabular">{master.value}</div>
        ) : (
          <div>
            <div className="text-xl font-black text-fg-muted">Dato no disponible</div>
            {master.pendingReason && <div className="text-[10px] text-fg-muted mt-1">{master.pendingReason}</div>}
          </div>
        )}
        <Icon
          name="arrow-right"
          size={16}
          className="flex-shrink-0 text-fg-muted opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0"
        />
      </div>
    </Link>
  );
}

function KpiCard({ kpi, index }: { kpi: ExecKpi; index: number }) {
  const pending = kpi.value === null;
  const numeric = kpi.value && /^\d+$/.test(kpi.value);
  return (
    <Link
      href={kpi.href}
      style={{ animationDelay: `${index * 40}ms` }}
      className="nx-interactive nx-stagger card kpi relative overflow-hidden block cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700"
      title={kpi.pendingReason ?? `Ir a ${kpi.label}`}
    >
      <div className="kpi-label">{kpi.label}</div>
      {pending ? (
        <>
          <div className="kpi-value text-fg-muted text-lg">Dato no disponible</div>
          {kpi.pendingReason && <div className="text-[10px] text-fg-muted mt-1.5 leading-tight">{kpi.pendingReason}</div>}
        </>
      ) : (
        <>
          <div className="kpi-value">{numeric ? <CountUp to={Number(kpi.value)} format="int" /> : kpi.value}</div>
          {kpi.sub && <div className="text-[10px] font-semibold text-fg-muted mt-1 uppercase tracking-wide">{kpi.sub}</div>}
        </>
      )}
    </Link>
  );
}

function ModuleCard({ href, icon, title, sub, index = 0 }: { href: string; icon: IconName; title: string; sub: string; index?: number }) {
  return (
    <Link
      href={href}
      style={{ animationDelay: `${index * 40}ms` }}
      className="nx-interactive nx-stagger card p-4 relative overflow-hidden group flex flex-col"
    >
      <div className="w-10 h-10 rounded-md bg-tops-blue-900 text-white grid place-items-center mb-2.5 group-hover:bg-tops-blue-700 transition-colors">
        <Icon name={icon} size={18} />
      </div>
      <div className="text-sm font-bold text-fg-primary">{title}</div>
      <div className="text-[11px] text-fg-muted">{sub}</div>
    </Link>
  );
}
