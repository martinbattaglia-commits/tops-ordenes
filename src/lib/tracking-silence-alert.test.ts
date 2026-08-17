import { describe, expect, it } from "vitest";
import { evaluateTrackingSilence } from "./tracking/silence-alert";

/**
 * FMC130 · punto 3 — alerta de silencio de tracking.
 *
 * Dos casos, que son los que importan:
 *  · con datos frescos NO manda nada (el que evita el cron que grita siempre);
 *  · con silencio de más de 24 h manda.
 *
 * La autenticación del endpoint no se re-prueba acá: usa `requireCronAuth`,
 * el guard compartido que ya tiene su propia cobertura en `cron-auth.test.ts`.
 */

const AHORA = Date.parse("2026-08-17T12:00:00.000Z");

describe("evaluateTrackingSilence", () => {
  it("con datos frescos no dispara la alerta", () => {
    const r = evaluateTrackingSilence({
      // Dos horas atrás: muy dentro del umbral de 24 h.
      lastCreatedAt: "2026-08-17T10:00:00.000Z",
      nowMs: AHORA,
      thresholdHours: 24,
    });

    expect(r.alert).toBe(false);
  });

  it("con silencio de más de 24 h dispara la alerta y dice qué revisar", () => {
    const r = evaluateTrackingSilence({
      // El silencio real que motivó esto: última posición el 10-07-2026.
      lastCreatedAt: "2026-07-10T12:00:00.000Z",
      nowMs: AHORA,
      thresholdHours: 24,
    });

    expect(r.alert).toBe(true);
    if (!r.alert) return;
    expect(r.hoursSilent).toBeGreaterThan(24);
    expect(r.subject).toContain("38 días");
    expect(r.text).toContain("Traccar");
    expect(r.text).toContain("equipos GPS");
  });
});
