// VO ProspectId — UUID branded. La identidad la genera IdGeneratorPort (§4.7), nunca la base (ARCH-001).
import { type Result, ok, err } from "../result";
import { domainError } from "../errors";

export type ProspectId = string & { readonly __brand: "ProspectId" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function makeProspectId(raw: string): Result<ProspectId> {
  if (!UUID_RE.test(raw)) return err(domainError("INVALID_PROSPECT_ID", `id inválido: ${raw}`));
  return ok(raw as ProspectId);
}
