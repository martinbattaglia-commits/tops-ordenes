import { Icon } from "@/components/Icon";
import { ORG, PRODUCT } from "@/lib/org";
import {
  ORGCHART_META,
  ASAMBLEA,
  PRESIDENTE,
  VICEPRESIDENTE,
  DIRECTOR,
  GERENCIA,
  AREAS,
  ENCARGADOS_OPERATIVOS,
  ASESORES_EXTERNOS,
  ORG_LEGEND,
  type OrgNode,
  type OrgTier,
  type RbacHint,
} from "@/lib/orgchart";

export const metadata = { title: "Organigrama institucional" };

/** Estilo de borde/acento por nivel jerárquico (theme-aware). */
const TIER_ACCENT: Record<OrgTier, string> = {
  asamblea: "border-l-amber-400",
  direccion: "border-l-tops-blue-900",
  gerencia: "border-l-blue-500",
  area: "border-l-cyan-500",
  encargado: "border-l-indigo-400",
  personal: "border-l-slate-400",
  externo: "border-l-transparent border border-dashed border-stroke-soft",
};

const TIER_DOT: Record<OrgTier, string> = {
  asamblea: "bg-amber-400",
  direccion: "bg-tops-blue-900",
  gerencia: "bg-blue-500",
  area: "bg-cyan-500",
  encargado: "bg-indigo-400",
  personal: "bg-slate-400",
  externo: "bg-fg-secondary",
};

function Initials({ name }: { name: string }) {
  const initials = name
    .replace(/^(Dra?\.|Cra?\.|Ing\.)\s*/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div className="w-9 h-9 shrink-0 rounded-full bg-tops-blue-900 text-white grid place-items-center text-[11px] font-bold">
      {initials}
    </div>
  );
}

function RbacBadge({ rbac }: { rbac: RbacHint }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border " +
        (rbac.decided
          ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
          : "text-fg-secondary bg-fg-secondary/10 border-stroke-soft")
      }
      title={
        rbac.decided
          ? `Rol RBAC asignado: ${rbac.slug}`
          : `Rol RBAC sugerido por cargo (pendiente de confirmación): ${rbac.slug}`
      }
    >
      <Icon name="shield" size={9} />
      {rbac.slug}
      {!rbac.decided && <span className="opacity-70">?</span>}
    </span>
  );
}

function PersonCard({ node, className }: { node: OrgNode; className?: string }) {
  return (
    <div
      className={
        "card border-l-4 " + TIER_ACCENT[node.tier] + " p-3 flex items-start gap-3 " + (className ?? "")
      }
    >
      <Initials name={node.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-bold text-fg-primary leading-tight">{node.name}</span>
          {node.equity && (
            <span className="text-[11px] font-black text-tops-red tabular-nums">{node.equity}</span>
          )}
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-secondary mt-0.5 leading-tight">
          {node.title}
        </div>
        {node.detail && <div className="text-[11px] text-fg-secondary mt-1 leading-snug">{node.detail}</div>}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {node.email && (
            <span className="inline-flex items-center gap-1 text-[10px] text-fg-link font-medium">
              <Icon name="mail" size={10} />
              {node.email}
            </span>
          )}
          {node.rbac && <RbacBadge rbac={node.rbac} />}
        </div>
      </div>
    </div>
  );
}

function TeamChips({ label, members }: { label: string; members: string[] }) {
  return (
    <div className="mt-2 pl-3 border-l border-stroke-soft">
      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-fg-secondary mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => (
          <span
            key={m}
            className="text-[11px] text-fg-primary bg-bg-surface border border-stroke-soft rounded px-2 py-0.5"
          >
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="eyebrow-tiny">{eyebrow}</div>
      <h2 className="text-lg font-black text-fg-primary tracking-tight">{title}</h2>
    </div>
  );
}

export default function OrganigramaPage() {
  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-8">
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
              {PRODUCT.name} · Documento institucional
            </div>
            <h1 className="page-title">Organigrama institucional</h1>
            <p className="page-subtitle max-w-2xl">
              {ORGCHART_META.legalName} · {ORG.brand} — Edición {ORGCHART_META.edition}. Estructura
              vigente y jerarquía de reporte. {ORGCHART_META.igj} · CUIT {ORGCHART_META.cuit}.
            </p>
            <div className="text-[11px] text-fg-secondary mt-2">
              Actualizado: {ORGCHART_META.updatedAt}
            </div>
          </div>
          <a
            href={ORGCHART_META.pdfPath}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-sm shrink-0"
          >
            <Icon name="download" size={14} stroke={2.2} />
            <span>PDF oficial</span>
          </a>
        </div>
      </section>

      {/* Asamblea de Accionistas */}
      <section className="space-y-3">
        <SectionTitle eyebrow="Propietarios" title="Asamblea de Accionistas" />
        <div className="grid gap-4 sm:grid-cols-2">
          {ASAMBLEA.map((n) => (
            <PersonCard key={n.name} node={n} />
          ))}
        </div>
      </section>

      {/* Estructura ejecutiva */}
      <section className="space-y-3">
        <SectionTitle eyebrow="Estructura ejecutiva" title="Presidencia y Dirección" />
        <div className="grid gap-4 lg:grid-cols-3">
          <PersonCard node={PRESIDENTE} className="lg:col-span-2" />
          <PersonCard node={VICEPRESIDENTE} />
        </div>
        <div className="flex justify-center">
          <Icon name="chevron-down" size={18} className="text-fg-secondary" />
        </div>
        <PersonCard node={DIRECTOR} className="max-w-2xl mx-auto w-full" />
      </section>

      {/* Gerencia / administración */}
      <section className="space-y-3">
        <SectionTitle eyebrow="Reporta a Dirección de Operaciones" title="Gerencia y Administración" />
        <div className="grid gap-4 sm:grid-cols-2">
          {GERENCIA.map((n) => (
            <PersonCard key={n.name} node={n} />
          ))}
        </div>
      </section>

      {/* Áreas operativas y personal */}
      <section className="space-y-3">
        <SectionTitle eyebrow="Operación" title="Áreas y Personal" />
        <div className="grid gap-4 md:grid-cols-2">
          {/* Personal Operativo (dos CD con encargados) */}
          <div className="card border-l-4 border-l-cyan-500 p-4 md:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-cyan-500" />
              <div className="text-sm font-bold text-fg-primary">Personal Operativo</div>
              <span className="text-[11px] text-fg-secondary">· Depósitos · Eslingaje · Distribución</span>
              <span className="ml-auto inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border text-fg-secondary bg-fg-secondary/10 border-stroke-soft">
                <Icon name="shield" size={9} /> operaciones ?
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {ENCARGADOS_OPERATIVOS.map((e) => (
                <div key={e.name}>
                  <PersonCard node={e} />
                  <TeamChips label={e.team.label} members={e.team.members} />
                </div>
              ))}
            </div>
          </div>

          {/* Resto de áreas */}
          {AREAS.filter((a) => a.label !== "Personal Operativo").map((area) => (
            <div key={area.label} className={"card border-l-4 " + TIER_ACCENT[area.tier] + " p-4"}>
              <div className="flex items-center gap-2 mb-2">
                <span className={"w-2 h-2 rounded-full " + TIER_DOT[area.tier]} />
                <div className="text-sm font-bold text-fg-primary">{area.label}</div>
                {area.rbac && <span className="ml-auto"><RbacBadge rbac={area.rbac} /></span>}
              </div>
              <div className="text-[11px] text-fg-secondary mb-2">{area.scope}</div>
              {area.lead && <PersonCard node={area.lead} />}
              {area.team && <TeamChips label={area.team.label} members={area.team.members} />}
              {area.members && <TeamChips label="Personal" members={area.members} />}
            </div>
          ))}
        </div>
      </section>

      {/* Asesores externos */}
      <section className="space-y-3">
        <SectionTitle eyebrow="Profesionales contratados ad-hoc" title="Asesores Externos" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ASESORES_EXTERNOS.map((a) => (
            <div
              key={a.name}
              className="card border border-dashed border-stroke-soft p-3 flex items-start gap-3"
            >
              <Initials name={a.name} />
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-tops-red">{a.area}</div>
                <div className="text-sm font-bold text-fg-primary leading-tight">{a.name}</div>
                <div className="text-[11px] text-fg-secondary mt-0.5">{a.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Leyenda + nota RBAC */}
      <section className="card p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-fg-secondary">Niveles</span>
          {ORG_LEGEND.map((l) => (
            <span key={l.tier} className="inline-flex items-center gap-1.5 text-[11px] text-fg-primary">
              <span className={"w-2.5 h-2.5 rounded-full " + TIER_DOT[l.tier]} />
              {l.label}
            </span>
          ))}
        </div>
        <div className="text-[11px] text-fg-secondary leading-relaxed border-t border-stroke-soft pt-3">
          <span className="inline-flex items-center gap-1 font-semibold text-fg-primary">
            <Icon name="shield" size={11} /> Mapeo RBAC
          </span>{" "}
          — las insignias de rol referencian el catálogo de permisos vigente. Verde = asignación
          resuelta por la Presidencia; gris con <span className="font-mono">?</span> = rol sugerido
          por el cargo, pendiente de confirmación. Detalle en{" "}
          <span className="font-mono">docs/erp/RBAC-READONLY-VALIDATION.md</span>.
        </div>
      </section>
    </div>
  );
}
