// F5.2-lite · Engine del Copilot — el ÚNICO camino al provider.
// Orden de guards (todos fail-closed): kill-switch → sesión/piloto → presupuesto.
// Loop acotado en CÓDIGO (no en prompt): máx. env.ai.limits.toolRoundsPerRequest.
// Cita validada o silencio: citas inválidas → 1 reintento → NO_EVIDENCE.
// Toda interacción termina en auditoría (ai_log_interaction), redactada.

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { logInteraction } from "./audit";
import { checkBudget } from "./budget";
import { checkGate } from "./gate";
import {
  NO_EVIDENCE,
  buildContext,
  redactPii,
  sanitizeQuestion,
  validateCitations,
} from "./guardrails";
import { getProvider } from "./provider";
import { SYSTEM_PROMPT } from "./prompts/system.v1";
import { executeTool } from "./data";
import type {
  CopilotAnswer,
  CopilotRequest,
  SourceChunk,
  ToolCall,
} from "./types";

const MAX_TOOL_CALLS_PER_ROUND = 3;

export async function askCopilot(req: CopilotRequest): Promise<CopilotAnswer> {
  const startedAt = Date.now();
  const question = sanitizeQuestion(req.question);
  const base = { sessionId: req.sessionId, messageId: null as string | null };

  // 1. Kill-switch + sesión + gate de piloto (fail-closed).
  const gate = await checkGate();
  if (!gate.ok) {
    return { ...base, outcome: gate.outcome, answer: gate.message, sources: [] };
  }
  if (!question || question.length < 2) {
    return { ...base, outcome: "no_evidence", answer: NO_EVIDENCE, sources: [] };
  }
  const supabase = gate.demo ? null : createClient();

  // 2. Presupuesto (D-F5-8) — antes de cualquier trabajo.
  const budget = await checkBudget(supabase, gate.userId);
  if (!budget.allowed) {
    const budgetAnswer = budget.reason ?? "Presupuesto diario agotado.";
    // D-F5-7: el corte por presupuesto también se audita (es una decisión).
    await logInteraction(supabase, {
      sessionId: req.sessionId,
      channel: req.channel,
      entityContext: req.entityContext ?? null,
      question: redactPii(question),
      answer: budgetAnswer,
      toolsUsed: [],
      provider: env.ai.provider,
      model: "n/a",
      latencyMs: Date.now() - startedAt,
      outcome: "budget",
      errorDetail: null,
      citedSources: [],
    });
    return { ...base, outcome: "budget", answer: budgetAnswer, sources: [] };
  }

  // 3. Historia acotada (tope de turnos por sesión).
  const history = req.history.slice(-env.ai.limits.maxTurnsPerSession);

  const provider = getProvider();
  const chunks: SourceChunk[] = [];
  const toolsUsed: string[] = [];
  let answer: string = NO_EVIDENCE;
  let outcome: CopilotAnswer["outcome"] = "no_evidence";
  let errorDetail: string | null = null;
  let retriedCitations = false;

  try {
    const maxRounds = env.ai.limits.toolRoundsPerRequest;
    let round = 1;
    while (round <= maxRounds + 1) {
      const { included } = buildContext(chunks, env.ai.limits.maxContextChars);
      const res = await provider.plan({
        system: SYSTEM_PROMPT,
        question,
        history,
        chunks: included,
        round,
        maxRounds,
        retryAfterInvalidCitations: retriedCitations,
      });

      if (res.kind === "tool_calls" && round <= maxRounds) {
        const calls: ToolCall[] = res.toolCalls.slice(0, MAX_TOOL_CALLS_PER_ROUND);
        for (const call of calls) {
          const results = await executeTool(call);
          toolsUsed.push(call.tool);
          for (const partial of results) {
            chunks.push({
              ...partial,
              sourceId: `S${chunks.length + 1}`,
              // Redacción PII antes del provider Y antes de la auditoría.
              excerpt: redactPii(partial.excerpt),
              title: redactPii(partial.title),
            });
          }
        }
        round += 1;
        continue;
      }

      // Respuesta final (o se agotaron las rondas).
      const finalAnswer = res.kind === "final" ? res.answer : NO_EVIDENCE;
      const check = validateCitations(finalAnswer, chunks);
      if (!check.valid && !retriedCitations) {
        // Única segunda oportunidad: el provider citó fuentes inexistentes.
        retriedCitations = true;
        continue;
      }
      if (!check.valid) {
        answer = NO_EVIDENCE;
        outcome = "no_evidence";
        errorDetail = `citas inválidas: ${check.invalid.join(",")}`;
      } else {
        answer = finalAnswer;
        outcome = finalAnswer.trim() === NO_EVIDENCE ? "no_evidence" : "answered";
      }
      break;
    }
  } catch (err) {
    answer =
      "El Copilot no está disponible en este momento. Probá de nuevo más tarde.";
    outcome = "error";
    errorDetail = err instanceof Error ? err.message : String(err);
    console.error("[ai/engine] error:", errorDetail);
  }

  // Fuentes efectivamente citadas (solo esas van a UI y auditoría).
  const cited = validateCitations(answer, chunks).used;
  const citedSources = chunks.filter((c) => cited.includes(c.sourceId));

  // 4. Auditoría SIEMPRE (D-F5-7) — incluida la decisión de no responder.
  const messageId = await logInteraction(supabase, {
    sessionId: req.sessionId,
    channel: req.channel,
    entityContext: req.entityContext ?? null,
    question: redactPii(question),
    answer,
    toolsUsed,
    provider: provider.name,
    model: provider.model,
    latencyMs: Date.now() - startedAt,
    outcome,
    errorDetail,
    citedSources,
  });

  return { sessionId: req.sessionId, messageId, outcome, answer, sources: citedSources };
}
