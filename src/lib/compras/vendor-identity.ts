import type { Vendor } from "@/lib/types-po";

export type CanonicalVendor = Pick<
  Vendor,
  | "id"
  | "razon"
  | "cuit"
  | "domicilio"
  | "telefono"
  | "contacto"
  | "email"
  | "categoria"
  | "cond_pago"
  | "active"
>;

export class VendorIdentityError extends Error {
  constructor(
    public readonly code:
      | "VENDOR_NOT_FOUND"
      | "VENDOR_INACTIVE"
      | "VENDOR_CUIT_MISMATCH"
      | "VENDOR_NAME_MISMATCH",
  ) {
    super(code);
    this.name = "VendorIdentityError";
  }
}

export function vendorDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizedName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Verifica que la identidad elegida por el navegador corresponda exactamente
 * al maestro. Los datos de contacto que salen de esta función son siempre los
 * canónicos; el payload nunca puede sustituirlos.
 */
export function assertCanonicalVendor(
  input: { id: string | null; razon: string; cuit: string },
  row: CanonicalVendor | null,
): CanonicalVendor {
  if (!row) throw new VendorIdentityError("VENDOR_NOT_FOUND");
  if (!row.active) throw new VendorIdentityError("VENDOR_INACTIVE");
  if (vendorDigits(input.cuit) !== vendorDigits(row.cuit)) {
    throw new VendorIdentityError("VENDOR_CUIT_MISMATCH");
  }
  if (normalizedName(input.razon) !== normalizedName(row.razon)) {
    throw new VendorIdentityError("VENDOR_NAME_MISMATCH");
  }
  return row;
}
