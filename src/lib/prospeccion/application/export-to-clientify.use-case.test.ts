import { describe, expect, it } from "vitest";
import { ExportToClientifyUseCase } from "./export-to-clientify.use-case";
import type {
  ApprovedProspectReadResult,
  ApprovedProspectReaderPort,
  ClientifyExportPort,
  ExportBatchSummary,
  ProspectToExport,
} from "../ports/clientify-export.port";

const prospect = (id: string): ProspectToExport => ({
  prospect_id: id,
  company_name: "ACME",
  full_name: "Ada Lovelace",
  cargo: "COO",
  email: "ada@acme.test",
  phone: "+5491100000000",
  website: "https://acme.test",
  cuit: "20123456786",
  linkedin_url: "https://linkedin.test/ada",
});

class FakeReader implements ApprovedProspectReaderPort {
  calls: readonly string[][] = [];

  constructor(
    private readonly rows: ProspectToExport[] = [],
    private readonly failure?: string,
    private readonly unexpectedFailure?: Error,
  ) {}

  async loadApproved(
    prospectIds: readonly string[],
  ): Promise<ApprovedProspectReadResult> {
    this.calls = [...this.calls, [...prospectIds]];
    if (this.unexpectedFailure) throw this.unexpectedFailure;
    if (this.failure) return { ok: false, errorMessage: this.failure };
    return { ok: true, prospects: this.rows };
  }
}

class FakeExporter implements ClientifyExportPort {
  calls: Array<{ prospects: ProspectToExport[]; actorId: string }> = [];

  constructor(
    private readonly summary: ExportBatchSummary = {
      results: [],
      totalOk: 0,
      totalErrors: 0,
    },
    private readonly failure?: Error,
  ) {}

  async export(prospects: ProspectToExport[], actorId: string): Promise<ExportBatchSummary> {
    this.calls.push({ prospects, actorId });
    if (this.failure) throw this.failure;
    return this.summary;
  }
}

describe("ExportToClientifyUseCase", () => {
  it("preserva el resumen y reporta como skipped los IDs no aprobados", async () => {
    const reader = new FakeReader([prospect("approved")]);
    const exporter = new FakeExporter({
      results: [
        {
          prospect_id: "approved",
          ok: true,
          clientify_contact_id: 42,
          error: null,
        },
      ],
      totalOk: 1,
      totalErrors: 0,
    });
    const useCase = new ExportToClientifyUseCase(exporter, reader);

    const result = await useCase.execute({
      prospectIds: ["approved", "not-approved"],
      actorId: "actor-1",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        processed: 1,
        totalOk: 1,
        totalErrors: 0,
        skipped: ["not-approved"],
        results: [
          {
            prospect_id: "approved",
            ok: true,
            clientify_contact_id: 42,
            error: null,
          },
        ],
      },
    });
    expect(reader.calls).toEqual([["approved", "not-approved"]]);
    expect(exporter.calls).toEqual([
      { prospects: [prospect("approved")], actorId: "actor-1" },
    ]);
  });

  it("no invoca el exportador cuando ningún ID está aprobado", async () => {
    const exporter = new FakeExporter();
    const useCase = new ExportToClientifyUseCase(exporter, new FakeReader());

    const result = await useCase.execute({ prospectIds: ["missing"], actorId: "actor-1" });

    expect(result).toEqual({
      ok: true,
      value: {
        processed: 0,
        totalOk: 0,
        totalErrors: 0,
        skipped: ["missing"],
        results: [],
      },
    });
    expect(exporter.calls).toEqual([]);
  });

  it("preserva el error de lectura de base de datos", async () => {
    const useCase = new ExportToClientifyUseCase(
      new FakeExporter(),
      new FakeReader([], "db unavailable"),
    );

    const result = await useCase.execute({ prospectIds: ["p1"], actorId: "actor-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXPORT_FAILED");
      expect(result.error.message).toBe(
        "Error al cargar prospectos desde la base de datos: db unavailable",
      );
    }
  });

  it("preserva la propagación de una excepción inesperada del lector", async () => {
    const useCase = new ExportToClientifyUseCase(
      new FakeExporter(),
      new FakeReader([], undefined, new Error("unexpected query failure")),
    );

    await expect(
      useCase.execute({ prospectIds: ["p1"], actorId: "actor-1" }),
    ).rejects.toThrow("unexpected query failure");
  });

  it("preserva el error inesperado del exportador", async () => {
    const useCase = new ExportToClientifyUseCase(
      new FakeExporter(undefined, new Error("clientify unavailable")),
      new FakeReader([prospect("p1")]),
    );

    const result = await useCase.execute({ prospectIds: ["p1"], actorId: "actor-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXPORT_FAILED");
      expect(result.error.message).toBe(
        "Error inesperado durante la exportación: clientify unavailable",
      );
    }
  });

  it("mantiene las guardas de IDs y actor antes de tocar los puertos", async () => {
    const reader = new FakeReader();
    const exporter = new FakeExporter();
    const useCase = new ExportToClientifyUseCase(exporter, reader);

    const withoutIds = await useCase.execute({ prospectIds: [], actorId: "actor-1" });
    const withoutActor = await useCase.execute({ prospectIds: ["p1"], actorId: "" });

    expect(withoutIds.ok).toBe(false);
    expect(withoutActor.ok).toBe(false);
    expect(reader.calls).toEqual([]);
    expect(exporter.calls).toEqual([]);
  });
});
