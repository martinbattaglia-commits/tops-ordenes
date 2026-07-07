"use client";

// F5.2-lite · Chat del Copilot (client component). Estados visibles y honestos:
// pensando / respuesta con fuentes / sin evidencia / presupuesto / error.
// Dark-mode-safe: tokens del design system, sin /opacity sobre var() (regla repo).

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { getPrincipalSections } from "@/lib/ai/copilot-suggestions";
import type { CopilotAnswer, CopilotVisual, SourceChunk } from "@/lib/ai/types";
import { askCopilotAction, copilotFeedbackAction } from "./actions";

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
        <p className="mt-2.5 text-xs font-medium text-fg-primary">💡 {v.insights.join(" ")}</p>
      )}

      {v.warnings && v.warnings.length > 0 && (
        <div className="mt-2 rounded-md border border-stroke-soft bg-bg-surface px-3 py-2">
          {v.warnings.map((w, i) => (
            <p key={i} className="text-xs text-fg-muted">
              ⚠️ {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

const HERO_BADGES = ["Read-only", "Fuentes verificables", "Piloto F5.2", "Datos Nexus"];

function SourceChips({ sources }: { sources: SourceChunk[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((s) =>
        s.url ? (
          <Link
            key={s.sourceId}
            href={s.url}
            className="rounded-full border border-stroke-soft bg-bg-surface-alt px-2 py-0.5 text-[10px] font-semibold text-fg-link hover:bg-bg-surface"
            title={s.title}
          >
            {s.sourceId} · {s.publicId ?? s.entityType}
          </Link>
        ) : (
          <span
            key={s.sourceId}
            className="rounded-full border border-stroke-soft bg-bg-surface-alt px-2 py-0.5 text-[10px] font-semibold text-fg-muted"
            title={s.title}
          >
            {s.sourceId} · {s.publicId ?? s.entityType}
          </span>
        )
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

/** Command Center: hero + recomendaciones por sección. Se muestra al inicio y
 *  puede REABRIRSE después de una respuesta (botón "Volver a recomendaciones")
 *  sin borrar el historial del chat (smoke 2026-07-07). */
function CommandCenter({ demo, onAsk }: { demo: boolean; onAsk: (q: string) => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      {/* ── Hero · command center (estándar 2026-07-07) ─────────────── */}
      <div className="card px-6 py-7 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-fg-muted">
          Centro de inteligencia · Nexus OS
        </p>
        <h2 className="mt-1.5 text-2xl font-extrabold tracking-tight text-fg-primary">
          Preguntale a Nexus
        </h2>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-fg-muted">
          Consultá, analizá y visualizá datos reales del sistema operativo:
          reportes, métricas, rankings y documentos — siempre con fuentes
          verificables.
          {demo ? " (Modo demo: datos ficticios.)" : ""}
        </p>
        <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
          {HERO_BADGES.map((b) => (
            <span
              key={b}
              className="rounded-full border border-stroke-soft bg-bg-surface-alt px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
            >
              {b}
            </span>
          ))}
        </div>
      </div>

      {/* ── Sugerencias por sección de Nexus (solo cobertura real) ──── */}
      <p className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
        Explorá por sección — o escribí tu propia pregunta
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {getPrincipalSections().map((section) => (
          <div
            key={section.id}
            className="card p-3.5 transition-colors hover:border-stroke-strong"
            style={{ borderLeft: `3px solid ${section.color}` }}
          >
            <div className="flex items-center gap-2">
              <span className="text-base" aria-hidden>
                {section.icon}
              </span>
              <p className="text-xs font-bold text-fg-primary">{section.title}</p>
            </div>
            <p className="mt-0.5 text-[10px] text-fg-muted">{section.description}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {section.prompts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onAsk(p.prompt)}
                  title={p.prompt}
                  className="rounded-lg border border-stroke-soft bg-bg-surface-alt px-2.5 py-1.5 text-[11px] font-medium text-fg-primary transition-colors hover:bg-bg-surface hover:text-fg-link"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
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

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setInput("");
    setShowHome(false); // al preguntar, el Command Center se repliega (historial intacto)
    setEntries((prev) => [...prev, { role: "user", content: q }]);
    startTransition(async () => {
      const history = entries.map(({ role, content }) => ({ role, content }));
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
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {entries.length === 0 && <CommandCenter demo={demo} onAsk={ask} />}

        {entries.map((e, i) =>
          e.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg bg-bg-surface-alt px-3 py-2 text-xs text-fg-primary">
                {e.content}
              </div>
            </div>
          ) : (
            <div key={i} className="card max-w-[92%] px-3 py-2">
              {e.visual && <VisualReport v={e.visual} />}
              <p className="whitespace-pre-wrap text-xs text-fg-primary">{e.content}</p>
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

        {pending && (
          <div className="card max-w-[92%] px-3 py-2">
            <p className="text-xs text-fg-muted">Consultando Nexus…</p>
          </div>
        )}

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
          <CommandCenter demo={demo} onAsk={ask} />
        )}
      </div>

      <form
        className="border-t border-stroke-soft bg-bg-surface px-4 py-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          ask(input);
        }}
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(ev) => setInput(ev.target.value)}
            placeholder="Preguntá por facturación, compliance, proveedores, vacancia, contratos…"
            maxLength={2000}
            className="min-w-0 flex-1 rounded-md border border-stroke-soft bg-bg-surface-alt px-3 py-2 text-xs text-fg-primary placeholder:text-fg-muted focus:outline-none"
            aria-label="Pregunta al Copilot"
          />
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
