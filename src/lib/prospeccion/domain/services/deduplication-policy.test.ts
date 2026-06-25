import { describe, it, expect } from "vitest";
import { DeduplicationPolicy } from "./deduplication-policy";

describe("DeduplicationPolicy (pura)", () => {
  it("primaryKey sigue la cadena cuit → email → linkedin", () => {
    expect(DeduplicationPolicy.primaryKey({ cuit: "30x", email: "a@b.c", linkedinUrl: "li" })).toBe("30x");
    expect(DeduplicationPolicy.primaryKey({ cuit: null, email: "a@b.c", linkedinUrl: "li" })).toBe("a@b.c");
    expect(DeduplicationPolicy.primaryKey({ cuit: null, email: null, linkedinUrl: "li" })).toBe("li");
    expect(DeduplicationPolicy.primaryKey({ cuit: null, email: null, linkedinUrl: null })).toBeNull();
  });

  it("isDuplicate detecta colisión por cualquier clave ya vista", () => {
    const seen = new Set(["a@b.c"]);
    expect(DeduplicationPolicy.isDuplicate({ cuit: null, email: "a@b.c", linkedinUrl: null }, seen)).toBe(true);
    expect(DeduplicationPolicy.isDuplicate({ cuit: "30x", email: "z@z.z", linkedinUrl: null }, seen)).toBe(false);
  });

  it("CR-HIGH #7 / CC-4: phone NO es señal de dedup en F0 (es identidad-de-alta)", () => {
    // DedupeKeys no incluye phone por diseño: un prospecto cuya única clave es phone NO tiene
    // clave de dedup → no se deduplica (comportamiento deliberado y fijado hasta F1+).
    expect(DeduplicationPolicy.primaryKey({ cuit: null, email: null, linkedinUrl: null })).toBeNull();
    // @ts-expect-error — `phone` no es parte del contrato DedupeKeys (excluido a propósito).
    const k = DeduplicationPolicy.primaryKey({ cuit: null, email: null, linkedinUrl: null, phone: "1145678901" });
    expect(k).toBeNull();
  });
});
