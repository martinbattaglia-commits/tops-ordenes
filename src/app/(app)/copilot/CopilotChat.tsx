"use client";

// F5.2-lite · Chat del Copilot (client component). Estados visibles y honestos:
// pensando / respuesta con fuentes / sin evidencia / presupuesto / error.
// Dark-mode-safe: tokens del design system, sin /opacity sobre var() (regla repo).

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import type { CopilotAnswer, SourceChunk } from "@/lib/ai/types";
import { askCopilotAction, copilotFeedbackAction } from "./actions";

interface ChatEntry {
  role: "user" | "assistant";
  content: string;
  sources?: SourceChunk[];
  messageId?: string | null;
  outcome?: CopilotAnswer["outcome"];
}

const SUGERENCIAS = [
  "¿Qué incidentes críticos están abiertos?",
  "¿Qué tareas están vencidas?",
  "¿Qué pasó hoy en operaciones?",
  "¿Qué documentos de compliance están pendientes?",
  "¿Qué debería mirar primero mañana?",
];

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

export function CopilotChat({ demo }: { demo: boolean }) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
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
          messageId: res.messageId,
          outcome: res.outcome,
        },
      ]);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {entries.length === 0 && (
          <div className="card p-4">
            <p className="text-xs font-semibold text-fg-primary">
              Preguntale al Copilot sobre la operación
            </p>
            <p className="mt-1 text-[11px] text-fg-muted">
              Responde solo con datos de Nexus y cita sus fuentes. Si no hay
              evidencia, te lo dice.
              {demo ? " (Modo demo: datos ficticios.)" : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="rounded-full border border-stroke-soft bg-bg-surface-alt px-2.5 py-1 text-[11px] text-fg-primary hover:bg-bg-surface"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {entries.map((e, i) =>
          e.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg bg-bg-surface-alt px-3 py-2 text-xs text-fg-primary">
                {e.content}
              </div>
            </div>
          ) : (
            <div key={i} className="card max-w-[92%] px-3 py-2">
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
            placeholder="Preguntá sobre incidentes, tareas, compliance…"
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
