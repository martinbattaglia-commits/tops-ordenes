import type { FormatDetectorPort, MapperPort } from "@/lib/udie/kernel/ports";
import { asDetectedFormat, type DetectedFormat, type RawTable } from "@/lib/udie/kernel/types";
import type { SourceSlugValue } from "../../../domain/vo/source-slug";
import type { ProspectImportInput } from "../../../domain/prospect";
import { makeProspectMapper } from "./prospect-mapper";

export { makeProspectMapper };

export interface ProspectSourceProfile {
  detectedFormat: DetectedFormat;
  sourceSlug: SourceSlugValue;
  label: string;
  signature: string[]; // headers (lowercase) telltale de la herramienta
}

const P = (label: string, slug: SourceSlugValue, signature: string[]): ProspectSourceProfile => ({
  detectedFormat: asDetectedFormat(label), sourceSlug: slug, label, signature: signature.map((s) => s.toLowerCase()),
});

export const PROSPECT_PROFILES: ProspectSourceProfile[] = [
  P("LinkedIn Sales Navigator", "linkedin_sales_navigator", ["first name", "last name", "company", "title", "linkedin url"]),
  P("Evaboot", "csv", ["evaboot cleaned company name", "linkedin url", "title"]),
  P("Apollo", "csv", ["first name", "last name", "company", "email", "# employees"]),
  P("Wiza", "csv", ["full name", "company", "title", "email status"]),
  P("Phantombuster", "csv", ["profileurl", "fullname", "companyname"]),
  P("Clientify", "csv", ["nombre", "empresa", "correo", "telefono"]),
  P("Generic CSV", "csv", []),
];

const GENERIC = PROSPECT_PROFILES[PROSPECT_PROFILES.length - 1];

export function profileFor(fmt: DetectedFormat): ProspectSourceProfile {
  return PROSPECT_PROFILES.find((p) => p.detectedFormat === fmt) ?? GENERIC;
}

function score(signature: string[], headers: string[]): number {
  if (signature.length === 0) return 0.01; // Generic CSV = catch-all (piso); gana solo si ningún perfil nombrado califica
  const set = new Set(headers.map((h) => h.toLowerCase().trim()));
  const hits = signature.filter((s) => set.has(s)).length;
  const ratio = hits / signature.length;
  // Un perfil nombrado debe cubrir ≥60% de su firma para competir; si no, no participa.
  // Evita que headers ubicuos (email/company/title) hagan ganar a un perfil parcial sobre Generic.
  return ratio >= 0.6 ? ratio : 0;
}

export const prospectDetectors: FormatDetectorPort[] = PROSPECT_PROFILES.map((p) => ({
  id: p.label,
  detect(table: RawTable) {
    const c = score(p.signature, table.headers);
    return c > 0 ? { format: p.detectedFormat, confidence: c } : null;
  },
}));

export function makeProspectMapperFor(fmt: DetectedFormat): MapperPort<ProspectImportInput> {
  return makeProspectMapper(fmt);
}
