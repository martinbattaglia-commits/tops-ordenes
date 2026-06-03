"use server";

import { revalidatePath } from "next/cache";
import {
  createReception,
  addReceptionItem,
  submitReception,
  confirmReception,
  releaseQuarantine,
  cancelReception,
  type NewReceptionInput,
} from "@/lib/wms/receptions";

type Result = { ok: true; id?: string } | { ok: false; error: string };

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

export interface CreateReceptionPayload {
  header: NewReceptionInput;
  items: ReceptionItemPayload[];
}

/** Crea cabecera + líneas y deja la recepción en 'pendiente' (lista para confirmar). */
export async function createReceptionFull(payload: CreateReceptionPayload): Promise<Result> {
  try {
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
    return { ok: true };
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
