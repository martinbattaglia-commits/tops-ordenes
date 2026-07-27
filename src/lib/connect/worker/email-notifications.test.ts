import { describe, expect, it, vi } from "vitest";

// Patrón dispatch.test: neutralizar server-only y dependencias de entorno.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/env", () => ({
  env: { app: { url: "https://nexus.logisticatops.com" }, email: { resendKey: undefined } },
}));

import { isEligibleNotification, buildNotificationEmail } from "./email-notifications";

// LINK-NOTIFY-001 F1 · regla de selección (resolución de Dirección 07-26):
// email = requiere acción (mención · asignación · high/urgent). Nada más.
describe("notify/email · isEligibleNotification (regla F1)", () => {
  const base = { kind: "connect_task", priority: "normal", title: "x", read_at: null };

  it("mención → SÍ (siempre)", () => {
    expect(isEligibleNotification({ ...base, kind: "connect_mention" })).toBe(true);
  });
  it("asignación de tarea con prioridad normal → SÍ (título 'Te asignaron:')", () => {
    expect(isEligibleNotification({ ...base, title: "Te asignaron: Llamar a Cliente X" })).toBe(true);
  });
  it("tarea high sin ser asignación → SÍ", () => {
    expect(isEligibleNotification({ ...base, priority: "high", title: "Paso de workflow" })).toBe(true);
  });
  it("incidente urgent → SÍ", () => {
    expect(isEligibleNotification({ ...base, kind: "connect_incident", priority: "urgent" })).toBe(true);
  });
  it("tarea normal que NO es asignación → NO (ruido operativo)", () => {
    expect(isEligibleNotification({ ...base, title: "Paso de workflow disponible" })).toBe(false);
  });
  it("kind info/new (ERP general) → NO", () => {
    expect(isEligibleNotification({ ...base, kind: "info", priority: "urgent" })).toBe(false);
    expect(isEligibleNotification({ ...base, kind: "new", priority: "high" })).toBe(false);
  });
  it("ya leída → NO (la campana ganó)", () => {
    expect(
      isEligibleNotification({ ...base, kind: "connect_mention", read_at: "2026-07-26T00:00:00Z" }),
    ).toBe(false);
  });
});

describe("notify/email · buildNotificationEmail (template mínimo, sin PII)", () => {
  it("asunto = título; cuerpo con deep-link por entity", () => {
    const { subject, html } = buildNotificationEmail({
      title: "Te asignaron: Llamar a Cliente X",
      entity: "connect_task",
      entity_id: "abc-123",
    });
    expect(subject).toBe("Te asignaron: Llamar a Cliente X");
    expect(html).toContain("/connect/tareas/abc-123");
    expect(html).toContain("Abrir en NEXUS");
  });
  it("mención → deep-link al hilo (entity connect)", () => {
    const { html } = buildNotificationEmail({
      title: "Te mencionaron",
      entity: "connect",
      entity_id: "conv-9",
    });
    expect(html).toContain("/connect/c/conv-9");
  });
  it("escapa HTML del título (no inyecta)", () => {
    const { html } = buildNotificationEmail({
      title: `<script>alert("x")</script>`,
      entity: null,
      entity_id: null,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
