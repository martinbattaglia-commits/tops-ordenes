import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { Icon, type IconName } from "@/components/Icon";
import { CountUp } from "@/components/CountUp";
import { getCommandCenter, type SystemState, type HealthLevel, type CriticalAlert, type ExecKpi } from "@/lib/ejecutivo/command-center";
import { canViewExecutiveFinancialBlocks } from "@/lib/rbac/cockpit-visibility";
import { getBootContext } from "@/lib/rbac/boot-permissions";
import { env } from "@/lib/env";
import { ws } from "@/lib/google/workspace";
import { getAnnouncements, type Announcement } from "@/lib/ejecutivo/announcements";
import { CollabCard } from "./_components/CollabCard";
import { ORG, PRODUCT } from "@/lib/org";

export const metadata = { title: "Cockpit ejecutivo" };
export const dynamic = "force-dynamic";

// ── Bienvenida contextual ─────────────────────────────────────────────────
// Saludo según el momento del día. La hora se calcula SIEMPRE en zona horaria
// de Argentina (no la del servidor SSR, que corre en UTC), para que el saludo
// sea correcto. Bloque 100% server-side: sin estado de cliente ni mismatch de
// hidratación.
type Daypart = "manana" | "tarde" | "noche";

const GREETINGS: Record<Daypart, { hi: string; wish: string; icon: IconName }> = {
  manana: { hi: "Buenos días", wish: "Te deseamos una excelente jornada.", icon: "sun" },
  tarde: { hi: "Buenas tardes", wish: "Que tengas una gran jornada de trabajo.", icon: "sun" },
  noche: { hi: "Buenas noches", wish: "Esperamos que tengas una excelente noche.", icon: "moon" },
};

function buenosAiresHour(): number {
  return Number(
    new Intl.DateTimeFormat("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date())
  );
}

function daypartFor(hour: number): Daypart {
  if (hour >= 6 && hour < 13) return "manana";
  if (hour >= 13 && hour < 20) return "tarde";
  return "noche";
}

function fechaLargaAr(): string {
  const s = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function firstNameOf(user: User | null): string {
  // Espeja la resolución del layout (full_name → name → local-part del email),
  // quedándose con el primer nombre para un saludo cálido.
  if (env.app.demoMode || !user) return "Ruth";
  const meta = (user.user_metadata ?? {}) as Record<string, string | undefined>;
  const full = meta.full_name || meta.name || user.email?.split("@")[0] || "Usuario";
  return full.trim().split(/\s+/)[0];
}

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
  // getBootContext está cacheado por request (lo resuelve el layout): reutilizarlo
  // para el saludo no agrega round trips.
  const [cc, canExec, boot, announcements] = await Promise.all([
    getCommandCenter(),
    canViewExecutiveFinancialBlocks(),
    getBootContext(),
    getAnnouncements(),
  ]);
  // Visibilidad condicional (mismo Cockpit, sin split): se ocultan bloques
  // financieros/ejecutivos a quien no tenga permiso ejecutivo.
  const modules = MODULES.filter((m) => m.enabled !== false && (canExec || !m.exec));
  const kpis = canExec ? cc.kpis : cc.kpis.filter((k) => !k.exec);
  const firstName = firstNameOf(boot.user);
  const daypart = daypartFor(buenosAiresHour());

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6 nx-page-fade max-w-[1400px] mx-auto">
      {/* BLOQUE 0 — Bienvenida contextual (saludo cálido al aterrizar) */}
      <WelcomeBanner firstName={firstName} part={daypart} dateLabel={fechaLargaAr()} />

      {/* Título de página — sólo accesibilidad/SEO. El liderazgo visual lo toman
          la bienvenida y el Command Center; el header presidencial se retiró. */}
      <h1 className="sr-only">Estado de la compañía · {ORG.legalName} · {PRODUCT.name}</h1>

      {/* BLOQUE 0B — Centro de comunicaciones corporativas (Command Center) */}
      <CommandCenterBanner announcements={announcements} />

      {/* BLOQUE 1 + 1A — Estado General TOPS + Salud Corporativa */}
      <EstadoGeneral cc={cc} />

      {/* BLOQUE 1B — Centro de Alertas Críticas (no se renderiza si no hay alertas) */}
      {cc.alerts.length > 0 && <AlertasCriticas alerts={cc.alerts} />}

      {/* BLOQUE 1C — Accesos rápidos (Mail · Calendario · Drive · Compliance) */}
      <QuickAccessRow />

      {/* BLOQUE 1D — Colaboración (F4.3, read-only): incidentes + tareas + workflows.
          Solo con permiso connect; se auto-oculta si las fuentes no responden. */}
      {boot.perms.connect && <CollabCard />}

      {/* BLOQUE 2 — KPIs Ejecutivos (FILA 1 financiero+operativo · FILA 2 ocupación).
          Responsive: 1 col mobile · 2 col tablet · 4 col desktop. */}
      <section className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {kpis.map((k, i) => (
            <KpiCard key={k.label} kpi={k} index={i} />
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

function WelcomeBanner({ firstName, part, dateLabel }: { firstName: string; part: Daypart; dateLabel: string }) {
  const g = GREETINGS[part];
  return (
    <section className="nx-surface card relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(120% 140% at 0% 0%, rgba(33,69,118,0.16), transparent 55%)" }}
      />
      <div className="relative p-5 md:p-6 flex items-center gap-4 md:gap-5">
        <span className="hidden sm:grid place-items-center w-12 h-12 md:w-14 md:h-14 rounded-xl bg-tops-blue-900 text-white shrink-0 shadow-sm ring-1 ring-white/10">
          <Icon name={g.icon} size={24} />
        </span>
        <div className="min-w-0">
          <h2 className="text-2xl md:text-3xl font-black text-fg-primary leading-tight">
            {g.hi}, {firstName}.
          </h2>
          <p className="text-sm md:text-[15px] text-fg-secondary mt-1.5">
            Bienvenido a <span className="font-bold text-fg-primary">{PRODUCT.name}</span>.
          </p>
          <p className="text-sm text-fg-muted mt-0.5">{g.wish}</p>
        </div>
        <div className="ml-auto self-start hidden md:flex flex-col items-end text-right shrink-0">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-fg-muted">{PRODUCT.edition}</span>
          <span className="text-sm font-semibold text-fg-secondary mt-1">{dateLabel}</span>
        </div>
      </div>
    </section>
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

// ── Command Center — Centro de comunicaciones corporativas (BLOQUE 0B) ────────
// Banner premium (fondo oscuro + acento ámbar corporativo) que consolida los
// comunicados activos. El primero (mayor prioridad) se destaca como bloque
// principal; el resto se listan en celdas separadas. Datos: getAnnouncements()
// — hoy curados en código, mañana gestionables desde Supabase sin tocar la UI.
function CommandCenterBanner({ announcements }: { announcements: Announcement[] }) {
  if (announcements.length === 0) return null;
  const [lead, ...rest] = announcements;
  return (
    <section className="space-y-2">
      <div className="eyebrow-tiny text-tops-red">{PRODUCT.name} · Command Center</div>
      <div
        className="card relative overflow-hidden ring-1 ring-amber-400/45"
        style={{ background: "linear-gradient(180deg, rgba(8,11,20,0.97), rgba(8,11,20,0.86))" }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(120% 140% at 0% 0%, rgba(245,180,30,0.12), transparent 60%)" }}
        />
        <div className="relative p-4 md:p-5 flex flex-col lg:flex-row lg:items-stretch gap-4">
          {/* Comunicado destacado */}
          <div className="flex items-center gap-3 shrink-0 lg:min-w-[260px] lg:max-w-[330px] lg:pr-5">
            <span className="grid place-items-center w-11 h-11 rounded-xl bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30 shrink-0">
              <Icon name={lead.icon} size={22} />
            </span>
            <div className="min-w-0">
              <div className="text-lg md:text-xl font-black uppercase tracking-tight text-amber-300 leading-none">
                {lead.title}
              </div>
              <div className="mt-1 text-[11px] md:text-xs font-bold uppercase tracking-[0.14em] text-white/80">
                {lead.description}
              </div>
            </div>
          </div>

          {/* Resto de comunicados */}
          {rest.length > 0 && (
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-0 lg:divide-x lg:divide-white/10 lg:border-l lg:border-white/10">
              {rest.map((a) => (
                <div key={a.id} className="flex items-start gap-2.5 lg:px-4">
                  <Icon name={a.icon} size={16} className="mt-0.5 shrink-0 text-amber-300/90" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-white">{a.title}</div>
                    <div className="text-[11px] leading-snug text-white/65">{a.description}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Icon name="chevron-right" size={18} className="hidden lg:block self-center shrink-0 text-white/40" />
        </div>
      </div>
    </section>
  );
}

// ── Accesos rápidos (BLOQUE 1C) ───────────────────────────────────────────────
// Cuatro destinos de productividad, mismo ancho. Mail/Calendario/Drive abren el
// Workspace corporativo en pestaña nueva (helper ws()); Compliance navega al
// módulo ANMAT interno. Estética y motion: tiles nx (igual a Módulos).
type QuickAccess = { title: string; sub: string; icon: IconName; href: string; external?: boolean };

const QUICK_ACCESS: QuickAccess[] = [
  { title: "Mail", sub: "Correo electrónico", icon: "mail", href: ws("mail"), external: true },
  { title: "Calendario", sub: "Agenda y eventos", icon: "calendar", href: ws("calendar"), external: true },
  { title: "Drive", sub: "Documentos y archivos", icon: "drive", href: ws("drive"), external: true },
  { title: "Compliance", sub: "Normativas y políticas", icon: "shield", href: "/anmat" },
];

function QuickAccessRow() {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      {QUICK_ACCESS.map((q, i) => (
        <QuickAccessCard key={q.title} item={q} index={i} />
      ))}
    </section>
  );
}

function QuickAccessCard({ item, index }: { item: QuickAccess; index: number }) {
  const cls =
    "nx-interactive nx-stagger card p-4 relative overflow-hidden group flex flex-col cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700";
  const style = { animationDelay: `${index * 40}ms` };
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="w-10 h-10 rounded-md bg-tops-blue-900 text-white grid place-items-center group-hover:bg-tops-blue-700 transition-colors">
          <Icon name={item.icon} size={18} />
        </span>
        <Icon
          name="arrow-right"
          size={16}
          className="flex-shrink-0 text-fg-muted opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0"
        />
      </div>
      <div className="mt-2.5 text-sm font-bold uppercase tracking-wide text-fg-primary">{item.title}</div>
      <div className="text-[11px] text-fg-muted">{item.sub}</div>
    </>
  );
  return item.external ? (
    <a href={item.href} target="_blank" rel="noopener noreferrer" className={cls} style={style} title={`Abrir ${item.title}`}>
      {body}
    </a>
  ) : (
    <Link href={item.href} className={cls} style={style} title={`Abrir ${item.title}`}>
      {body}
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
          <div className="kpi-value" style={kpi.tone ? { color: kpi.tone } : undefined}>
            {numeric ? <CountUp to={Number(kpi.value)} format="int" /> : kpi.value}
          </div>
          {kpi.sub && <div className="text-[10px] font-semibold text-fg-muted mt-1 uppercase tracking-wide">{kpi.sub}</div>}
          {typeof kpi.progress === "number" && (
            <div className="mt-2 h-1.5 rounded-full bg-bg-surface-alt overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, kpi.progress))}%`, background: kpi.tone ?? "#16a34a" }}
              />
            </div>
          )}
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
