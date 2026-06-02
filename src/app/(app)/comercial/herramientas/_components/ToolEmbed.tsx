import { Icon, type IconName } from "@/components/Icon";
import { PRODUCT } from "@/lib/org";

/* ── ToolEmbed · embebido oficial de herramientas comerciales ──────────────
 *
 * Cada herramienta comercial (Cotizador, Propuesta ANMAT, Propuesta Cargas
 * Generales) es un artefacto estático autocontenido que vive en
 * `public/tools/<slug>/index.html` (fuente oficial entregada por Comercial).
 * Se embebe vía <iframe> same-origin dentro del shell Nexus para mantener la
 * integración visual (sidebar + topbar) y el branding.
 *
 * La lógica, los cálculos y los formularios de cada herramienta NO se tocan:
 * para actualizarlas, reemplazar ÚNICAMENTE el index.html correspondiente.
 */

export function ToolEmbed({
  slug,
  title,
  icon = "calculator",
}: {
  slug: string;
  title: string;
  icon?: IconName;
}) {
  const src = `/tools/${slug}/index.html`;
  return (
    <div className="flex h-full flex-col">
      {/* Barra de contexto Nexus por encima del artefacto embebido */}
      <div className="shrink-0 flex items-center justify-between gap-3 border-b border-stroke-soft bg-bg-surface px-4 md:px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-bg-surface border border-stroke-soft grid place-items-center shadow-sm text-tops-red">
            <Icon name={icon} size={20} />
          </div>
          <div className="min-w-0">
            <div className="eyebrow-tiny">{PRODUCT.name} · Herramientas</div>
            <h1 className="text-base font-black text-fg-primary tracking-tight truncate">
              {title}
            </h1>
          </div>
        </div>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost btn-sm shrink-0"
          aria-label={`Abrir ${title} en una pestaña nueva`}
        >
          <Icon name="arrow-up-right" size={14} stroke={2.2} />
          <span className="hidden sm:inline">Pantalla completa</span>
        </a>
      </div>

      {/* Artefacto embebido — ocupa todo el alto disponible del content area */}
      <iframe
        src={src}
        title={`${title} · TOPS`}
        className="flex-1 min-h-0 w-full border-0 bg-bg-page"
        loading="eager"
      />
    </div>
  );
}
