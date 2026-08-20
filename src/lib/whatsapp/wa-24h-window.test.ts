import { describe, it, expect, beforeEach } from "vitest";
import { calculateWa24hWindow, draftManager } from "@/lib/whatsapp/window24h";
import { APPROVED_UTILITY_TEMPLATES, renderTemplateText } from "@/lib/whatsapp/templates";
import { isHumanOperator, shouldSilenceMaxBot } from "@/lib/whatsapp/handover";

describe("WhatsApp 24h Window & Handover Protocol", () => {
  const baseNow = new Date("2026-08-20T12:00:00.000Z");

  describe("calculateWa24hWindow", () => {
    it("devuelve green_open cuando quedan más de 3 horas", () => {
      const lastMsg = new Date("2026-08-20T02:00:00.000Z");
      const info = calculateWa24hWindow(lastMsg, baseNow);

      expect(info.status).toBe("green_open");
      expect(info.isExpired).toBe(false);
      expect(info.isWarning).toBe(false);
      expect(info.formattedRemaining).toBe("14h 0m");
    });

    it("devuelve amber_warning cuando quedan 3h o menos (< 3h)", () => {
      const lastMsg = new Date("2026-08-19T14:00:00.000Z");
      const info = calculateWa24hWindow(lastMsg, baseNow);

      expect(info.status).toBe("amber_warning");
      expect(info.isExpired).toBe(false);
      expect(info.isWarning).toBe(true);
      expect(info.formattedRemaining).toBe("2h 0m");
    });

    it("devuelve red_locked cuando la ventana expiró (>= 24h)", () => {
      const lastMsg = new Date("2026-08-19T11:00:00.000Z");
      const info = calculateWa24hWindow(lastMsg, baseNow);

      expect(info.status).toBe("red_locked");
      expect(info.isExpired).toBe(true);
      expect(info.isWarning).toBe(false);
      expect(info.formattedRemaining).toContain("Expirada");
    });
  });

  describe("APPROVED_UTILITY_TEMPLATES", () => {
    it("contiene exactamente las 4 plantillas Utility aprobadas por Meta", () => {
      const ids = APPROVED_UTILITY_TEMPLATES.map((t) => t.id);
      expect(ids).toEqual([
        "propuesta_comercial",
        "actualizacion_orden_tops",
        "aviso_documentacion_pendiente",
        "soporte_operativo_tops",
      ]);
    });

    it("renderiza correctamente los parámetros de plantilla", () => {
      const tmpl = APPROVED_UTILITY_TEMPLATES.find((t) => t.id === "actualizacion_orden_tops")!;
      const rendered = renderTemplateText(tmpl, {
        cliente: "María González",
        orden: "ORD-2026-0042",
        estado: "En Proceso",
      });

      expect(rendered).toBe(
        "Estimado/a María González, tu orden ORD-2026-0042 ha cambiado al estado En Proceso."
      );
    });
  });

  describe("Draft Preservation Manager", () => {
    beforeEach(() => {
      draftManager.clearDraft("conv-123");
    });

    it("preserva y recupera el borrador en memoria sin pérdida de texto", () => {
      draftManager.setDraft("conv-123", "Borrador de prueba de operador");
      expect(draftManager.getDraft("conv-123")).toBe("Borrador de prueba de operador");

      draftManager.clearDraft("conv-123");
      expect(draftManager.getDraft("conv-123")).toBe("");
    });
  });

  describe("Handover Protocol & Max Bot Silencing", () => {
    it("reconoce a los operadores humanos nombrados por Dirección", () => {
      expect(isHumanOperator("Martín Battaglia")).toBe(true);
      expect(isHumanOperator("Cynthia")).toBe(true);
      expect(isHumanOperator("Ruth")).toBe(true);
      expect(isHumanOperator("José Luis")).toBe(true);
      expect(isHumanOperator("Bot Automatico")).toBe(false);
    });

    it("silencia a Max Bot cuando handoverState es PAUSED_HUMAN", () => {
      expect(shouldSilenceMaxBot("PAUSED_HUMAN")).toBe(true);
      expect(shouldSilenceMaxBot("BOT_ACTIVE")).toBe(false);
      expect(shouldSilenceMaxBot(undefined)).toBe(false);
    });
  });
});
