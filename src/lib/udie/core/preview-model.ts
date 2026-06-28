import type { DedupKeyExtractorPort, Projector } from "../kernel/ports";
import type { DetectedFormat, PreviewModel, PreviewRow, RowOutcome, RowStatus } from "../kernel/types";

interface Args<TRow> {
  rows: TRow[];
  outcomes: RowOutcome[];
  dedup: DedupKeyExtractorPort<TRow>;
  projector: Projector<TRow>;
  fmt: DetectedFormat;
  sourceSlug: string;
  unmappedHeaders: string[];
  columnas: number;
  maxBatch: number;
}

export function buildPreview<TRow>(a: Args<TRow>): PreviewModel<TRow> {
  const seen = new Map<string, number>(); // key -> first row index (1-based)
  const previewRows: PreviewRow<TRow>[] = [];
  const companies = new Set<string>();
  const contacts = new Set<string>();

  a.rows.forEach((row, i) => {
    const keys = Object.values(a.dedup.keysOf(row)).filter((k): k is string => !!k);
    const collisions = keys.filter((k) => seen.has(k));
    let status: RowStatus = "nuevo";
    let reason = "registro nuevo";
    if (keys.length > 0 && collisions.length === keys.length) {
      status = "exacto";
      reason = `coincide con la fila #${seen.get(collisions[0])} en todas las claves`;
    } else if (collisions.length > 0) {
      status = "posible";
      reason = `coincide parcialmente con la fila #${seen.get(collisions[0])}`;
    }
    for (const k of keys) if (!seen.has(k)) seen.set(k, i + 1);

    const proj = a.projector(row);
    if (proj.company) companies.add(proj.company.toLowerCase());
    if (proj.contactKey) contacts.add(proj.contactKey);

    const outcome = a.outcomes[i] ?? { valid: false, diagnostics: [] };
    previewRows.push({ index: i, row, valid: outcome.valid, diagnostics: outcome.diagnostics, dedupStatus: status, dedupReason: reason });
  });

  const registros = a.rows.length;
  const errores = previewRows.filter((r) => !r.valid).length;
  const validos = registros - errores;
  const pct = (n: number) => (registros === 0 ? 0 : Math.round((n / registros) * 100));

  return {
    rows: previewRows,
    stats: {
      registros,
      columnas: a.columnas,
      errores,
      pctValidos: pct(validos),
      pctRechazados: pct(errores),
      empresasUnicas: companies.size,
      contactosUnicos: contacts.size,
      posiblesDuplicados: previewRows.filter((r) => r.dedupStatus === "posible").length,
      duplicadosExactos: previewRows.filter((r) => r.dedupStatus === "exacto").length,
      detectedFormat: a.fmt,
      sourceSlug: a.sourceSlug,
      unmappedHeaders: a.unmappedHeaders,
      excedeMaxBatch: registros > a.maxBatch,
    },
  };
}
