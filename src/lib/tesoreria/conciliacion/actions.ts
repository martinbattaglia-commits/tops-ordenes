"use server";

/**
 * Server Actions de Conciliación Bancaria (S4). RPC-First: adaptadores delgados
 * de las RPC `tesoreria_recon_*` (0079, security definer + has_permission). La
 * autorización (rol con `tesoreria.conciliacion.approve`), el LOCK y el append-
 * only viven en la RPC. NUNCA se registra solo: cada acción es un click humano.
 *
 * NOTA: las RPC provienen de 0078 (DISEÑO, aún NO aplicadas).
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { humanizeRpcError } from "@/lib/tesoreria/errors";
import type { ActionResult } from "@/lib/tesoreria/types";

const Uuid = z.string().uuid();
const revalidate = () => revalidatePath("/tesoreria/conciliacion");

async function callRpc(fn: string, args: Record<string, unknown>, okMsg: string): Promise<ActionResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Servicio no disponible." };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: humanizeRpcError(error.message) };
  revalidate();
  return { ok: true, message: okMsg, data };
}

/** Aceptar la sugerencia de un match → enlaza el movimiento (LOCK) · no crea asiento. */
export async function aceptarMatchAction(matchId: unknown): Promise<ActionResult> {
  const p = Uuid.safeParse(matchId);
  if (!p.success) return { ok: false, message: "Match inválido." };
  return callRpc("tesoreria_recon_accept", { p_match_id: p.data }, "Conciliación confirmada.");
}

/** Rechazar la sugerencia de un match. */
export async function rechazarMatchAction(matchId: unknown): Promise<ActionResult> {
  const p = Uuid.safeParse(matchId);
  if (!p.success) return { ok: false, message: "Match inválido." };
  return callRpc("tesoreria_recon_reject", { p_match_id: p.data }, "Sugerencia rechazada.");
}

/** Aceptar el lote de movimientos sistémicos → un único ajuste con aprobación (D7). */
export async function aceptarSistemicosLoteAction(statementId: unknown): Promise<ActionResult> {
  const p = Uuid.safeParse(statementId);
  if (!p.success) return { ok: false, message: "Extracto inválido." };
  return callRpc("tesoreria_recon_accept_systemic_batch", { p_statement_id: p.data }, "Sistémicos registrados (ajuste por lote).");
}

/** Crear un ajuste para una línea sin contraparte (diferencia). */
export async function crearAjusteAction(input: unknown): Promise<ActionResult> {
  const schema = z.object({ lineId: Uuid, bankAccountId: Uuid });
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  return callRpc("tesoreria_recon_create_adjustment", { p_line_id: p.data.lineId, p_bank_account_id: p.data.bankAccountId }, "Ajuste creado.");
}
