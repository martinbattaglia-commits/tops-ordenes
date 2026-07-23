// fix/f5-2 · Proyección read-only del organigrama institucional para el Copilot.
// Fuente única: src/lib/orgchart.ts (la misma que /organigrama). Sin DB, sin PII.

import { describe, expect, it } from "vitest";
import { resolveOrgChart } from "./org-source";

describe("resolveOrgChart — organigrama institucional (fix/f5-2)", () => {
  it("el presidente aparece con nombre y cargo", () => {
    const rows = resolveOrgChart({ query: "presidente" });
    const pres = rows.find((r) => /presidente/i.test(String(r.role)));
    expect(pres, "no encontró al presidente").toBeDefined();
    expect(String(pres!.name)).toMatch(/Battaglia/);
  });

  it("responde vicepresidente, comercial, operaciones y administración", () => {
    expect(resolveOrgChart({ query: "vicepresidente" }).length).toBeGreaterThan(0);
    expect(resolveOrgChart({ query: "comercial" }).length).toBeGreaterThan(0);
    expect(resolveOrgChart({ query: "operaciones" }).length).toBeGreaterThan(0);
    expect(resolveOrgChart({ query: "administración" }).length).toBeGreaterThan(0);
  });

  it("sin query devuelve la estructura completa (varios miembros, presidencia primero)", () => {
    const rows = resolveOrgChart({});
    expect(rows.length).toBeGreaterThan(6);
    expect(/presidente/i.test(String(rows[0].role))).toBe(true);
  });

  it("NUNCA expone emails, CUIT ni participación accionaria (PII / datos sensibles)", () => {
    const dump = JSON.stringify(resolveOrgChart({}));
    expect(dump).not.toMatch(/@logisticatops\.com/i);
    expect(dump).not.toMatch(/\b\d{2}-\d{8}-\d\b/); // CUIT
    expect(dump).not.toMatch(/\b\d{1,3}\s?%/); // equity "55 %"
  });

  it("cada fila tiene name + role no vacíos (datos reales, no inventados)", () => {
    for (const r of resolveOrgChart({})) {
      expect(String(r.name).length, JSON.stringify(r)).toBeGreaterThan(1);
      expect(String(r.role).length, JSON.stringify(r)).toBeGreaterThan(1);
    }
  });

  it("respeta el limit", () => {
    expect(resolveOrgChart({ limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  it("query sin coincidencias → vacío (no inventa)", () => {
    expect(resolveOrgChart({ query: "zzzznoexiste" })).toEqual([]);
  });
});
