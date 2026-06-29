import { describe, it, expect } from "vitest";
import { canTransition, TRANSICIONES } from "./transitions";

describe("canTransition · máquina de estados (D11)", () => {
  it("auto-transición siempre válida (idempotencia del re-sync)", () => {
    expect(canTransition("en_tramite", "en_tramite")).toBe(true);
  });
  it("sin_iniciar → cualquiera (creación inicial)", () => {
    expect(canTransition("sin_iniciar", "vigente")).toBe(true);
    expect(canTransition("sin_iniciar", "rechazado")).toBe(true);
  });
  it("en_tramite → pendiente_emision / aprobado / rechazado permitido", () => {
    expect(canTransition("en_tramite", "pendiente_emision")).toBe(true);
    expect(canTransition("en_tramite", "rechazado")).toBe(true);
  });
  it("pendiente_emision → vigente permitido (se incorporó el cert)", () => {
    expect(canTransition("pendiente_emision", "vigente")).toBe(true);
  });
  it("rechazado → vigente NO permitido (debe reabrir trámite)", () => {
    expect(canTransition("rechazado", "vigente")).toBe(false);
  });
  it("vigente → pendiente_emision NO permitido (no salta el trámite)", () => {
    expect(canTransition("vigente", "pendiente_emision")).toBe(false);
  });
  it("todo destino declarado es un estado válido del enum", () => {
    const all = Object.keys(TRANSICIONES);
    for (const tos of Object.values(TRANSICIONES)) for (const t of tos) expect(all).toContain(t);
  });
});
