// VO Email — inmutable, válido por construcción, normalizado (lower/trim). CC-7/Parte II §1.3.
import { type Result, ok, err } from "../result";
import { domainError } from "../errors";

const RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Email {
  private constructor(public readonly value: string) {}

  static create(raw: string | null | undefined): Result<Email> {
    const v = (raw ?? "").trim().toLowerCase();
    if (!v) return err(domainError("INVALID_EMAIL", "email vacío"));
    if (!RE.test(v)) return err(domainError("INVALID_EMAIL", `email inválido: ${v}`));
    return ok(new Email(v));
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }
}
