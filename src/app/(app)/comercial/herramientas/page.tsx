import type { CSSProperties } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { PRODUCT } from "@/lib/org";

export const metadata = { title: "Herramientas Comerciales" };

/* ── Herramientas Comerciales · accesos rápidos ───────────────────────────
 *
 * Cada herramienta es un enlace externo que abre en una pestaña nueva. Las
 * URLs son configurables desde este array: agregar una nueva tarjeta solo
 * requiere sumar un objeto a `TOOLS` — el layout (grid responsive) se adapta
 * solo. No se duplica funcionalidad: estas tarjetas son únicamente accesos.
 */

interface CommercialTool {
  key: string;
  name: string;
  description: string;
  url: string;
  /** Texto del botón de acción. */
  cta: string;
  /** Etiqueta corta de categoría. */
  badge: string;
  icon: IconName;
  /** Color de marca y derivados para el glow/borde en hover (custom props CSS). */
  accent: string;
  glow: string;
  border: string;
  /** Color del ícono. */
  iconColor: string;
}

const TOOLS: CommercialTool[] = [
  {
    key: "recorrido-anmat",
    name: "Recorrido Virtual ANMAT",
    description:
      "Visualización interactiva de los nuevos cubículos y áreas habilitadas para clientes.",
    url: "https://realsee.ai/49kkW65",
    cta: "Abrir Recorrido Virtual",
    badge: "Recorrido 3D",
    icon: "building",
    accent: "rgba(33,69,118,0.30)",
    glow: "rgba(33,69,118,0.40)",
    border: "rgba(33,69,118,0.45)",
    iconColor: "text-tops-blue-700",
  },
  {
    key: "cotizador",
    name: "Cotizador Comercial",
    description:
      "Herramienta interna para cálculo rápido de propuestas comerciales y valorización de servicios logísticos.",
    url: "https://logisticatops-cotizador.netlify.app",
    cta: "Abrir Cotizador",
    badge: "Cotización",
    icon: "calculator",
    accent: "rgba(229,57,53,0.28)",
    glow: "rgba(229,57,53,0.38)",
    border: "rgba(229,57,53,0.45)",
    iconColor: "text-tops-red",
  },
];

export default function HerramientasComercialesPage() {
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
              <div className="eyebrow-tiny">{PRODUCT.name} · Comercial</div>
              <h1 className="page-title">Herramientas Comerciales</h1>
              <p className="page-subtitle max-w-2xl">
                Accesos rápidos a las herramientas del equipo comercial. Cada
                acceso abre la herramienta en una pestaña nueva.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Grid de herramientas ───────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="eyebrow-tiny">Accesos rápidos</div>
            <p className="text-[13px] text-fg-secondary">
              Herramientas comerciales de Logística TOPS.
            </p>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary bg-fg-secondary/10 border border-stroke-soft px-2 py-1 rounded shrink-0">
            {TOOLS.length} herramientas
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool, i) => (
            <a
              key={tool.key}
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${tool.cta} en una pestaña nueva`}
              style={
                {
                  "--gws-accent": tool.accent,
                  "--gws-glow": tool.glow,
                  "--gws-border": tool.border,
                  animationDelay: `${i * 55}ms`,
                } as CSSProperties
              }
              className="gws-card gws-stagger card p-5 flex flex-col gap-4 group focus:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-700/50"
            >
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

              <span className="btn btn-primary btn-sm btn-shimmer w-full justify-center pointer-events-none">
                <span>{tool.cta}</span>
                <Icon name="arrow-up-right" size={14} stroke={2.2} />
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* ── Nota informativa ───────────────────────────────────────────── */}
      <section className="card p-4 md:p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-fg-secondary">
            <Icon name="arrow-up-right" size={12} /> Enlaces externos
          </span>
        </div>
        <p className="text-[12px] text-fg-secondary leading-relaxed">
          Estos accesos son enlaces directos a herramientas externas: abren en
          una pestaña nueva y no modifican datos del sistema. Esta sección queda
          preparada para sumar nuevas herramientas comerciales a futuro.
        </p>
      </section>
    </div>
  );
}
