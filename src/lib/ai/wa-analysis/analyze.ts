import "server-only";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { runStructuredAnalysis } from "../engine";
import { buildAnalysisPrompt, type WaMessageInput } from "./prompt";
import { mockAnalyzeRawWithProse } from "./mock-analyzer";
import { parseAnalysis, type WaAnalysis } from "./schema";

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

/** Tope duro por corrida (D2 de Dirección): máximo 120 mensajes por análisis. */
export const WINDOW_LIMIT = 120;

export type AnalyzeOutcome =
  | "ok" | "killed" | "denied" | "budget" | "invalid_output" | "error";

export interface AnalyzeResult {
  ok: boolean;
  outcome: AnalyzeOutcome;
  message?: string;
  runId?: string;
  analyzed?: number;
  emitted?: number;
  costUsd?: number;
  analysis?: WaAnalysis;
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
}

/** Auditoría propia del expediente (complementa la del engine). */
async function logRun(r: RunLog): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;
  await supabase.from("ai_analysis_runs").insert({
    ...(r.runId ? { id: r.runId } : {}),
    conversation_id: r.conversationId,
    requested_by: r.requestedBy,
    provider: env.ai.provider ?? "mock",
    model: "mock-deterministic",
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

  // (2) Prompt con evidencia delimitada y PII redactada (guardrails del módulo).
  const prompt = buildAnalysisPrompt(messages);

  // (3) EMBUDO ÚNICO: kill-switch, piloto, presupuesto y auditoría los aplica el
  //     engine. En E1 el generador es el mock determinista (costo cero); en E2 se
  //     reemplaza por el provider real SIN cambiar este gobierno.
  const run = await runStructuredAnalysis({
    prompt,
    kind: "wa_analysis",
    entityContext: `connect_conversation:${conversationId}`,
    generate: async (_p, provider) => {
      if (provider.name !== "mock") {
        // E1 admite exclusivamente mock (resolución): un provider pago no puede
        // activarse por accidente. El engine audita el error como corte gobernado.
        throw new Error(
          `E1 sólo admite provider mock (actual: ${provider.name}). Un provider real requiere autorización de Dirección.`,
        );
      }
      return mockAnalyzeRawWithProse(messages);
    },
  });

  if (!run.ok) {
    await logRun({
      conversationId, requestedBy: null, outcome: run.outcome,
      detail: run.message, analyzed: messages.length,
    });
    return { ok: false, outcome: run.outcome, message: run.message };
  }

  // (4) Validación de esquema + citas dentro de la ventana. Lo inválido NO se persiste.
  const parsed = parseAnalysis(run.raw, messages.map((m) => m.id));
  if (!parsed.ok) {
    await logRun({
      conversationId, requestedBy: run.userId, outcome: "invalid_output",
      detail: parsed.reason, analyzed: messages.length,
    });
    return { ok: false, outcome: "invalid_output", message: `Salida inválida: ${parsed.reason}` };
  }

  // (5) Persistencia — SÓLO sugerencias. Ninguna entidad de negocio se crea acá.
  const a = parsed.analysis;
  const runId = crypto.randomUUID();
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
    await logRun({
      conversationId, requestedBy: run.userId, outcome: "error",
      detail: insErr.message, analyzed: messages.length, runId,
    });
    return { ok: false, outcome: "error", message: `No se pudieron guardar las sugerencias: ${insErr.message}` };
  }

  await logRun({
    conversationId, requestedBy: run.userId, outcome: "ok",
    analyzed: messages.length, emitted: toInsert.length,
    windowFrom: messages[0]?.createdAt, windowTo: messages[messages.length - 1]?.createdAt,
    runId,
  });

  return {
    ok: true, outcome: "ok", runId,
    analyzed: messages.length, emitted: toInsert.length,
    costUsd: run.costUsd, analysis: a,
  };
}
