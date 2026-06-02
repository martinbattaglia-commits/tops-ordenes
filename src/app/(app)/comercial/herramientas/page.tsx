import type { CSSProperties } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { PRODUCT } from "@/lib/org";
import { VIRTUAL_TOURS } from "./_data/tours";

export const metadata = { title: "Herramientas" };

/* ── Herramientas · repositorio de herramientas comerciales oficiales ───────
 *
 * Sección única de Herramientas de Logística TOPS:
 *   · Generadores → rutas internas que embeben la versión oficial dentro del
 *                   shell Nexus (iframe same-origin desde `public/tools/<x>`):
 *                   Cotizador, Propuesta ANMAT, Propuesta Cargas Generales.
 *   · Recorridos  → abren el tour 360° en una pestaña nueva (las plataformas
 *                   no permiten embeber en iframe).
 *
 * Fuente de verdad de los recorridos: `_data/tours.ts`.
 */

interface ToolCard {
  key: string;
  /** Ruta interna (Link). Mutuamente excluyente con `externalUrl`. */
  href?: string;
  /** Enlace externo (abre en pestaña nueva). */
  externalUrl?: string;
  name: string;
  description: string;
  badge: string;
  icon: IconName;
  disabled?: boolean;
  accent: string;
  glow: string;
  border: string;
  iconColor: string;
}

const RED = {
  accent: "rgba(229,57,53,0.28)",
  glow: "rgba(229,57,53,0.38)",
  border: "rgba(229,57,53,0.45)",
  iconColor: "text-tops-red",
};
const BLUE = {
  accent: "rgba(33,69,118,0.30)",
  glow: "rgba(33,69,118,0.40)",
  border: "rgba(33,69,118,0.45)",
  iconColor: "text-tops-blue-700",
};

const TOOL_CARDS: ToolCard[] = [
  {
    key: "cotizador",
    href: "/comercial/herramientas/cotizador",
    name: "Cotizador Logístico TOPS",
    description:
      "Versión oficial del cotizador de Logística TOPS: cálculo de tarifas de almacenaje, distribución y servicios logísticos.",
    badge: "Cotización",
    icon: "calculator",
    ...RED,
  },
  {
    key: "propuesta-anmat",
    href: "/comercial/herramientas/propuesta-anmat",
    name: "Propuesta Comercial ANMAT",
    description:
      "Generador oficial de propuestas comerciales para almacenamiento regulado ANMAT.",
    badge: "ANMAT",
    icon: "shield",
    ...RED,
  },
  {
    key: "propuesta-general",
    href: "/comercial/herramientas/propuesta-general",
    name: "Propuesta Comercial Cargas Generales",
    description:
      "Generador oficial de propuestas comerciales para almacenamiento de cargas generales.",
    badge: "Cargas Generales",
    icon: "forklift",
    ...RED,
  },
];

const TOUR_ICONS: Record<string, IconName> = {
  lujan: "building",
  "barracas-anmat": "shield",
  "barracas-general": "forklift",
};

const RECORRIDO_CARDS: ToolCard[] = VIRTUAL_TOURS.map((tour) => {
  const hasTour = tour.status === "available" && tour.tourUrl.trim().length > 0;
  return {
    key: tour.slug,
    externalUrl: hasTour ? tour.tourUrl : undefined,
    name: tour.shortTitle,
    description: tour.description,
    badge: tour.status === "coming_soon" ? "Próximamente" : "Recorrido 3D",
    icon: TOUR_ICONS[tour.slug] ?? "building",
    disabled: !hasTour,
    ...BLUE,
  };
});

export default function HerramientasPage() {
  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <section className="card overflow-hidden relative">
        <div
          className="absolute inset-0 pointer-events-none opacity-90"
          style={{
            background:
              "radial-gradient(ellipse at top right, rgba(33,69,118,0.12), transparent 58%), radial-gradient(ellipse at bottom left, rgba(229,57,53,0.10), transparent 60%)",
          }}
        />
        <div className="relative p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 shrink-0 rounded-2xl bg-bg-surface border border-stroke-soft grid place-items-center shadow-sm text-tops-blue-700">
              <Icon name="bolt" size={26} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="eyebrow-tiny">{PRODUCT.name} · Herramientas</div>
              <h1 className="page-title">Herramientas</h1>
              <p className="page-subtitle max-w-2xl">
                Repositorio oficial de herramientas comerciales de Logística TOPS:
                cotizador, generadores de propuestas y recorridos virtuales de las
                instalaciones.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Herramientas Comerciales ───────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <div className="eyebrow-tiny">Herramientas Comerciales</div>
          <p className="text-[13px] text-fg-secondary">
            Cotizador y generadores oficiales de propuestas comerciales.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOL_CARDS.map((tool, i) => (
            <ToolTile key={tool.key} tool={tool} index={i} />
          ))}
        </div>
      </section>

      {/* ── Recorridos Virtuales ───────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="eyebrow-tiny">Recorridos Virtuales</div>
            <p className="text-[13px] text-fg-secondary">
              Tours 360° de los depósitos de Logística TOPS. Se abren en una
              pestaña nueva.
            </p>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-2 py-1 rounded shrink-0">
            {RECORRIDO_CARDS.length} recorridos
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RECORRIDO_CARDS.map((tool, i) => (
            <ToolTile key={tool.key} tool={tool} index={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ToolTile({ tool, index }: { tool: ToolCard; index: number }) {
  const cardStyle = {
    "--gws-accent": tool.accent,
    "--gws-glow": tool.glow,
    "--gws-border": tool.border,
    animationDelay: `${index * 55}ms`,
  } as CSSProperties;

  const isExternal = Boolean(tool.externalUrl);

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div
          className={`gws-icon-tile w-14 h-14 shrink-0 rounded-xl bg-bg-surface border border-stroke-soft grid place-items-center shadow-sm ${tool.iconColor}`}
        >
          <Icon name={tool.icon} size={26} />
        </div>
        <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-1.5 py-0.5 rounded">
          {tool.badge}
        </span>
      </div>

      <div className="flex-1">
        <div className="text-base font-black text-fg-primary tracking-tight">
          {tool.name}
        </div>
        <p className="text-[13px] text-fg-secondary mt-1 leading-snug">
          {tool.description}
        </p>
      </div>

      <span
        className={`btn btn-sm w-full justify-center pointer-events-none ${
          tool.disabled ? "btn-ghost opacity-60" : "btn-primary btn-shimmer"
        }`}
      >
        <span>{tool.disabled ? "Próximamente" : "Abrir"}</span>
        {!tool.disabled && (
          <Icon
            name={isExternal ? "arrow-up-right" : "arrow-right"}
            size={14}
            stroke={2.2}
          />
        )}
      </span>
    </>
  );

  const cardClass =
    "gws-card gws-clickable gws-stagger card p-5 flex flex-col gap-4 group focus:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700/50";

  if (tool.disabled) {
    return (
      <div
        aria-disabled="true"
        style={cardStyle}
        className="gws-card gws-stagger card p-5 flex flex-col gap-4 cursor-not-allowed"
      >
        {inner}
      </div>
    );
  }

  if (isExternal) {
    return (
      <a
        href={tool.externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Abrir ${tool.name} en una pestaña nueva`}
        style={cardStyle}
        className={cardClass}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link
      href={tool.href ?? "#"}
      aria-label={`Abrir ${tool.name}`}
      style={cardStyle}
      className={cardClass}
    >
      {inner}
    </Link>
  );
}
