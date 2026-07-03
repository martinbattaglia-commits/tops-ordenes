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
 *   1. CLAIM: insert del run. Conflicto 23505 ⇒ inspeccionar el run existente:
 *      terminado ('fired'/'skipped') ⇒ skip; 'claimed' fresco ⇒ otro worker
 *      in-flight ⇒ skip; 'claimed' VENCIDO (> CLAIM_LEASE_MS — worker muerto
 *      entre claim y efecto) ⇒ TAKEOVER con lock optimista (fix adversarial
 *      F4.4: sin esto el broadcast se perdía para siempre).
 *   2. Evaluar (puro). No dispara ⇒ run queda 'skipped' con la razón.
 *   3. Dispara ⇒ efecto (insert interno en notifications) ⇒ run 'fired'.
 *   4. Efecto falla ⇒ se LIBERA el claim (delete) y se reporta error ⇒ el
 *      worker aplica backoff/dead-letter y la re-entrega puede reintentar
 *      sin duplicar lo ya disparado por otras reglas.
 *
 * Semántica resultante: AT-LEAST-ONCE para el efecto (residual aceptado y
 * documentado: si el insert del efecto commitea pero la respuesta se pierde,
 * o un takeover corre contra un efecto ya commiteado, puede haber UN aviso
 * interno duplicado — preferible a perder un aviso de incidente crítico).
 *
 * Fail-closed (D-F44-6): si las reglas no pueden leerse por un error real de
 * infraestructura ⇒ el evento queda `failed` (backoff), NUNCA "asumir que sí".
 * Excepción deliberada: tabla inexistente (mig 0172 sin aplicar) ⇒ `skipped`,
 * para que el drenado del backlog no dependa del orden de la ventana.
 */

/** Códigos PostgREST/Postgres de "la tabla no existe" (mig 0172 no aplicada). */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205", "PGRST202"]);

/** Lease del claim: pasado este tiempo, un claim sin resultado se considera
 *  huérfano (worker muerto mid-evento) y otro worker puede tomarlo. Alineado
 *  con el lease de connect_claim_batch (5 min, 0160). */
const CLAIM_LEASE_MS = 5 * 60_000;

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
    let runId: number | null = null;
    const { data: claim, error: claimErr } = await admin
      .from("automation_runs")
      .insert({ rule_key: rule.key, outbox_seq: row.seq, result: "claimed" })
      .select("id")
      .maybeSingle();
    if (claimErr) {
      if (claimErr.code !== "23505") {
        errors.push(`claim ${rule.key}: ${claimErr.message}`);
        continue;
      }
      // 23505 ⇒ re-entrega. ¿Run terminado, in-flight, o claim huérfano?
      const { data: existing } = await admin
        .from("automation_runs")
        .select("id, result, created_at")
        .eq("rule_key", rule.key)
        .eq("outbox_seq", row.seq)
        .maybeSingle();
      if (!existing || existing.result !== "claimed") continue; // ya evaluada
      const age = Date.now() - new Date(existing.created_at).getTime();
      if (age < CLAIM_LEASE_MS) continue; // otro worker in-flight (lease vigente)
      // Takeover del claim huérfano con lock optimista (solo un worker gana).
      const { data: taken, error: takeErr } = await admin
        .from("automation_runs")
        .update({ created_at: new Date().toISOString(), detail: "lease_takeover" })
        .eq("id", existing.id)
        .eq("result", "claimed")
        .eq("created_at", existing.created_at)
        .select("id")
        .maybeSingle();
      if (takeErr || !taken) continue; // otro worker ganó el takeover
      runId = existing.id;
    } else if (claim) {
      runId = claim.id;
    }
    if (runId == null) continue;

    // 2) Evaluación pura.
    const decision = evaluateRule(rule, {
      seq: row.seq,
      topic: row.topic,
      payload: row.payload ?? {},
    });

    if (!decision.fire) {
      const { error: updErr } = await admin
        .from("automation_runs")
        .update({ result: "skipped", detail: decision.reason, duration_ms: Date.now() - t0 })
        .eq("id", runId);
      if (updErr) console.error("[automations] telemetría skipped no persistida:", updErr.message);
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
      await admin.from("automation_runs").delete().eq("id", runId);
      errors.push(`effect ${rule.key}: ${effectErr.message}`);
      continue;
    }

    const { error: firedErr } = await admin
      .from("automation_runs")
      .update({ result: "fired", duration_ms: Date.now() - t0 })
      .eq("id", runId);
    if (firedErr) console.error("[automations] telemetría fired no persistida:", firedErr.message);
    fired += 1;
  }

  if (errors.length > 0) return { ok: false, error: errors.join("; ") };
  return fired > 0 ? { ok: true } : { ok: true, skipped: true };
};
