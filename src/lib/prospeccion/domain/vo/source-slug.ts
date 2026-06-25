// VO SourceSlug — enum cerrado de orígenes (catálogo prospeccion_sources). Parte II §1.3 / CC.
import { type Result, ok, err } from "../result";
import { domainError } from "../errors";

export const SOURCE_SLUGS = [
  "linkedin_sales_navigator",
  "csv",
  "manual",
  "paste",
  "api",
  "webhook",
] as const;

export type SourceSlugValue = (typeof SOURCE_SLUGS)[number];

export class SourceSlug {
  private constructor(public readonly value: SourceSlugValue) {}

  static create(raw: string | null | undefined): Result<SourceSlug> {
    const v = (raw ?? "").trim();
    if (!(SOURCE_SLUGS as readonly string[]).includes(v)) {
      return err(domainError("INVALID_SOURCE", `origen desconocido: ${raw}`, { allowed: SOURCE_SLUGS }));
    }
    return ok(new SourceSlug(v as SourceSlugValue));
  }
}
