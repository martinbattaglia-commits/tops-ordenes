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
  emptyResultMessage,
  isEmptyAnswer,
  isMetadataContentRisk,
  redactPii,
  sanitizeQuestion,
  validateCitations,
} from "./guardrails";
import { getProvider } from "./provider";
import { SYSTEM_PROMPT } from "./prompts/system.v1";
import { ToolArgsError, executeTool } from "./data";
import { classifyCopilotIntent } from "./intent-classifier";
import { detectManagementIntent } from "./management-brief";
import { redactVisual } from "./visuals";
import type {
  CopilotAnswer,
  CopilotRequest,
  CopilotVisual,
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
  let skippedToolArgs = 0; // P1b: tool-calls salteadas por args inválidos.
  let turnVisual: CopilotVisual | null = null; // tablero determinístico del turno.

  // Ingesta de resultados de tool → chunks con sourceId + PII redactada + primer
  // tablero determinístico del turno. Compartido entre el pre-seed gerencial y
  // el loop de tool-calls del provider (misma política, un solo lugar).
  const ingest = (results: Awaited<ReturnType<typeof executeTool>>) => {
    if (!turnVisual && results.visual) turnVisual = results.visual;
    for (const partial of results.chunks) {
      chunks.push({
        ...partial,
        sourceId: `S${chunks.length + 1}`,
        // Redacción PII antes del provider Y antes de la auditoría.
        excerpt: redactPii(partial.excerpt),
        title: redactPii(partial.title),
      });
    }
  };

  try {
    // ── Pirámide de conocimiento (2026-07-07) ────────────────────────────────
    // La CAPA se decide en CÓDIGO antes que nada: Nexus (default) → contexto
    // general/actualidad → institucional/investigación (brechas declaradas) →
    // mixto. Una pregunta que NO es de Nexus jamás cae en search_knowledge ni
    // responde "no encontré registros en Nexus".
    const intent = classifyCopilotIntent(question);
    if (intent.tipo === "general_current") {
      ingest(await executeTool({ tool: "general_context", args: { tema: intent.tema } }));
      toolsUsed.push("general_context");
    } else if (intent.tipo === "company_institutional") {
      ingest(
        await executeTool({
          tool: "coverage_overview",
          args: { query: "institucional web servicios propuesta" },
        })
      );
      toolsUsed.push("coverage_overview");
    } else if (intent.tipo === "internal_research") {
      ingest(
        await executeTool({
          tool: "coverage_overview",
          args: { query: "notebooklm investigaciones capacitaciones" },
        })
      );
      toolsUsed.push("coverage_overview");
    } else if (intent.tipo === "mixed_nexus_external") {
      // Parte Nexus (determinística) + brecha externa declarada, en un turno.
      ingest(await executeTool({ tool: "billing_summary", args: { mode: "ultimo_mes" } }));
      toolsUsed.push("billing_summary");
      if (/anmat|categor/i.test(question)) {
        ingest(
          await executeTool({
            tool: "revenue_by_category_report",
            args: { periodo: "ultimo_mes" },
          })
        );
        toolsUsed.push("revenue_by_category_report");
      }
      ingest(await executeTool({ tool: "general_context", args: { tema: "dolar" } }));
      toolsUsed.push("general_context");
    }

    // ── Copiloto de gestión (paradigma 2026-07-07) ──────────────────────────
    // La intención GERENCIAL se detecta en CÓDIGO (no en prompt): el engine
    // ejecuta el management brief ANTES del provider, que recibe la evidencia
    // multi-dominio ya compuesta (secciones+riesgos+oportunidades+brechas) y el
    // tablero ejecutivo determinístico. El modelo narra y puede pedir tools
    // adicionales si le falta un dato puntual. No depende del ruteo del modelo.
    const gerencial = intent.tipo === "nexus_internal" ? detectManagementIntent(question) : null;
    if (gerencial) {
      ingest(
        await executeTool({ tool: "management_brief", args: { focus: gerencial.focus } })
      );
      toolsUsed.push("management_brief");
    }

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
        // Pirámide: conocimiento general estático → el provider responde como
        // asistente general (decidido en código, no por el modelo). El rescate
        // determinístico de arriba cubre general_current/mixed si el modelo no
        // cita la evidencia ya inyectada.
        intent: intent.tipo === "general_static" ? "general_static" : undefined,
      });
      if (res.usage) {
        usage.inputTokens += res.usage.inputTokens;
        usage.outputTokens += res.usage.outputTokens;
        usage.costUsd += res.usage.costUsd;
      }

      if (res.kind === "tool_calls" && round <= maxRounds) {
        const calls: ToolCall[] = res.toolCalls.slice(0, MAX_TOOL_CALLS_PER_ROUND);
        for (const call of calls) {
          let results;
          try {
            results = await executeTool(call);
          } catch (toolErr) {
            // P1b (fix/f5-2): una call con args inválidos del provider (p.ej. Gemini
            // fuera de rango o enum inexistente) se SALTEA, no rompe el turno. Antes
            // caía en el catch externo → outcome 'error' ("Copilot no disponible")
            // por un solo mal argumento (crash real observado en ai_messages). Los
            // errores de RPC ya los absorbe executeTool devolviendo []; acá solo
            // llegan ToolArgsError. No se suma a toolsUsed (la tool no corrió).
            if (toolErr instanceof ToolArgsError) {
              skippedToolArgs += 1;
              console.warn(
                `[ai/engine] tool ${call.tool} salteada por args inválidos:`,
                toolErr.message
              );
              continue;
            }
            throw toolErr;
          }
          toolsUsed.push(call.tool);
          // Capa visual (estándar 2026-07-07): primer tablero determinístico del
          // turno (la primera tool analítica con datos define el dashboard).
          ingest(results);
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

  // Pirámide de conocimiento · rescate NO-Nexus (review adversarial 2026-07-07):
  // una pregunta que NO es de Nexus (fecha/hora, actualidad, mixta) pre-ingesta
  // chunks de general_context con la respuesta honesta (fecha, o la limitación
  // "requiere fuente externa"). Si el modelo no la cita y el guard degradó a la
  // frase de la regla 2 ("No tengo evidencia suficiente EN NEXUS…"), esa frase
  // es EXACTAMENTE la prohibida para preguntas no-Nexus. Se compone de forma
  // determinística desde TODOS los chunks del turno (incluye la parte Nexus de
  // las mixtas + la brecha externa), nada inventado. Solo dispara cuando hubo
  // general_context (intent no-Nexus): jamás toca el flujo Nexus puro.
  if (outcome !== "answered" && chunks.some((c) => c.tool === "general_context")) {
    answer = chunks.map((c) => `${c.title}: ${c.excerpt} [${c.sourceId}]`).join("\n");
    outcome = "answered";
    errorDetail = errorDetail
      ? `${errorDetail}; general_context_rescue`
      : "general_context_rescue";
  }

  // P1a (fix/f5-2): distinguir "la tool corrió y devolvió 0 filas" (heladera vacía)
  // del fallback anti-alucinación. Si el turno terminó SIN evidencia pero se corrieron
  // tools que no trajeron filas, el mensaje honesto es de dominio ("no encontré
  // incidentes que coincidan con tu consulta"), NO el genérico. Esto NO relaja el
  // guard: es más preciso. Solo aplica cuando `answer` es EXACTAMENTE el fallback y no
  // se recuperó ningún chunk (chunks>0 = degradación por citas/metadata, se respeta).
  if (
    outcome === "no_evidence" &&
    answer === NO_EVIDENCE &&
    chunks.length === 0 &&
    toolsUsed.length > 0
  ) {
    answer = emptyResultMessage(toolsUsed);
    errorDetail = errorDetail ? `${errorDetail}; empty_tool_result` : "empty_tool_result";
  }
  // Rastro de observabilidad para args salteados (P1b), aunque el turno haya podido
  // responder con otras tools.
  if (skippedToolArgs > 0 && errorDetail === null) {
    errorDetail = `skipped_invalid_tool_args=${skippedToolArgs}`;
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

  return {
    sessionId: req.sessionId,
    messageId,
    outcome,
    answer,
    sources: citedSources,
    // Tablero visual SOLO con respuesta sustanciada: nunca se maquilla un vacío
    // ni una degradación del guard con un dashboard. Strings redactados (PII).
    visual: outcome === "answered" && turnVisual ? redactVisual(turnVisual, redactPii) : null,
  };
}
