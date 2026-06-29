import { describe, it, expect } from "vitest";
import { executiveKpis, type ComplianceItem } from "./data";

function it_(riesgo: ComplianceItem["riesgo"], sede: ComplianceItem["sede"] = "MAGALDI"): ComplianceItem {
  return { id: "x"+Math.random(), sede, categoria: "Residuos", documento: "d", organismo: "", tipo: "", emision: null, vencimiento: null, frecuencia: "", estado: "", riesgo, fuente: "", nota: "", docs: 0, dias: null, venc_fmt: "", emi_fmt: "" };
}

describe("executiveKpis", () => {
  const items = [it_("Verde"), it_("Amarillo"), it_("Naranja"), it_("Naranja"), it_("Rojo")];
  const byKey = (k: string) => executiveKpis(items).find((x) => x.key === k)!;
  it("'proximos' cuenta Amarillo (próximo a vencer)", () => {
    expect(byKey("proximos").value).toBe(1);
  });
  it("'en_tramite' cuenta Naranja (en trámite administrativo)", () => {
    expect(byKey("en_tramite").value).toBe(2);
  });
  it("'vencidos' cuenta Rojo", () => {
    expect(byKey("vencidos").value).toBe(1);
  });
});
