/** Política de descubrimiento y acceso a WhatsApp Comercial Histórico. */
export function canAccessWaCommercialImport(role: string | null | undefined): boolean {
  return role === "admin";
}
