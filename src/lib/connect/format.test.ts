import { describe, expect, it } from "vitest";
import { dayKey, isNewDay, dayLabel, timeHM, AR_TIME_ZONE } from "./format";

// LINK-WA-UX-001 · separadores de fecha por día.
// Zona explícita (ART) ⇒ los tests no dependen de la TZ del proceso.

const NOW = new Date("2026-07-29T15:00:00Z"); // 29-07-2026 12:00 ART

describe("format · dayKey (agrupamiento por día en ART)", () => {
  it("rinde clave ordenable YYYY-MM-DD", () => {
    expect(dayKey("2026-07-29T15:00:00Z")).toBe("2026-07-29");
  });

  it("respeta la zona ART en el borde de medianoche", () => {
    // 2026-07-30T02:00Z = 2026-07-29 23:00 ART ⇒ sigue siendo el día 29.
    expect(dayKey("2026-07-30T02:00:00Z")).toBe("2026-07-29");
    // 2026-07-30T03:00Z = 2026-07-30 00:00 ART ⇒ ya es el día 30.
    expect(dayKey("2026-07-30T03:00:00Z")).toBe("2026-07-30");
  });

  it("la zona es parametrizable (mismo instante, otro día civil)", () => {
    expect(dayKey("2026-07-30T02:00:00Z", "UTC")).toBe("2026-07-30");
    expect(dayKey("2026-07-30T02:00:00Z", AR_TIME_ZONE)).toBe("2026-07-29");
  });
});

describe("format · isNewDay", () => {
  it("varios mensajes del MISMO día no generan separador", () => {
    expect(isNewDay("2026-07-29T13:00:00Z", "2026-07-29T12:00:00Z")).toBe(false);
    expect(isNewDay("2026-07-29T20:00:00Z", "2026-07-29T13:00:00Z")).toBe(false);
  });
  it("cambio de DÍA genera separador", () => {
    expect(isNewDay("2026-07-30T14:00:00Z", "2026-07-29T14:00:00Z")).toBe(true);
  });
  it("cambio de MES genera separador", () => {
    expect(isNewDay("2026-08-01T14:00:00Z", "2026-07-31T14:00:00Z")).toBe(true);
  });
  it("cambio de AÑO genera separador", () => {
    expect(isNewDay("2026-01-01T14:00:00Z", "2025-12-31T14:00:00Z")).toBe(true);
  });
  it("el primer mensaje del hilo siempre lleva separador", () => {
    expect(isNewDay("2021-09-07T14:00:00Z", null)).toBe(true);
    expect(isNewDay("2021-09-07T14:00:00Z", undefined)).toBe(true);
  });
});

describe("format · dayLabel", () => {
  it("hoy → «Hoy»", () => {
    expect(dayLabel("2026-07-29T13:00:00Z", NOW)).toBe("Hoy");
  });
  it("ayer → «Ayer»", () => {
    expect(dayLabel("2026-07-28T13:00:00Z", NOW)).toBe("Ayer");
  });
  it("mismo año → día de semana + día + mes, SIN año", () => {
    const l = dayLabel("2026-03-10T13:00:00Z", NOW);
    expect(l).toContain("10");
    expect(l).toContain("marzo");
    expect(l).not.toContain("2026");
  });
  it("año distinto → el AÑO se vuelve visible (requisito del expediente)", () => {
    expect(dayLabel("2023-11-29T13:00:00Z", NOW)).toContain("2023");
    expect(dayLabel("2021-09-07T13:00:00Z", NOW)).toContain("2021");
  });
  it("los 5 años del corpus importado producen etiquetas distinguibles", () => {
    const años = ["2021-09-07", "2022-12-02", "2023-10-31", "2024-08-08", "2026-03-10"];
    const labels = años.map((d) => dayLabel(`${d}T13:00:00Z`, NOW));
    expect(new Set(labels).size).toBe(5); // ninguna colisión
    // los 4 anteriores al año en curso exhiben su año
    for (const l of labels.slice(0, 4)) expect(l).toMatch(/20\d\d/);
  });
});

describe("format · la hora individual se conserva (no se toca timeHM)", () => {
  it("timeHM sigue devolviendo hora:minuto del mensaje", () => {
    expect(timeHM("2026-07-29T15:30:00Z")).toMatch(/\d{1,2}:\d{2}/);
  });
});
