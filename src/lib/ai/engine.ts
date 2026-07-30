// F5.2-lite · Engine del Copilot — el ÚNICO camino al provider.
// Orden de guards (todos fail-closed): kill-switch → sesión/piloto → presupuesto.
// Loop acotado en CÓDIGO (no en prompt): máx. env.ai.limits.toolRoundsPerRequest.
// Cita validada o silencio: citas inválidas → 1 reintento → NO_EVIDENCE.
// Toda interacción termina en auditoría (ai_log_interaction), redactada.

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { logInteraction, logInteractionResult } from "./audit";
import { checkBudget, checkMonthlyBudget } from "./budget";
import { maybeRaiseBudgetAlert, alertMessage } from "./budget-alerts";
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
import { CONTEXT_LIMITS } from "./wa-analysis/window";
import { SYSTEM_PROMPT } from "./prompts/system.v1";
import { ToolArgsError, executeTool } from "./data";
import { classifyCopilotIntent } from "./intent-classifier";
import { detectManagementIntent } from "./management-brief";
import { redactVisual } from "./visuals";
import type {
  AiProvider,
  ProviderUsage,
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
      // Capa 2: primero la Knowledge Base institucional (Drive→Nexus, mig 0185).
      // Si NO hay documentos ingestados (RPC/fixture vacío, o migración sin
      // aplicar), se cae a la brecha ESPECÍFICA (coverage) — nunca a
      // search_knowledge genérico ni a "no encontré registros en Nexus".
      const kb = await executeTool({
        tool: "company_knowledge_search",
        args: { query: question.slice(0, 200) },
      });
      if (kb.chunks.length > 0) {
        ingest(kb);
        toolsUsed.push("company_knowledge_search");
      } else {
        ingest(
          await executeTool({
            tool: "coverage_overview",
            args: { query: "institucional web servicios propuesta" },
          })
        );
        toolsUsed.push("coverage_overview");
      }
    } else if (intent.tipo === "manual_nexus") {
      // Capa Manual Nexus / Ayuda Interna (C1.5): el Manual de Usuario (capa
      // manual_nexus, Drive→KB, mig 0186). Si NO hay documentos (sin ingerir),
      // brecha ESPECÍFICA — nunca search_knowledge genérico ni "no encontré".
      const man = await executeTool({
        tool: "company_knowledge_search",
        args: { query: question.slice(0, 200), capa: "manual_nexus" },
      });
      if (man.chunks.length > 0) {
        ingest(man);
        toolsUsed.push("company_knowledge_search");
      } else {
        ingest(
          await executeTool({
            tool: "coverage_overview",
            args: { query: "manual nexus ayuda interna modulos roles flujos" },
          })
        );
        toolsUsed.push("coverage_overview");
      }
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

// ─────────────────────────────────────────────────────────────────────────────
// LINK-WA-002 · FASE 2 (IA Copiloto) — ANÁLISIS ESTRUCTURADO GOBERNADO.
//
// Segundo TIPO DE SALIDA del engine, NO un camino paralelo: vive en este mismo
// archivo y atraviesa exactamente los mismos guards que askCopilot, en el mismo
// orden fail-closed (kill-switch → sesión/piloto → presupuesto mensual → diario
// → generación → auditoría). La diferencia con askCopilot es sólo la FORMA de la
// salida: aquí se pide un objeto estructurado en vez de prosa con citas [S#].
//
// Por qué el generador se inyecta: el MockProvider del Copilot es un *planner
// conversacional* (elige tools y compone prosa citando [S#]); no puede emitir
// JSON de análisis. El generador estructurado se pasa como callback —en E1 el
// mock determinista, en E2 el provider real vía getProvider()— pero el GOBIERNO
// (kill-switch, presupuesto, auditoría, costo) es el de este engine, único.
// ─────────────────────────────────────────────────────────────────────────────

export interface StructuredRunRequest {
  /** Identidad de la corrida, generada por el caller ANTES de invocar al engine.
   *  Se usa como `session_id` de auditoría, de modo que
   *  `ai_analysis_runs.id == ai_messages.session_id` y las dos tablas se
   *  reconcilian por construcción. Debe ser un UUID único POR CORRIDA: un uuid
   *  determinista compartido haría que el RPC rechace a todo usuario que no sea
   *  el dueño de la sesión («sesión ajena») y que dos corridas concurrentes
   *  colisionen en `unique(session_id, seq)`. */
  runId: string;
  /** Prompt ya construido: evidencia delimitada y PII redactada por el caller. */
  prompt: string;
  /** Etiqueta de auditoría (p. ej. "wa_analysis"). */
  kind: string;
  /** Contexto de entidad para auditoría (p. ej. "connect_conversation:<uuid>"). */
  entityContext?: string | null;
  /** Generador de la salida cruda. Recibe el prompt y el provider del entorno.
   *  Devuelve el texto y, con provider real, el `usage` para registrar COSTO REAL. */
  generate: (
    prompt: string,
    provider: AiProvider,
  ) => Promise<{ raw: string; usage?: ProviderUsage | null; finishReason?: string | null }>;
  /** Validación de la salida, ANTES de auditar y de que el caller persista nada.
   *  El orden que fijó Dirección es: proveedor → validar → auditar la economía →
   *  persistir sugerencias → devolver éxito. */
  validate?: (raw: string) => { ok: true } | { ok: false; reason: string };
}

/** Economía y trazas de la corrida. `costUsd === null` significa NO VERIFICABLE:
 *  el proveedor no informó `usage`. Nunca se estima un costo inventado. */
export interface StructuredRunEconomics {
  /** D-3: desglose informado por el proveedor. Es dato DIAGNÓSTICO, no el registro
   *  económico: ese lo deriva la base de `ai_messages`. */
  usageBreakdown?: {
    promptTokens: number; candidatesTokens: number;
    thoughtsTokens: number; totalTokens: number;
  } | null;
  /** D-1: false cuando un tope AUTORIZADO se excedió de verdad. La estimación
   *  previa podía mentir; esto compara contra lo que el proveedor cobró. */
  conforme: boolean;
  /** Qué tope se excedió y por cuánto. null si la corrida fue conforme. */
  deviation: string | null;
  provider: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  finishReason: string | null;
  errorCode: string | null;
  /** true SÓLO si el costo quedó registrado en `ai_messages` — la fuente del tope
   *  mensual y del contador diario. */
  audited: boolean;
  latencyMs: number;
}

export type StructuredRunResult =
  | ({
      ok: true; raw: string; userId: string | null;
      budgetAlert: { raised: boolean; pct: number; spentUsd: number } | null;
    } & StructuredRunEconomics)
  | ({
      ok: false;
      outcome: "killed" | "denied" | "budget" | "error" | "invalid_output" | "audit_failure";
      /** Mensaje GOBERNADO para el usuario: sin status, sin variables, sin PII. */
      message: string;
      /** Detalle técnico SANEADO para la auditoría. Nunca el prompt ni el chat. */
      detail: string | null;
      userId: string | null;
    } & StructuredRunEconomics);

/** D-1 · ¿la corrida respetó el tope AUTORIZADO de entrada?
 *
 *  Se compara contra lo que el proveedor COBRÓ, no contra la estimación. Si no hay
 *  `usage` no se puede afirmar nada: se declara conforme por ausencia de evidencia
 *  en contra, y eso queda dicho en el motivo. */
function evaluarConformidad(inputTokensReales: number | null): {
  conforme: boolean; deviation: string | null;
} {
  const tope = CONTEXT_LIMITS.maxInputTokens;
  if (inputTokensReales === null) return { conforme: true, deviation: null };
  if (inputTokensReales <= tope) return { conforme: true, deviation: null };
  const pct = ((inputTokensReales / tope) * 100).toFixed(1);
  return {
    conforme: false,
    deviation:
      `context_limit_exceeded: el proveedor contabilizó ${inputTokensReales} tokens de ` +
      `entrada contra un tope autorizado de ${tope} (${pct} %). La estimación de la ` +
      `ventana subestimó el costo real de tokenización.`,
  };
}

export async function runStructuredAnalysis(
  req: StructuredRunRequest,
): Promise<StructuredRunResult> {
  const startedAt = Date.now();
  // 🔑 UUID por corrida. Antes era `structured:${kind}` —un string— y el RPC
  // `ai_log_interaction(p_session_id uuid, …)` lo rechazaba, así que la auditoría
  // económica NUNCA persistía y el analizador corría sin tope efectivo.
  const sessionId = req.runId;
  const auditBase = {
    sessionId,
    channel: "panel" as const,
    entityContext: req.entityContext ?? null,
    toolsUsed: [] as string[],
    citedSources: [] as SourceChunk[],
  };

  // 1. Kill-switch + sesión + gate de piloto (fail-closed) — ANTES del provider.
  const gate = await checkGate();
  if (!gate.ok) {
    // El corte se audita igual que en askCopilot (D-F5-7: es una decisión).
    await logInteraction(null, {
      ...auditBase,
      question: `[${req.kind}] análisis estructurado`,
      answer: gate.message,
      provider: env.ai.provider,
      model: "n/a",
      latencyMs: Date.now() - startedAt,
      outcome: gate.outcome,
      errorDetail: null,
    });
    return {
      ok: false, outcome: gate.outcome, message: gate.message, detail: null,
      userId: null, provider: env.ai.provider, model: null,
      inputTokens: null, outputTokens: null, costUsd: null,
      usageBreakdown: null, conforme: true, deviation: null,
      finishReason: null, errorCode: gate.outcome, audited: false,
      latencyMs: Date.now() - startedAt,
    };
  }
  const supabase = gate.demo ? null : createClient();

  // 2. Presupuesto: mensual global en USD y diario por usuario (mismo orden).
  const monthly = await checkMonthlyBudget(supabase);
  const budget = monthly.allowed ? await checkBudget(supabase, gate.userId) : monthly;
  if (!budget.allowed) {
    const reason = budget.reason ?? "Presupuesto agotado.";
    await logInteraction(supabase, {
      ...auditBase,
      question: `[${req.kind}] análisis estructurado`,
      answer: reason,
      provider: env.ai.provider,
      model: "n/a",
      latencyMs: Date.now() - startedAt,
      outcome: "budget",
      errorDetail: null,
    });
    return {
      ok: false, outcome: "budget", message: reason, detail: null,
      userId: gate.userId, provider: env.ai.provider, model: null,
      inputTokens: null, outputTokens: null, costUsd: null,
      usageBreakdown: null, conforme: true, deviation: null,
      finishReason: null, errorCode: "budget", audited: false,
      latencyMs: Date.now() - startedAt,
    };
  }

  // 3. Generación — el provider del entorno lo resuelve el engine, no el caller.
  const provider = getProvider();
  let raw: string;
  let usage: ProviderUsage | null | undefined;
  let finishOk: string | null = null;
  try {
    const out = await req.generate(req.prompt, provider);
    raw = out.raw;
    usage = out.usage;
    finishOk = (out as { finishReason?: string | null }).finishReason ?? null;
  } catch (e) {
    // El proveedor pudo haber COBRADO aunque no devolviera nada útil: Gemini
    // factura entrada y razonamiento. `GeminiStructuredError` conserva ese usage
    // para que el costo se registre; si no lo trae, se declara no verificable.
    const err = e as { message?: string; code?: string; usage?: ProviderUsage | null; finishReason?: string | null };
    const detail = redactPii(err?.message ?? String(e)).slice(0, 2000);
    const u = err?.usage ?? null;
    const eco = {
      ...evaluarConformidad(u?.inputTokens ?? null),
      usageBreakdown: u?.breakdown ?? null,
      provider: provider.name,
      model: provider.model,
      inputTokens: u?.inputTokens ?? null,
      outputTokens: u?.outputTokens ?? null,
      costUsd: u?.costUsd ?? null,
      finishReason: err?.finishReason ?? null,
      errorCode: err?.code ?? "provider_error",
      latencyMs: Date.now() - startedAt,
    };
    const audit = await logInteractionResult(supabase, {
      ...auditBase,
      question: `[${req.kind}] análisis estructurado`,
      answer: "El proveedor de IA no pudo completar el análisis.",
      provider: provider.name,
      model: provider.model,
      latencyMs: eco.latencyMs,
      outcome: "error",
      errorDetail: detail,
      tokensIn: u?.inputTokens ?? null,
      tokensOut: u?.outputTokens ?? null,
      costEstimate: u?.costUsd ?? null,
    });
    return {
      ok: false, outcome: "error",
      message: "El proveedor de IA no pudo completar el análisis.",
      detail, userId: gate.userId, ...eco, audited: audit.ok && audit.persisted,
    };
  }

  // Ausencia de `usage`: para el MOCK significa costo CERO VERIFICABLE —no llama a
  // ninguna red, su costo es 0 medido—; para un provider real significa NO
  // VERIFICABLE (null). Nunca se estima un costo inventado.
  const esMock = provider.name === "mock";
  // D-1 · POSTCHECK DE CONFORMIDAD. La guarda de contexto trabaja con una
  // ESTIMACIÓN; el proveedor cobra por tokens reales. Cuando la estimación
  // subestima —pasó: 5.147 declarados contra 10.835 cobrados— el tope autorizado
  // se excede y antes nada lo detectaba. Esto lo compara contra lo cobrado.
  const conformidad = evaluarConformidad(usage?.inputTokens ?? null);
  const ecoOk = {
    ...conformidad,
    provider: provider.name,
    model: provider.model,
    usageBreakdown: usage?.breakdown ?? null,
    inputTokens: usage?.inputTokens ?? (esMock ? 0 : null),
    outputTokens: usage?.outputTokens ?? (esMock ? 0 : null),
    costUsd: usage?.costUsd ?? (esMock ? 0 : null),
    // M3: antes se descartaba y la columna sólo se llenaba desde la excepción.
    finishReason: finishOk,
    errorCode: null as string | null,
  };

  // 3.b VALIDAR antes de auditar y antes de que el caller persista nada.
  const checked = req.validate ? req.validate(raw) : ({ ok: true } as const);
  if (!checked.ok) {
    const detail = redactPii(checked.reason).slice(0, 2000);
    // Se audita igual: el proveedor cobró. Sin esto el costo se perdía.
    const audit = await logInteractionResult(supabase, {
      ...auditBase,
      question: `[${req.kind}] análisis estructurado`,
      answer: "La IA devolvió una salida que no cumple el contrato.",
      provider: provider.name, model: provider.model,
      latencyMs: Date.now() - startedAt,
      outcome: "error", errorDetail: `salida inválida: ${detail}`,
      tokensIn: usage?.inputTokens ?? null,
      tokensOut: usage?.outputTokens ?? null,
      costEstimate: usage?.costUsd ?? null,
    });
    return {
      ok: false, outcome: "invalid_output",
      message: "La IA devolvió una salida que no cumple el contrato.",
      detail, userId: gate.userId, ...ecoOk,
      errorCode: "invalid_output", audited: audit.ok && audit.persisted,
      latencyMs: Date.now() - startedAt,
    };
  }

  // 4. Auditoría ECONÓMICA — fail-closed. Si no se pudo registrar el costo, la
  //    corrida NO es exitosa: el tope mensual y el diario se leen de
  //    `ai_messages`, así que una corrida sin auditar sería gasto sin control.
  const latencyMs = Date.now() - startedAt;
  const audit = await logInteractionResult(supabase, {
    ...auditBase,
    question: `[${req.kind}] análisis estructurado`,
    answer: redactPii(raw).slice(0, 4000),
    provider: provider.name,
    model: provider.model,
    latencyMs,
    outcome: "answered",
    errorDetail: null,
    // Costo REAL del provider (mock ⇒ 0; Gemini ⇒ estimateGeminiCostUsd sobre usage).
    tokensIn: ecoOk.inputTokens,
    tokensOut: ecoOk.outputTokens,
    costEstimate: ecoOk.costUsd,
  });
  // 🔴 Se exige `persisted`, no sólo ausencia de error. `logInteractionResult`
  // devuelve `{ok:true, persisted:false}` cuando no hay cliente de datos (modo
  // demo): con credenciales reales y DEMO_MODE activo, eso habría declarado
  // `audited=true` para una corrida SIN una sola fila en `ai_messages` — el mismo
  // defecto original, ahora con una afirmación de auditoría falsa.
  if (!audit.ok || !audit.persisted) {
    return {
      ok: false, outcome: "audit_failure",
      message: "No se pudo registrar la auditoría del análisis. La corrida se descartó.",
      detail: redactPii(audit.ok ? "auditoría no persistida (sin cliente de datos)" : audit.error).slice(0, 2000),
      userId: gate.userId, ...ecoOk,
      errorCode: "audit_failure", audited: false, latencyMs,
    };
  }

  // E1.1 · Guarda B: alerta al 70 %, una sola vez por mes y umbral.
  // Se evalúa DESPUÉS de auditar, para que el gasto de esta corrida ya cuente.
  // 🔑 NO se audita con `logInteraction`: eso insertaría un par user/assistant en
  // `ai_messages` y le consumiría al usuario una unidad de su cupo diario por un
  // evento del SISTEMA. La constancia de la alerta vive en `ai_budget_alerts`,
  // que es su registro propio y no se duplica (unique period+threshold).
  const alert = await maybeRaiseBudgetAlert(supabase, {
    provider: provider.name,
    model: provider.model,
    userId: gate.demo ? null : gate.userId,
  });
  if (alert.raised) {
    console.warn(`[ai/budget] ${alertMessage(alert)}`);
  }

  return {
    ok: true,
    raw,
    // Constatación, no literal: llegar acá implica `audit.persisted === true`.
    audited: audit.ok && audit.persisted,
    latencyMs,
    ...ecoOk,
    userId: gate.demo ? null : gate.userId,
    budgetAlert: alert.raised || alert.alreadyRaised
      ? { raised: alert.raised, pct: alert.pct, spentUsd: alert.spentUsd }
      : null,
  };
}
