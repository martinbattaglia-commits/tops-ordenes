// F5.2-lite · Tests del presupuesto (parte pura + contador demo).

import { describe, expect, it } from "vitest";
import { computeBudgetState, demoCount, startOfTodayIso } from "./budget";

describe("computeBudgetState", () => {
  it("permite bajo el límite y corta al alcanzarlo", () => {
    expect(computeBudgetState(0, 40).allowed).toBe(true);
    expect(computeBudgetState(39, 40).allowed).toBe(true);
    expect(computeBudgetState(40, 40).allowed).toBe(false);
    expect(computeBudgetState(41, 40).allowed).toBe(false);
  });
  it("explica el motivo al cortar", () => {
    const s = computeBudgetState(40, 40);
    expect(s.reason).toContain("40");
  });
});

describe("demoCount", () => {
  it("incrementa por usuario y resetea por día", () => {
    const day1 = new Date("2026-07-03T10:00:00");
    expect(demoCount("u1", day1)).toBe(1);
    expect(demoCount("u1", day1)).toBe(2);
    expect(demoCount("u2", day1)).toBe(1); // otro usuario, contador propio
    const day2 = new Date("2026-07-04T10:00:00");
    expect(demoCount("u1", day2)).toBe(1); // nuevo día → reset
  });
});

describe("startOfTodayIso", () => {
  it("devuelve la medianoche local del día dado", () => {
    const iso = startOfTodayIso(new Date("2026-07-03T15:30:00"));
    expect(new Date(iso).getHours()).toBe(0);
  });
});
