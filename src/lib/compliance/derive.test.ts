import { describe, it, expect } from "vitest";
import { deriveComplianceStatus, type ComplianceItem } from "./data";

const base: ComplianceItem = {
  id: "T", sede: "MAGALDI", categoria: "Residuos", documento: "X", organismo: "O", tipo: "T",
  emision: "2022-10-06", vencimiento: "2023-10-06", frecuencia: "Anual", estado: "Vencido",
  riesgo: "Rojo", fuente: "Leído", nota: "", docs: 0, dias: null, venc_fmt: "", emi_fmt: "",
};

describe("deriveComplianceStatus · cascada con caso activo", () => {
  it("vencido SIN caso → Rojo (comportamiento heredado)", () => {
    const out = deriveComplianceStatus({ ...base }, "2026-06-29");
    expect(out.riesgo).toBe("Rojo");
  });
  it("CASO MAG-04: vencido CON caso en_tramite → Naranja", () => {
    const out = deriveComplianceStatus(
      { ...base, activeCase: { estadoAdministrativo: "en_tramite", etapa: "pronto_despacho", nivelRiesgo: "alto", origen: "sheet", confianza: "confirmada" } },
      "2026-06-29",
    );
    expect(out.riesgo).toBe("Naranja");
    expect(out.estadoAdministrativo).toBe("en_tramite");
    expect(out.nivelRiesgo).toBe("alto");
  });
  it("pendiente_emision vencido → Amarillo", () => {
    const out = deriveComplianceStatus(
      { ...base, activeCase: { estadoAdministrativo: "pendiente_emision", etapa: null, nivelRiesgo: "medio", origen: "sheet", confianza: "confirmada" } },
      "2026-06-29",
    );
    expect(out.riesgo).toBe("Amarillo");
  });
  it("anticipación por frecuencia: Cuatrienal avisa a 180 días", () => {
    const cuatri = { ...base, frecuencia: "Cuatrienal", vencimiento: "2026-09-01" }; // ~64 días al 2026-06-29
    const out = deriveComplianceStatus(cuatri, "2026-06-29", { Cuatrienal: 180, __default__: 60 });
    expect(out.riesgo).toBe("Amarillo"); // dentro de los 180 → próximo
  });
  it("override del ítem manda sobre la config", () => {
    const it = { ...base, frecuencia: "Cuatrienal", vencimiento: "2026-09-01", anticipacion_dias: 10 };
    const out = deriveComplianceStatus(it, "2026-06-29", { Cuatrienal: 180, __default__: 60 });
    expect(out.riesgo).toBe("Verde"); // 64 días > 10 → vigente
  });
});
