import type { PreviewBuilderPort, Projector } from "@/lib/udie/kernel/ports";
import type { ProspectImportInput } from "../../../domain/prospect";
import { buildPreview } from "@/lib/udie/core/preview-model";
import { prospectDedupKeys } from "./prospect-dedup-keys";

const MAX_BATCH = 500; // espejo de ImportProspectsUseCase.MAX_BATCH

export const prospectProjector: Projector<ProspectImportInput> = (row) => ({
  company: (row.company_name ?? "").trim() || null,
  contactKey: prospectDedupKeys.primaryKey(row),
});

export const prospectPreviewBuilder: PreviewBuilderPort<ProspectImportInput> = {
  build(rows, outcomes, fmt, sourceSlug, unmappedHeaders, columnas) {
    return buildPreview<ProspectImportInput>({
      rows, outcomes, dedup: prospectDedupKeys, projector: prospectProjector,
      fmt, sourceSlug, unmappedHeaders, columnas, maxBatch: MAX_BATCH,
    });
  },
};
