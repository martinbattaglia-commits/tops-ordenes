// VO ProspectStatus — espejo del enum SQL `prospeccion_status_t` (español canónico de persistencia, CC-3/CC-7).
// La correspondencia con los nombres de dominio en inglés (created→raw, ai_analyzed→con_ia, …) vive en CC-7.
import { type Result, ok, err } from "../result";
import { domainError } from "../errors";

export const PROSPECT_STATUSES = [
  "raw",
  "imported",
  "enriquecido",
  "scoreado",
  "con_ia",
  "aprobado",
  "sincronizado",
  "cliente_creado",
  "rechazado",
  "duplicado",
] as const;

export type ProspectStatusValue = (typeof PROSPECT_STATUSES)[number];

/** Estados que F0 puede producir vía la RPC de ingesta. */
export const F0_STATUSES: readonly ProspectStatusValue[] = ["raw", "imported", "duplicado"];

export class ProspectStatus {
  private constructor(public readonly value: ProspectStatusValue) {}

  static create(raw: string | null | undefined): Result<ProspectStatus> {
    const v = (raw ?? "").trim();
    if (!(PROSPECT_STATUSES as readonly string[]).includes(v)) {
      return err(domainError("INVALID_STATUS", `estado inválido: ${raw}`));
    }
    return ok(new ProspectStatus(v as ProspectStatusValue));
  }
}
