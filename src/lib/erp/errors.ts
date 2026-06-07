/**
 * humanizeApRpcError — traduce los códigos de excepción de las RPC de Cuentas
 * a Pagar (0058, formato 'CODE: mensaje') a textos legibles para el usuario.
 * No agrega lógica: solo mapeo. Espejo de tesoreria/errors.ts.
 */
export function humanizeApRpcError(message = ""): string {
  const m = message || "";
  if (m.includes("FORBIDDEN")) return "No tenés permiso para registrar facturas de proveedor.";
  if (m.includes("VENDOR_REQUIRED")) return "Seleccioná un proveedor.";
  if (m.includes("NUMERO_REQUIRED")) return "El número de comprobante es obligatorio.";
  if (m.includes("DUPLICATE_INVOICE"))
    return "Ya existe un comprobante con ese tipo, punto de venta y número para este proveedor.";
  if (m.includes("TOTAL_MISMATCH"))
    return "El total no coincide con la suma de neto + IVA + percepciones. Revisá los renglones.";
  if (m.includes("sivl_alic_pair_chk")) return "Una alícuota de IVA no es válida para AFIP.";
  if (m.includes("sivl_iva_coherente_chk"))
    return "El IVA de un renglón no coincide con base × alícuota.";
  if (m.includes("siot_iibb_jurisdiction_chk"))
    return "La percepción de IIBB requiere indicar la jurisdicción (provincia).";
  if (m.includes("AP_DETAIL_VIA_RPC_ONLY"))
    return "El detalle fiscal solo puede registrarse a través del alta de factura.";
  if (m.includes("INVOICE_NOT_FOUND")) return "No se encontró la factura indicada.";
  if (m.includes("INVALID_TRANSITION")) return "La factura no está en un estado válido para esta acción.";
  if (m.includes("INVOICE_HAS_PAYMENTS"))
    return "La factura tiene pagos confirmados; anulá el pago antes de continuar.";
  if (m.includes("ALREADY_VOID")) return "La factura ya está anulada.";
  if (m.includes("VOID_REASON_REQUIRED")) return "La anulación requiere un motivo.";
  return "No se pudo registrar la factura. Revisá los datos e intentá nuevamente.";
}
