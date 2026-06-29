/**
 * BATERÍA DE REGRESIÓN PERMANENTE — motor de Compliance (deriveComplianceStatus).
 * Matriz de escenarios de negocio. Cualquier cambio futuro del algoritmo DEBE pasar
 * estos 12 casos. No relajar ni borrar sin aprobación de Dirección.
 */
import { describe, it, expect } from "vitest";
import { deriveComplianceStatus, type ComplianceItem } from "./data";
import type { ComplianceCaseLite } from "./cases/types";

const TODAY = "2026-06-29";
const CFG = { Anual: 60, Cuatrienal: 180, __default__: 60 };

function item(over: Partial<ComplianceItem> = {}): ComplianceItem {
  return {
    id: "T", sede: "MAGALDI", categoria: "Residuos", documento: "Cert", organismo: "Org", tipo: "Certificado",
    emision: "2022-10-06", vencimiento: "2023-10-06", frecuencia: "Anual", estado: "", riesgo: "Rojo",
    fuente: "Leído", nota: "", docs: 0, dias: null, venc_fmt: "", emi_fmt: "", ...over,
  };
}
function caso(over: Partial<ComplianceCaseLite> = {}): ComplianceCaseLite {
  return { estadoAdministrativo: "en_tramite", etapa: null, nivelRiesgo: "medio", origen: "sheet", confianza: "confirmada", ...over };
}
const color = (it: ComplianceItem) => deriveComplianceStatus(it, TODAY, CFG).riesgo;

describe("REGRESIÓN · matriz de escenarios de negocio (motor de Compliance)", () => {
  it("1. Certificado vigente → Verde", () => {
    expect(color(item({ vencimiento: "2027-06-29", frecuencia: "Anual" }))).toBe("Verde");
  });
  it("2. Próximo a vencer según anticipación parametrizada (Cuatrienal 180d) → Amarillo", () => {
    expect(color(item({ vencimiento: "2026-09-01", frecuencia: "Cuatrienal" }))).toBe("Amarillo");
  });
  it("3. Vencido sin caso regulatorio → Rojo", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: null }))).toBe("Rojo");
  });
  it("4. Vencido con caso EN_TRAMITE → Naranja", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite" }) }))).toBe("Naranja");
  });
  it("5. Vencido con PRONTO_DESPACHO (en_tramite + etapa) → Naranja", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite", etapa: "pronto_despacho" }) }))).toBe("Naranja");
  });
  it("6. Vencido con PENDIENTE_EMISION → Amarillo", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "pendiente_emision" }) }))).toBe("Amarillo");
  });
  it("7. Vencido con RECHAZADO → Rojo", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "rechazado" }) }))).toBe("Rojo");
  });
  it("8. Riesgo ALTO no modifica el color (vencido+en_tramite sigue Naranja)", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite", nivelRiesgo: "alto" }) }))).toBe("Naranja");
  });
  it("9. Riesgo CRÍTICO no modifica el color (vencido+en_tramite sigue Naranja)", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite", nivelRiesgo: "critico" }) }))).toBe("Naranja");
  });
  it("10. Cambiar SÓLO el riesgo → semáforo idéntico", () => {
    const medio = color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite", nivelRiesgo: "medio" }) }));
    const critico = color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite", nivelRiesgo: "critico" }) }));
    expect(medio).toBe(critico);
  });
  it("11. Cambiar SÓLO el estado administrativo → semáforo cambia", () => {
    const tramite = color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite" }) }));
    const rechazado = color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "rechazado" }) }));
    expect(tramite).toBe("Naranja");
    expect(rechazado).toBe("Rojo");
    expect(tramite).not.toBe(rechazado);
  });
  it("12. Caso real MAG-04 (EX-2023-116887453) → Naranja 'En trámite administrativo'", () => {
    const mag04 = item({
      id: "MAG-04",
      documento: "Certificado Ambiental Anual (CAA) – Nación – Generador R. Peligrosos",
      vencimiento: "2023-10-06", frecuencia: "Anual",
      activeCase: caso({ estadoAdministrativo: "en_tramite", etapa: "pronto_despacho", nivelRiesgo: "alto" }),
    });
    const out = deriveComplianceStatus(mag04, TODAY, CFG);
    expect(out.riesgo).toBe("Naranja");
    expect(out.estado).toBe("En trámite administrativo");
  });
});
