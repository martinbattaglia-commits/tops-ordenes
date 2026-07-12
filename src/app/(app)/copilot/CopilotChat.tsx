"use client";

// F5.2-lite · Chat del Copilot (client component). Estados visibles y honestos:
// pensando / respuesta con fuentes / sin evidencia / presupuesto / error.
// Dark-mode-safe: tokens del design system, sin /opacity sobre var() (regla repo).

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { getManualNexusSection, getPrincipalSections } from "@/lib/ai/copilot-suggestions";
import {
  groupEntityCards,
  groupSections,
  parseBlocks,
  parseInline,
  type BadgeTone,
  type EntityCard,
  type MdBlock,
  type MdInline,
  type NarrativeSection,
} from "@/lib/ai/markdown";
import type { CopilotAnswer, CopilotVisual, SourceChunk } from "@/lib/ai/types";
import { askCopilotAction, copilotFeedbackAction } from "./actions";
import { CopilotThinkingLoader } from "./CopilotThinkingLoader";
import { VoiceField } from "@/components/voice/VoiceField";

// Loader consciente del tipo de consulta (round loader 2026-07-08): las
// ejecutivas/complejas muestran el subtítulo de cruce multi-dominio; el resto,
// el general. Detección liviana por palabra clave (cliente, sin llamar al motor).
const COMPLEX_RE =
  /riesgo|forecast|informe|resumen|ejecutiv|facturaci|contrato|compliance|tesoreri|caja|flujo|cruz|direccion|comite|vacancia|capacidad|proveedor|oportunidad|decision|anmat|renovacion|liquidez|forecast/;
function isComplexQuestion(q: string): boolean {
  return COMPLEX_RE.test(q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
}

// Brecha honesta del Manual Nexus (round 2026-07-08): el manual está en Drive
// pero aún sin ingerir (C1.5). Se arma como briefing → el renderer lo muestra con
// título premium + caja ámbar "Brechas de datos". NO inventa instrucciones.
function manualGapMessage(label: string): string {
  return [
    `## Manual Nexus · ${label}`,
    "",
    "El Manual Nexus ya está preparado en Drive, pero todavía no fue ingerido en Copilot.",
    "",
    "Brechas de datos:",
    "Falta cerrar C1.5 (ingesta de la capa manual_nexus) para responder esta consulta con las fuentes del Manual de Usuario. No invento instrucciones hasta que el manual esté disponible en Copilot.",
  ].join("\n");
}

interface ChatEntry {
  role: "user" | "assistant";
  content: string;
  sources?: SourceChunk[];
  visual?: CopilotVisual | null;
  messageId?: string | null;
  outcome?: CopilotAnswer["outcome"];
}

// ── Tablero ejecutivo (estándar 2026-07-07) ─────────────────────────────────
// Renderiza el payload DETERMINÍSTICO del engine (KPIs/tabla/chart calculados
// en SQL/código — el modelo no genera estos números). SVG nativo, sin libs
// (patrón ServiceMixDonut). Paleta fija hex (regla repo: no /opacity sobre
// tokens var()); 'Sin clasificar' siempre en gris.

const CHART_PALETTE = ["#3b82f6", "#f43f5e", "#22c55e", "#eab308", "#8b5cf6", "#14b8a6"];
/** Tonos semánticos de KPI (estilo Cockpit/Compliance). */
const TONE_COLOR: Record<string, string> = {
  brand: "#3b82f6",
  ok: "#22c55e",
  warn: "#f59e0b",
  danger: "#ef4444",
};
const colorFor = (label: string, i: number): string =>
  label.toLowerCase().includes("sin clasificar")
    ? "#94a3b8"
    : CHART_PALETTE[i % CHART_PALETTE.length];

function DonutChart({ chart }: { chart: NonNullable<CopilotVisual["chart"]> }) {
  const total = chart.values.reduce((a, b) => a + b, 0) || 1;
  const r = 40;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-32 w-32 shrink-0" role="img" aria-label={`Composición: ${chart.labels.join(", ")}`}>
        {chart.values.map((v, i) => {
          const frac = v / total;
          const seg = (
            <circle
              key={i}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={colorFor(chart.labels[i] ?? "", i)}
              strokeWidth="14"
              strokeDasharray={`${frac * circ} ${circ}`}
              strokeDashoffset={-acc * circ}
              transform="rotate(-90 50 50)"
            />
          );
          acc += frac;
          return seg;
        })}
      </svg>
      <ul className="min-w-0 space-y-1">
        {chart.labels.map((label, i) => (
          <li key={i} className="flex items-center gap-1.5 text-[11px] text-fg-primary">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorFor(label, i) }} />
            <span className="truncate">{label}</span>
            <span className="ml-auto pl-2 font-semibold tabular-nums text-fg-muted">
              {((100 * chart.values[i]) / total).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BarChart({ chart }: { chart: NonNullable<CopilotVisual["chart"]> }) {
  const max = Math.max(...chart.values, 1);
  return (
    <ul className="space-y-1.5">
      {chart.labels.map((label, i) => (
        <li key={i} className="text-[11px]">
          <div className="mb-0.5 flex justify-between gap-2 text-fg-primary">
            <span className="truncate">{label}</span>
            <span className="shrink-0 tabular-nums text-fg-muted">
              {chart.values[i].toLocaleString("en-US")}
            </span>
          </div>
          <div className="h-2 rounded-full bg-bg-surface-alt">
            <div
              className="h-2 rounded-full"
              style={{ width: `${Math.max(2, (100 * chart.values[i]) / max)}%`, backgroundColor: colorFor(label, i) }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Acción inline de fuente: Drive/externa abre en pestaña nueva; interna navega.
 *  kind='fallback' (sin documento real) se ATENÚA: navega al módulo pero nunca
 *  se presenta con el mismo peso visual que una fuente documental verdadera. */
function SourceAction({ url, label, kind }: { url: string; label: string; kind?: string | null }) {
  const cls =
    kind === "fallback"
      ? "mt-1.5 inline-block rounded border border-dashed border-stroke-soft px-2 py-0.5 text-[10px] font-medium text-fg-muted hover:bg-bg-surface-alt"
      : "mt-1.5 inline-block rounded border border-stroke-soft bg-bg-surface-alt px-2 py-0.5 text-[10px] font-semibold text-fg-link hover:bg-bg-surface";
  if (/^https?:\/\//.test(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={cls}>
        {label} ↗
      </a>
    );
  }
  return (
    <Link href={url} className={cls}>
      {label} →
    </Link>
  );
}

// ── Renderer de markdown SEGURO del narrativo (round briefing premium 2026-07-08)
// El modelo devuelve markdown; sin renderer se veían los '**' crudos. Acá se mapea
// la estructura parseada (markdown.ts) a elementos — sin dangerouslySetInnerHTML,
// sin HTML crudo (cero XSS). Las etiquetas ejecutivas se muestran como BADGES.
// Color semántico (round 16): cada tono comunica significado, no decora.
const BADGE_TONE: Record<BadgeTone, string> = {
  brand: "#3b82f6", // KPIs / datos / facturación
  ok: "#22c55e", // oportunidades / crecimiento
  warn: "#f59e0b", // brechas / warnings
  danger: "#ef4444", // riesgos / urgencias
  action: "#8b5cf6", // recomendaciones / decisiones (violeta premium)
  muted: "#94a3b8", // evidencia / fuentes / notas
};
// Acento por tipo de sección del briefing.
const SECTION_ACCENT: Record<string, string> = {
  summary: "#3b82f6",
  recommendations: "#8b5cf6",
  gaps: "#f59e0b",
  sources: "#94a3b8",
  section: "#64748b",
};

function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  const c = BADGE_TONE[tone];
  return (
    <span
      className="mr-1.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: c, backgroundColor: `${c}1f`, border: `1px solid ${c}36` }}
    >
      {label}
    </span>
  );
}

function Eyebrow({ color, children }: { color: string; children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>
      {children}
    </p>
  );
}

function Inline({ spans }: { spans: MdInline[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.t === "bold")
          return (
            <strong key={i} className="font-bold text-fg-primary">
              {s.value}
            </strong>
          );
        // Itálica = notas/aclaraciones secundarias (tono atenuado, FASE A #5).
        if (s.t === "italic")
          return (
            <em key={i} className="text-fg-muted">
              {s.value}
            </em>
          );
        if (s.t === "code")
          return (
            <code key={i} className="rounded bg-bg-surface-alt px-1 py-0.5 text-[0.85em] text-fg-primary">
              {s.value}
            </code>
          );
        if (s.t === "cite")
          return (
            <sup key={i} className="ml-0.5 rounded bg-bg-surface-alt px-1 text-[9px] font-semibold text-fg-muted">
              {s.value}
            </sup>
          );
        if (s.t === "link")
          return /^https?:\/\//.test(s.href) ? (
            <a
              key={i}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg-link underline underline-offset-2 hover:opacity-80"
            >
              {s.value}
            </a>
          ) : (
            <Link key={i} href={s.href} className="text-fg-link underline underline-offset-2">
              {s.value}
            </Link>
          );
        return <span key={i}>{s.value}</span>;
      })}
    </>
  );
}

// ── Bloque atómico (párrafo, lista, tabla, etiqueta-badge, subtítulo) ────────
function BlockView({ block: b }: { block: MdBlock }) {
  if (b.type === "h2")
    return <p className="text-sm font-bold tracking-tight text-fg-primary">{b.text}</p>;
  if (b.type === "h3")
    return <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{b.text}</p>;
  if (b.type === "p")
    return (
      <p className="text-sm leading-relaxed text-fg-primary">
        <Inline spans={b.spans} />
      </p>
    );
  if (b.type === "label")
    return (
      <p className="text-sm leading-relaxed text-fg-primary">
        <Badge label={b.label} tone={b.tone} />
        <Inline spans={b.spans} />
      </p>
    );
  if (b.type === "ul" || b.type === "ol") {
    const Tag = b.type === "ol" ? "ol" : "ul";
    return (
      <Tag className="space-y-1.5">
        {b.items.map((it, j) => (
          <li key={j} className="flex gap-2 text-sm leading-relaxed text-fg-primary">
            {it.label ? (
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-1">
                <Badge label={it.label} tone={it.tone ?? "muted"} />
                <Inline spans={it.spans} />
              </span>
            ) : (
              <>
                {b.type === "ol" ? (
                  <span className="shrink-0 tabular-nums text-[13px] font-semibold text-fg-muted">{j + 1}.</span>
                ) : (
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-muted" aria-hidden />
                )}
                <span className="min-w-0">
                  <Inline spans={it.spans} />
                </span>
              </>
            )}
          </li>
        ))}
      </Tag>
    );
  }
  if (b.type !== "table") return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-stroke-soft text-left text-fg-muted">
            {b.header.map((c, k) => (
              <th key={k} className={`py-1.5 pr-3 font-semibold ${k > 0 ? "text-right" : ""}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((row, ri) => (
            <tr key={ri} className="border-b border-stroke-soft/50 text-fg-primary last:border-0">
              {row.map((cell, ci) => (
                <td key={ci} className={`py-1.5 pr-3 ${ci > 0 ? "text-right tabular-nums" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Risk / Opportunity card (FASE E): título + atributos como campos etiquetados ─
function EntityCardView({ card }: { card: EntityCard }) {
  const c = BADGE_TONE[card.tone];
  return (
    <div
      className="rounded-lg border border-stroke-soft bg-bg-surface p-3"
      style={{ borderLeft: `3px solid ${c}` }}
    >
      <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm font-semibold text-fg-primary">
        <Badge label={card.label} tone={card.tone} />
        <Inline spans={card.title} />
      </p>
      {card.fields.length > 0 && (
        <div className="mt-2 space-y-1">
          {card.fields.map((f, i) => (
            <p key={i} className="text-xs leading-relaxed text-fg-muted">
              <span
                className="mr-1.5 text-[10px] font-bold uppercase tracking-wide"
                style={{ color: BADGE_TONE[f.tone] }}
              >
                {f.label}
              </span>
              <Inline spans={f.spans} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Recomendaciones como action cards (FASE C.3): verbo + acento violeta ─────
function ActionList({ block }: { block: Extract<MdBlock, { type: "ul" | "ol" }> }) {
  return (
    <div className="space-y-1.5">
      {block.items.map((it, j) => (
        <div
          key={j}
          className="flex items-start gap-2 rounded-md border border-stroke-soft bg-bg-surface px-3 py-2"
          style={{ borderLeft: `3px solid ${BADGE_TONE.action}` }}
        >
          <span className="mt-0.5 shrink-0 text-xs font-bold" style={{ color: BADGE_TONE.action }} aria-hidden>
            ▸
          </span>
          <span className="min-w-0 text-sm leading-relaxed text-fg-primary">
            {it.label && <Badge label={it.label} tone={it.tone ?? "action"} />}
            <Inline spans={it.spans} />
          </span>
        </div>
      ))}
    </div>
  );
}

function BlockList({ blocks, variant }: { blocks: MdBlock[]; variant?: NarrativeSection["variant"] }) {
  const items = groupEntityCards(blocks);
  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        if (it.type === "card") return <EntityCardView key={i} card={it} />;
        if (variant === "recommendations" && (it.type === "ul" || it.type === "ol"))
          return <ActionList key={i} block={it} />;
        return <BlockView key={i} block={it} />;
      })}
    </div>
  );
}

// ── Sección temática del briefing: título premium + cajas de color semántico ─
function SectionView({ section }: { section: NarrativeSection }) {
  const { variant, title, blocks } = section;

  if (variant === "title" && title)
    return (
      <div className="flex items-center gap-2.5">
        <span
          className="h-6 w-1 shrink-0 rounded-full"
          style={{ background: "linear-gradient(180deg,#3b82f6,#8b5cf6)" }}
          aria-hidden
        />
        <h2 className="text-base font-bold leading-tight tracking-tight text-fg-primary">{title}</h2>
      </div>
    );

  if (variant === "lead") return <BlockList blocks={blocks} />;

  if (variant === "summary")
    return (
      <div className="rounded-lg border p-3" style={{ borderColor: "#3b82f636", backgroundColor: "#3b82f60f" }}>
        <Eyebrow color={SECTION_ACCENT.summary}>{title ?? "Resumen ejecutivo"}</Eyebrow>
        <div className="mt-1.5">
          <BlockList blocks={blocks} />
        </div>
      </div>
    );

  if (variant === "gaps")
    return (
      <div className="rounded-lg border p-3" style={{ borderColor: "#f59e0b36", backgroundColor: "#f59e0b0f" }}>
        <Eyebrow color={SECTION_ACCENT.gaps}>⚠ {title ?? "Brechas de datos"}</Eyebrow>
        <div className="mt-1.5">
          <BlockList blocks={blocks} />
        </div>
      </div>
    );

  if (variant === "recommendations")
    return (
      <div>
        <Eyebrow color={SECTION_ACCENT.recommendations}>{title ?? "Recomendaciones"}</Eyebrow>
        <div className="mt-1.5">
          <BlockList blocks={blocks} variant="recommendations" />
        </div>
      </div>
    );

  if (variant === "sources")
    return (
      <div className="border-t border-stroke-soft pt-2">
        <Eyebrow color={SECTION_ACCENT.sources}>{title ?? "Fuentes"}</Eyebrow>
        <div className="mt-1 text-xs text-fg-muted">
          <BlockList blocks={blocks} />
        </div>
      </div>
    );

  // Sección genérica (subtítulo con acento neutro + cuerpo).
  return (
    <div>
      {title && <Eyebrow color={SECTION_ACCENT.section}>{title}</Eyebrow>}
      <div className={title ? "mt-1.5" : ""}>
        <BlockList blocks={blocks} />
      </div>
    </div>
  );
}

/** Briefing ejecutivo: título premium + cajas temáticas (resumen/recomendaciones/
 *  brechas/fuentes) + risk cards, con color semántico. Nunca markdown crudo. */
function Markdown({ source }: { source: string }) {
  const sections = groupSections(parseBlocks(source));
  if (sections.length === 0) return null;
  return (
    <div className="space-y-3">
      {sections.map((s, i) => (
        <SectionView key={i} section={s} />
      ))}
    </div>
  );
}

function VisualReport({ v }: { v: CopilotVisual }) {
  const table = v.table; // narrowing estable dentro de los .map()
  // Dashboard multi-chart (FASE 5/6): principal + adicionales, cada uno con título.
  const charts = [...(v.chart ? [v.chart] : []), ...(v.charts ?? [])];
  return (
    <div className="mb-2 rounded-lg border border-stroke-soft bg-bg-surface-alt p-4">
      <p className="text-sm font-bold tracking-tight text-fg-primary">{v.title}</p>
      {v.period && <p className="text-[10px] text-fg-muted">{v.period}</p>}

      {v.kpis && v.kpis.length > 0 && (
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {v.kpis.map((k, i) => {
            const tone = TONE_COLOR[k.tone ?? "brand"];
            const primary = i === 0; // número principal: jerarquía visual mayor
            return (
              <div
                key={i}
                className={`rounded-md border border-stroke-soft bg-bg-surface px-3 py-2.5 ${
                  primary ? "col-span-2 sm:col-span-2" : ""
                }`}
                style={{ borderLeft: `3px solid ${tone}` }}
              >
                <p className="text-[10px] uppercase tracking-wide text-fg-muted">{k.label}</p>
                <p
                  className={`truncate font-bold tabular-nums text-fg-primary ${
                    primary ? "text-3xl" : "text-lg"
                  }`}
                  title={k.value}
                >
                  {k.value}
                </p>
                {k.hint && <p className="text-[10px] text-fg-muted">{k.hint}</p>}
                {typeof k.pct === "number" && (
                  <div className={`mt-1.5 rounded-full bg-bg-surface-alt ${primary ? "h-2" : "h-1.5"}`} aria-hidden>
                    <div
                      className={`rounded-full ${primary ? "h-2" : "h-1.5"}`}
                      style={{
                        width: `${Math.min(100, Math.max(0, k.pct))}%`,
                        backgroundColor: tone,
                      }}
                    />
                  </div>
                )}
                {k.url && <SourceAction url={k.url} label={k.actionLabel ?? "Abrir"} />}
              </div>
            );
          })}
        </div>
      )}

      {charts.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {charts.map((c, i) => (
            <div
              key={i}
              className={`rounded-md border border-stroke-soft bg-bg-surface px-3 py-2.5 ${
                charts.length === 1 ? "sm:col-span-2" : ""
              }`}
            >
              {c.title && (
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  {c.title}
                </p>
              )}
              {c.type === "donut" ? <DonutChart chart={c} /> : <BarChart chart={c} />}
            </div>
          ))}
        </div>
      )}

      {table && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stroke-soft text-left text-fg-muted">
                {table.columns.map((c, i) => (
                  <th key={i} className={`py-1.5 pr-3 font-semibold ${i > 0 ? "text-right" : ""}`}>
                    {c}
                  </th>
                ))}
                {table.rowLinks && <th className="py-1.5 text-right font-semibold">Fuente</th>}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-stroke-soft/50 last:border-0 text-fg-primary">
                  {row.map((cell, ci) => (
                    <td key={ci} className={`py-1.5 pr-3 ${ci > 0 ? "text-right tabular-nums" : ""}`}>
                      {cell}
                    </td>
                  ))}
                  {table.rowLinks && (
                    <td className="py-1.5 text-right">
                      {table.rowLinks[ri] && (
                        <SourceAction
                          url={table.rowLinks[ri]!.url}
                          label={table.rowLinks[ri]!.label}
                          kind={table.rowLinks[ri]!.kind}
                        />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {v.insights && v.insights.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {/* Recomendaciones/oportunidades como cards de acción (no párrafo). */}
          {v.insights.map((ins, i) => (
            <div
              key={i}
              className="rounded-md border border-stroke-soft bg-bg-surface px-3 py-2 text-xs leading-relaxed text-fg-primary"
              style={{ borderLeft: `3px solid #8b5cf6` }}
            >
              <span className="mr-1" aria-hidden>💡</span>
              <Inline spans={parseInline(ins)} />
            </div>
          ))}
        </div>
      )}

      {v.warnings && v.warnings.length > 0 && (
        <div
          className="mt-3 rounded-md border border-stroke-soft bg-bg-surface px-3 py-2"
          style={{ borderLeft: `3px solid ${TONE_COLOR.warn}` }}
        >
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: TONE_COLOR.warn }}>
            Brechas de datos
          </p>
          {v.warnings.map((w, i) => (
            <p key={i} className="text-xs leading-relaxed text-fg-muted">
              <Inline spans={parseInline(w)} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Badges del hero con marcador de color propio (hex literal, regla repo:
 *  no /opacity sobre tokens var()). Sobrios: informan capacidades, no decoran. */
const HERO_BADGES: Array<{ label: string; dot: string }> = [
  { label: "Read-only", dot: "#22c55e" },
  { label: "Fuentes verificables", dot: "#3b82f6" },
  { label: "Piloto F5.2", dot: "#eab308" },
  { label: "Datos Nexus", dot: "#8b5cf6" },
];

/** Fuentes COLAPSABLES y secundarias (round UI 2026-07-07): la trazabilidad se
 *  mantiene pero no domina visualmente. Colapsado por defecto; al abrir muestra
 *  máximo 3 fuentes + "+N más". Chips compactos ([9px]). */
function SourceChips({ sources }: { sources: SourceChunk[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  const shown = open ? sources.slice(0, 3) : [];
  const extra = sources.length - shown.length;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full border border-stroke-soft bg-bg-surface-alt px-2 py-0.5 text-[10px] font-semibold text-fg-muted transition-colors hover:text-fg-link"
      >
        🔗 {sources.length} fuente{sources.length === 1 ? "" : "s"} citada{sources.length === 1 ? "" : "s"} {open ? "▲" : "▾"}
      </button>
      {open && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {shown.map((s) =>
            s.url ? (
              <Link
                key={s.sourceId}
                href={s.url}
                className="rounded-full border border-stroke-soft bg-bg-surface-alt px-1.5 py-0.5 text-[9px] font-medium text-fg-link hover:bg-bg-surface"
                title={s.title}
              >
                {s.sourceId} · {s.publicId ?? s.entityType}
              </Link>
            ) : (
              <span
                key={s.sourceId}
                className="rounded-full border border-stroke-soft bg-bg-surface-alt px-1.5 py-0.5 text-[9px] font-medium text-fg-muted"
                title={s.title}
              >
                {s.sourceId} · {s.publicId ?? s.entityType}
              </span>
            )
          )}
          {extra > 0 && <span className="text-[9px] text-fg-muted">+{extra} más</span>}
        </div>
      )}
    </div>
  );
}

function FeedbackButtons({ messageId }: { messageId: string }) {
  const [sent, setSent] = useState<"up" | "down" | null>(null);
  const send = async (verdict: "up" | "down") => {
    setSent(verdict);
    await copilotFeedbackAction({ messageId, verdict });
  };
  return (
    <div className="mt-2 flex items-center gap-2 text-[10px] text-fg-muted">
      <span>¿Te sirvió?</span>
      <button
        type="button"
        onClick={() => send("up")}
        disabled={sent !== null}
        className={`rounded px-1.5 py-0.5 hover:bg-bg-surface-alt ${sent === "up" ? "font-bold text-fg-primary" : ""}`}
        aria-label="Respuesta útil"
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => send("down")}
        disabled={sent !== null}
        className={`rounded px-1.5 py-0.5 hover:bg-bg-surface-alt ${sent === "down" ? "font-bold text-fg-primary" : ""}`}
        aria-label="Respuesta no útil"
      >
        👎
      </button>
      {sent && <span>Gracias, quedó registrado.</span>}
    </div>
  );
}

/** Command Center: hero ejecutivo + recomendaciones por sección. Se muestra al
 *  inicio y puede REABRIRSE después de una respuesta ("Volver a recomendaciones")
 *  sin borrar el historial del chat (smoke 2026-07-07).
 *
 *  Estándar visual 2026-07-07 (round UI): hero con imagen de IA integrada por
 *  fundido hacia var(--bg-surface) — se adapta a dark/light por token, sin
 *  /opacity sobre var() (regla repo). Jerarquía: 1) hero/título · 2) imagen ·
 *  3) cards de sección · 4) chips de consulta. Motion del sistema (.card-lift,
 *  .nx-stagger) — nada custom. */
function CommandCenter({
  demo,
  onAsk,
  onPreview,
}: {
  demo: boolean;
  onAsk: (q: string) => void;
  onPreview: (label: string) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      {/* ── Hero ejecutivo · centro de inteligencia ─────────────────── */}
      <div className="card nx-stagger relative overflow-hidden">
        {/* Imagen IA (md+): panel derecho fundido al fondo del card. En mobile
            se omite: el hero queda tipográfico, limpio y legible. */}
        <div className="absolute inset-y-0 right-0 hidden w-[46%] md:block" aria-hidden>
          <Image
            src="/copilot/hero-ai.jpg"
            alt=""
            fill
            priority
            sizes="(min-width: 768px) 42vw, 1px"
            className="object-cover object-[68%_28%]"
          />
          {/* Velos de integración: fundido lateral al color real del card
              (token por tema) + apoyo inferior + tinte de marca sutil. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to right, var(--bg-surface) 2%, transparent 58%)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, var(--bg-surface) 0%, transparent 38%)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(115deg, rgba(59,130,246,0.12) 0%, transparent 55%)",
            }}
          />
        </div>

        <div className="relative px-6 py-8 sm:px-8 sm:py-9 md:max-w-[58%]">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-fg-muted">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: "#3b82f6" }}
              aria-hidden
            />
            Centro de inteligencia · Nexus OS
          </p>
          <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-fg-primary sm:text-4xl">
            Preguntale a{" "}
            <span
              style={{
                background: "linear-gradient(92deg, #3b82f6 0%, #8b5cf6 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Nexus
            </span>
          </h2>
          <p className="mt-3 max-w-md text-[13px] leading-relaxed text-fg-muted">
            La capa de inteligencia del sistema operativo: reportes ejecutivos,
            métricas, rankings y documentos — con datos reales y fuentes
            verificables en cada respuesta.
            {demo ? " (Modo demo: datos ficticios.)" : ""}
          </p>
          <div className="mt-5 flex flex-wrap gap-1.5">
            {HERO_BADGES.map((b) => (
              <span
                key={b.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-stroke-soft bg-bg-surface-alt px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
              >
                <span
                  className="h-1 w-1 rounded-full"
                  style={{ backgroundColor: b.dot }}
                  aria-hidden
                />
                {b.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Separador de sección con línea (jerarquía clara) ─────────── */}
      <div className="mt-6 mb-3 flex items-center gap-3">
        <p className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          Explorá por sección — o escribí tu propia pregunta
        </p>
        <span className="h-px flex-1 bg-stroke-soft" aria-hidden />
      </div>

      {/* ── Cards por sección (solo cobertura real) ──────────────────── */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {getPrincipalSections().map((section, i) => (
          <div
            key={section.id}
            className="card card-lift nx-stagger p-4"
            style={{
              borderLeft: `3px solid ${section.color}`,
              animationDelay: `${Math.min(i * 45, 400)}ms`,
            }}
          >
            <div className="flex items-center gap-2.5">
              {/* Ícono en chip tintado con el acento del módulo (hex literal). */}
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-base"
                style={{
                  backgroundColor: `${section.color}1f`,
                  border: `1px solid ${section.color}36`,
                }}
                aria-hidden
              >
                {section.icon}
              </span>
              <div className="min-w-0">
                {/* Título de sección un nivel más grande/jerárquico (round
                    "reportes ejecutivos" 2026-07-07): 13px → 15px, negrita. */}
                <p className="truncate text-[15px] font-bold leading-snug tracking-tight text-fg-primary">
                  {section.title}
                </p>
                <p className="truncate text-[10px] text-fg-muted">{section.description}</p>
              </div>
              <span
                className="ml-auto shrink-0 rounded-full border border-stroke-soft px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-fg-muted"
                title={`${section.prompts.length} consultas disponibles`}
              >
                {section.prompts.length}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {section.prompts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onAsk(p.prompt)}
                  title={p.decisionGoal ? `${p.label} — ${p.decisionGoal}` : p.prompt}
                  className="rounded-lg border border-stroke-soft bg-bg-surface-alt px-2.5 py-1.5 text-[11px] font-medium text-fg-primary transition-colors hover:border-stroke-strong hover:bg-bg-surface hover:text-fg-link"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Manual Nexus · Ayuda Interna — preparada en la UI; ejecuta una brecha
          honesta hasta cerrar C1.5 (ingesta del manual). */}
      <ManualHelpSection onAsk={onAsk} onPreview={onPreview} />
    </div>
  );
}

// Sección de ayuda interna del Manual Nexus. En 'preview' (manual en Drive, sin
// ingerir) el click NO llama al motor: muestra una brecha honesta client-side.
function ManualHelpSection({
  onAsk,
  onPreview,
}: {
  onAsk: (q: string) => void;
  onPreview: (label: string) => void;
}) {
  const manual = getManualNexusSection();
  const preview = manual.coverage === "preview";
  return (
    <div
      className="card nx-stagger mt-2.5 p-4"
      style={{ borderLeft: `3px solid ${manual.color}`, animationDelay: "460ms" }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-base"
          style={{ backgroundColor: `${manual.color}1f`, border: `1px solid ${manual.color}36` }}
          aria-hidden
        >
          {manual.icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold leading-snug tracking-tight text-fg-primary">
            {manual.title}
          </p>
          <p className="truncate text-[10px] text-fg-muted">{manual.description}</p>
        </div>
        {preview && (
          <span
            className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{
              color: manual.color,
              backgroundColor: `${manual.color}1f`,
              border: `1px solid ${manual.color}36`,
            }}
            title="El Manual Nexus está en Drive; falta ingerirlo en Copilot (C1.5)."
          >
            En preparación
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {manual.prompts.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => (preview ? onPreview(p.label) : onAsk(p.prompt))}
            title={p.decisionGoal ?? p.prompt}
            className="rounded-lg border border-stroke-soft bg-bg-surface-alt px-2.5 py-1.5 text-[11px] font-medium text-fg-primary transition-colors hover:border-stroke-strong hover:bg-bg-surface hover:text-fg-link"
          >
            {p.label}
          </button>
        ))}
      </div>
      {preview && (
        <p className="mt-2.5 text-[10px] leading-relaxed text-fg-muted">
          Preparadas en la UI. Se responderán con fuentes del Manual de Usuario cuando se cierre C1.5
          (ingesta del Manual Nexus).
        </p>
      )}
    </div>
  );
}

export function CopilotChat({ demo }: { demo: boolean }) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  // Command Center reabierto a demanda tras una respuesta (no borra historial).
  const [showHome, setShowHome] = useState(false);
  const [pending, startTransition] = useTransition();
  const sessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0").slice(-12)}`
  );
  // Loader "pensando" (round 2026-07-08): aparece SOLO si la espera supera ~800ms
  // (no parpadea en respuestas rápidas) y se desmonta al llegar la respuesta o el
  // error (pending → false, sin quedar colgado). Auto-scroll pega el chat abajo.
  const [showLoader, setShowLoader] = useState(false);
  const lastQuestionRef = useRef("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pending) {
      setShowLoader(false);
      return;
    }
    const t = setTimeout(() => setShowLoader(true), 800);
    return () => clearTimeout(t);
  }, [pending]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries.length, showLoader]);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setInput("");
    setShowHome(false); // al preguntar, el Command Center se repliega (historial intacto)
    lastQuestionRef.current = q; // para el subtítulo consciente del tipo de consulta
    setEntries((prev) => [...prev, { role: "user", content: q }]);
    startTransition(async () => {
      const history = entries.map(({ role, content }) => ({ role, content }));
      try {
        const res = await askCopilotAction({
          sessionId: sessionIdRef.current,
          question: q,
          history,
          channel: "page",
        });
        setEntries((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.answer,
            sources: res.sources,
            visual: res.visual ?? null,
            messageId: res.messageId,
            outcome: res.outcome,
          },
        ]);
      } catch {
        // El loader se desmonta igual (pending → false); acá evitamos que la
        // espera termine "en la nada" ante un throw inesperado.
        setEntries((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "No pude completar la consulta (se interrumpió antes de terminar). Probá de nuevo en unos segundos.",
          },
        ]);
      }
    });
  };

  // Sugerencia del Manual Nexus en 'preview' (manual en Drive, aún sin ingerir):
  // brecha honesta SIN llamar al motor (no rutea a una tool ni cae en "No
  // encontré en Nexus"). Al cerrar C1.5, estas pasan a llamar a `ask`.
  const showManualPending = (label: string) => {
    setShowHome(false);
    setEntries((prev) => [
      ...prev,
      { role: "user", content: label },
      { role: "assistant", content: manualGapMessage(label) },
    ]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {entries.length === 0 && <CommandCenter demo={demo} onAsk={ask} onPreview={showManualPending} />}

        {entries.map((e, i) =>
          e.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg bg-bg-surface-alt px-3 py-2 text-xs text-fg-primary">
                {e.content}
              </div>
            </div>
          ) : (
            <div key={i} className="card max-w-[92%] px-3 py-2">
              {/* Orden ejecutivo (round UI 2026-07-07): 1) respuesta ejecutiva
                  arriba · 2) tablero/cards de apoyo · 3) fuentes colapsadas.
                  El narrativo se renderiza como markdown seguro (2026-07-08): sin
                  '**' crudos, con jerarquía y badges ejecutivos. */}
              <Markdown source={e.content} />
              {e.visual && (
                <div className="mt-3">
                  <VisualReport v={e.visual} />
                </div>
              )}
              <SourceChips sources={e.sources ?? []} />
              {e.outcome === "answered" && e.messageId && (
                <FeedbackButtons messageId={e.messageId} />
              )}
              <p className="mt-2 border-t border-stroke-soft pt-1.5 text-[10px] text-fg-muted">
                Respuesta generada por IA — verificá las fuentes citadas.
              </p>
            </div>
          )
        )}

        {/* Loader "pensando" con animación TOPS Nexus. `showLoader` ya aplica el
            delay de ~800ms → no parpadea en respuestas rápidas. Alineado como
            respuesta del asistente; se desmonta con la respuesta/el error. */}
        {showLoader && <CopilotThinkingLoader complex={isComplexQuestion(lastQuestionRef.current)} />}

        {/* Volver al Command Center tras una respuesta (smoke 2026-07-07):
            reabre las recomendaciones SIN borrar el historial del chat. */}
        {entries.length > 0 && !pending && (
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={() => setShowHome((v) => !v)}
              className="rounded-full border border-stroke-soft bg-bg-surface-alt px-3.5 py-1.5 text-[11px] font-semibold text-fg-primary transition-colors hover:bg-bg-surface hover:text-fg-link"
            >
              {showHome ? "Ocultar recomendaciones ▲" : "✨ Volver a recomendaciones"}
            </button>
          </div>
        )}
        {entries.length > 0 && showHome && !pending && (
          <CommandCenter demo={demo} onAsk={ask} onPreview={showManualPending} />
        )}
        {/* Ancla de auto-scroll: pega el chat abajo al aparecer el loader o una
            respuesta nueva (no rompe el scroll manual hacia arriba). */}
        <div ref={endRef} aria-hidden />
      </div>

      <form
        className="border-t border-stroke-soft bg-bg-surface px-4 py-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          ask(input);
        }}
      >
        <div className="flex gap-2">
          <VoiceField className="min-w-0 flex-1">
            <input
              value={input}
              onChange={(ev) => setInput(ev.target.value)}
              placeholder="Preguntá por facturación, compliance, proveedores, vacancia, contratos…"
              maxLength={2000}
              className="w-full rounded-md border border-stroke-soft bg-bg-surface-alt px-3 py-2 text-xs text-fg-primary placeholder:text-fg-muted focus:outline-none"
              aria-label="Pregunta al Copilot"
            />
          </VoiceField>
          <button
            type="submit"
            disabled={pending || input.trim().length === 0}
            className="rounded-md border border-stroke-soft bg-bg-surface-alt px-3 py-2 text-xs font-semibold text-fg-primary hover:bg-bg-surface disabled:opacity-50"
          >
            Preguntar
          </button>
        </div>
      </form>
    </div>
  );
}
