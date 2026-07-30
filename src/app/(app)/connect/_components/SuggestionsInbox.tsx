"use client";

// LINK-WA-002 · Bandeja de revisión de sugerencias (cliente).
// Sólo lectura + cambio de estado. «Aceptar» deja constancia: no ejecuta acciones.
//
// El provider, el modelo y los topes llegan por props desde el server component
// (`ai`), nunca de un literal ni de `env`: en el cliente `process.env.AI_PROVIDER`
// no existe y el fallback lo haría decir «mock» siempre, aun corriendo Gemini.

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";
import type { SuggestionRow, RunRow } from "@/lib/ai/wa-analysis/read";
import type { AiRuntimeStatus } from "@/lib/ai/runtime-status";
import {
  analyzeConversationAction, decideSuggestionAction,
} from "@/lib/connect/adapters/driving/wa-analysis-actions";

type Thread = { id: string; title: string | null; messages: number };

/** Etiqueta del provider EFECTIVO. No inventa marcas que el entorno no declaró. */
function providerText(ai: AiRuntimeStatus): string {
  if (ai.isMock) return `Provider ${ai.provider} · ${ai.model}`;
  if (ai.provider === "gemini") return `Gemini · ${ai.model}`;
  if (ai.provider === "anthropic") return `Anthropic · ${ai.model}`;
  return `${ai.provider} · ${ai.model}`;
}

const KIND_LABEL: Record<SuggestionRow["kind"], string> = {
  clasificacion: "Clasificación",
  hallazgo: "Hallazgo",
  accion: "Acción sugerida",
};

const STATUS_STYLE: Record<SuggestionRow["status"], string> = {
  pendiente: "bg-amber-400/15 text-amber-500",
  aceptada: "bg-emerald-400/15 text-emerald-500",
  descartada: "bg-bg-surface-alt text-fg-muted",
};

function title(s: SuggestionRow): string {
  const p = s.payload as Record<string, unknown>;
  if (s.kind === "clasificacion") return `Clase: ${String(p.clase ?? "—")}`;
  if (s.kind === "hallazgo") return `${String(p.tipo ?? "—")}: ${String(p.resumen ?? "")}`;
  return String(p.titulo ?? p.accion ?? "Acción");
}

function detail(s: SuggestionRow): string {
  const p = s.payload as Record<string, unknown>;
  if (s.kind === "clasificacion") return String(p.rationale ?? "");
  if (s.kind === "hallazgo") return "";
  return String(p.detalle ?? "");
}

export function SuggestionsInbox({
  suggestions, runs, threads, ai,
}: {
  suggestions: SuggestionRow[]; runs: RunRow[]; threads: Thread[]; ai: AiRuntimeStatus;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"todas" | SuggestionRow["status"]>("todas");

  async function runAnalysis(conversationId: string) {
    setBusy(conversationId); setErr(null); setMsg(null);
    const r = await analyzeConversationAction({ conversationId });
    setBusy(null);
    if (!r.ok) { setErr(r.message); return; }
    // El operador tiene que ver QUÉ se analizó y qué quedó afuera. Antes esta
    // información existía sólo en la base: la promesa de «ningún recorte
    // silencioso» se cumplía para la auditoría y no para quien decide.
    const w = r.window;
    const eco = r.economics;
    const partes = [`Análisis completo: ${r.analyzed} mensajes → ${r.emitted} sugerencias.`];
    if (w) {
      partes.push(
        w.truncated
          ? `Ventana truncada por ${w.reason}: ${w.included} de ${w.total} mensajes · ${w.omitted} quedaron fuera · ${w.chars.toLocaleString("es-AR")} caracteres · ~${w.estimatedInputTokens.toLocaleString("es-AR")} tokens de entrada.`
          : `Ventana completa: ${w.included} mensajes · ${w.chars.toLocaleString("es-AR")} caracteres · ~${w.estimatedInputTokens.toLocaleString("es-AR")} tokens.`,
      );
    }
    if (eco) {
      partes.push(
        eco.costUsd === null
          ? `${eco.provider}${eco.model ? " · " + eco.model : ""} · costo no verificable.`
          : `${eco.provider}${eco.model ? " · " + eco.model : ""} · ${eco.inputTokens ?? "?"}/${eco.outputTokens ?? "?"} tokens · USD ${eco.costUsd.toFixed(6)}${eco.audited ? "" : " · ⚠️ NO contabilizado"}.`,
      );
    }
    setMsg(partes.join(" "));
  }

  async function decide(id: string, status: SuggestionRow["status"]) {
    setBusy(id); setErr(null);
    const r = await decideSuggestionAction({ suggestionId: id, status });
    setBusy(null);
    if (!r.ok) setErr(r.message);
  }

  const visible = filter === "todas" ? suggestions : suggestions.filter((s) => s.status === filter);

  return (
    <div className="space-y-5">
      {/* Estado EFECTIVO del entorno — leído del servidor, nunca un literal */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              ai.enabled
                ? "bg-emerald-400/15 text-emerald-500"
                : "bg-bg-surface-alt text-fg-muted",
            )}
          >
            {ai.enabled ? "IA activa" : "IA desactivada"}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              ai.isMock ? "bg-amber-400/15 text-amber-500" : "bg-nexus/15 text-nexus",
            )}
          >
            {ai.isMock ? "simulado" : "provider real"}
          </span>
          <span className="text-xs text-fg-primary">{providerText(ai)}</span>
        </div>
        <p className="mt-2 text-xs text-fg-muted">
          {ai.isMock
            ? "El análisis es determinista y no tiene costo."
            : "Cada corrida tiene costo real, medido y auditado."}{" "}
          Tope por corrida: {ai.maxMessages} mensajes · {ai.maxChars.toLocaleString("es-AR")} caracteres ·{" "}
          {ai.maxInputTokens.toLocaleString("es-AR")} tokens de entrada ·{" "}
          {ai.maxOutputTokens.toLocaleString("es-AR")} de salida. Límite diario:{" "}
          {ai.dailyLimit} análisis. Presupuesto mensual: USD {ai.monthlyBudgetUsd}.
        </p>
      </div>

      {/* Analizar un hilo — acción HUMANA explícita */}
      <div className="card p-4">
        <p className="text-sm font-semibold text-fg-primary">Analizar una conversación</p>
        {/* D-1: el tope de mensajes es un TECHO, no una promesa. Con la constante
            de tokens calibrada sobre la medición real, en hilos densos entran menos
            —el tope de entrada muerde antes—. Decirlo acá y no sólo después de la
            corrida: el operador decide antes de gastar. */}
        <p className="mt-1 text-xs text-fg-muted">
          Se analizan los mensajes más recientes: hasta {ai.maxMessages}, y menos si primero
          se alcanza el tope de {ai.maxInputTokens.toLocaleString("es-AR")} tokens de entrada
          —lo habitual en hilos largos—. Cada corrida informa cuántos entraron y cuántos
          quedaron fuera.
        </p>
        <div className="mt-3 space-y-1.5">
          {threads.length === 0 && <p className="text-xs text-fg-muted">No hay hilos de WhatsApp importados.</p>}
          {threads.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 rounded border border-stroke-soft px-3 py-2">
              <span className="min-w-0 truncate text-xs text-fg-primary">
                {t.title ?? "Sin título"} <span className="text-fg-muted">· {t.messages} mensajes</span>
              </span>
              <button
                type="button"
                className="btn btn-nexus btn-sm text-xs"
                disabled={busy === t.id}
                onClick={() => void runAnalysis(t.id)}
              >
                {busy === t.id ? "Analizando…" : "Analizar"}
              </button>
            </div>
          ))}
        </div>
        {msg && <p className="mt-2 text-xs text-emerald-500">{msg}</p>}
        {err && <p className="mt-2 text-xs text-tops-red">{err}</p>}
      </div>

      {/* Bandeja */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          {(["todas", "pendiente", "aceptada", "descartada"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "focus-nexus rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
                filter === f ? "bg-tops-red text-white" : "bg-bg-surface-alt text-fg-muted hover:text-fg-secondary",
              )}
            >
              {f === "todas" ? "Todas" : f[0].toUpperCase() + f.slice(1) + "s"}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-fg-muted">{visible.length}</span>
        </div>

        {visible.length === 0 ? (
          <p className="card p-6 text-center text-xs text-fg-muted">
            Sin sugerencias todavía. Analizá una conversación para empezar.
          </p>
        ) : (
          <div className="space-y-2">
            {visible.map((s) => (
              <div key={s.id} className="card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip text-[10px]">{KIND_LABEL[s.kind]}</span>
                  <span className={cn("chip text-[10px]", STATUS_STYLE[s.status])}>{s.status}</span>
                  {s.confidence != null && (
                    <span className="text-[10px] text-fg-muted">confianza {Math.round(s.confidence * 100)}%</span>
                  )}
                  <Link
                    href={`/connect/c/${s.conversationId}`}
                    className="ml-auto text-[11px] text-fg-link hover:underline"
                  >
                    {s.conversationTitle ?? "hilo"}
                  </Link>
                </div>
                <p className="mt-1.5 text-xs font-semibold text-fg-primary">{title(s)}</p>
                {detail(s) && <p className="mt-0.5 text-[11px] text-fg-secondary">{detail(s)}</p>}

                {s.citations.length > 0 && (
                  <div className="mt-2 space-y-1 border-l-2 border-stroke-soft pl-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                      Evidencia ({s.citations.length})
                    </p>
                    {s.citations.slice(0, 3).map((c) => (
                      <p key={c.messageId} className="text-[10px] italic text-fg-muted">
                        «{c.quote ?? c.messageId}»
                      </p>
                    ))}
                  </div>
                )}

                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-xs"
                    disabled={busy === s.id || s.status === "aceptada"}
                    onClick={() => void decide(s.id, "aceptada")}
                    title="E1: deja constancia — no crea ninguna entidad"
                  >
                    <Icon name="check" size={12} /> Aceptar
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-xs"
                    disabled={busy === s.id || s.status === "descartada"}
                    onClick={() => void decide(s.id, "descartada")}
                  >
                    <Icon name="x" size={12} /> Descartar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auditoría de corridas */}
      {runs.length > 0 && (
        <div className="card p-3">
          <p className="text-xs font-semibold text-fg-primary">Últimos análisis</p>
          <table className="mt-2 w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-stroke-soft text-[10px] uppercase text-fg-muted">
                <th className="py-1 font-semibold">Hilo</th>
                <th className="py-1 font-semibold">Resultado</th>
                <th className="py-1 font-semibold">Mensajes</th>
                <th className="py-1 font-semibold">Sugerencias</th>
                <th className="py-1 font-semibold">Provider</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-stroke-soft last:border-0">
                  <td className="py-1 text-fg-primary">{r.conversationTitle ?? "—"}</td>
                  <td className="py-1 text-fg-muted">{r.outcome}</td>
                  <td className="py-1 text-fg-muted">{r.messagesAnalyzed}</td>
                  <td className="py-1 text-fg-muted">{r.suggestionsEmitted}</td>
                  <td className="py-1 text-fg-muted">{r.provider}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
