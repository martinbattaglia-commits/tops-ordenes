// VO Cuit — 11 dígitos + dígito verificador AR válido (mod-11). Rechaza placeholders. Parte II §1.3.
import { type Result, ok, err } from "../result";
import { domainError } from "../errors";

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

function isValidCuit(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // 00000000000, 11111111111…
  const nums = digits.split("").map(Number);
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * nums[i]!, 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === nums[10];
}

export class Cuit {
  private constructor(public readonly value: string) {}

  /** Normaliza (quita guiones/espacios) y valida el dígito verificador. */
  static create(raw: string | null | undefined): Result<Cuit> {
    const digits = (raw ?? "").replace(/\D/g, "");
    if (!digits) return err(domainError("INVALID_CUIT", "cuit vacío"));
    if (!isValidCuit(digits)) return err(domainError("INVALID_CUIT", `cuit inválido: ${raw}`));
    return ok(new Cuit(digits));
  }

  equals(other: Cuit): boolean {
    return this.value === other.value;
  }
}
