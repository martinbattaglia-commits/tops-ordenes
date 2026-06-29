import { describe, it, expect } from "vitest";
import { computeSemaforo, resolveAnticipacion, temporalOf, alertSeverity } from "./semaforo";

const CFG = { Mensual: 7, Anual: 60, Cuatrienal: 180, __default__: 60 };

describe("resolveAnticipacion · jerarquía override → config → default", () => {
  it("override del ítem manda", () => {
    expect(resolveAnticipacion({ itemOverride: 5, frecuencia: "Anual", config: CFG })).toBe(5);
  });
  it("config por frecuencia si no hay override", () => {
    expect(resolveAnticipacion({ itemOverride: null, frecuencia: "Cuatrienal", config: CFG })).toBe(180);
  });
  it("default del sistema si la frecuencia no matchea", () => {
    expect(resolveAnticipacion({ itemOverride: null, frecuencia: "Rara", config: CFG })).toBe(60);
  });
});

describe("temporalOf", () => {
  it("sin vencimiento y base no faltante → sin_fecha", () => {
    expect(temporalOf({ vencimiento: null, dias: null, baseFalta: false })).toBe("sin_fecha");
  });
  it("sin vencimiento pero base faltante → falta", () => {
    expect(temporalOf({ vencimiento: null, dias: null, baseFalta: true })).toBe("falta");
  });
  it("dias negativos → vencido", () => {
    expect(temporalOf({ vencimiento: "2020-01-01", dias: -10, baseFalta: false })).toBe("vencido");
  });
});

describe("computeSemaforo · cascada (riesgo NO interviene)", () => {
  it("vigente → Verde", () => {
    expect(computeSemaforo("vigente", "vigente")).toBe("Verde");
    expect(computeSemaforo("vigente", "aprobado")).toBe("Verde");
  });
  it("vigente con observado → Amarillo", () => {
    expect(computeSemaforo("vigente", "observado")).toBe("Amarillo");
  });
  it("proximo → Amarillo", () => {
    expect(computeSemaforo("proximo", "en_tramite")).toBe("Amarillo");
  });
  it("CASO MAG-04: vencido + en_tramite → Naranja (NO Rojo)", () => {
    expect(computeSemaforo("vencido", "en_tramite")).toBe("Naranja");
  });
  it("vencido + pendiente_emision/aprobado → Amarillo (falta incorporar cert)", () => {
    expect(computeSemaforo("vencido", "pendiente_emision")).toBe("Amarillo");
    expect(computeSemaforo("vencido", "aprobado")).toBe("Amarillo");
  });
  it("vencido sin caso / rechazado → Rojo", () => {
    expect(computeSemaforo("vencido", "sin_iniciar")).toBe("Rojo");
    expect(computeSemaforo("vencido", "rechazado")).toBe("Rojo");
  });
  it("falta de doc + en_tramite → Naranja; sin caso → Rojo", () => {
    expect(computeSemaforo("falta", "en_tramite")).toBe("Naranja");
    expect(computeSemaforo("falta", "sin_iniciar")).toBe("Rojo");
  });
  it("permanente (sin_fecha): en_tramite → Naranja, vigente → Verde", () => {
    expect(computeSemaforo("sin_fecha", "en_tramite")).toBe("Naranja");
    expect(computeSemaforo("sin_fecha", "vigente")).toBe("Verde");
  });
});

describe("alertSeverity · riesgo = prioridad (no color)", () => {
  it("verde nunca alerta", () => {
    expect(alertSeverity("critico", "Verde")).toBe("info");
  });
  it("critico en no-verde → critical", () => {
    expect(alertSeverity("critico", "Naranja")).toBe("critical");
  });
  it("alto en no-verde → warning", () => {
    expect(alertSeverity("alto", "Amarillo")).toBe("warning");
  });
});
