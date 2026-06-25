// VO Website — host válido, sin esquema, lowercase. Clave para dedup de empresa. Parte II §1.3.
import { type Result, ok, err } from "../result";
import { domainError } from "../errors";

const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

export class Website {
  private constructor(public readonly value: string) {}

  static create(raw: string | null | undefined): Result<Website> {
    let v = (raw ?? "").trim().toLowerCase();
    v = v.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (!v) return err(domainError("INVALID_WEBSITE", "website vacío"));
    if (!HOST_RE.test(v)) return err(domainError("INVALID_WEBSITE", `website inválido: ${raw}`));
    return ok(new Website(v));
  }

  equals(other: Website): boolean {
    return this.value === other.value;
  }
}
