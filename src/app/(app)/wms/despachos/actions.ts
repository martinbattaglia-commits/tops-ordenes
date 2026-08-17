"use server";

import { revalidatePath } from "next/cache";
import { confirmDispatch, confirmDelivery, revertDispatch } from "@/lib/dispatch/dispatch";
import { registerEgressEvidence } from "@/lib/custody/physical-egress";
import { resolveDispatchOrderUnits } from "@/lib/custody/dispatch-egress";
import { triggerAnalysisIfPairComplete } from "@/lib/custody/analysis-trigger";
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
 * ─── EL ANÁLISIS SÍ SE DISPARA ACÁ (2-C-2) ───────────────────────────────
 *
 * 2-C-1 lo dejó explícitamente afuera, porque disparar significaba importar
 * `wms/custody/actions.ts` y con él `OpenAICustodyVisionProvider` al grafo de
 * despachos — la misma clase de acoplamiento que obligó a extraer
 * `physical-ingress.ts` en 2-A.
 *
 * 2-C-2 lo resuelve extrayendo el disparo a `@/lib/custody/analysis-trigger`,
 * que es liviano y resuelve la composición pesada por `import()` dinámico. El
 * grafo ESTÁTICO de despachos sigue sin contener el proveedor de visión, y ahora
 * además el operario que saca la foto no queda mirando una pantalla donde no
 * pasó nada. La DECISIÓN humana sigue viviendo en `/wms/custody/[id]`: acá se
 * captura y se evalúa, no se decide.
 *
 * ─── F-1 · LA UNIDAD TIENE QUE SER DE ESTE PEDIDO ────────────────────────
 *
 * Hasta la remediación de C4 1/2, `orderId` entraba a esta acción y **sólo se
 * usaba para revalidar**. Nivel, tenant y permiso se comprobaban; la
 * PERTENENCIA no. Un operario con permiso de captura, parado en el pedido A,
 * podía mandar el `entity_id` de una unidad del pedido B que seguía en picking y
 * la foto quedaba adjunta a un bulto que estaba en la estantería.
 *
 * Lo que se rompía no era un permiso: era el ANCLAJE TEMPORAL de la puerta.
 * `has_egress_photo` es la única condición de `0253` que el operario resuelve por
 * sí mismo, y una vez satisfecha lo queda para siempre. Si la foto puede tomarse
 * fuera de la ventana que Dirección definió —bulto cerrado, bien todavía bajo
 * control del depósito—, la compuerta sigue abriéndose pero ya no acredita el
 * momento que tenía que acreditar.
 *
 * La validación va ACÁ, en el servidor, y no en el componente: el componente sólo
 * ofrece las unidades correctas, y esta acción es alcanzable sin él. Y resuelve
 * pedido→unidades con `resolveDispatchOrderUnits`, el MISMO camino que usa el
 * panel — dos formas de contestar esa pregunta divergen, y entonces la
 * validación dejaría de describir lo que la pantalla ofrece.
 */
export async function registerDispatchEgressAction(
  orderId: string,
  form: FormData,
): Promise<Result> {
  try {
    const unitId = parseCanonicalUuid(form.get("entity_id"));
    if (!unitId) return { ok: false, error: "Unidad física inválida" };
    const order = parseCanonicalUuid(orderId);
    if (!order) return { ok: false, error: "Pedido inválido" };

    const supabase = createClient();
    if (!supabase) return { ok: false, error: "Supabase no configurado" };

    // F-1 · PERTENENCIA, antes que nada. `null` es «este pedido no tiene
    // genealogía de custodia»; una lista que no contiene la unidad es «esta
    // unidad es de otro pedido». Las dos rechazan, y por eso el mensaje no
    // distingue: decirle al operario de qué otro pedido es la unidad sería
    // filtrarle algo que su pantalla no le muestra.
    const unidades = await resolveDispatchOrderUnits(order);
    if (!unidades?.some((u) => u.id === unitId)) {
      return {
        ok: false,
        error:
          "Esa unidad no pertenece a este pedido. Sacá la foto de egreso desde el pedido que la va a despachar.",
      };
    }

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

    // 2-C-2 · EL ANÁLISIS ARRANCA SOLO.
    //
    // «Saqué la foto y no pasó nada visible» garantiza reintentos y circuitos a
    // medias. Con el par completo, el sistema evalúa acá mismo y el inspector
    // recibe un caso ya analizado.
    //
    // `analysis-trigger` es LIVIANO a propósito: resuelve la composición pesada
    // —proveedor de visión incluido— por `import()` dinámico, de modo que el
    // grafo ESTÁTICO de despachos no contiene `openai-vision-provider`. Es la
    // misma clase de acoplamiento que obligó a extraer `physical-ingress.ts` en
    // 2-A, y acá se paga de entrada. Lo mide
    // `tests/wms-ui/custody-analysis-boundary.test.ts`.
    //
    // Best-effort: la foto ya quedó registrada y verificada. Un análisis que no
    // arranca no puede convertir una captura exitosa en un error.
    await triggerAnalysisIfPairComplete(unitId);

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
