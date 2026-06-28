import type { ValidatorPort } from "@/lib/udie/kernel/ports";
import type { RowOutcome } from "@/lib/udie/kernel/types";
import type { ProspectImportInput } from "../../../domain/prospect";
import { ProspectFactory } from "../../../domain/prospect";
import { makeProspectId } from "../../../domain/vo/prospect-id";
import { SourceSlug } from "../../../domain/vo/source-slug";

const SOURCE = SourceSlug.create("csv");

export const prospectValidator: ValidatorPort<ProspectImportInput> = {
  validate(row): RowOutcome {
    if (!SOURCE.ok) return { valid: false, diagnostics: [{ level: "error", code: "SOURCE", message: "origen inválido" }] };
    const idR = makeProspectId(crypto.randomUUID());
    if (!idR.ok) return { valid: false, diagnostics: [{ level: "error", code: "ID", message: idR.error.message }] };
    const r = ProspectFactory.fromImportRow(idR.value, SOURCE.value, row);
    if (r.ok) return { valid: true, diagnostics: [] };
    return { valid: false, diagnostics: [{ level: "error", code: r.error.code, message: r.error.message }] };
  },
};
