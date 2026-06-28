import type { PreviewBuilderPort, Projector } from "@/lib/udie/kernel/ports";
import type { ProspectImportInput } from "../../../domain/prospect";
import { buildPreview } from "@/lib/udie/core/preview-model";
import { prospectDedupKeys } from "./prospect-dedup-keys";
import { MAX_BATCH } from "../../../application/import-prospects.use-case";

export const prospectProjector: Projector<ProspectImportInput> = (row) => ({
  company: (row.company_name ?? "").trim() || null,
  contactKey: prospectDedupKeys.primaryKey(row),
});

/**
 * Headers that the mapper consumes by special-case logic (first+last name
 * combination into full_name). They are NOT in HEADER_ALIASES so UDIE core
 * would report them as unmapped — filter them out here (consumer-side fix,
 * AP-UDIE-1 kept green: src/lib/udie/** is untouched).
 */
const MAPPER_CONSUMED_HEADERS = new Set([
  "first name",
  "last name",
  "nombre de pila",
  "apellido",
]);

export const prospectPreviewBuilder: PreviewBuilderPort<ProspectImportInput> = {
  build(rows, outcomes, fmt, sourceSlug, unmappedHeaders, columnas) {
    const filteredUnmapped = unmappedHeaders.filter(
      (h) => !MAPPER_CONSUMED_HEADERS.has(h.toLowerCase()),
    );
    return buildPreview<ProspectImportInput>({
      rows, outcomes, dedup: prospectDedupKeys, projector: prospectProjector,
      fmt, sourceSlug, unmappedHeaders: filteredUnmapped, columnas, maxBatch: MAX_BATCH,
    });
  },
};
