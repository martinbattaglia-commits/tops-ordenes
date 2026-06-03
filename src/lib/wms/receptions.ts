import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { ReceptionRow, BusinessUnit, ReceptionStatus } from "./types";

/**
 * Servicios de Recepciones (WMS Sprint 2). Las CONFIRMACIONES van por RPC
 * transaccional (confirm_reception / release_quarantine); el alta de cabecera y
 * líneas son inserts directos (receptions / reception_items siguen siendo
 * escribibles por rol). El stock NUNCA se toca acá — solo dentro de la RPC.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

const MOCK_RECEPTIONS: ReceptionRow[] = [
  {
    id: "rec-1", public_id: "REC-2026-0001", client_name: "Lab. Andrómaco",
    business_unit: "ANMAT", status: "cuarentena",
    numero_oc: "OC-4471", numero_remito: "R-0099123", transportista: "Andreani",
    patente: "AB123CD", chofer: "J. Pérez", requires_quarantine: true,
    received_at: "2026-06-01T10:00:00Z",
    created_at: "2026-06-01T09:30:00Z", item_count: 3, received_count: 3,
  },
  {
    id: "rec-2", public_id: "REC-2026-0002", client_name: "Farma Sur",
    business_unit: "GENERAL", status: "pendiente",
    numero_oc: null, numero_remito: "R-0099440", transportista: "Cruz del Sur",
    patente: "AD884FF", chofer: "M. Gómez", requires_quarantine: false,
    received_at: null,
    created_at: "2026-06-02T08:15:00Z", item_count: 2, received_count: 0,
  },
];

interface RawReceptionItem { status: string }
interface RawReception {
  id: string; public_id: string; client_name: string; business_unit: string; status: string;
  numero_oc: string | null; numero_remito: string | null; transportista: string | null;
  patente: string | null; chofer: string | null; requires_quarantine: boolean;
  received_at: string | null; created_at: string;
  reception_items?: RawReceptionItem[] | null;
}

export async function listReceptions(): Promise<ReceptionRow[]> {
  if (isMock()) return MOCK_RECEPTIONS;

  const supabase = createClient();
  if (!supabase) return MOCK_RECEPTIONS;

  const { data, error } = await supabase
    .from("receptions")
    .select(
      `id, public_id, client_name, business_unit, status, numero_oc, numero_remito,
       transportista, patente, chofer, requires_quarantine, received_at, created_at,
       reception_items(status)`
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listReceptions: ${error.message}`);

  return ((data ?? []) as unknown as RawReception[]).map((r): ReceptionRow => {
    const items = Array.isArray(r.reception_items) ? r.reception_items : [];
    return {
      id: r.id,
      public_id: r.public_id,
      client_name: r.client_name,
      business_unit: r.business_unit as BusinessUnit,
      status: r.status as ReceptionStatus,
      numero_oc: r.numero_oc ?? null,
      numero_remito: r.numero_remito ?? null,
      transportista: r.transportista ?? null,
      patente: r.patente ?? null,
      chofer: r.chofer ?? null,
      requires_quarantine: r.requires_quarantine ?? false,
      received_at: r.received_at ?? null,
      created_at: r.created_at,
      item_count: items.length,
      received_count: items.filter((i) => i.status === "recibido" || i.status === "cuarentena").length,
    };
  });
}

// ── Alta de cabecera y líneas (inserts directos) ──────────────────────────

export interface NewReceptionInput {
  client_name: string;
  business_unit: BusinessUnit;
  numero_oc?: string | null;
  numero_remito?: string | null;
  transportista?: string | null;
  patente?: string | null;
  chofer?: string | null;
  requires_quarantine?: boolean;
  notes?: string | null;
}

export async function createReception(input: NewReceptionInput): Promise<string> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { data, error } = await supabase
    .from("receptions")
    .insert({ ...input, requires_quarantine: input.requires_quarantine ?? false, status: "borrador" })
    .select("id")
    .single();
  if (error) throw new Error(`createReception: ${error.message}`);
  return (data as { id: string }).id;
}

export interface NewReceptionItemInput {
  reception_id: string;
  sku: string;
  description: string;
  lot_number?: string | null;
  expiration_date?: string | null;
  quantity: number;
  position_id?: string | null;
}

export async function addReceptionItem(item: NewReceptionItemInput): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  // business_unit lo setea el trigger desde la cabecera; el CHECK ANMAT valida lote/vencimiento.
  const { error } = await supabase.from("reception_items").insert({ ...item, status: "pendiente" });
  if (error) throw new Error(`addReceptionItem: ${error.message}`);
}

// ── Transiciones de estado ─────────────────────────────────────────────────

/** borrador → pendiente (recepción cargada, lista para confirmar). */
export async function submitReception(id: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase
    .from("receptions")
    .update({ status: "pendiente" })
    .eq("id", id)
    .eq("status", "borrador");
  if (error) throw new Error(`submitReception: ${error.message}`);
}

// ── Confirmaciones (RPC transaccional — único camino que toca stock) ───────

export async function confirmReception(id: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("confirm_reception", { p_reception_id: id });
  if (error) {
    // DIAGNÓSTICO TEMPORAL: capturar el error COMPLETO (no solo message).
    console.error(
      "[confirmReception] FULL SUPABASE ERROR >>>",
      JSON.stringify(
        { message: error.message, details: error.details, hint: error.hint, code: error.code, id },
        null,
        2
      )
    );
    throw new Error(
      `confirmReception: ${error.message}` +
        (error.code ? ` | code=${error.code}` : "") +
        (error.details ? ` | details=${error.details}` : "") +
        (error.hint ? ` | hint=${error.hint}` : "")
    );
  }
}

export async function releaseQuarantine(id: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("release_quarantine", { p_reception_id: id });
  if (error) throw new Error(`releaseQuarantine: ${error.message}`);
}

export async function cancelReception(id: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.from("receptions").update({ status: "anulada" }).eq("id", id);
  if (error) throw new Error(`cancelReception: ${error.message}`);
}
