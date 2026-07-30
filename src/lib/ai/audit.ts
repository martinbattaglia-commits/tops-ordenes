// F5.2-lite · Auditoría IA (D-F5-7). Única escritura del módulo, vía RPC
// SECURITY DEFINER ai_log_interaction (0174). Se persiste DESPUÉS de la
// redacción PII (la auditoría no debe volverse un repositorio de PII).
// En demo mode no hay DB: se loguea a consola del server y sigue.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROMPT_VERSION } from "./prompts/system.v1";
import type { CopilotOutcome, SourceChunk } from "./types";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface AuditPayload {
  sessionId: string;
  channel: "page" | "panel";
  entityContext: string | null;
  question: string;
  answer: string;
  toolsUsed: string[];
  provider: string;
  model: string;
  latencyMs: number;
  outcome: CopilotOutcome;
  errorDetail?: string | null;
  citedSources: SourceChunk[];
  tokensIn?: number | null;
  tokensOut?: number | null;
  costEstimate?: number | null;
}

/** Resultado EXPLÍCITO de la auditoría.
 *
 *  Existe porque en el camino estructurado la auditoría **es** el mecanismo de
 *  cobro: `ai_monthly_spend()` suma `ai_messages.cost_estimate` y el tope diario
 *  cuenta filas de `ai_messages`. Si la auditoría falla y nadie se entera, el
 *  analizador corre sin tope efectivo — que es exactamente lo que pasó. Devolver
 *  `null` no alcanzaba: el llamador no podía distinguir «no había cliente» de
 *  «la base rechazó la escritura». */
export type AuditResult =
  | { ok: true; messageId: string | null; persisted: boolean }
  | { ok: false; error: string };

/** Auditoría con resultado explícito. La usa el camino estructurado, que NO puede
 *  seguir adelante si el costo no quedó registrado. */
export async function logInteractionResult(
  supabase: SupabaseClient | null,
  p: AuditPayload
): Promise<AuditResult> {
  const messages = [
    {
      role: "user",
      content: p.question,
      content_hash: sha256(p.question),
    },
    {
      role: "assistant",
      content: p.answer,
      content_hash: sha256(p.answer),
      tools_used: p.toolsUsed,
      provider: p.provider,
      model: p.model,
      prompt_version: PROMPT_VERSION,
      latency_ms: p.latencyMs,
      outcome: p.outcome,
      error_detail: p.errorDetail ?? null,
      tokens_in: p.tokensIn ?? null,
      tokens_out: p.tokensOut ?? null,
      cost_estimate: p.costEstimate ?? null,
    },
  ];
  const sources = p.citedSources.map((c, i) => ({
    entity_type: c.entityType,
    entity_id: c.entityId,
    public_id: c.publicId,
    excerpt_hash: sha256(c.excerpt),
    rank: i + 1,
  }));

  if (!supabase) {
    console.info(
      `[ai/audit demo] session=${p.sessionId} outcome=${p.outcome} tools=${p.toolsUsed.join(",")} sources=${sources.length}`
    );
    // Modo demo: no hay base, así que tampoco hay gasto que contabilizar.
    return { ok: true, messageId: null, persisted: false };
  }
  const { data, error } = await supabase.rpc("ai_log_interaction", {
    p_session_id: p.sessionId,
    p_channel: p.channel,
    p_entity_context: p.entityContext,
    p_messages: messages,
    p_sources: sources,
  });
  if (error) {
    // Se registra en logs Y se devuelve al llamador. El Copilot conversacional
    // puede seguir (su auditoría es traza); el camino estructurado NO, porque
    // ahí la auditoría es el cobro.
    console.error("[ai/audit] ai_log_interaction error:", error.message);
    return { ok: false, error: error.message };
  }
  const result = data as { last_message_id?: string } | null;
  return { ok: true, messageId: result?.last_message_id ?? null, persisted: true };
}

/** Firma histórica, preservada para el Copilot conversacional: devuelve el id del
 *  mensaje assistant o null. No se cambia su comportamiento (fail-open) porque en
 *  ese camino la auditoría es traza, no control de consumo. */
export async function logInteraction(
  supabase: SupabaseClient | null,
  p: AuditPayload
): Promise<string | null> {
  const r = await logInteractionResult(supabase, p);
  return r.ok ? r.messageId : null;
}
