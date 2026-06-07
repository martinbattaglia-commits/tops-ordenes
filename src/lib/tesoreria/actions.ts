"use server";

/**
 * Server Actions del dominio Tesorería (ERP-A3). RPC-First: cada acción es un
 * ADAPTADOR delgado — valida forma (zod), llama la RPC de `0054` (con el
 * cliente de sesión → auth.uid() + RLS + has_permission gobiernan autz),
 * traduce el error y revalida. NINGUNA regla financiera vive acá (D1/D5).
 *
 * Toda la lógica financiera (suma=importe, saldo, lock F1, retención, append-
 * only) está en las RPC desplegadas en producción. No duplicar.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  RegisterReceiptSchema,
  RegisterPaymentSchema,
  RegisterTransferSchema,
  VoidMovementSchema,
} from "./validation";
import { humanizeRpcError } from "./errors";
import type { ActionResult } from "./types";

function firstIssue(message?: string): string {
  return message ?? "Datos inválidos.";
}

function revalidateTreasury(): void {
  // Ruta de UI futura (ERP-A4). Hoy es inofensivo.
  revalidatePath("/tesoreria");
}

export async function registerReceiptAction(input: unknown): Promise<ActionResult> {
  const parsed = RegisterReceiptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error.issues[0]?.message) };
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Servicio no disponible." };
  const p = parsed.data;
  const { data, error } = await supabase.rpc("tesoreria_register_receipt", {
    p_client_id: p.client_id,
    p_payment_date: p.payment_date,
    p_payment_method: p.payment_method,
    p_bank_account_id: p.bank_account_id,
    p_gross_amount: Number(p.gross_amount),
    p_retention_amount: Number(p.retention_amount),
    p_observations: p.observations ?? null,
    p_attachment: p.attachment ?? null,
    p_allocations: p.allocations, // jsonb: amounts como string → exacto en la RPC
  });
  if (error) return { ok: false, message: humanizeRpcError(error.message) };
  revalidateTreasury();
  return { ok: true, message: "Cobranza registrada.", data };
}

export async function registerPaymentAction(input: unknown): Promise<ActionResult> {
  const parsed = RegisterPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error.issues[0]?.message) };
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Servicio no disponible." };
  const p = parsed.data;
  const { data, error } = await supabase.rpc("tesoreria_register_payment", {
    p_vendor_id: p.vendor_id,
    p_payment_date: p.payment_date,
    p_payment_method: p.payment_method,
    p_bank_account_id: p.bank_account_id,
    p_amount: Number(p.amount),
    p_operation_number: p.operation_number ?? null,
    p_observations: p.observations ?? null,
    p_attachment: p.attachment ?? null,
    p_allocations: p.allocations,
  });
  if (error) return { ok: false, message: humanizeRpcError(error.message) };
  revalidateTreasury();
  return { ok: true, message: "Pago registrado.", data };
}

export async function registerTransferAction(input: unknown): Promise<ActionResult> {
  const parsed = RegisterTransferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error.issues[0]?.message) };
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Servicio no disponible." };
  const p = parsed.data;
  const { data, error } = await supabase.rpc("tesoreria_register_transfer", {
    p_date: p.date,
    p_from_bank_account_id: p.from_bank_account_id,
    p_to_bank_account_id: p.to_bank_account_id,
    p_amount: Number(p.amount),
    p_description: p.description ?? null,
  });
  if (error) return { ok: false, message: humanizeRpcError(error.message) };
  revalidateTreasury();
  return { ok: true, message: "Transferencia registrada.", data };
}

export async function voidMovementAction(input: unknown): Promise<ActionResult> {
  const parsed = VoidMovementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error.issues[0]?.message) };
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Servicio no disponible." };
  const p = parsed.data;
  const { data, error } = await supabase.rpc("tesoreria_void_movement", {
    p_target_type: p.target_type,
    p_target_id: p.target_id,
    p_reason: p.reason,
  });
  if (error) return { ok: false, message: humanizeRpcError(error.message) };
  revalidateTreasury();
  return { ok: true, message: "Comprobante anulado.", data };
}
