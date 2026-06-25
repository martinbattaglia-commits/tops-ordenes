import { describe, it, expect } from "vitest";
import { ImportProspectsUseCase } from "./import-prospects.use-case";
import { ok, type Result } from "../domain/result";
import type { IdGeneratorPort } from "../ports/id-generator.port";
import type { IngestPort, ProspectIngestRow, IngestResult } from "../ports/ingest.port";

// Fakes (sin red ni base): determinismo total (HEX-7).
class FakeIds implements IdGeneratorPort {
  private n = 0;
  uuid(): string {
    this.n++;
    const h = this.n.toString(16).padStart(12, "0");
    return `11111111-1111-4111-8111-${h}`;
  }
}
class FakeIngest implements IngestPort {
  public received: ProspectIngestRow[] = [];
  constructor(private readonly res: IngestResult) {}
  async ingest(rows: ReadonlyArray<ProspectIngestRow>): Promise<Result<IngestResult>> {
    this.received = [...rows];
    return ok(this.res);
  }
}

describe("ImportProspectsUseCase", () => {
  it("valida fila por fila, descarta inválidas y envía solo las válidas al IngestPort", async () => {
    const ingest = new FakeIngest({ inserted: 1, duplicates: 1 });
    const uc = new ImportProspectsUseCase(new FakeIds(), ingest);

    const r = await uc.execute({
      source: "csv",
      rows: [
        { email: "laura@acme.test", company_name: "ACME" }, // válida
        { email: "roto" }, // inválida (email)
        { company_name: "Sin identidad" }, // inválida (sin clave)
        { cuit: "20-12345678-6" }, // válida
      ],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.received).toBe(4);
    expect(r.value.valid).toBe(2);
    expect(r.value.rejected.length).toBe(2);
    expect(r.value.inserted).toBe(1);
    expect(r.value.duplicates).toBe(1);
    expect(ingest.received.length).toBe(2);
    expect(ingest.received[0]!.email).toBe("laura@acme.test");
  });

  it("falla temprano si el origen es inválido (no llama al IngestPort)", async () => {
    const ingest = new FakeIngest({ inserted: 0, duplicates: 0 });
    const uc = new ImportProspectsUseCase(new FakeIds(), ingest);
    const r = await uc.execute({ source: "origen_inexistente", rows: [{ email: "a@b.co" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_SOURCE");
    expect(ingest.received.length).toBe(0);
  });

  it("si no hay filas válidas, no invoca el IngestPort", async () => {
    const ingest = new FakeIngest({ inserted: 0, duplicates: 0 });
    const uc = new ImportProspectsUseCase(new FakeIds(), ingest);
    const r = await uc.execute({ source: "csv", rows: [{ email: "roto" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.valid).toBe(0);
      expect(r.value.rejected.length).toBe(1);
    }
    expect(ingest.received.length).toBe(0);
  });
});
