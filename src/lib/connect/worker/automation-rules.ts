/**
 * automation-rules.ts — F4.4-E4 · Evaluación PURA de reglas de automatización MVP.
 *
 * D-F44-6: solo efectos internos y reversibles. En F4.4 el único efecto
 * soportado es `notify_role` (broadcast de notificación interna a un rol,
 * patrón 0162/0169). Cualquier otro `effect.type` ⇒ NO dispara (fail-closed:
 * una regla mal seedeada no puede producir un efecto no contemplado).
 *
 * Las reglas viven en `automation_rules` (mig 0172, seed-only, sin UI;
 * kill-switch = `enabled=false` vía SQL, sin deploy). Config declarativa:
 *
 *   {
 *     "when":   { "field": "severidad", "equals": "critica" },   // opcional
 *     "effect": {
 *       "type": "notify_role",
 *       "role_target": "admin",
 *       "kind": "connect_incident",
 *       "priority": "urgent",                                    // low|normal|high|urgent
 *       "title": "…",
 *       "message_template": "{public_id} — …",                   // {campo} ⇒ payload.campo
 *       "entity": "connect_incident",
 *       "entity_id_field": "incident_id"
 *     }
 *   }
 *
 * Módulo puro (sin IO) → testeable con vectores fijos.
 */

export interface AutomationRuleRow {
  key: string;
  topic: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

export interface OutboxEventLike {
  seq: number;
  topic: string;
  payload: Record<string, unknown>;
}

export interface NotificationEffect {
  role_target: string;
  kind: string;
  title: string;
  message: string;
  entity: string | null;
  entity_id: string | null;
  priority: "low" | "normal" | "high" | "urgent";
}

export type RuleDecision =
  | { fire: true; effect: NotificationEffect }
  | {
      fire: false;
      reason:
        | "disabled"
        | "topic_mismatch"
        | "condition_not_met"
        | "config_invalid"
        | "unsupported_effect";
    };

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const MAX_TEMPLATE_VALUE_LEN = 80;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** Renderiza `{campo}` desde el payload; valores no-string o faltantes ⇒ "—". */
export function renderTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, field: string) => {
    const v = payload[field];
    if (typeof v === "string") return v.slice(0, MAX_TEMPLATE_VALUE_LEN);
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return "—";
  });
}

/** Evalúa una regla contra un evento del outbox. Determinista y sin IO. */
export function evaluateRule(rule: AutomationRuleRow, event: OutboxEventLike): RuleDecision {
  if (!rule.enabled) return { fire: false, reason: "disabled" };
  if (rule.topic !== event.topic) return { fire: false, reason: "topic_mismatch" };

  const config = rule.config ?? {};
  const when = config["when"] as Record<string, unknown> | undefined;
  if (when) {
    const field = str(when["field"]);
    if (!field || !("equals" in when)) return { fire: false, reason: "config_invalid" };
    if (event.payload[field] !== when["equals"]) {
      return { fire: false, reason: "condition_not_met" };
    }
  }

  const effect = config["effect"] as Record<string, unknown> | undefined;
  if (!effect) return { fire: false, reason: "config_invalid" };
  if (effect["type"] !== "notify_role") return { fire: false, reason: "unsupported_effect" };

  const roleTarget = str(effect["role_target"]);
  const title = str(effect["title"]);
  const template = str(effect["message_template"]);
  if (!roleTarget || !title || !template) return { fire: false, reason: "config_invalid" };

  const rawPriority = str(effect["priority"]) ?? "normal";
  const priority = (PRIORITIES.has(rawPriority) ? rawPriority : "normal") as NotificationEffect["priority"];

  const entityIdField = str(effect["entity_id_field"]);
  const entityId = entityIdField ? str(event.payload[entityIdField]) : null;

  return {
    fire: true,
    effect: {
      role_target: roleTarget,
      kind: str(effect["kind"]) ?? "info",
      title,
      message: renderTemplate(template, event.payload),
      entity: str(effect["entity"]),
      entity_id: entityId,
      priority,
    },
  };
}
