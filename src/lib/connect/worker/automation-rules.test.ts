import { describe, expect, it } from "vitest";
import {
  evaluateRule,
  renderTemplate,
  type AutomationRuleRow,
  type OutboxEventLike,
} from "./automation-rules";

// F4.4-E4 — dispatcher de reglas: topic con regla on/off, condición, config
// inválida, efecto no soportado (TDD §23).

const R1: AutomationRuleRow = {
  key: "r1_incidente_critico_broadcast",
  topic: "connect.incident.opened",
  enabled: true,
  config: {
    when: { field: "severidad", equals: "critica" },
    effect: {
      type: "notify_role",
      role_target: "admin",
      kind: "connect_incident",
      priority: "urgent",
      title: "Incidente crítico abierto",
      message_template: "{public_id} — abierto con severidad crítica.",
      entity: "connect_incident",
      entity_id_field: "incident_id",
    },
  },
};

const EVENT: OutboxEventLike = {
  seq: 100,
  topic: "connect.incident.opened",
  payload: {
    incident_id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    public_id: "INC-2026-0007",
    severidad: "critica",
  },
};

describe("evaluateRule", () => {
  it("dispara R1 con incidente crítico y arma la notificación completa", () => {
    const d = evaluateRule(R1, EVENT);
    expect(d.fire).toBe(true);
    if (!d.fire) return;
    expect(d.effect.role_target).toBe("admin");
    expect(d.effect.kind).toBe("connect_incident");
    expect(d.effect.priority).toBe("urgent");
    expect(d.effect.message).toBe("INC-2026-0007 — abierto con severidad crítica.");
    expect(d.effect.entity).toBe("connect_incident");
    expect(d.effect.entity_id).toBe("6f9619ff-8b86-4d01-b42d-00cf4fc964ff");
  });

  it("NO dispara si la severidad no matchea (condition_not_met)", () => {
    const d = evaluateRule(R1, { ...EVENT, payload: { ...EVENT.payload, severidad: "media" } });
    expect(d).toEqual({ fire: false, reason: "condition_not_met" });
  });

  it("NO dispara con la regla deshabilitada (kill-switch)", () => {
    expect(evaluateRule({ ...R1, enabled: false }, EVENT)).toEqual({
      fire: false,
      reason: "disabled",
    });
  });

  it("NO dispara ante topic distinto", () => {
    expect(evaluateRule(R1, { ...EVENT, topic: "connect.message.posted" })).toEqual({
      fire: false,
      reason: "topic_mismatch",
    });
  });

  it("fail-closed: effect.type desconocido NO dispara (unsupported_effect)", () => {
    const rule: AutomationRuleRow = {
      ...R1,
      config: { effect: { type: "send_whatsapp", role_target: "admin" } },
    };
    expect(evaluateRule(rule, EVENT)).toEqual({ fire: false, reason: "unsupported_effect" });
  });

  it("fail-closed: config vacía o incompleta NO dispara (config_invalid)", () => {
    expect(evaluateRule({ ...R1, config: null }, EVENT)).toEqual({
      fire: false,
      reason: "config_invalid",
    });
    expect(
      evaluateRule({ ...R1, config: { effect: { type: "notify_role" } } }, EVENT),
    ).toEqual({ fire: false, reason: "config_invalid" });
  });

  it("priority inválida degrada a normal (no rompe el insert)", () => {
    const rule = structuredClone(R1) as AutomationRuleRow;
    (rule.config!["effect"] as Record<string, unknown>)["priority"] = "apocalyptic";
    const d = evaluateRule(rule, EVENT);
    expect(d.fire).toBe(true);
    if (d.fire) expect(d.effect.priority).toBe("normal");
  });

  it("regla sin `when` dispara para todo evento del topic", () => {
    const rule = structuredClone(R1) as AutomationRuleRow;
    delete rule.config!["when"];
    const d = evaluateRule(rule, { ...EVENT, payload: { ...EVENT.payload, severidad: "baja" } });
    expect(d.fire).toBe(true);
  });
});

describe("renderTemplate", () => {
  it("sustituye campos del payload y tolera faltantes", () => {
    expect(renderTemplate("{public_id} · {nada} · {n}", { public_id: "INC-1", n: 3 })).toBe(
      "INC-1 · — · 3",
    );
  });
  it("recorta valores largos (anti-PII/anti-abuso del template)", () => {
    const out = renderTemplate("{texto}", { texto: "x".repeat(500) });
    expect(out.length).toBe(80);
  });
});
