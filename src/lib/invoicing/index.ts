/**
 * Dominio de Facturación Electrónica (ARCA).
 * Desacoplado: consume `@/lib/arca` para autorización y QR.
 */

export * from "./types";
export * from "./calc";
export * from "./data";
export { emitInvoice } from "./emit";
export type { EmitInvoiceInput, EmitItemInput, EmitContext, EmitResult } from "./emit";
