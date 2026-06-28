import { describe, it, expect } from "vitest";
import { buildPreview } from "./preview-model";
import { asDetectedFormat } from "../kernel/types";
import type { DedupKeyExtractorPort, Projector } from "../kernel/ports";
import type { RowOutcome } from "../kernel/types";

interface R { email: string | null; cuit: string | null; company: string | null }
const dedup: DedupKeyExtractorPort<R> = {
  keysOf: (r) => ({ cuit: r.cuit, email: r.email }),
  primaryKey: (r) => r.cuit ?? r.email ?? null,
};
const projector: Projector<R> = (r) => ({ company: r.company, contactKey: r.cuit ?? r.email ?? null });
const okOutcome: RowOutcome = { valid: true, diagnostics: [] };

describe("buildPreview", () => {
  it("classifies nuevo/posible/exacto and computes stats", () => {
    const rows: R[] = [
      { email: "a@x.co", cuit: "30", company: "ACME" },        // nuevo
      { email: "a@x.co", cuit: "30", company: "ACME" },        // exacto (email+cuit colisionan)
      { email: "a@x.co", cuit: "99", company: "OTRA" },        // posible (solo email colisiona)
    ];
    const outcomes: RowOutcome[] = [okOutcome, okOutcome, { valid: false, diagnostics: [{ level: "error", code: "X", message: "no" }] }];
    const m = buildPreview<R>({
      rows, outcomes, dedup, projector,
      fmt: asDetectedFormat("Evaboot"), sourceSlug: "csv", unmappedHeaders: ["foo"], columnas: 4, maxBatch: 500,
    });
    expect(m.rows.map((r) => r.dedupStatus)).toEqual(["nuevo", "exacto", "posible"]);
    expect(m.stats.registros).toBe(3);
    expect(m.stats.errores).toBe(1);
    expect(m.stats.duplicadosExactos).toBe(1);
    expect(m.stats.posiblesDuplicados).toBe(1);
    expect(m.stats.empresasUnicas).toBe(2);   // ACME, OTRA
    expect(m.stats.detectedFormat).toBe("Evaboot");
    expect(m.stats.excedeMaxBatch).toBe(false);
  });
});
