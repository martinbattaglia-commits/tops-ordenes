import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import type { OutboxProcessor, OutboxRow, ProcessResult } from "./dispatch";
import { evaluateRule, type AutomationRuleRow } from "./automation-rules";

/**
 * automations.ts — F4.4-E4 · Processor de automatizaciones MVP para el worker
 * del outbox (reemplaza a `governanceProcessor` en el route, manteniendo su
 * compat: topic sin reglas ⇒ `skipped`, exactamente como F4.1 drenaba).
 *
 * Protocolo de idempotencia (UNIQUE(rule_key, outbox_seq) en automation_runs):
 *   1. CLAIM: insert del run con on-conflict-do-nothing. Sin fila insertada ⇒
 *      la regla YA se evaluó para este evento (re-entrega del worker) ⇒ skip.
 *   2. Evaluar (puro). No dispara ⇒ run queda 'skipped' con la razón.
 *   3. Dispara ⇒ efecto (insert interno en notifications) ⇒ run 'fired'.
 *   4. Efecto falla ⇒ se LIBERA el claim (delete) y se reporta error ⇒ el
 *      worker aplica backoff/dead-letter y la re-entrega puede reintentar
 *      sin duplicar lo ya disparado por otras reglas.
 *
 * Fail-closed (D-F44-6): si las reglas no pueden leerse por un error real de
 * infraestructura ⇒ el evento queda `failed` (backoff), NUNCA "asumir que sí".
 * Excepción deliberada: tabla inexistente (mig 0172 sin aplicar) ⇒ `skipped`,
 * para que el drenado del backlog no dependa del orden de la ventana.
 */

/** Códigos PostgREST/Postgres de "la tabla no existe" (mig 0172 no aplicada). */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205", "PGRST202"]);

export const automationProcessor: OutboxProcessor = async (row: OutboxRow): Promise<ProcessResult> => {
  const admin = createAdminClient();
  if (!admin) return { ok: true, skipped: true }; // demo/sin config: gobierno puro

  const { data: rules, error } = await admin
    .from("automation_rules")
    .select("key, topic, enabled, config")
    .eq("topic", row.topic)
    .eq("enabled", true);

  if (error) {
    if (MISSING_TABLE_CODES.has(error.code ?? "")) return { ok: true, skipped: true };
    return { ok: false, error: `automation_rules read: ${error.message}` };
  }
  if (!rules || rules.length === 0) return { ok: true, skipped: true };

  let fired = 0;
  const errors: string[] = [];

  for (const rule of rules as AutomationRuleRow[]) {
    const t0 = Date.now();

    // 1) CLAIM idempotente.
    const { data: claim, error: claimErr } = await admin
      .from("automation_runs")
      .insert({ rule_key: rule.key, outbox_seq: row.seq, result: "claimed" })
      .select("id")
      .maybeSingle();
    if (claimErr) {
      // UNIQUE violation ⇒ ya evaluada para este evento (re-entrega): skip.
      if (claimErr.code === "23505") continue;
      errors.push(`claim ${rule.key}: ${claimErr.message}`);
      continue;
    }
    if (!claim) continue;

    // 2) Evaluación pura.
    const decision = evaluateRule(rule, {
      seq: row.seq,
      topic: row.topic,
      payload: row.payload ?? {},
    });

    if (!decision.fire) {
      await admin
        .from("automation_runs")
        .update({ result: "skipped", detail: decision.reason, duration_ms: Date.now() - t0 })
        .eq("id", claim.id);
      continue;
    }

    // 3) Efecto interno: broadcast a rol (service_role bypassa RLS, patrón 0169).
    const { error: effectErr } = await admin.from("notifications").insert({
      role_target: decision.effect.role_target,
      kind: decision.effect.kind,
      title: decision.effect.title,
      message: decision.effect.message,
      entity: decision.effect.entity,
      entity_id: decision.effect.entity_id,
      priority: decision.effect.priority,
    });

    if (effectErr) {
      // 4) Liberar el claim para que la re-entrega pueda reintentar esta regla.
      await admin.from("automation_runs").delete().eq("id", claim.id);
      errors.push(`effect ${rule.key}: ${effectErr.message}`);
      continue;
    }

    await admin
      .from("automation_runs")
      .update({ result: "fired", duration_ms: Date.now() - t0 })
      .eq("id", claim.id);
    fired += 1;
  }

  if (errors.length > 0) return { ok: false, error: errors.join("; ") };
  return fired > 0 ? { ok: true } : { ok: true, skipped: true };
};
