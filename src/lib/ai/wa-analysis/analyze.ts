import "server-only";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { runStructuredAnalysis } from "../engine";
import { buildAnalysisPrompt, SYSTEM_PROMPT, type WaMessageInput } from "./prompt";
import { buildWindow, describeWindow, CONTEXT_LIMITS } from "./window";
import { mockAnalyzeRawWithProse } from "./mock-analyzer";
import { parseAnalysis, type WaAnalysis } from "./schema";
import { redactPii } from "../guardrails";
import { createHash } from "node:crypto";

/**
 * LINK-WA-002 · FASE 2 E1 — Análisis de un hilo de WhatsApp.
 *
 * GARANTÍA 1 — EMBUDO ÚNICO (remediación, resolución de Dirección): la generación
 * pasa OBLIGATORIAMENTE por `engine.runStructuredAnalysis`, que aplica el mismo
 * gobierno que el Copilot y en el mismo orden fail-closed: kill-switch → sesión/
 * piloto → presupuesto mensual → presupuesto diario → provider del entorno →
 * auditoría. Este módulo NO llama a `getProvider()` ni a ningún provider.
 *
 * GARANTÍA 2 — SIN ESCRITURA LATERAL: no importa acciones ni RPCs de negocio.
 * Sólo escribe en `ai_suggestions` / `ai_analysis_runs`. La única ruta a crear
 * una entidad real es la confirmación humana, en otro módulo, en otra etapa (E4).
 *
 * GARANTÍA 3 — RETRIEVAL POR SESIÓN (invariante de `src/lib/ai`, tools.test.ts):
 * se lee y escribe con la SESIÓN del humano, nunca con service_role ⇒ la RLS es
 * la frontera: un hilo que el usuario no ve devuelve cero mensajes.
 */

/** Tope de mensajes por corrida (D2). Los otros tres límites viven en window.ts
 *  y se aplican SIMULTÁNEAMENTE (E1.1 guarda A). */
export const WINDOW_LIMIT = CONTEXT_LIMITS.maxMessages;

/** Tipo de análisis. Junto con la conversación forma la clave del candado. */
export const ANALYSIS_KIND = "wa_analysis";

export type AnalyzeOutcome =
  | "ok" | "killed" | "denied" | "budget" | "invalid_output"
  | "audit_failure"   // el proveedor respondió pero el costo no pudo registrarse
  | "en_curso"        // otra corrida equivalente está activa (candado)
  | "error";

export interface AnalyzeResult {
  ok: boolean;
  outcome: AnalyzeOutcome;
  message?: string;
  runId?: string;
  analyzed?: number;
  emitted?: number;
  costUsd?: number | null;
  /** Economía de la corrida, para que el operador la vea sin consultar la base. */
  economics?: {
    provider: string; model: string | null;
    inputTokens: number | null; outputTokens: number | null;
    costUsd: number | null; audited: boolean;
    usageBreakdown?: { promptTokens: number; candidatesTokens: number; thoughtsTokens: number; totalTokens: number } | null;
    conforme?: boolean; deviation?: string | null;
  };
  analysis?: WaAnalysis;
  /** E1.1 guarda A: qué entró, qué quedó afuera y por qué. Nunca un recorte silencioso. */
  window?: {
    included: number; omitted: number; total: number;
    chars: number; estimatedInputTokens: number;
    truncated: boolean; reason: string | null; detail: string;
  };
}

interface RunLog {
  conversationId: string;
  requestedBy: string | null;
  outcome: AnalyzeOutcome;
  detail?: string;
  analyzed?: number;
  emitted?: number;
  windowFrom?: string | null;
  windowTo?: string | null;
  runId?: string;
  /** Provider y modelo REALES de la corrida (mock o gemini). */
  provider?: string;
  model?: string | null;
}

/** Huella CANÓNICA de la ventana analizada.
 *
 *  Es la evidencia de entrada: fija QUÉ se analizó, de modo que la auditoría no
 *  dependa de volver a leer los mensajes (que pueden cambiar o borrarse). Incluye
 *  id, autor, timestamp y cuerpo YA REDACTADO, en orden, con separadores que no
 *  pueden confundirse con contenido. Cambiar un solo mensaje cambia el hash.
 *
 *  Antes esta columna existía (`0213`) y NUNCA se escribía, así que la garantía de
 *  integridad de evidencia de `0215` —que la deriva de acá— estaba vacía. */
export function canonicalWindowSha256(messages: WaMessageInput[]): string {
  // 🔴 Serialización INEQUÍVOCA. La versión anterior unía los campos con
  // separadores de control (\u001f/\u001e) y el cuerpo iba último sin escapar:
  // un mensaje que contuviera esos bytes podía imitar la frontera y hacer que dos
  // ventanas distintas dieran el MISMO hash —verificado con una prueba de
  // concepto—. Eso anulaba la integridad de evidencia que 0215 deriva de acá.
  // JSON.stringify escapa lo necesario y hace la estructura no ambigua.
  const canonical = JSON.stringify(
    messages.map((m) => [m.id, m.createdAt, m.author, redactPii(m.body ?? "")]),
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Cierre GOBERNADO de la corrida.
 *
 *  Pasa por `ai_finalize_analysis_run` y no por un UPDATE directo, porque `0216`
 *  revocó UPDATE a `authenticated` —la auditoría no se edita— y el RPC
 *  `security definer` es la única transición autorizada: sólo el dueño, sólo desde
 *  `en_curso`, y jamás de vuelta a `en_curso`. */
export async function finalizeRun(a: {
  /** Cliente inyectado: antes esta función creaba el suyo, lo que la volvía
   *  inverificable —y la regresión «devolver true ante error del RPC» se colaba
   *  por eso—. Inyectarlo también evita instanciar un cliente de más. */
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> } | null;
  runId: string;
  outcome: AnalyzeOutcome;
  economics: {
    provider: string; model: string | null;
    inputTokens: number | null; outputTokens: number | null;
    costUsd: number | null; audited: boolean;
    usageBreakdown?: { promptTokens: number; candidatesTokens: number; thoughtsTokens: number; totalTokens: number } | null;
    conforme?: boolean; deviation?: string | null;
  };
  detail: string;
  finishReason: string | null;
  errorCode: string | null;
  analyzed: number;
  emitted: number;
  win: { included: WaMessageInput[] };
}): Promise<boolean> {
  const { supabase } = a;
  if (!supabase) return false;
  const { error } = await supabase.rpc("ai_finalize_analysis_run", {
    p_run_id: a.runId,
    p_outcome: a.outcome,
    p_provider: a.economics.provider,
    p_model: a.economics.model,
    p_messages: a.analyzed,
    p_emitted: a.emitted,
    // La economía la DERIVA el RPC de `ai_messages`: no se declara desde el
    // cliente. Antes viajaba por parámetro y un admin podía cerrar una corrida
    // afirmando `audited=true, cost_usd=0` desde el navegador.
    p_finish_reason: a.finishReason,
    p_error_code: a.errorCode,
    p_detail: a.detail,
    // D-3 diagnóstico y D-1 conformidad. La economía sigue derivándose en la base.
    p_provider_usage: a.economics.usageBreakdown ?? null,
    p_conforme: a.economics.conforme ?? true,
    p_deviation: a.economics.deviation ?? null,
    p_window_from: a.win.included[0]?.createdAt ?? null,
    p_window_to: a.win.included[a.win.included.length - 1]?.createdAt ?? null,
  });
  if (error) {
    // Queda `en_curso` y el candado la vencerá; se registra para no perderlo.
    console.error("[wa-analysis] no se pudo cerrar la corrida:", error.message);
    return false;
  }
  return true;
}

/** Auditoría de cortes ANTERIORES al candado (todavía no hay corrida reclamada). */
async function logRun(r: RunLog): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;
  await supabase.from("ai_analysis_runs").insert({
    ...(r.runId ? { id: r.runId } : {}),
    conversation_id: r.conversationId,
    requested_by: r.requestedBy,
    provider: r.provider ?? env.ai.provider ?? "mock",
    model: r.model ?? null,
    messages_analyzed: r.analyzed ?? 0,
    window_from: r.windowFrom ?? null,
    window_to: r.windowTo ?? null,
    outcome: r.outcome,
    detail: r.detail ?? null,
    suggestions_emitted: r.emitted ?? 0,
  });
}

export async function analyzeConversation(
  conversationId: string,
  opts: { limit?: number } = {},
): Promise<AnalyzeResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, outcome: "error", message: "Sin cliente de datos." };

  // (1) Ventana acotada (D2): los N mensajes más recientes, en orden cronológico,
  //     con fechas, autores y referencia al mensaje fuente. RLS de por medio.
  const limit = Math.min(Math.max(opts.limit ?? WINDOW_LIMIT, 1), WINDOW_LIMIT);
  // Total REAL del hilo: sin esto, un hilo de 500 mensajes se reportaría como
  // «ventana completa de 120» y el recorte de la consulta quedaría invisible.
  const { count: totalInThread } = await supabase
    .from("connect_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);
  const { data: rows, error } = await supabase
    .from("connect_messages")
    .select("id, body, created_at, author_participant_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    await logRun({ conversationId, requestedBy: null, outcome: "error", detail: error.message });
    return { ok: false, outcome: "error", message: error.message };
  }
  const raw = (rows ?? []) as Array<{
    id: string; body: string | null; created_at: string; author_participant_id: string | null;
  }>;
  // Sin filas puede significar hilo vacío O sin acceso por RLS: en ambos casos, nada que analizar.
  if (raw.length === 0) {
    await logRun({ conversationId, requestedBy: null, outcome: "error", detail: "sin mensajes accesibles" });
    return { ok: false, outcome: "error", message: "No hay mensajes accesibles en esta conversación." };
  }

  const { data: parts } = await supabase
    .from("connect_participants")
    .select("id, external_ref")
    .eq("conversation_id", conversationId);
  const authorById = new Map(
    ((parts ?? []) as Array<{ id: string; external_ref: { display_name?: string } | null }>)
      .map((p) => [p.id, p.external_ref?.display_name ?? "Participante"]),
  );

  const messages: WaMessageInput[] = raw
    .slice()
    .reverse() // cronológico ascendente (D2: preserva el orden real)
    .map((m) => ({
      id: m.id,
      author: m.author_participant_id ? (authorById.get(m.author_participant_id) ?? "Participante") : "Participante",
      createdAt: m.created_at,
      body: m.body ?? "",
    }));

  // (2) E1.1 guarda A — CONTEXTO: los cuatro límites a la vez (120 mensajes ·
  //     24.000 caracteres · 8.000 tokens de entrada · 2.000 de salida). Los
  //     mensajes entran COMPLETOS; lo que queda afuera se reporta con motivo.
  const win = buildWindow(messages, {}, totalInThread ?? messages.length);
  const windowMeta = {
    included: win.included.length, omitted: win.omitted, total: win.total,
    chars: win.chars, estimatedInputTokens: win.estimatedInputTokens,
    truncated: win.truncated, reason: win.reason, detail: describeWindow(win),
  };
  if (win.included.length === 0) {
    await logRun({ conversationId, requestedBy: null, outcome: "error", detail: "ventana vacía" });
    return { ok: false, outcome: "error", message: "No se pudo construir una ventana de análisis.", window: windowMeta };
  }

  // (3) Prompt con evidencia delimitada y PII redactada (guardrails del módulo).
  const prompt = buildAnalysisPrompt(win.included);
  const inputSha256 = canonicalWindowSha256(win.included);

  // (4) CANDADO DE SERVIDOR. Antes el único freno era un `disabled` de React: dos
  //     pestañas o un doble clic producían dos llamadas al proveedor, dos cargos
  //     reales y dos juegos de sugerencias. Ahora la corrida se RECLAMA en la base
  //     con un índice único parcial; una segunda equivalente es rechazada.
  const runId = crypto.randomUUID();
  const { data: claim, error: claimErr } = await supabase.rpc("ai_claim_analysis_run", {
    p_run_id: runId,
    p_conversation_id: conversationId,
    p_analysis_kind: ANALYSIS_KIND,
    p_input_sha256: inputSha256,
    p_messages: win.included.length,
  });
  if (claimErr) {
    return { ok: false, outcome: "error", message: "No se pudo iniciar el análisis.", window: windowMeta };
  }
  const claimed = claim as { ok?: boolean; reason?: string; mismo_usuario?: boolean } | null;
  if (!claimed?.ok) {
    return {
      ok: false, outcome: "en_curso",
      message: claimed?.mismo_usuario
        ? "Ya hay un análisis en curso sobre esta conversación. Esperá que termine."
        : "Otro usuario está analizando esta conversación en este momento.",
      window: windowMeta,
    };
  }

  // (5) Desde acá el candado está TOMADO: todo lo que siga va dentro de try, para
  //     que ninguna excepción deje el hilo bloqueado ni un cargo sin auditar.
  try {
    return await ejecutarCorrida({
      supabase, conversationId, runId, win, windowMeta, prompt,
    });
  } catch (e) {
    const detail = String(e instanceof Error ? e.message : e).slice(0, 500);
    await finalizeRun({
      supabase, runId, outcome: "error",
      economics: { provider: env.ai.provider ?? "mock", model: null, inputTokens: null, outputTokens: null, costUsd: null, audited: false },
      detail: `excepción no prevista: ${detail} · ${describeWindow(win)}`,
      finishReason: null, errorCode: "unhandled", analyzed: win.included.length, emitted: 0, win,
    });
    return { ok: false, outcome: "error", message: "El análisis se interrumpió.", window: windowMeta, runId };
  }
}

/** Cuerpo de la corrida, ya con el candado tomado. Separado para que el
 *  `try/finally` del llamador no dependa de la disciplina de cada `return`. */
async function ejecutarCorrida(c: {
  supabase: NonNullable<ReturnType<typeof createClient>>;
  conversationId: string;
  runId: string;
  win: ReturnType<typeof buildWindow>;
  windowMeta: NonNullable<AnalyzeResult["window"]>;
  prompt: string;
}): Promise<AnalyzeResult> {
  const { supabase, conversationId, runId, win, windowMeta, prompt } = c;

  // EMBUDO ÚNICO. El engine aplica kill-switch, piloto, presupuesto, valida la
  //     salida y audita la ECONOMÍA en `ai_messages` — que es de donde salen el
  //     tope mensual y el diario. Su `runId` es el mismo de la corrida, así que
  //     `ai_analysis_runs.id == ai_messages.session_id`.
  const run = await runStructuredAnalysis({
    runId,
    prompt,
    kind: ANALYSIS_KIND,
    entityContext: `connect_conversation:${conversationId}`,
    validate: (raw) => {
      const p = parseAnalysis(raw, win.included.map((m) => m.id));
      return p.ok ? { ok: true } : { ok: false, reason: p.reason };
    },
    generate: async (builtPrompt, provider) => {
      if (provider.name === "mock") {
        // Costo CERO VERIFICABLE, distinto de «no verificable»: el mock no llama a
        // ninguna red, así que su costo es 0 medido, no una ausencia de dato.
        return {
          raw: mockAnalyzeRawWithProse(win.included),
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        };
      }
      // `usage` es NULLABLE por contrato: un proveedor puede no informar uso, y en
      // ese caso el costo es no verificable. El cast anterior lo declaraba no
      // nullable, así que TypeScript no habría protegido una regresión a `?? 0`.
      const g = provider as {
        generateJson?: (o: { system: string; prompt: string; maxOutputTokens: number }) => Promise<{
          text: string;
          finishReason: string | null;
          usage: { inputTokens: number; outputTokens: number; costUsd: number } | null;
        }>;
      };
      if (typeof g.generateJson === "function") {
        const out = await g.generateJson({
          system: SYSTEM_PROMPT,
          prompt: builtPrompt,
          maxOutputTokens: CONTEXT_LIMITS.maxOutputTokens,
        });
        return { raw: out.text, usage: out.usage, finishReason: out.finishReason };
      }
      throw new Error(
        `El provider "${provider.name}" no soporta salida estructurada. Autorizados: mock y gemini.`,
      );
    },
  });

  const economics = {
    provider: run.provider, model: run.model,
    inputTokens: run.inputTokens, outputTokens: run.outputTokens,
    costUsd: run.costUsd, audited: run.audited,
    usageBreakdown: run.usageBreakdown ?? null,
    conforme: run.conforme, deviation: run.deviation,
  };
  const ventana = describeWindow(win);

  // (6) Si el engine no llegó a un éxito auditado, se cierra la corrida y NO se
  //     emite ninguna sugerencia. Vale para `audit_failure`: una corrida cuyo
  //     costo no se pudo registrar NO es una corrida completada.
  if (!run.ok) {
    await finalizeRun({
      supabase, runId, outcome: run.outcome, economics,
      detail: `${run.message} · ${ventana}`,
      finishReason: run.finishReason, errorCode: run.errorCode,
      analyzed: win.included.length, emitted: 0, win,
    });
    return {
      ok: false, outcome: run.outcome, message: run.message,
      window: windowMeta, economics, costUsd: run.costUsd, runId,
    };
  }

  // (7) La salida ya fue validada por el engine ANTES de auditar; acá sólo se
  //     reconstruye el objeto tipado para persistir.
  const parsed = parseAnalysis(run.raw, win.included.map((m) => m.id));
  if (!parsed.ok) {
    await finalizeRun({
      supabase, runId, outcome: "invalid_output", economics,
      detail: `${parsed.reason} · ${ventana}`,
      finishReason: run.finishReason, errorCode: "invalid_output",
      analyzed: win.included.length, emitted: 0, win,
    });
    return { ok: false, outcome: "invalid_output", message: `Salida inválida: ${parsed.reason}`, window: windowMeta, economics, runId };
  }

  // (8) Persistencia — SÓLO sugerencias. Ninguna entidad de negocio se crea acá.
  const a = parsed.analysis;
  const meta = { provider: run.provider, model: run.model };
  const toInsert = [
    {
      run_id: runId, conversation_id: conversationId, kind: "clasificacion",
      payload: a.clasificacion as unknown as Record<string, unknown>,
      citations: a.clasificacion.citations, confidence: a.clasificacion.confidence, ...meta,
    },
    ...a.hallazgos.map((h) => ({
      run_id: runId, conversation_id: conversationId, kind: "hallazgo",
      payload: h as unknown as Record<string, unknown>,
      citations: h.citations, confidence: h.confidence, ...meta,
    })),
    ...a.acciones.map((x) => ({
      run_id: runId, conversation_id: conversationId, kind: "accion",
      payload: x as unknown as Record<string, unknown>,
      citations: x.citations, confidence: x.confidence, ...meta,
    })),
  ];

  const { error: insErr } = await supabase.from("ai_suggestions").insert(toInsert);
  if (insErr) {
    await finalizeRun({
      supabase, runId, outcome: "error", economics,
      detail: `no se pudieron guardar las sugerencias: ${insErr.message} · ${ventana}`,
      finishReason: run.finishReason, errorCode: "suggestions_insert",
      analyzed: win.included.length, emitted: 0, win,
    });
    return { ok: false, outcome: "error", message: `No se pudieron guardar las sugerencias: ${insErr.message}`, window: windowMeta, economics, runId };
  }

  const cerrada = await finalizeRun({
    supabase, runId, outcome: "ok", economics, detail: ventana,
    finishReason: run.finishReason, errorCode: null,
    analyzed: win.included.length, emitted: toInsert.length, win,
  });
  if (!cerrada) {
    // Las sugerencias ya se insertaron y no se pueden retirar —`authenticated` no
    // tiene DELETE, por 0216—. Pero NO se declara éxito: quedarían sugerencias
    // visibles cuya corrida figura sin cerrar, y el operador tiene que saberlo.
    return {
      ok: false, outcome: "error", runId,
      message: "El análisis se completó pero no se pudo cerrar su registro. Revisá la corrida antes de usar las sugerencias.",
      analyzed: win.included.length, emitted: toInsert.length,
      window: windowMeta, economics, costUsd: run.costUsd,
    };
  }

  return {
    ok: true, outcome: "ok", runId,
    analyzed: win.included.length, emitted: toInsert.length,
    costUsd: run.costUsd, analysis: a, window: windowMeta, economics,
  };
}
