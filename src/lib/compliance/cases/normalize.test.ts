import { describe, it, expect } from "vitest";
import { normalizar, stripKey, DEFAULT_DICT } from "./normalize";

describe("normalizar · estado", () => {
  it("variantes de trámite → en_tramite (sin acentos / mayúsculas)", () => {
    for (const t of ["En elaboración", "EN ANÁLISIS", "  en proceso ", "Pendiente de resolución"]) {
      expect(normalizar(t, "estado")).toBe("en_tramite");
    }
  });
  it("aprobado/resuelto/emitido/finalizado → aprobado", () => {
    for (const t of ["Aprobado", "Resuelto", "Emitido", "Finalizado"]) {
      expect(normalizar(t, "estado")).toBe("aprobado");
    }
  });
  it("pendiente de emisión → pendiente_emision", () => {
    expect(normalizar("Pendiente de emisión", "estado")).toBe("pendiente_emision");
  });
  it("archivado/caducado/rechazado → rechazado", () => {
    for (const t of ["Archivado", "Caducado", "Rechazado"]) {
      expect(normalizar(t, "estado")).toBe("rechazado");
    }
  });
  it("texto desconocido → null (degradación segura, no inventa)", () => {
    expect(normalizar("bla bla", "estado")).toBeNull();
    expect(normalizar("", "estado")).toBeNull();
  });
  it("extensible: un dict adicional agrega sinónimos sin tocar el motor", () => {
    const extra = [...DEFAULT_DICT, { dimension: "estado" as const, sinonimo: stripKey("en cola"), valorCanonico: "en_tramite" }];
    expect(normalizar("En cola", "estado", extra)).toBe("en_tramite");
  });
});

describe("normalizar · riesgo", () => {
  it("crítico → critico", () => {
    expect(normalizar("Crítico", "riesgo")).toBe("critico");
  });
});
