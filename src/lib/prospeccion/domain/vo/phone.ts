// VO Phone — normaliza a solo dígitos (E.164 AR por defecto). Parte II §1.3.
import { type Result, ok, err } from "../result";
import { domainError } from "../errors";

export class Phone {
  private constructor(public readonly value: string) {}

  static create(raw: string | null | undefined): Result<Phone> {
    const digits = (raw ?? "").replace(/\D/g, "");
    if (digits.length < 8) return err(domainError("INVALID_PHONE", `teléfono inválido: ${raw}`));
    return ok(new Phone(digits));
  }

  equals(other: Phone): boolean {
    return this.value === other.value;
  }
}
