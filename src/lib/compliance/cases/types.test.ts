import { describe, it, expect } from "vitest";
import { ESTADOS, NIVELES_RIESGO, SEMAFOROS } from "./types";

describe("compliance cases · types", () => {
  it("incluye el estado transitorio pendiente_emision", () => {
    expect(ESTADOS).toContain("pendiente_emision");
  });
  it("niveles de riesgo son 4 (no son colores)", () => {
    expect(NIVELES_RIESGO).toEqual(["bajo", "medio", "alto", "critico"]);
  });
  it("semáforo tiene exactamente los 4 colores", () => {
    expect(SEMAFOROS).toEqual(["Verde", "Amarillo", "Naranja", "Rojo"]);
  });
});
