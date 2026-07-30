"use server";

// LINK-WA-002 · FASE 2 E1 — server actions de la bandeja de sugerencias.
// FAIL-CLOSED: sesión + rol admin verificado EN LA ACTION (misma frontera que el
// importador F1a). En E1 «aceptar» es CONCEPTUAL: marca la sugerencia y NADA más —
// no existe en este módulo ninguna llamada a RPCs de negocio.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { analyzeConversation } from "@/lib/ai/wa-analysis/analyze";

type AdminGuard = { ok: true; userId: string } | { ok: false; message: string };

async function requireAdmin(): Promise<AdminGuard> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Modo demo: análisis deshabilitado." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if ((prof as { role?: string } | null)?.role !== "admin") {
    return { ok: false, message: "Solo administradores pueden revisar sugerencias de IA." };
  }
  return { ok: true, userId: user.id };
}

export type AnalyzeActionResult =
  | {
      ok: true; runId: string; analyzed: number; emitted: number;
      /** La ventana viaja al operador: total, analizados, omitidos, caracteres,
       *  tokens y motivo del corte. Sin esto el humano nunca sabía que quedaron
       *  471 de 591 mensajes afuera. */
      window?: { total: number; included: number; omitted: number; chars: number;
                 estimatedInputTokens: number; truncated: boolean;
                 reason: string | null; detail: string };
      economics?: { provider: string; model: string | null; inputTokens: number | null;
                    outputTokens: number | null; costUsd: number | null; audited: boolean };
    }
  | { ok: false; message: string };

/** Dispara el análisis de un hilo. Acción HUMANA explícita — nunca automática. */
export async function analyzeConversationAction(raw: unknown): Promise<AnalyzeActionResult> {
  const g = await requireAdmin();
  if (!g.ok) return { ok: false, message: g.message };
  const p = z.object({ conversationId: z.string().uuid() }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const r = await analyzeConversation(p.data.conversationId);
  if (!r.ok) return { ok: false, message: r.message ?? "El análisis no produjo resultados." };
  revalidatePath("/connect/ia-sugerencias");
  return {
    ok: true, runId: r.runId!, analyzed: r.analyzed ?? 0, emitted: r.emitted ?? 0,
    window: r.window, economics: r.economics,
  };
}

export type DecisionResult = { ok: true } | { ok: false; message: string };

/**
 * Cambia el estado de una sugerencia.
 * ⚠️ E1: 'aceptada' es CONCEPTUAL — deja constancia de que el humano la considera
 * válida, pero NO crea tarea/incidencia/oportunidad/workflow. Esa ejecución llega
 * en E4 con autorización propia.
 */
export async function decideSuggestionAction(raw: unknown): Promise<DecisionResult> {
  const g = await requireAdmin();
  if (!g.ok) return { ok: false, message: g.message };
  const p = z.object({
    suggestionId: z.string().uuid(),
    status: z.enum(["pendiente", "descartada", "aceptada"]),
  }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Sin cliente de datos." };
  const { error } = await admin
    .from("ai_suggestions")
    .update({
      status: p.data.status,
      decided_by: g.userId,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // created_entity_* permanecen NULL en E1: aceptar no ejecuta nada.
    })
    .eq("id", p.data.suggestionId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/connect/ia-sugerencias");
  return { ok: true };
}
