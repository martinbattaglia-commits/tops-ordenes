import { describe, it, expect, vi } from "vitest";
import { createOrchestrator } from "./orchestrator";
import { createReaderRegistry } from "./reader-registry";
import { createDetectorRegistry } from "./detector-registry";
import { defaultNormalizer } from "./default-normalizer";
import { ok } from "../kernel/result";
import { asDetectedFormat } from "../kernel/types";
import type { DomainPack, ReaderPort, FormatDetectorPort } from "../kernel/ports";

interface FakeRow { name: string | null }
interface FakeReport { saved: number }

const fakeReader: ReaderPort = {
  id: "csv", accepts: () => true,
  read: async () => ok({ headers: ["name"], rows: [{ name: "ana" }, { name: "ana" }], sourceName: "x.csv" }),
};
const fakeDetector: FormatDetectorPort = {
  id: "fake", detect: () => ({ format: asDetectedFormat("Fake Tool"), confidence: 1 }),
};

function pack(executeSpy: ReturnType<typeof vi.fn>): DomainPack<FakeRow, FakeReport> {
  const fmt = asDetectedFormat("Fake Tool");
  return {
    contextId: "fake",
    mapping: {
      aliases: { name: "name" },
      mapperFor: () => ({ format: fmt, map: (r) => ({ name: r["name"] ?? null }) }),
      validator: { validate: (row) => ({ valid: !!row.name, diagnostics: [] }) },
      dedup: { keysOf: (r) => ({ name: r.name }), primaryKey: (r) => r.name },
      preview: {
        build: (rows, outcomes) => ({
          rows: rows.map((row, i) => ({ index: i, row, valid: outcomes[i].valid, diagnostics: [], dedupStatus: "nuevo", dedupReason: "" })),
          stats: { registros: rows.length, columnas: 1, errores: 0, pctValidos: 100, pctRechazados: 0, empresasUnicas: 0, contactosUnicos: 0, posiblesDuplicados: 0, duplicadosExactos: 0, detectedFormat: "Fake Tool", sourceSlug: "csv", unmappedHeaders: [], excedeMaxBatch: false },
        }),
      },
    },
    commit: {
      executor: { execute: executeSpy },
      reporter: { toReport: (r: FakeReport) => ({ inserted: r.saved, duplicates: 0, rejected: 0, message: "ok" }) },
    },
  };
}

function deps(executeSpy: ReturnType<typeof vi.fn>) {
  const readers = createReaderRegistry(); readers.register(fakeReader);
  const detectors = createDetectorRegistry(); detectors.register(fakeDetector);
  return { readers, detectors, defaultNormalizer, pack: pack(executeSpy), maxBatch: 500 };
}

describe("ImportOrchestrator (generic, no domain knowledge)", () => {
  it("plan() reads → detects → maps → validates → previews", async () => {
    const orch = createOrchestrator<FakeRow, FakeReport>(deps(vi.fn()));
    const r = await orch.plan(new Blob(["x"], { type: "text/csv" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.stats.detectedFormat).toBe("Fake Tool");
      expect(r.value.rows).toHaveLength(2);
    }
  });
  it("commit() calls executor once when proceed=true, never when false", async () => {
    const spy = vi.fn(async () => ok({ saved: 2 }));
    const orch = createOrchestrator<FakeRow, FakeReport>(deps(spy));
    const no = await orch.commit({ proceed: false, source: "csv" }, [{ name: "ana" }]);
    expect(no.ok).toBe(false);
    expect(spy).toHaveBeenCalledTimes(0);
    const yes = await orch.commit({ proceed: true, source: "csv" }, [{ name: "ana" }]);
    expect(yes.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    if (yes.ok) expect(yes.value.inserted).toBe(2);
  });
});
