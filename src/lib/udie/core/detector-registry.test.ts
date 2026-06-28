import { describe, it, expect } from "vitest";
import { createDetectorRegistry } from "./detector-registry";
import { asDetectedFormat, type RawTable } from "../kernel/types";
import type { FormatDetectorPort } from "../kernel/ports";

const table: RawTable = { headers: ["a"], rows: [], sourceName: "x.csv" };
const det = (id: string, conf: number): FormatDetectorPort => ({
  id, detect: () => (conf > 0 ? { format: asDetectedFormat(id), confidence: conf } : null),
});

describe("DetectorRegistry", () => {
  it("max confidence wins", () => {
    const r = createDetectorRegistry();
    r.register(det("low", 0.3));
    r.register(det("high", 0.9));
    expect(r.detect(table)?.format).toBe("high");
  });
  it("ties break by lower id alphabetically", () => {
    const r = createDetectorRegistry();
    r.register(det("bbb", 0.5));
    r.register(det("aaa", 0.5));
    expect(r.detect(table)?.format).toBe("aaa");
  });
  it("rejects duplicate id (fail-closed)", () => {
    const r = createDetectorRegistry();
    r.register(det("dup", 0.5));
    expect(() => r.register(det("dup", 0.6))).toThrow();
  });
  it("returns null when no detector matches", () => {
    const r = createDetectorRegistry();
    r.register(det("none", 0));
    expect(r.detect(table)).toBeNull();
  });
});
