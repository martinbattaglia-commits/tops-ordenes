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
  if (m.includes("BENEFICIARY_REQUIRED")) return "Esta categoría exige identificar al beneficiario.";
  if (m.includes("BENEFICIARY_INACTIVE")) return "El beneficiario está dado de baja.";
  if (m.includes("BENEFICIARY_INVALID")) return "El beneficiario seleccionado no existe.";
  if (m.includes("NOT_FOUND_OR_ALREADY_VOID")) return "El comprobante no existe o ya está anulado.";
  if (m.includes("VOID_REQUIRES_REASON")) return "La anulación requiere un motivo.";
  if (m.includes("INVALID_TARGET_TYPE")) return "Tipo de anulación inválido.";
  if (m.includes("INVALID_RETENTION")) return "La retención es inválida (debe estar entre 0 y el importe bruto).";
  if (m.includes("INVALID_ALLOCATION_AMOUNT")) return "Una imputación tiene un importe inválido.";
  if (m.includes("INVALID_AMOUNT")) return "El importe es inválido.";
  if (m.includes("NO_ALLOCATIONS")) return "Se requiere al menos una imputación.";
  // Conciliación bancaria (0212 · TREAS-RECON-001)
  if (m.includes("RECON_ACCOUNT_NOT_FOUND")) return "La cuenta indicada no existe.";
  if (m.includes("RECON_ACCOUNT_INACTIVE")) return "La cuenta está inactiva; no admite conciliación.";
  if (m.includes("RECON_ACCOUNT_NOT_BANK")) return "La cuenta seleccionada no es bancaria (Caja no admite conciliación de extractos).";
  if (m.includes("RECON_BANK_MISMATCH")) return "El banco del extracto no coincide con el banco de la cuenta seleccionada.";
  if (m.includes("RECON_BANK_REQUIRED")) return "El extracto no declara banco.";
  if (m.includes("RECON_BANK_UNSUPPORTED")) return "Banco no soportado: sólo se admiten Santander y Galicia.";
  if (m.includes("RECON_MOVEMENT_ALREADY_RECONCILED")) return "Uno de los movimientos ya está conciliado; la operación se cancela completa.";
  if (m.includes("RECON_ALLOCATION_MISMATCH")) return "La suma imputada no coincide con el importe de la línea del extracto.";
  if (m.includes("RECON_PARTIAL_SEAL")) return "No se pudieron sellar todos los movimientos; la conciliación se revirtió completa.";
  if (m.includes("RECON_EXCLUSION_ACTOR_FORBIDDEN")) return "No se puede declarar un autor distinto del usuario autenticado.";
  if (m.includes("RECON_EXCLUSION_ACTOR_REQUIRED")) return "La operación técnica debe declarar un autor explícito.";
  if (m.includes("RECON_EXCLUSION_ACTOR_INVALID")) return "El autor declarado no existe.";
  if (m.includes("RECON_EXCLUSION_MOVEMENT_NOT_FOUND")) return "El movimiento a excluir no existe.";
  if (m.includes("RECON_CURRENCY_UNSUPPORTED")) return "La conciliación actual sólo soporta cuentas en pesos (ARS).";
  if (m.includes("RECON_EXCLUDED_MOVEMENT")) return "El movimiento está excluido de conciliación por gobernanza (baseline/cutover).";
  if (m.includes("RECON_STATEMENT_NOT_FOUND")) return "El extracto no existe.";
  if (m.includes("RECON_SYSTEMIC_BATCH_EXISTS")) return "Los sistémicos de este extracto ya fueron registrados (operación única por extracto).";
  if (m.includes("RECON_NO_SYSTEMIC_LINES")) return "El extracto no tiene líneas sistémicas pendientes.";
  if (m.includes("RECON_SYSTEMIC_NET_ZERO")) return "El neto sistémico es cero; no corresponde ajuste.";
  if (m.includes("RECON_LINE_NOT_FOUND")) return "La línea del extracto no existe.";
  if (m.includes("RECON_ACCOUNT_MISMATCH")) return "La cuenta indicada no corresponde al extracto de esa línea.";
  if (m.includes("RECON_LINE_NOT_OPEN")) return "La línea ya fue resuelta y no admite ajuste.";
  if (m.includes("RECON_LINE_ADJUSTMENT_EXISTS")) return "La línea ya tiene un ajuste registrado.";
  return "No se pudo completar la operación. Revisá los datos e intentá nuevamente.";
}
