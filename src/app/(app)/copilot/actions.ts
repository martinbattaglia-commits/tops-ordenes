"use server";

// F5.2-lite · Server actions del Copilot. NO son endpoints públicos: corren
// con la sesión del usuario (middleware default) y el engine re-verifica
// kill-switch + gate de piloto + presupuesto en cada llamada (fail-closed).

import { z } from "zod";
import { askCopilot } from "@/lib/ai/engine";
import { isMock } from "@/lib/ai/gate";
import { createClient } from "@/lib/supabase/server";
import type { CopilotAnswer } from "@/lib/ai/types";

const askSchema = z.object({
  sessionId: z.string().uuid(),
  question: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      })
    )
    .max(20)
    .default([]),
  channel: z.enum(["page", "panel"]).default("page"),
  entityContext: z.string().max(120).nullish(),
});

export async function askCopilotAction(input: unknown): Promise<CopilotAnswer> {
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) {
    return {
      sessionId: "",
      messageId: null,
      outcome: "error",
      answer: "Consulta inválida.",
      sources: [],
    };
  }
  const { sessionId, question, history, channel, entityContext } = parsed.data;
  return askCopilot({ sessionId, question, history, channel, entityContext });
}

const feedbackSchema = z.object({
  messageId: z.string().uuid(),
  verdict: z.enum(["up", "down"]),
  reason: z.string().max(500).optional(),
});

export async function copilotFeedbackAction(
  input: unknown
): Promise<{ ok: boolean }> {
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  if (isMock()) return { ok: true }; // demo: sin DB, feedback no persiste
  const supabase = createClient();
  if (!supabase) return { ok: false };
  const { error } = await supabase.rpc("ai_set_feedback", {
    p_message_id: parsed.data.messageId,
    p_verdict: parsed.data.verdict,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    console.error("[ai/feedback] error:", error.message);
    return { ok: false };
  }
  return { ok: true };
}
