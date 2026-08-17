/**
 * PUERTA DE EGRESO · EL LADO DEL DESPACHO · 2-C-1
 *
 * ─── QUÉ COSTURA CIERRA ──────────────────────────────────────────────────
 *
 * §10.7 del contrato declaraba `registerEgressEvidence` CONSTRUIDO Y SIN
 * CONSUMIDOR: la puerta existía en la base —0253 la enganchó al trigger de
 * despacho— y en el servidor, pero no había ninguna pantalla donde el operario
 * sacara la foto en el momento en que la Adenda la pide.
 *
 * ─── EL MOMENTO, QUE ES UNA DECISIÓN DE DIRECCIÓN ────────────────────────
 *
 *   «La foto de egreso se toma entre el packing y el despacho: justo antes de
 *    subir la mercadería al transporte.»
 *
 * Con el bulto ya cerrado y el bien todavía bajo control del depósito. En el
 * sistema eso es exactamente el instante previo a `confirmDispatchAction`, que
 * es la acción que descuenta stock reservado, lotes y ledger — la salida real.
 * Por eso esto vive en la pantalla de despacho y no en la del caso: el panel de
 * `/wms/custody/[id]` sirve para el ingreso, cuando el operario está frente a la
 * mercadería que acaba de recibir, no frente al camión.
 *
 * ─── POR QUÉ HACE FALTA RESOLVER PEDIDO → UNIDADES, Y CÓMO ───────────────
 *
 * `custody_egress_gate_status` (0253) es POR UNIDAD FÍSICA y la pantalla de
 * despacho es POR PEDIDO. El puente es la genealogía
 * `custody_allocation_physical_units`, que tiene RLS habilitada y **ninguna
 * política de SELECT**: con el cliente de sesión devuelve cero filas aunque el
 * grant exista. De ahí la única lectura administrativa de este módulo.
 *
 * No es un atajo de autorización, y el orden importa:
 *
 *   · las allocations salen del cliente de SESIÓN, sometidas a su RLS — si el
 *     operario no puede ver el pedido, acá no hay nada que mapear;
 *   · la lectura admin es un mapeo cerrado sobre ESAS allocations: no puede
 *     revelar ninguna unidad que no cuelgue de algo que el usuario ya vio;
 *   · y el estado de cada unidad se pide con el cliente de SESIÓN, por
 *     `custody_egress_gate_status`, que exige `wms.view` y compara el tenant.
 *     Ahí es donde se autoriza de verdad, y ahí falla si no corresponde.
 *
 * ─── FALLAR HACIA «NO APLICA» ES LO CORRECTO ACÁ ─────────────────────────
 *
 * Ante cualquier error, este módulo devuelve `applies: false` y la pantalla
 * queda idéntica a como estaba. Puede sonar al revés, pero la interfaz no es
 * la que retiene la mercadería: el trigger de 0253 lo hace del otro lado, y una
 * unidad de nivel 2 sin foto de egreso no se despacha aunque acá no se muestre
 * nada. Fallar hacia «mostrar panel» sí rompería el requisito duro del bloque
 * —que un despacho de nivel 1 no vea absolutamente nada— y convertiría una
 * caída de custodia en un freno para mercadería que nunca la contrató.
 */

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { evaluateEgressGate, type CustodyLevel } from "@/lib/custody/egress-gate";
import type { IntegrityCaseState } from "@/lib/custody/integrity/types";

/** Una unidad física de NIVEL 2 que este pedido va a sacar del depósito. */
export interface DispatchEgressUnit {
  physicalUnitId: string;
  unitPublicId: string;
  sku: string;
  caseId: string | null;
  hasIngressPhoto: boolean;
  hasEgressPhoto: boolean;
  /** Ya guiados por `blocker-guidance`: qué falta y qué hacer. */
  blockers: string[];
  dispatchAllowed: boolean;
}

export interface DispatchEgressGate {
  /** `false` ⇒ la pantalla de despacho no cambia en nada. */
  applies: boolean;
  units: DispatchEgressUnit[];
  /** Todas las unidades de nivel 2 en condiciones de salir. */
  allAllowed: boolean;
}

const NO_APLICA: DispatchEgressGate = { applies: false, units: [], allAllowed: true };

interface GateStatusRow {
  custody_level: number;
  case_exists: boolean;
  has_ingress_photo: boolean;
  has_egress_photo: boolean;
  case_state: string | null;
  decision_kind: string | null;
  hold_reasons: string[] | null;
  release_certificate_issued: boolean;
  chain_advanced_after_release: boolean;
}

/** Una unidad física que este pedido va a sacar, de CUALQUIER nivel. */
export interface DispatchOrderUnit {
  id: string;
  public_id: string;
  sku: string;
  custody_level: number;
}

/**
 * PEDIDO → UNIDADES FÍSICAS. **El único camino que resuelve ese vínculo.**
 *
 * Se extrajo de `getDispatchEgressGate` porque hay DOS preguntas distintas que
 * dependen de la misma respuesta, y contestarlas por caminos separados era el
 * defecto F-1:
 *
 *   · la PANTALLA pregunta «qué unidades de nivel 2 tiene este pedido, y qué le
 *     falta a cada una»;
 *   · la ACCIÓN de captura pregunta «esta unidad, ¿pertenece a este pedido?».
 *
 * Dos implementaciones de la misma pregunta divergen: basta que una filtre por
 * un estado de allocation que la otra no, y la validación de pertenencia deja de
 * describir lo que la pantalla ofrece. Por eso hay una sola.
 *
 * Devuelve `null` —no lista vacía— cuando no se puede resolver el vínculo, para
 * que quien llama distinga «este pedido no tiene genealogía de custodia» de
 * «este pedido tiene unidades y ésta no es una de ellas». La primera no es una
 * negativa: es un pedido sin custodia. La segunda sí, y es la que F-1 rechaza.
 *
 * El orden de las tres lecturas es la contención que el C4 aprobó y no cambia:
 * allocations por SESIÓN, puente admin CERRADO sobre esas allocations, identidad
 * por SESIÓN. Ver el docblock del módulo.
 */
export async function resolveDispatchOrderUnits(
  orderId: string,
): Promise<DispatchOrderUnit[] | null> {
  const session = createClient();
  const admin = createAdminClient();
  if (!session || !admin) return null;

  // 1 · Las allocations del pedido, por el cliente de SESIÓN y su RLS.
  const { data: allocs, error: aErr } = await session
    .from("stock_allocations")
    .select("id, logistics_order_items!inner(order_id)")
    .eq("logistics_order_items.order_id", orderId)
    .in("status", ["empacada", "despachada"]);
  if (aErr || !allocs?.length) return null;
  const allocationIds = (allocs as { id: string }[]).map((a) => a.id);

  // 2 · El puente. Lectura admin acotada a esas allocations — ver docblock.
  const { data: bridge, error: bErr } = await admin
    .from("custody_allocation_physical_units")
    .select("physical_unit_id")
    .in("allocation_id", allocationIds);
  if (bErr || !bridge?.length) return null;
  const unitIds = [...new Set((bridge as { physical_unit_id: string }[]).map((b) => b.physical_unit_id))];

  // 3 · Identidad legible de cada unidad, por SESIÓN (RLS de tenant).
  const { data: units, error: uErr } = await session
    .from("custody_physical_units")
    .select("id, public_id, sku, custody_level")
    .in("id", unitIds)
    .order("public_id", { ascending: true });
  if (uErr || !units?.length) return null;

  return units as DispatchOrderUnit[];
}

/**
 * Resuelve la puerta de egreso de un pedido, unidad por unidad.
 *
 * Devuelve `applies: false` cuando el pedido no tiene ninguna unidad de nivel 2
 * —el caso del nivel 1 y el de la mercadería sin custodia— y también ante
 * cualquier error de lectura, por lo dicho en el docblock.
 */
export async function getDispatchEgressGate(orderId: string): Promise<DispatchEgressGate> {
  try {
    const session = createClient();
    if (!session) return NO_APLICA;

    const units = await resolveDispatchOrderUnits(orderId);
    if (!units) return NO_APLICA;

    const nivel2 = units.filter((u) => u.custody_level >= 2);
    // El requisito duro del bloque: sin unidades de nivel 2 no se muestra NADA.
    if (nivel2.length === 0) return NO_APLICA;

    // 4 · El estado de la puerta, por SESIÓN: acá se autoriza de verdad.
    const resueltas: DispatchEgressUnit[] = [];
    for (const u of nivel2) {
      const { data, error } = await session.rpc("custody_egress_gate_status", {
        p_physical_unit_id: u.id,
      });
      const row = (Array.isArray(data) ? data[0] : data) as GateStatusRow | null | undefined;
      if (error || !row) return NO_APLICA;

      // La máquina de estados es la MISMA que la de la base: se reusa el módulo
      // puro en vez de reinterpretar las columnas acá.
      const estado = evaluateEgressGate({
        level: (row.custody_level >= 2 ? 2 : 1) as CustodyLevel,
        state: (row.case_state ?? "PENDING_EVIDENCE") as IntegrityCaseState,
        caseExists: row.case_exists === true,
        hasIngressPhoto: row.has_ingress_photo === true,
        hasEgressPhoto: row.has_egress_photo === true,
        decision:
          row.decision_kind === "release" || row.decision_kind === "quarantine"
            ? { kind: row.decision_kind }
            : null,
        holdReasons: row.hold_reasons ?? [],
        releaseCertificateIssued: row.release_certificate_issued === true,
        chainAdvancedAfterRelease: row.chain_advanced_after_release === true,
      });

      resueltas.push({
        physicalUnitId: u.id,
        unitPublicId: u.public_id,
        sku: u.sku,
        caseId: null,
        hasIngressPhoto: row.has_ingress_photo === true,
        hasEgressPhoto: row.has_egress_photo === true,
        blockers: estado.blockers,
        dispatchAllowed: estado.dispatchAllowed,
      });
    }

    return {
      applies: true,
      units: resueltas,
      allAllowed: resueltas.every((u) => u.dispatchAllowed),
    };
  } catch {
    return NO_APLICA;
  }
}
