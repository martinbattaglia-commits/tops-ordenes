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
}

/** Devuelve el id del mensaje assistant auditado (para feedback) o null. */
export async function logInteraction(
  supabase: SupabaseClient | null,
  p: AuditPayload
): Promise<string | null> {
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
    return null;
  }
  const { data, error } = await supabase.rpc("ai_log_interaction", {
    p_session_id: p.sessionId,
    p_channel: p.channel,
    p_entity_context: p.entityContext,
    p_messages: messages,
    p_sources: sources,
  });
  if (error) {
    // La auditoría fallida NO rompe la respuesta al usuario, pero queda
    // registrada en server logs (punto de la revisión adversarial §19.7).
    console.error("[ai/audit] ai_log_interaction error:", error.message);
    return null;
  }
  const result = data as { last_message_id?: string } | null;
  return result?.last_message_id ?? null;
}
