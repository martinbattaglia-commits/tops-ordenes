import { describe, expect, it } from "vitest";
import { dayKey, isNewDay, dayLabel, timeHM, AR_TIME_ZONE } from "./format";

// LINK-WA-UX-001 · REVISIÓN ADVERSARIAL de los separadores de fecha.
const NOW = new Date("2026-07-29T15:00:00Z");

describe("ADVERSARIAL · bordes temporales", () => {
  it("X1 · 31-dic 23:00 ART NO salta de año (el instante UTC ya es enero)", () => {
    // 2026-01-01T02:00Z = 2025-12-31 23:00 ART ⇒ sigue siendo 2025.
    expect(dayKey("2026-01-01T02:00:00Z")).toBe("2025-12-31");
    expect(isNewDay("2026-01-01T02:00:00Z", "2025-12-31T20:00:00Z")).toBe(false);
  });

  it("X2 · cambio real de año en ART genera separador con año visible", () => {
    // 2026-01-01T03:00Z = 2026-01-01 00:00 ART.
    expect(isNewDay("2026-01-01T03:00:00Z", "2026-01-01T02:00:00Z")).toBe(true);
    expect(dayLabel("2025-12-31T20:00:00Z", NOW)).toContain("2025");
  });

  it("X3 · Argentina no aplica DST: el offset es -03:00 todo el año", () => {
    expect(dayKey("2026-01-15T02:59:00Z")).toBe("2026-01-14"); // verano
    expect(dayKey("2026-07-15T02:59:00Z")).toBe("2026-07-14"); // invierno
  });

  it("X4 · timestamps idénticos NO generan separador duplicado", () => {
    const t = "2026-07-20T12:00:00Z";
    expect(isNewDay(t, t)).toBe(false);
  });

  it("X5 · mensajes fuera de orden: cada cambio de día se marca (no se pierde el hilo)", () => {
    // Aunque el orden llegue invertido, la función compara con el ANTERIOR real.
    const desordenado = ["2026-07-20T12:00:00Z", "2026-07-18T12:00:00Z", "2026-07-20T13:00:00Z"];
    const flags = desordenado.map((iso, i) => isNewDay(iso, desordenado[i - 1]));
    expect(flags).toEqual([true, true, true]);
  });

  it("X6 · un solo mensaje ⇒ exactamente un separador", () => {
    const solo = ["2024-03-05T12:00:00Z"];
    expect(solo.map((iso, i) => isNewDay(iso, solo[i - 1])).filter(Boolean)).toHaveLength(1);
  });

  it("X7 · timestamp inválido no lanza (degrada, no rompe el hilo)", () => {
    expect(() => dayKey("no-es-fecha")).not.toThrow();
    expect(() => dayLabel("no-es-fecha", NOW)).not.toThrow();
    expect(() => isNewDay("no-es-fecha", "tampoco")).not.toThrow();
  });

  it("X8 · optimista con createdAt del cliente (ahora) rinde «Hoy»", () => {
    expect(dayLabel(new Date().toISOString())).toBe("Hoy");
  });

  it("X9 · las etiquetas de días consecutivos son distintas (no colisionan)", () => {
    const dias = ["2026-03-09", "2026-03-10", "2026-03-11"].map((d) => dayLabel(`${d}T15:00:00Z`, NOW));
    expect(new Set(dias).size).toBe(3);
  });

  it("X10 · dayKey es ordenable como string (garantiza agrupamiento estable)", () => {
    const keys = ["2026-07-29T15:00:00Z", "2021-09-07T15:00:00Z", "2024-01-15T15:00:00Z"].map((i) => dayKey(i));
    expect([...keys].sort()).toEqual(["2021-09-07", "2024-01-15", "2026-07-29"]);
  });

  it("X11 · la hora individual NO se altera por el separador (funciones independientes)", () => {
    const iso = "2026-07-20T18:45:00Z";
    const antes = timeHM(iso);
    void dayLabel(iso, NOW);
    void dayKey(iso);
    expect(timeHM(iso)).toBe(antes); // sin efectos colaterales
  });

  it("X12 · la zona es inmutable por defecto (ART) aunque el proceso corra en otra TZ", () => {
    expect(AR_TIME_ZONE).toBe("America/Argentina/Buenos_Aires");
    expect(dayKey("2026-07-30T02:00:00Z")).toBe(dayKey("2026-07-30T02:00:00Z", AR_TIME_ZONE));
  });
});
