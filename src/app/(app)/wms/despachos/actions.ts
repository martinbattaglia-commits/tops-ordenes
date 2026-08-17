"use server";

import { revalidatePath } from "next/cache";
import { confirmDispatch, confirmDelivery, revertDispatch } from "@/lib/dispatch/dispatch";
import { registerEgressEvidence } from "@/lib/custody/physical-egress";
import { createClient } from "@/lib/supabase/server";
import { parseCanonicalUuid } from "@/lib/custody/canonical-contract";
import type { CustodyLevel } from "@/lib/custody/egress-gate";

/**
 * Server Actions de Despacho + Entrega (GATE 4C). Cada una envuelve una RPC
 * SECURITY DEFINER de 0035 y revalida las rutas afectadas con revalidatePath().
 *
 * NO usamos router.refresh() (carrera ?_rsc → 503, criterio de 4A/4B).
 * A DIFERENCIA de Packing, el DESPACHO SÍ TOCA STOCK (stock_reserved-- +
 * inventory_lots-- + ledger), por lo que TAMBIÉN revalidamos inventario/lotes/
 * vencimientos además de packing y pedidos.
 */

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(e: unknown): Result {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

function revalidate(orderId: string): void {
  revalidatePath("/wms/despachos");
  revalidatePath(`/wms/despachos/${orderId}`);
  revalidatePath("/wms/packing");
  revalidatePath(`/wms/packing/${orderId}`);
  revalidatePath(`/pedidos/${orderId}`);
  revalidatePath("/pedidos");
  // El despacho mueve stock: refrescar las vistas de inventario.
  revalidatePath("/wms/inventario");
  revalidatePath("/wms/lotes");
  revalidatePath("/wms/vencimientos");
}

/** Despacha un pedido preparado (EGRESO irreversible). Devuelve el shipment id. */
export async function confirmDispatchAction(orderId: string): Promise<Result> {
  try {
    const id = await confirmDispatch(orderId);
    revalidate(orderId);
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

/** Marca un despacho como entregado. */
export async function confirmDeliveryAction(
  shipmentId: string,
  orderId: string,
  receivedBy?: string | null
): Promise<Result> {
  try {
    await confirmDelivery(shipmentId, receivedBy ?? null);
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * 2-C-1 · REGISTRA LA FOTO DE EGRESO, EN EL MOMENTO EN QUE LA ADENDA LA PIDE.
 *
 * Entre el packing y el despacho: bulto cerrado, bien todavía en el depósito,
 * inmediatamente antes de `confirmDispatchAction`. Cierra la costura §10.7 —
 * `registerEgressEvidence` existía, probado, y no lo llamaba nadie.
 *
 * ─── LO QUE ESTA ACCIÓN NO DEJA DECIDIR AL NAVEGADOR ─────────────────────
 *
 * El par canónico y el NIVEL. La etapa y el tipo de evento se fijan acá, igual
 * que en el ingreso. Y el nivel se LEE de la base a partir de la unidad, nunca
 * se acepta del formulario: es el dato del que depende la puerta entera, y
 * tomarlo del cliente sería dejar que quien manda el formulario elija si la
 * puerta le aplica.
 *
 * ─── POR QUÉ ACÁ NO SE DISPARA EL ANÁLISIS ───────────────────────────────
 *
 * El camino del caso (`registerPhysicalEgressAction`) dispara la evaluación al
 * completarse el par. Este NO, y es deliberado: ese disparo arrastra
 * `OpenAICustodyVisionProvider` al grafo de despachos, que es la misma clase de
 * acoplamiento que obligó a extraer `physical-ingress.ts` en 2-A. La evaluación
 * y la decisión humana viven en `/wms/custody/[id]`, que es donde trabaja el
 * inspector; acá el operario registra la foto y ve qué falta.
 */
export async function registerDispatchEgressAction(
  orderId: string,
  form: FormData,
): Promise<Result> {
  try {
    const unitId = parseCanonicalUuid(form.get("entity_id"));
    if (!unitId) return { ok: false, error: "Unidad física inválida" };

    const supabase = createClient();
    if (!supabase) return { ok: false, error: "Supabase no configurado" };

    // El nivel sale de la BASE, sometido a la RLS de la sesión.
    const { data, error } = await supabase
      .from("custody_physical_units")
      .select("custody_level")
      .eq("id", unitId)
      .maybeSingle();
    if (error || !data) return { ok: false, error: "Unidad física no disponible para tu usuario" };
    const level = (Number((data as { custody_level: number }).custody_level) >= 2 ? 2 : 1) as CustodyLevel;

    const forced = new FormData();
    forced.set("file", form.get("file") as Blob);
    forced.set("entity_id", unitId);
    forced.set("scope", "physical_unit");
    forced.set("stage", "despacho");
    forced.set("event_type", "foto_egreso");
    forced.set("kind", "foto");
    forced.set("revalidate", `/wms/despachos/${orderId}`);

    const res = await registerEgressEvidence(forced, level);
    if (!res.ok) return { ok: false, error: res.error };
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Revierte un despacho no entregado (reingreso compensatorio). */
export async function revertDispatchAction(shipmentId: string, orderId: string): Promise<Result> {
  try {
    await revertDispatch(shipmentId);
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
