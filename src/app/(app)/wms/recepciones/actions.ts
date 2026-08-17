"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseCanonicalUuid } from "@/lib/custody/canonical-contract";
// Se importa el módulo EXTRAÍDO, no `wms/custody/actions`: ese archivo arrastra
// el proveedor de visión de OpenAI, y recepciones está dentro de la clausura del
// maestro de clientes, cuyo guard de egreso de red —correctamente— lo rechaza.
import { attachPhysicalEvidence } from "@/lib/custody/physical-ingress";
import {
  createReception,
  addReceptionItem,
  assertPositionRequired,
  submitReception,
  confirmReception,
  releaseQuarantine,
  cancelReception,
  type NewReceptionInput,
} from "@/lib/wms/receptions";

type Result<T = undefined> =
  | { ok: true; id?: string; data?: T }
  | { ok: false; error: string };

function fail(e: unknown): Result {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

export interface ReceptionItemPayload {
  sku: string;
  description: string;
  lot_number?: string | null;
  expiration_date?: string | null;
  quantity: number;
  position_id?: string | null;
}

/**
 * Unidad de custodia nacida de una recepción confirmada. `caseId` es `null`
 * para el NIVEL 1, que por definición no abre caso.
 */
export interface ReceptionCustodyUnit {
  physicalUnitId: string;
  receptionItemId: string;
  unitPublicId: string;
  sku: string;
  quantity: number;
  lotNumber: string | null;
  custodyLevel: number;
  caseId: string | null;
  casePublicId: string | null;
  caseState: string | null;
  hasIngressPhoto: boolean;
}

export interface CreateReceptionPayload {
  header: NewReceptionInput;
  items: ReceptionItemPayload[];
}

/** Crea cabecera + líneas y deja la recepción en 'pendiente' (lista para confirmar). */
export async function createReceptionFull(payload: CreateReceptionPayload): Promise<Result> {
  try {
    // A-6 · Se valida ANTES de crear la cabecera. Si una línea viniera sin
    // posición a mitad del lote, la cabecera ya existiría y quedaría huérfana
    // y sin sede: inservible, y sin nada que la limpie.
    for (const it of payload.items) assertPositionRequired(it);
    const id = await createReception(payload.header);
    for (const it of payload.items) {
      await addReceptionItem({ reception_id: id, ...it });
    }
    await submitReception(id);
    revalidatePath("/wms/recepciones");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function confirmReceptionAction(id: string): Promise<Result> {
  try {
    await confirmReception(id);
    revalidatePath("/wms/recepciones");
    revalidatePath("/wms");
    revalidatePath("/operaciones/mapa-inteligente");
    // S2-2 · confirmar es lo que materializa las unidades de custodia. Sin esto
    // el listado de custodia seguía mostrando el estado anterior y el operario
    // no encontraba el caso que su propia confirmación acababa de abrir.
    revalidatePath("/wms/custody");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Unidades de custodia de una recepción, para avisar y enlazar (S2-2).
 *
 * Lee por `custody_reception_units` (0252), que es SECURITY DEFINER y exige
 * `wms.view`: la pantalla no arma joins propios contra el módulo de custodia.
 */
export async function receptionCustodyUnitsAction(
  receptionId: string,
): Promise<Result<ReceptionCustodyUnit[]>> {
  try {
    const id = parseCanonicalUuid(receptionId);
    if (!id) return { ok: false, error: "Identificador de recepción inválido" };
    const supabase = createClient();
    if (!supabase) return { ok: false, error: "Supabase no configurado" };
    const { data, error } = await supabase.rpc("custody_reception_units", {
      p_reception_id: id,
    });
    if (error) return { ok: false, error: "No se pudieron leer las unidades de custodia" };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return {
      ok: true,
      data: rows.map((r) => ({
        physicalUnitId: String(r.physical_unit_id ?? ""),
        receptionItemId: String(r.reception_item_id ?? ""),
        unitPublicId: String(r.unit_public_id ?? ""),
        sku: String(r.sku ?? ""),
        quantity: Number(r.quantity ?? 0),
        lotNumber: (r.lot_number as string | null) ?? null,
        custodyLevel: Number(r.custody_level ?? 1),
        caseId: (r.case_id as string | null) ?? null,
        casePublicId: (r.case_public_id as string | null) ?? null,
        caseState: (r.case_state as string | null) ?? null,
        hasIngressPhoto: r.has_ingress_photo === true,
      })),
    };
  } catch (e) {
    return fail(e);
  }
}

/**
 * S2-1 · RECEPCIÓN CON FOTO DE INGRESO, EN UN SOLO ACTO (I4).
 *
 * ─── EL PROBLEMA DE BASE, Y CÓMO SE RESUELVE ─────────────────────────────
 *
 * `custody_materialize_reception_item_row` está REVOCADA para todos los roles,
 * incluido `service_role` (0250a:449-450). NO se puede invocar. Materializa
 * únicamente el trigger `trg_custody_materialize_reception_item`, que es
 * SECURITY DEFINER y corre como su dueño, y que dispara cuando el ítem pasa a
 * `recibido`/`cuarentena` con `inventory_item_id` — es decir, AL CONFIRMAR.
 *
 * De las dos salidas que el master admite, ésta es la primera: COORDINAR EL
 * ORDEN. No hace falta ninguna RPC nueva de materialización, y por eso no se
 * escribió: crear → confirmar → leer las unidades que el trigger acaba de
 * crear → ligar cada foto a la suya, por el camino de captura que ya existe y
 * ya está autorizado (`attest_custody_physical_content` +
 * `attach_custody_physical_evidence`, concedidas a `authenticated`).
 *
 * El emparejamiento foto↔unidad es por `reception_item_id`, que es UNIQUE en
 * `custody_physical_units`. Emparejar por SKU y lote habría fallado en cuanto
 * una recepción trajera dos líneas iguales.
 *
 * ─── POR QUÉ ESTA ACCIÓN CONFIRMA Y `createReceptionFull` NO ─────────────
 *
 * El caso no existe hasta confirmar, así que una foto tomada «al crear» no
 * tendría a qué ligarse. Se conserva `createReceptionFull` intacta para el
 * flujo sin fotos —crear y dejar pendiente—: quien no saca fotos no cambia de
 * comportamiento. La pantalla dice cuál de los dos actos va a ejecutar.
 *
 * Las fotos son BEST-EFFORT respecto de la recepción: si una falla, la
 * recepción YA está confirmada y el stock movido. Devolver un error global
 * haría creer que no se recibió nada. Se informa cuáles quedaron pendientes.
 */
export interface ReceptionPhotoPayload {
  /** Índice de la línea en `items`, para saber a qué ítem pertenece la foto. */
  itemIndex: number;
  file: File;
}

export interface CreateAndCaptureResult {
  receptionId: string;
  units: ReceptionCustodyUnit[];
  /** Fotos que no se pudieron registrar, con su motivo. La recepción ya existe. */
  fotosPendientes: Array<{ sku: string; motivo: string }>;
}

export async function createConfirmAndCaptureAction(
  form: FormData,
): Promise<Result<CreateAndCaptureResult>> {
  try {
    const raw = form.get("payload");
    if (typeof raw !== "string") return { ok: false, error: "Solicitud inválida" };
    const payload = JSON.parse(raw) as CreateReceptionPayload;

    // JUNTURA 2-A/2-B · A-6, la misma guarda previa que `createReceptionFull`.
    //
    // Fase B la puso allá porque esta acción no existía de su lado. El motivo
    // vale igual acá, y más: si una línea viniera sin posición a mitad del
    // lote, la cabecera ya estaría creada, quedaría huérfana y sin sede, y
    // ADEMÁS esta acción CONFIRMA —así que el trigger de custodia habría
    // materializado unidades colgando de una recepción inservible.
    for (const it of payload.items) assertPositionRequired(it);

    // 1 · cabecera + líneas, guardando el id de cada línea
    const receptionId = await createReception(payload.header);
    const itemIds: string[] = [];
    for (const it of payload.items) {
      itemIds.push(await addReceptionItem({ reception_id: receptionId, ...it }));
    }
    await submitReception(receptionId);

    // 2 · CONFIRMAR: es el acto que dispara el trigger y crea las unidades
    await confirmReception(receptionId);

    // 3 · leer lo que el trigger materializó
    const unidades = await receptionCustodyUnitsAction(receptionId);
    const units = unidades.ok && unidades.data ? unidades.data : [];
    const porItem = new Map(units.map((u) => [u.receptionItemId, u]));

    // 4 · ligar cada foto a SU unidad
    const fotosPendientes: Array<{ sku: string; motivo: string }> = [];
    for (const [i, itemId] of itemIds.entries()) {
      const file = form.get(`foto-${i}`);
      if (!(file instanceof File) || file.size < 1) continue;
      const unidad = porItem.get(itemId);
      if (!unidad) {
        fotosPendientes.push({
          sku: payload.items[i]?.sku ?? `línea ${i + 1}`,
          motivo: "la línea no generó unidad de custodia",
        });
        continue;
      }
      // El par canónico lo fija el SERVIDOR, igual que en el panel de custodia:
      // el formulario nunca elige etapa, tipo ni soporte.
      const captura = new FormData();
      captura.set("file", file);
      captura.set("entity_id", unidad.physicalUnitId);
      captura.set("scope", "physical_unit");
      captura.set("stage", "recepcion");
      captura.set("event_type", "foto_ingreso");
      captura.set("kind", "foto");
      const res = await attachPhysicalEvidence(captura);
      if (!res.ok) {
        fotosPendientes.push({ sku: unidad.sku, motivo: res.error });
      }
    }

    revalidatePath("/wms/recepciones");
    revalidatePath("/wms");
    revalidatePath("/wms/custody");
    revalidatePath("/operaciones/mapa-inteligente");

    const frescas = await receptionCustodyUnitsAction(receptionId);
    return {
      ok: true,
      id: receptionId,
      data: {
        receptionId,
        units: frescas.ok && frescas.data ? frescas.data : units,
        fotosPendientes,
      },
    };
  } catch (e) {
    return fail(e);
  }
}

/** Nivel de custodia contratado por el cliente, para el valor por defecto. */
export async function custodyClientLevelAction(clientId: string): Promise<Result<1 | 2>> {
  try {
    const id = parseCanonicalUuid(clientId);
    if (!id) return { ok: false, error: "Cliente inválido" };
    const supabase = createClient();
    if (!supabase) return { ok: false, error: "Supabase no configurado" };
    const { data, error } = await supabase.rpc("custody_client_level", { p_client_id: id });
    if (error) return { ok: false, error: "No se pudo leer el nivel de custodia" };
    return { ok: true, data: Number(data) === 2 ? 2 : 1 };
  } catch (e) {
    return fail(e);
  }
}

export async function releaseQuarantineAction(id: string): Promise<Result> {
  try {
    await releaseQuarantine(id);
    revalidatePath("/wms/recepciones");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelReceptionAction(id: string): Promise<Result> {
  try {
    await cancelReception(id);
    revalidatePath("/wms/recepciones");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
