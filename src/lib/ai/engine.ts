// F5.2-lite · Engine del Copilot — el ÚNICO camino al provider.
// Orden de guards (todos fail-closed): kill-switch → sesión/piloto → presupuesto.
// Loop acotado en CÓDIGO (no en prompt): máx. env.ai.limits.toolRoundsPerRequest.
// Cita validada o silencio: citas inválidas → 1 reintento → NO_EVIDENCE.
// Toda interacción termina en auditoría (ai_log_interaction), redactada.

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { logInteraction } from "./audit";
import { checkBudget, checkMonthlyBudget } from "./budget";
import { checkGate } from "./gate";
import {
  NO_EVIDENCE,
  buildContext,
  isEmptyAnswer,
  isMetadataContentRisk,
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

  // 2. Presupuesto (D-F5-8) — antes de cualquier trabajo: diario por usuario
  // y, con provider real, tope mensual global en USD.
  const monthly = await checkMonthlyBudget(supabase);
  const budget = monthly.allowed ? await checkBudget(supabase, gate.userId) : monthly;
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
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
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
      if (res.usage) {
        usage.inputTokens += res.usage.inputTokens;
        usage.outputTokens += res.usage.outputTokens;
        usage.costUsd += res.usage.costUsd;
      }

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
      const isNoEvidence = finalAnswer.trim() === NO_EVIDENCE;
      // F5.1-b.0.1.1: una respuesta VACÍA no es una respuesta (hallazgo smoke b.0.1:
      // el modelo devolvió answered vacío sin tools ni fuentes).
      const emptyAnswer = isEmptyAnswer(finalAnswer);
      // Anti-alucinación: una afirmación de negocio con evidencia recuperada
      // DEBE citar al menos una fuente válida. Sin citas válidas (formato roto,
      // o el modelo no citó) no la damos por buena aunque no haya citas
      // "inválidas" explícitas.
      const missingCitations =
        !isNoEvidence && chunks.length > 0 && check.used.length === 0;
      if ((!check.valid || missingCitations || emptyAnswer) && !retriedCitations) {
        // Única segunda oportunidad: citó fuentes inexistentes, no citó nada, o
        // devolvió una respuesta vacía (F5.1-b.0.1.1).
        retriedCitations = true;
        continue;
      }
      if (emptyAnswer) {
        // F5.1-b.0.1.1: nunca dar por 'answered' una respuesta vacía. El modelo
        // debió citar evidencia o decir EXACTAMENTE la frase de sin-evidencia.
        answer = NO_EVIDENCE;
        outcome = "no_evidence";
        errorDetail = "empty_answer_no_sources";
      } else if (!check.valid) {
        answer = NO_EVIDENCE;
        outcome = "no_evidence";
        errorDetail = `citas inválidas: ${check.invalid.join(",")}`;
      } else if (missingCitations) {
        answer = NO_EVIDENCE;
        outcome = "no_evidence";
        errorDetail = "respuesta sin citas válidas pese a evidencia recuperada";
      } else {
        answer = finalAnswer;
        outcome = isNoEvidence ? "no_evidence" : "answered";
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

  // F5.1-b.0 · Guard estructural metadata-vs-contenido (D5 / H6): si la respuesta
  // se apoya SOLO en fichas de metadata documental y el usuario pidió CONTENIDO
  // (resumen/qué dice/cláusulas…), degradar a NO_EVIDENCE — b.0 no proyecta el texto
  // del documento, solo su ficha. Control en código; no depende del prompt.
  if (outcome === "answered") {
    const citedNow = validateCitations(answer, chunks).used;
    const citedChunksNow = chunks.filter((c) => citedNow.includes(c.sourceId));
    // Evalúa citadas Y recuperadas (chunks): fail-closed no depende de dónde el
    // modelo puso el [S#]. Follow-ups escuetos multi-turno también degradan (seguro).
    if (isMetadataContentRisk(question, citedChunksNow, chunks)) {
      answer = NO_EVIDENCE;
      outcome = "no_evidence";
      errorDetail = "riesgo metadata-vs-contenido (b.0 no proyecta el texto del documento)";
    }
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
    tokensIn: usage.inputTokens || null,
    tokensOut: usage.outputTokens || null,
    costEstimate: usage.costUsd || null,
  });

  return { sessionId: req.sessionId, messageId, outcome, answer, sources: citedSources };
}
