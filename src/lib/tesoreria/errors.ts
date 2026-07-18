/**
 * humanizeRpcError — traduce los códigos de excepción de las RPC de `0054`
 * (formato 'CODE: mensaje') a textos legibles. No agrega lógica: solo mapeo.
 */
export function humanizeRpcError(message = ""): string {
  const m = message || "";
  if (m.includes("FORBIDDEN")) return "No tenés permiso para realizar esta operación.";
  if (m.includes("ALLOCATION_SUM_MISMATCH")) return "La suma de las imputaciones no coincide con el importe total.";
  if (m.includes("OVERALLOCATION")) return "Una factura quedaría sobre-imputada (excede su saldo pendiente).";
  if (m.includes("INVOICE_NOT_FOUND")) return "No se encontró una de las facturas indicadas.";
  if (m.includes("INVOICE_NOT_PAYABLE")) return "La factura no está autorizada por ARCA o está anulada.";
  if (m.includes("INVOICE_WRONG_CLIENT")) return "La factura no pertenece al cliente seleccionado.";
  if (m.includes("INVOICE_WRONG_VENDOR")) return "La factura no pertenece al proveedor seleccionado.";
  if (m.includes("INVOICE_VOID")) return "La factura está anulada.";
  if (m.includes("CASH_REQUIRES_CAJA")) return "El efectivo debe imputarse a la cuenta CAJA.";
  if (m.includes("CURRENCY_UNSUPPORTED")) return "Solo se opera en pesos (ARS).";
  if (m.includes("BANK_INACTIVE")) return "La cuenta bancaria está inactiva.";
  if (m.includes("BANK_INVALID")) return "La cuenta bancaria es inválida.";
  if (m.includes("SAME_ACCOUNT")) return "La transferencia requiere cuentas de origen y destino distintas.";
  if (m.includes("OPMOV_CONCEPT_REQUIRED")) return "El concepto del movimiento es obligatorio.";
  if (m.includes("OPMOV_DIRECTION_INVALID")) return "Indicá si el movimiento es un ingreso o un egreso.";
  if (m.includes("NOT_FOUND_OR_ALREADY_VOID")) return "El comprobante no existe o ya está anulado.";
  if (m.includes("VOID_REQUIRES_REASON")) return "La anulación requiere un motivo.";
  if (m.includes("INVALID_TARGET_TYPE")) return "Tipo de anulación inválido.";
  if (m.includes("INVALID_RETENTION")) return "La retención es inválida (debe estar entre 0 y el importe bruto).";
  if (m.includes("INVALID_ALLOCATION_AMOUNT")) return "Una imputación tiene un importe inválido.";
  if (m.includes("INVALID_AMOUNT")) return "El importe es inválido.";
  if (m.includes("NO_ALLOCATIONS")) return "Se requiere al menos una imputación.";
  return "No se pudo completar la operación. Revisá los datos e intentá nuevamente.";
}
