import { describe, it, expect, vi } from "vitest";
import type { ProspectImportInput } from "../../../domain/prospect";
import type { ImportProspectsActionInput } from "../../driving/import-actions";

vi.mock("../../driving/import-actions", () => ({
  importProspectsAction: vi.fn(async () => ({ ok: true, message: "Import: 2 nuevos", inserted: 2, duplicates: 1, rejected: 0 })),
}));

import { prospectCommitPack } from "./prospect-commit";

// Type-level contract: engine rows must be assignable to the action's rows parameter.
// If this line fails at compile time, a signature drift was introduced.
type _RowsAreAssignable = ProspectImportInput[] extends NonNullable<ImportProspectsActionInput["rows"]> ? true : never;
const _contractCheck: _RowsAreAssignable = true;

describe("prospectCommitPack", () => {
  it("executor wraps importProspectsAction and reporter maps to ImportReport", async () => {
    const r = await prospectCommitPack.executor.execute([{ email: "a@b.co" }], "csv");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const report = prospectCommitPack.reporter.toReport(r.value);
    expect(report.inserted).toBe(2);
    expect(report.duplicates).toBe(1);
  });
});
