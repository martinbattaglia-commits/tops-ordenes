/**
 * Esquemas zod del dominio Tesorería (ERP-A3). Validan SOLO forma/tipos/formato.
 * Las reglas financieras (suma=importe, saldo, vigencia de factura, moneda,
 * CAJA, transición de void) viven en las RPC de `0054` — NO se duplican acá.
 *
 * Los importes se modelan como STRING decimal (máx 2 decimales) para evitar
 * imprecisión de punto flotante; las RPC los castean a numeric.
 */
import { z } from "zod";
import { RECEIPT_METHOD_VALUES, PAYMENT_METHOD_VALUES, VOID_TARGET_VALUES } from "./types";

const MONEY = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido (hasta 2 decimales)");
const UUID = z.string().uuid("Identificador inválido");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)");

const ReceiptAllocation = z.object({
  invoice_id: UUID,
  amount: MONEY,
});

const PaymentAllocation = z.object({
  supplier_invoice_id: UUID,
  amount: MONEY,
});

export const RegisterReceiptSchema = z.object({
  client_id: UUID,
  payment_date: DATE,
  payment_method: z.enum(RECEIPT_METHOD_VALUES as unknown as [string, ...string[]]),
  bank_account_id: UUID,
  gross_amount: MONEY,
  retention_amount: MONEY.default("0"),
  observations: z.string().trim().max(500).optional().nullable(),
  attachment: z.string().trim().max(500).optional().nullable(),
  allocations: z.array(ReceiptAllocation).min(1, "Se requiere al menos una imputación"),
});
export type RegisterReceiptInput = z.infer<typeof RegisterReceiptSchema>;

export const RegisterPaymentSchema = z.object({
  vendor_id: UUID,
  payment_date: DATE,
  payment_method: z.enum(PAYMENT_METHOD_VALUES as unknown as [string, ...string[]]),
  bank_account_id: UUID,
  amount: MONEY,
  operation_number: z.string().trim().max(60).optional().nullable(),
  observations: z.string().trim().max(500).optional().nullable(),
  attachment: z.string().trim().max(500).optional().nullable(),
  allocations: z.array(PaymentAllocation).min(1, "Se requiere al menos una imputación"),
});
export type RegisterPaymentInput = z.infer<typeof RegisterPaymentSchema>;

export const RegisterTransferSchema = z.object({
  date: DATE,
  from_bank_account_id: UUID,
  to_bank_account_id: UUID,
  amount: MONEY,
  description: z.string().trim().max(200).optional().nullable(),
});
export type RegisterTransferInput = z.infer<typeof RegisterTransferSchema>;

export const VoidMovementSchema = z.object({
  target_type: z.enum(VOID_TARGET_VALUES as unknown as [string, ...string[]]),
  target_id: UUID,
  reason: z.string().trim().min(1, "El motivo es obligatorio").max(300),
});
export type VoidMovementInput = z.infer<typeof VoidMovementSchema>;
