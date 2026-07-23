"use server";

/**
 * Server Actions de Caja Chica (CCN-001B · F3). RPC-First: cada acción es un
 * ADAPTADOR delgado — valida forma (zod), llama la RPC `caja_chica_*` con el
 * cliente de sesión (auth.uid() + RLS + has_permission gobiernan la autorización),
 * traduce el error y revalida. NINGUNA regla financiera vive acá.
 *
 * La cuenta NO viaja en el payload: la resuelve la RPC (decisión de Dirección
 * 2026-07-22 — la interfaz nunca permite elegir cuenta manualmente).
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { RegistrarCajaMovimientoSchema, AnularCajaMovimientoSchema } from "./validation";
import { humanizeCajaError } from "./errors";
import type { ActionResult } from "../types";

function firstIssue(message?: string): string {
  return message ?? "Datos inválidos.";
}

/** Un movimiento de caja mueve el saldo del motor: revalidar también Tesorería. */
function revalidateCaja(): void {
  revalidatePath("/tesoreria/caja-chica");
  revalidatePath("/tesoreria");
  revalidatePath("/tesoreria/bancos");
  revalidatePath("/tesoreria/movimientos");
}

export async function registrarCajaMovimientoAction(input: unknown): Promise<ActionResult> {
  const parsed = RegistrarCajaMovimientoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error.issues[0]?.message) };
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Servicio no disponible." };
  const p = parsed.data;
  const { data, error } = await supabase.rpc("caja_chica_registrar_movimiento", {
    p_date: p.date,
    p_direction: p.direction,
    p_amount: Number(p.amount),
    p_concept: p.concept,
    p_responsable_id: p.responsable_id,
    p_observations: p.observations?.trim() || null,
  });
  if (error) return { ok: false, message: humanizeCajaError(error.message) };
  revalidateCaja();
  return { ok: true, message: "Movimiento registrado.", data };
}

export async function anularCajaMovimientoAction(input: unknown): Promise<ActionResult> {
  const parsed = AnularCajaMovimientoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error.issues[0]?.message) };
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Servicio no disponible." };
  const p = parsed.data;
  const { data, error } = await supabase.rpc("caja_chica_anular_movimiento", {
    p_movement_id: p.movement_id,
    p_reason: p.reason,
  });
  if (error) return { ok: false, message: humanizeCajaError(error.message) };
  revalidateCaja();
  return { ok: true, message: "Movimiento anulado.", data };
}
