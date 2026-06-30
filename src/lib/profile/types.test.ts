import { describe, it, expect } from "vitest";
import { initialsFrom } from "./types";

describe("profile/types · initialsFrom", () => {
  it("toma iniciales de nombre y apellido", () => {
    expect(initialsFrom("Martín Battaglia")).toBe("MB");
    expect(initialsFrom("María José González")).toBe("MG"); // primero + último
  });
  it("un solo nombre → 2 primeras letras", () => {
    expect(initialsFrom("Lucía")).toBe("LU");
  });
  it("vacío/nulo → NN", () => {
    expect(initialsFrom("")).toBe("NN");
    expect(initialsFrom(null)).toBe("NN");
    expect(initialsFrom(undefined)).toBe("NN");
  });
});
