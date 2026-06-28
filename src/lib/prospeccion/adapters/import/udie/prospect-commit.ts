import type { CommitPack } from "@/lib/udie/kernel/ports";
import { ok, err, domainError } from "@/lib/udie/kernel/result";
import type { ProspectImportInput } from "../../../domain/prospect";
import { importProspectsAction, type ImportProspectsActionResult } from "../../driving/import-actions";

export const prospectCommitPack: CommitPack<ProspectImportInput, ImportProspectsActionResult> = {
  executor: {
    async execute(rows, source) {
      const res = await importProspectsAction({ source, rows });
      if (!res.ok) return err(domainError("INGEST_FAILED", res.message));
      return ok(res);
    },
  },
  reporter: {
    toReport(r) {
      if (!r.ok) return { inserted: 0, duplicates: 0, rejected: 0, message: r.message };
      return { inserted: r.inserted, duplicates: r.duplicates, rejected: r.rejected, message: r.message };
    },
  },
};
