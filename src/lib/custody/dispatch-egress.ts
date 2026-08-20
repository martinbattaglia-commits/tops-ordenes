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
 * ─── LECTURA TRIESTADO Y FAIL-CLOSED ─────────────────────────────────────
 *
 * Sólo una lectura autoritativa que demuestra ausencia de genealogía N2 puede
 * producir `not_applicable`. Una falla, contradicción o respuesta incompleta
 * produce `unavailable` y bloquea la acción visible; `required` conserva el
 * detalle por unidad. El trigger DB sigue siendo la última autoridad, pero la
 * UX ya no degrada una lectura fallida a mercadería de nivel 1.
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
  casePublicId: string | null;
  hasIngressPhoto: boolean;
  hasEgressPhoto: boolean;
  /** Ya guiados por `blocker-guidance`: qué falta y qué hacer. */
  blockers: string[];
  dispatchAllowed: boolean;
}

export interface DispatchEgressGate {
  status: "not_applicable" | "unavailable" | "required";
  /** Compatibilidad visual: sólo `required` monta el panel por unidad. */
  applies: boolean;
  units: DispatchEgressUnit[];
  /** Todas las unidades de nivel 2 en condiciones de salir. */
  allAllowed: boolean;
}

const NO_APLICA: DispatchEgressGate = {
  status: "not_applicable",
  applies: false,
  units: [],
  allAllowed: true,
};
const NO_VERIFICABLE: DispatchEgressGate = {
  status: "unavailable",
  applies: false,
  units: [],
  allAllowed: false,
};

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

interface DispatchAllocationRow {
  id: string;
  quantity: number | string;
}

interface DispatchBridgeRow {
  allocation_id: string;
  physical_unit_id: string;
  quantity: number | string;
}

/** Convierte numeric(14,3) a milésimos exactos, sin comparar floats. */
function quantityMilli(value: unknown): bigint | null {
  const raw = typeof value === "number" || typeof value === "string" ? String(value) : "";
  if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

type DispatchOrderUnitsResolution =
  | { status: "resolved"; units: DispatchOrderUnit[] }
  | { status: "not_applicable" }
  | { status: "unavailable" };

async function resolveDispatchOrderUnitsDetailed(
  orderId: string,
  allocationStatuses: readonly ("empacada" | "despachada")[] = ["empacada", "despachada"],
): Promise<DispatchOrderUnitsResolution> {
  const session = createClient();
  const admin = createAdminClient();
  if (!session || !admin) return { status: "unavailable" };

  const { data: allocs, error: aErr } = await session
    .from("stock_allocations")
    .select("id, quantity, logistics_order_items!inner(order_id)")
    .eq("logistics_order_items.order_id", orderId)
    .in("status", allocationStatuses);
  if (aErr) return { status: "unavailable" };
  if (!allocs?.length) return { status: "not_applicable" };
  const allocationRows = allocs as DispatchAllocationRow[];
  const allocationIds = allocationRows.map((a) => a.id);

  const { data: bridge, error: bErr } = await admin
    .from("custody_allocation_physical_units")
    .select("allocation_id, physical_unit_id, quantity")
    .in("allocation_id", allocationIds);
  if (bErr) return { status: "unavailable" };
  if (!bridge?.length) return { status: "unavailable" };
  const bridgeRows = bridge as DispatchBridgeRow[];

  // 0252 exige cobertura física exacta ANTES de decidir si hay N2. Un puente
  // ausente/parcial no significa N1: significa genealogía no verificable.
  for (const allocation of allocationRows) {
    const target = quantityMilli(allocation.quantity);
    const covered = bridgeRows
      .filter((row) => row.allocation_id === allocation.id)
      .reduce<bigint | null>((sum, row) => {
        if (sum === null) return null;
        const quantity = quantityMilli(row.quantity);
        return quantity === null ? null : sum + quantity;
      }, 0n);
    if (target === null || target <= 0n || covered === null || covered !== target) {
      return { status: "unavailable" };
    }
  }

  const unitIds = [...new Set(bridgeRows.map((b) => b.physical_unit_id))];

  const { data: units, error: uErr } = await session
    .from("custody_physical_units")
    .select("id, public_id, sku, custody_level")
    .in("id", unitIds)
    .order("public_id", { ascending: true });
  if (uErr || !units) return { status: "unavailable" };
  const visible = units as DispatchOrderUnit[];
  if (new Set(visible.map((unit) => unit.id)).size !== unitIds.length) {
    return { status: "unavailable" };
  }
  return { status: "resolved", units: visible };
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
  // Esta superficie existe para la foto PRE-despacho: una allocation que ya
  // figura despachada queda deliberadamente fuera aunque siga en el puente.
  const result = await resolveDispatchOrderUnitsDetailed(orderId, ["empacada"]);
  if (result.status === "resolved") return result.units;
  if (result.status === "not_applicable") return [];
  return null;
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
    if (!session) return NO_VERIFICABLE;

    const resolution = await resolveDispatchOrderUnitsDetailed(orderId, ["empacada", "despachada"]);
    if (resolution.status === "unavailable") return NO_VERIFICABLE;
    if (resolution.status === "not_applicable") return NO_APLICA;
    const units = resolution.units;

    if (units.some((u) => Number(u.custody_level) !== 1 && Number(u.custody_level) !== 2)) {
      return NO_VERIFICABLE;
    }
    const nivel2 = units.filter((u) => Number(u.custody_level) === 2);
    // El requisito duro del bloque: sin unidades de nivel 2 no se muestra NADA.
    if (nivel2.length === 0) return NO_APLICA;

    const { data: caseRows, error: caseError } = await session
      .from("custody_integrity_cases")
      .select("id, public_id, physical_unit_id")
      .in("physical_unit_id", nivel2.map((unit) => unit.id));
    if (caseError) return NO_VERIFICABLE;
    const cases = new Map<string, { id: string; public_id: string }>();
    for (const row of (caseRows ?? []) as Array<{ id: string; public_id: string; physical_unit_id: string }>) {
      if (cases.has(row.physical_unit_id)) return NO_VERIFICABLE;
      cases.set(row.physical_unit_id, { id: row.id, public_id: row.public_id });
    }

    // 4 · El estado de la puerta, por SESIÓN: acá se autoriza de verdad.
    const resueltas: DispatchEgressUnit[] = [];
    for (const u of nivel2) {
      const { data, error } = await session.rpc("custody_egress_gate_status", {
        p_physical_unit_id: u.id,
      });
      const row = (Array.isArray(data) ? data[0] : data) as GateStatusRow | null | undefined;
      if (error || !row) return NO_VERIFICABLE;
      if (
        (Number(row.custody_level) !== 1 && Number(row.custody_level) !== 2) ||
        Number(row.custody_level) !== Number(u.custody_level)
      ) {
        return NO_VERIFICABLE;
      }
      const integrityCase = cases.get(u.id) ?? null;
      if (row.case_exists !== (integrityCase !== null)) return NO_VERIFICABLE;

      // La máquina de estados es la MISMA que la de la base: se reusa el módulo
      // puro en vez de reinterpretar las columnas acá.
      const estado = evaluateEgressGate({
        level: Number(row.custody_level) as CustodyLevel,
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
        caseId: integrityCase?.id ?? null,
        casePublicId: integrityCase?.public_id ?? null,
        hasIngressPhoto: row.has_ingress_photo === true,
        hasEgressPhoto: row.has_egress_photo === true,
        blockers: estado.blockers,
        dispatchAllowed: estado.dispatchAllowed,
      });
    }

    return {
      status: "required",
      applies: true,
      units: resueltas,
      allAllowed: resueltas.every((u) => u.dispatchAllowed),
    };
  } catch {
    return NO_VERIFICABLE;
  }
}

/**
 * FILA 11b · UNIDAD FÍSICA → SU DESPACHO, PARA EL POD.
 *
 * El POD pertenece al shipment (0250a lo condiciona a la entrega efectiva) y
 * la pantalla del caso de una unidad física no tenía cómo llegar a él. Este
 * resolver recorre la genealogía en sentido inverso al de arriba —unidad →
 * allocations → pedido → shipment— con la MISMA doctrina de lectura:
 *
 *   · la unidad se verifica primero por el cliente de SESIÓN y su RLS: si el
 *     operario no puede ver la unidad, acá no hay nada que resolver;
 *   · el puente `custody_allocation_physical_units` (RLS sin política de
 *     SELECT) se lee con admin, CERRADO sobre ESA unidad ya vista;
 *   · allocations y shipments vuelven a salir por SESIÓN, sometidos a su RLS.
 *
 * No toca ninguna compuerta: sólo responde «¿en qué despacho salió esta
 * unidad y ese despacho ya registró la entrega?». Ante cualquier error
 * devuelve `null` y la pantalla dice que no pudo resolverse, no inventa.
 */
export interface PhysicalUnitPodShipment {
  shipmentId: string;
  shipmentPublicId: string;
  delivered: boolean;
}

export async function resolvePhysicalUnitPodShipment(
  physicalUnitId: string,
): Promise<PhysicalUnitPodShipment | null> {
  try {
    const session = createClient();
    const admin = createAdminClient();
    if (!session || !admin) return null;

    // 1 · La unidad, por SESIÓN (RLS de tenant). Sin visibilidad no hay mapeo.
    const { data: unit, error: uErr } = await session
      .from("custody_physical_units")
      .select("id, quantity")
      .eq("id", physicalUnitId)
      .maybeSingle();
    if (uErr || !unit) return null;

    // 2 · El puente, admin CERRADO sobre esa unidad (ver docblock del módulo).
    const { data: bridge, error: bErr } = await admin
      .from("custody_allocation_physical_units")
      .select("allocation_id, quantity")
      .eq("physical_unit_id", physicalUnitId);
    if (bErr || !bridge?.length) return null;
    const bridgeRows = bridge as Array<{ allocation_id: string; quantity: number | string }>;
    const allocationIds = bridgeRows.map((b) => b.allocation_id);

    // 3 · Las allocations por SESIÓN → pedidos que el usuario puede ver.
    //     C4-M1 · MISMO filtro de estado que `resolveDispatchOrderUnits` y que
    //     la doctrina `sa.status<>'liberada'` de la base (0250a/0252): una
    //     reserva LIBERADA persiste en el puente inmutable pero la unidad
    //     nunca viajó con ese pedido — sin este filtro la pantalla podía
    //     atribuirle el POD de una entrega ajena.
    const { data: allocs, error: aErr } = await session
      .from("stock_allocations")
      .select("id, quantity, status, logistics_order_items!inner(order_id)")
      .in("id", allocationIds)
      .in("status", ["empacada", "despachada"]);
    if (aErr || !allocs?.length) return null;
    // El `!inner` garantiza la fila; el tipo generado la modela como arreglo.
    const allocRows = allocs as unknown as Array<{
      id: string;
      quantity: number | string;
      status: string;
      logistics_order_items: { order_id: string } | { order_id: string }[];
    }>;
    if (allocRows.some((allocation) => allocation.status !== "despachada")) return null;
    const activeAllocationIds = new Set(allocRows.map((allocation) => allocation.id));

    // C4-F2 · Para probar la cobertura de CADA allocation hay que sumar el
    // puente completo de esas allocations, no sólo la fracción aportada por
    // esta CPU. Una allocation legítima puede combinar CPU-A 5 + CPU-B 5. Los
    // IDs ya fueron reautorizados por la sesión en el paso anterior; la lectura
    // admin permanece cerrada a ese conjunto y sólo se usa para coherencia.
    const { data: allocationBridge, error: allocationBridgeError } = await admin
      .from("custody_allocation_physical_units")
      .select("allocation_id, physical_unit_id, quantity")
      .in("allocation_id", [...activeAllocationIds]);
    if (allocationBridgeError || !allocationBridge?.length) return null;
    const allocationBridgeRows = allocationBridge as Array<{
      allocation_id: string;
      physical_unit_id: string;
      quantity: number | string;
    }>;

    const unitQuantity = quantityMilli((unit as { quantity: number | string }).quantity);
    const activeCovered = bridgeRows.reduce<bigint | null>((sum, row) => {
      if (sum === null || !activeAllocationIds.has(row.allocation_id)) return sum;
      const quantity = quantityMilli(row.quantity);
      return quantity === null ? null : sum + quantity;
    }, 0n);
    // Una CPU fraccionada o parcialmente reservada no tiene «un POD de la
    // unidad». Sólo el shipment que cubre la cantidad física completa es apto.
    if (unitQuantity === null || activeCovered === null || activeCovered !== unitQuantity) return null;
    for (const allocation of allocRows) {
      const allocationQuantity = quantityMilli(allocation.quantity);
      const bridgeQuantity = allocationBridgeRows
        .filter((row) => row.allocation_id === allocation.id)
        .reduce<bigint | null>((sum, row) => {
          if (sum === null) return null;
          const quantity = quantityMilli(row.quantity);
          return quantity === null ? null : sum + quantity;
        }, 0n);
      if (
        allocationQuantity === null ||
        bridgeQuantity === null ||
        allocationQuantity !== bridgeQuantity
      ) {
        return null;
      }
    }
    const orderIds = [
      ...new Set(
        allocRows.flatMap((a) =>
          Array.isArray(a.logistics_order_items)
            ? a.logistics_order_items.map((i) => i.order_id)
            : [a.logistics_order_items.order_id],
        ),
      ),
    ];
    if (orderIds.length !== 1) return null;

    // 4 · El shipment vigente de esos pedidos, por SESIÓN. Se prefiere el
    //     entregado (el POD es post-entrega); si no, el último despachado.
    const { data: ships, error: sErr } = await session
      .from("shipments")
      .select("id, public_id, status, delivered_at, dispatched_at")
      .in("order_id", orderIds)
      .neq("status", "anulado")
      // C4-L2 · sin `nullsFirst:false`, un shipment sin `dispatched_at` quedaba
      // primero y el motivo podía nombrar un despacho que nunca salió.
      .order("dispatched_at", { ascending: false, nullsFirst: false });
    if (sErr || !ships?.length) return null;
    type Ship = { id: string; public_id: string; status: string; delivered_at: string | null };
    const rows = ships as Ship[];
    if (rows.length !== 1) return null;
    const chosen = rows[0];
    return {
      shipmentId: chosen.id,
      shipmentPublicId: chosen.public_id,
      delivered: chosen.delivered_at !== null || chosen.status === "entregado",
    };
  } catch {
    return null;
  }
}
