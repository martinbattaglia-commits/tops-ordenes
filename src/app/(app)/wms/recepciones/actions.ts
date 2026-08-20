"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseCanonicalUuid } from "@/lib/custody/canonical-contract";
import { CUSTODY_EVIDENCE_MAX_BYTES } from "@/lib/custody/canonical-contract";
import { sniffCustodyVisionMime } from "@/lib/custody/vision-mime";
// Se importa el módulo EXTRAÍDO, no `wms/custody/actions`: ese archivo arrastra
// el proveedor de visión de OpenAI, y recepciones está dentro de la clausura del
// maestro de clientes, cuyo guard de egreso de red —correctamente— lo rechaza.
import { attachPhysicalEvidence } from "@/lib/custody/physical-ingress";
import { getCanonicalPhysicalUnitQr } from "@/lib/custody/operation-visibility";
import {
  createReception,
  addReceptionItem,
  assertPositionRequired,
  submitReception,
  confirmReception,
  releaseQuarantine,
  cancelReception,
  createConfirmedReceptionIdempotent,
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
  /** QR canónico de la CPU. Sólo existe para N2 con caso; nunca se acuña acá. */
  qrDataUrl: string | null;
  qrUrl: string | null;
}

export interface CreateReceptionPayload {
  header: NewReceptionInput;
  items: ReceptionItemPayload[];
}

async function clientContractedCustodyLevel(clientId: string): Promise<1 | 2> {
  const id = parseCanonicalUuid(clientId);
  if (!id) throw new Error("No se pudo verificar el nivel de custodia del cliente");
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { data, error } = await supabase.rpc("custody_client_level", { p_client_id: id });
  if (error) throw new Error("No se pudo verificar el nivel de custodia del cliente");
  const level = Number(data);
  if (level !== 1 && level !== 2) {
    throw new Error("El nivel de custodia del cliente no es verificable");
  }
  return level;
}

/**
 * El navegador puede elevar a N2, pero nunca degradar un contrato N2. La
 * decisión efectiva se vuelve a obtener en el servidor antes de la primera
 * escritura. El escape explícito de cliente no listado carece de contrato
 * canónico y conserva nivel 1 salvo elevación manual.
 */
async function effectiveCustodyLevel(header: NewReceptionInput): Promise<1 | 2> {
  if (header.custody_reforzada === true) return 2;
  const clientId = header.client_id?.trim();
  if (!clientId) return 1;
  return clientContractedCustodyLevel(clientId);
}

function assertPayload(payload: CreateReceptionPayload): void {
  if (!payload || typeof payload !== "object" || !payload.header || !Array.isArray(payload.items)) {
    throw new Error("Solicitud de recepción inválida");
  }
  if (payload.items.length === 0) throw new Error("La recepción necesita al menos una línea");
}

/** Crea cabecera + líneas y deja la recepción en 'pendiente' (lista para confirmar). */
export async function createReceptionFull(payload: CreateReceptionPayload): Promise<Result> {
  try {
    assertPayload(payload);
    const level = await effectiveCustodyLevel(payload.header);
    if (level === 2) {
      return {
        ok: false,
        error: "Custodia nivel 2: cada línea requiere su foto de ingreso antes de confirmar.",
      };
    }
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
    const receptionId = parseCanonicalUuid(id);
    if (!receptionId) return { ok: false, error: "Identificador de recepción inválido" };
    const supabase = createClient();
    if (!supabase) return { ok: false, error: "Supabase no configurado" };
    const { data, error } = await supabase
      .from("receptions")
      .select("client_id, custody_reforzada")
      .eq("id", receptionId)
      .maybeSingle();
    if (error || !data) {
      return { ok: false, error: "No se pudo verificar el nivel de custodia de la recepción" };
    }
    const row = data as { client_id: string | null; custody_reforzada: boolean | null };
    const level = await effectiveCustodyLevel({
      client_id: row.client_id,
      business_unit: "GENERAL",
      custody_reforzada: row.custody_reforzada === true,
    });
    if (level === 2) {
      return {
        ok: false,
        error: "Custodia nivel 2: anulá esta recepción y recreala desde Nueva recepción con una foto por línea.",
      };
    }
    await confirmReception(receptionId);
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
async function readReceptionCustodyUnits(
  receptionId: string,
  decorateQr: boolean,
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
    const mapped = rows.map((r) => ({
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
      qrDataUrl: null,
      qrUrl: null,
    } satisfies ReceptionCustodyUnit));
    if (
      mapped.some(
        (unit) =>
          !parseCanonicalUuid(unit.physicalUnitId) ||
          !parseCanonicalUuid(unit.receptionItemId) ||
          (unit.custodyLevel !== 1 && unit.custodyLevel !== 2) ||
          (unit.caseId !== null && !parseCanonicalUuid(unit.caseId)) ||
          unit.unitPublicId.length === 0,
      )
    ) {
      return { ok: false, error: "La identidad de custodia de la recepción no es verificable" };
    }
    const decorated = decorateQr ? await Promise.all(
      mapped.map(async (unit): Promise<ReceptionCustodyUnit> => {
        if (unit.custodyLevel !== 2 || !unit.caseId) return unit;
        const qr = await getCanonicalPhysicalUnitQr(unit.physicalUnitId);
        return {
          ...unit,
          qrDataUrl: qr?.dataUrl ?? null,
          qrUrl: qr?.url ?? null,
        };
      }),
    ) : mapped;
    return {
      ok: true,
      data: decorated,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function receptionCustodyUnitsAction(
  receptionId: string,
): Promise<Result<ReceptionCustodyUnit[]>> {
  return readReceptionCustodyUnits(receptionId, true);
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
    const idempotencyKey = parseCanonicalUuid(form.get("idempotency_key"));
    if (!idempotencyKey) return { ok: false, error: "Clave de operación inválida" };
    const payload = JSON.parse(raw) as CreateReceptionPayload;
    assertPayload(payload);
    const requestedReforzada = payload.header.custody_reforzada === true;
    const level = await effectiveCustodyLevel(payload.header);

    const photos = payload.items.map((_, index) => form.get(`foto-${index}`));
    if (
      level === 2 &&
      photos.some((file) => !(file instanceof File) || file.size < 1)
    ) {
      return {
        ok: false,
        error: "Custodia nivel 2: cada línea requiere una foto de ingreso válida.",
      };
    }
    const ingressSha256: Array<string | null> = photos.map(() => null);
    if (level === 2) {
      for (const [index, entry] of photos.entries()) {
        const file = entry as File;
        if (file.size > CUSTODY_EVIDENCE_MAX_BYTES) {
          return {
            ok: false,
            error: `La foto de la línea ${index + 1} supera el máximo permitido de 8 MiB.`,
          };
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mime = sniffCustodyVisionMime(bytes);
        if (!mime) {
          return {
            ok: false,
            error: `La foto de la línea ${index + 1} no es JPEG, PNG o WebP válido.`,
          };
        }
        ingressSha256[index] = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
      }
    } else {
      for (const [index, entry] of photos.entries()) {
        if (entry instanceof File && entry.size > 0) {
          const bytes = new Uint8Array(await entry.arrayBuffer());
          ingressSha256[index] = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
        }
      }
    }

    // JUNTURA 2-A/2-B · A-6, la misma guarda previa que `createReceptionFull`.
    //
    // Fase B la puso allá porque esta acción no existía de su lado. El motivo
    // vale igual acá, y más: si una línea viniera sin posición a mitad del
    // lote, la cabecera ya estaría creada, quedaría huérfana y sin sede, y
    // ADEMÁS esta acción CONFIRMA —así que el trigger de custodia habría
    // materializado unidades colgando de una recepción inservible.
    for (const it of payload.items) assertPositionRequired(it);

    // 1 · UNA sola RPC durable: claim idempotente + cabecera + líneas +
    // confirmación + stock + movimientos + CPU/casos, todo en la misma tx.
    const clientId = parseCanonicalUuid(payload.header.client_id);
    if (!clientId) return { ok: false, error: "Cliente canónico requerido" };
    const confirmed = await createConfirmedReceptionIdempotent(idempotencyKey, {
      client_id: clientId,
      business_unit: payload.header.business_unit,
      numero_oc: payload.header.numero_oc ?? null,
      numero_remito: payload.header.numero_remito ?? null,
      transportista: payload.header.transportista ?? null,
      patente: payload.header.patente ?? null,
      chofer: payload.header.chofer ?? null,
      requires_quarantine: payload.header.requires_quarantine ?? false,
      notes: payload.header.notes ?? null,
      custody_reforzada: requestedReforzada,
      items: payload.items.map((item, index) => ({
        ...item,
        ingress_sha256: ingressSha256[index],
      })),
    });
    const receptionId = confirmed.receptionId;
    const itemIds = confirmed.itemIds;

    // 2 · leer lo que el trigger materializó
    const unidades = await readReceptionCustodyUnits(receptionId, false);
    const units = unidades.ok && unidades.data ? unidades.data : [];
    const porItem = new Map(units.map((u) => [u.receptionItemId, u]));

    // 3 · ligar cada foto a SU unidad
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
      captura.set("reception_operation_id", confirmed.operationId);
      captura.set("reception_item_id", itemId);
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
    return { ok: true, data: await clientContractedCustodyLevel(clientId) };
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
