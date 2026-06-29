import { describe, it, expect } from "vitest";
import { mapSheetRowToCaseRecord, planCaseChanges, evidenceFor } from "./sync";
import type { SheetCaseRow } from "./sheet";

const row = (over: Partial<SheetCaseRow> = {}): SheetCaseRow => ({
  item_id: "MAG-04", sede: "MAGALDI", tipo_certificado: "CAA", expediente_nro: "EX-1",
  organismo: "MAD", estado_administrativo: "en_tramite", etapa: "pronto_despacho",
  nivel_riesgo: "alto", fecha_inicio: "2023-09-01", fecha_pronto_despacho: "2025-02-01",
  ultima_actuacion: "X", proxima_accion: "Y", observaciones: "Z", ...over,
});

describe("mapSheetRowToCaseRecord", () => {
  it("marca origen=sheet, confianza=confirmada, activo=true, con row_hash", () => {
    const rec = mapSheetRowToCaseRecord(row());
    expect(rec.origen).toBe("sheet");
    expect(rec.confianza).toBe("confirmada");
    expect(rec.activo).toBe(true);
    expect(rec.estado_administrativo).toBe("en_tramite");
    expect(typeof rec.row_hash).toBe("string");
    expect(rec.row_hash.length).toBeGreaterThan(0);
  });
});

describe("planCaseChanges · valida transición vs estado activo previo (D11)", () => {
  it("creación (sin caso previo) siempre se aplica", () => {
    const { apply, blocked } = planCaseChanges([row()], new Map());
    expect(apply).toHaveLength(1);
    expect(blocked).toHaveLength(0);
  });
  it("transición permitida (en_tramite→pendiente_emision) se aplica", () => {
    const prior = new Map([["MAG-04", "en_tramite" as const]]);
    const { apply, blocked } = planCaseChanges([row({ estado_administrativo: "pendiente_emision" })], prior);
    expect(apply).toHaveLength(1);
    expect(blocked).toHaveLength(0);
  });
  it("transición prohibida (rechazado→vigente) se bloquea y NO se aplica", () => {
    const prior = new Map([["MAG-04", "rechazado" as const]]);
    const { apply, blocked } = planCaseChanges([row({ estado_administrativo: "vigente" })], prior);
    expect(apply).toHaveLength(0);
    expect(blocked).toEqual([{ item_id: "MAG-04", from: "rechazado", to: "vigente" }]);
  });
});

describe("evidenceFor", () => {
  it("registra origen=sheet, nivel_verificacion=confirmada y la transición", () => {
    const ev = evidenceFor({ caseId: "c1", itemId: "MAG-04", from: "en_tramite", to: "pendiente_emision", fecha: "2025-02-01" });
    expect(ev.origen).toBe("sheet");
    expect(ev.nivel_verificacion).toBe("confirmada");
    expect(ev.from_estado).toBe("en_tramite");
    expect(ev.to_estado).toBe("pendiente_emision");
    expect(ev.case_id).toBe("c1");
  });
});
