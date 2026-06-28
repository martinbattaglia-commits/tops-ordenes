import type { DomainPack } from "@/lib/udie/kernel/ports";
import type { DetectedFormat, ImportReport, PreviewModel } from "@/lib/udie/kernel/types";
import { ok, type Result } from "@/lib/udie/kernel/result";
import { createReaderRegistry } from "@/lib/udie/core/reader-registry";
import { createDetectorRegistry } from "@/lib/udie/core/detector-registry";
import { defaultNormalizer } from "@/lib/udie/core/default-normalizer";
import { createOrchestrator } from "@/lib/udie/core/orchestrator";
import { csvReader } from "@/lib/udie/readers/csv-reader";
import { xlsxReader } from "@/lib/udie/readers/xlsx-reader";
import type { ProspectImportInput } from "../../../domain/prospect";
import { HEADER_ALIASES } from "../header-aliases";
import { prospectValidator } from "./prospect-validator";
import { prospectDedupKeys } from "./prospect-dedup-keys";
import { prospectPreviewBuilder, prospectProjector } from "./prospect-preview";
import { prospectCommitPack } from "./prospect-commit";
import { makeProspectMapperFor, prospectDetectors, profileFor } from "./profiles";
import type { ImportProspectsActionResult } from "../../driving/import-actions";

function buildPack(): DomainPack<ProspectImportInput, ImportProspectsActionResult> {
  return {
    contextId: "prospeccion",
    mapping: {
      aliases: HEADER_ALIASES,
      mapperFor: (fmt: DetectedFormat) => makeProspectMapperFor(fmt),
      normalizer: defaultNormalizer,
      validator: prospectValidator,
      dedup: prospectDedupKeys,
      preview: prospectPreviewBuilder,
    },
    commit: prospectCommitPack,
  };
}

function buildOrchestrator() {
  const readers = createReaderRegistry();
  readers.register(csvReader);
  readers.register(xlsxReader);
  const detectors = createDetectorRegistry();
  prospectDetectors.forEach((d) => detectors.register(d));
  return createOrchestrator({ readers, detectors, defaultNormalizer, pack: buildPack(), maxBatch: 500, projector: prospectProjector, formatToSlug: (fmt) => slugForDetectedFormat(fmt) });
}

export function runProspectImportPreview(file: Blob, override?: { format?: DetectedFormat }): Promise<Result<PreviewModel<ProspectImportInput>>> {
  return buildOrchestrator().plan(file, override);
}

export function slugForDetectedFormat(fmt: string): string {
  return profileFor(fmt as DetectedFormat).sourceSlug;
}

export async function confirmProspectImport(rows: ProspectImportInput[], sourceSlug: string): Promise<Result<ImportReport>> {
  // Camino liviano: commit solo necesita el CommitPack; no construye readers/detectors (que no usaría).
  const r = await prospectCommitPack.executor.execute(rows, sourceSlug);
  if (!r.ok) return r;
  return ok(prospectCommitPack.reporter.toReport(r.value));
}
