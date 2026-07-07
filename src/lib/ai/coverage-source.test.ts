// Slice A (manual de aceptación 2026-07-07) · matriz de COBERTURA del Copilot.
// El manual exige que el Copilot sepa responder sobre sí mismo ("qué módulos
// tienen cobertura completa y cuáles son brecha", "qué fuentes usa", "qué datos
// faltan") y que los dominios SIN fuente (WMS, caja chica, movimientos) declaren
// una brecha ESPECÍFICA en vez de responder otro tema.

import { describe, expect, it } from "vitest";
import { resolveCopilotCoverage } from "./coverage-source";

describe("resolveCopilotCoverage · matriz de cobertura consultable", () => {
  it("sin query → matriz completa con estado conectado/brecha y fuente por módulo", () => {
    const rows = resolveCopilotCoverage({});
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const r of rows) {
      expect(["conectado", "parcial", "brecha"]).toContain(String(r.estado));
      expect(String(r.modulo)).toBeTruthy();
      expect(String(r.detalle)).toBeTruthy();
    }
    // Dominios conectados clave presentes.
    const modulos = rows.map((r) => String(r.modulo).toLowerCase()).join(" | ");
    expect(modulos).toMatch(/facturaci/);
    expect(modulos).toMatch(/tesorer/);
    expect(modulos).toMatch(/vacancia/);
  });

  it("las brechas conocidas están declaradas: WMS, caja chica y movimientos", () => {
    const rows = resolveCopilotCoverage({});
    const brechas = rows.filter((r) => r.estado === "brecha");
    const texto = brechas.map((r) => `${r.modulo} ${r.detalle}`.toLowerCase()).join(" | ");
    expect(texto).toMatch(/wms|dep[oó]sito|stock/);
    expect(texto).toContain("caja chica");
    expect(texto).toMatch(/movimientos/);
  });

  it("query de un dominio brecha ('stock', 'posiciones') → devuelve LA brecha específica", () => {
    const rows = resolveCopilotCoverage({ query: "posiciones stock deposito" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.estado === "brecha")).toBe(true);
  });

  it("cada módulo conectado cita su fuente (tool/RPC) y su ruta real", () => {
    const conectados = resolveCopilotCoverage({}).filter((r) => r.estado === "conectado");
    for (const r of conectados) {
      expect(String(r.fuente), String(r.modulo)).toBeTruthy();
      expect(String(r.ruta), String(r.modulo)).toMatch(/^\//);
    }
  });
});
