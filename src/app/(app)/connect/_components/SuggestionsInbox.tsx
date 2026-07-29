"use client";

// LINK-WA-002 · FASE 2 E1 — Bandeja de revisión de sugerencias (cliente).
// Sólo lectura + cambio de estado. «Aceptar» es conceptual en E1: no ejecuta acciones.

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";
import type { SuggestionRow, RunRow } from "@/lib/ai/wa-analysis/read";
import {
  analyzeConversationAction, decideSuggestionAction,
} from "@/lib/connect/adapters/driving/wa-analysis-actions";

type Thread = { id: string; title: string | null; messages: number };

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
  suggestions, runs, threads,
}: {
  suggestions: SuggestionRow[]; runs: RunRow[]; threads: Thread[];
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
    setMsg(`Análisis completo: ${r.analyzed} mensajes → ${r.emitted} sugerencias.`);
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
      {/* Analizar un hilo — acción HUMANA explícita */}
      <div className="card p-4">
        <p className="text-sm font-semibold text-fg-primary">Analizar una conversación</p>
        <p className="mt-1 text-xs text-fg-muted">
          Se analizan hasta 120 mensajes por corrida. Provider mock: determinista, sin costo.
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
