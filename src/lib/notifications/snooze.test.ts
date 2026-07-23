import { describe, it, expect } from "vitest";
import { SNOOZE_PRESETS, tomorrowAt9, isValidSnoozeUntil } from "./snooze";

const NOW = new Date("2026-07-01T15:30:00.000Z");

describe("notifications/snooze (F4.1C)", () => {
  it("preset 1h suma exactamente una hora", () => {
    const p = SNOOZE_PRESETS.find((x) => x.key === "1h")!;
    expect(p.until(NOW).getTime() - NOW.getTime()).toBe(3600_000);
  });

  it("tomorrowAt9 cae al día siguiente a las 09:00 local", () => {
    const d = tomorrowAt9(NOW);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
    expect(d.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("todos los presets producen snoozes válidos (regla espejo de la RPC)", () => {
    for (const p of SNOOZE_PRESETS) {
      expect(isValidSnoozeUntil(p.until(NOW), NOW)).toBe(true);
    }
  });

  it("isValidSnoozeUntil rechaza pasado, muy-cercano y > 30 días", () => {
    expect(isValidSnoozeUntil(new Date(NOW.getTime() - 1000), NOW)).toBe(false);
    expect(isValidSnoozeUntil(new Date(NOW.getTime() + 30_000), NOW)).toBe(false);
    expect(isValidSnoozeUntil(new Date(NOW.getTime() + 31 * 24 * 3600_000), NOW)).toBe(false);
  });
});
