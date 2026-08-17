import { createClient, createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { ReceptionRow, BusinessUnit, ReceptionStatus } from "./types";
import {
  resolveClientSelection,
  type CanonicalClientRef,
  type ClientSelectionInput,
} from "./client-identity";

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
    created_at: "2026-06-01T09:30:00Z", item_count: 3, received_count: 3, custody_reforzada: false, custody_units: 0, custody_units_con_foto: 0,
  },
  {
    id: "rec-2", public_id: "REC-2026-0002", client_name: "Farma Sur",
    business_unit: "GENERAL", status: "pendiente",
    numero_oc: null, numero_remito: "R-0099440", transportista: "Cruz del Sur",
    patente: "AD884FF", chofer: "M. Gómez", requires_quarantine: false,
    received_at: null,
    created_at: "2026-06-02T08:15:00Z", item_count: 2, received_count: 0, custody_reforzada: false, custody_units: 0, custody_units_con_foto: 0,
  },
];

interface RawReceptionItem { status: string }
/** Unidad de custodia materializada, con sus eventos, para la señal del listado. */
interface RawCustodyUnit { id: string; custody_events?: Array<{ event_type: string }> | null }
interface RawReception {
  id: string; public_id: string; client_name: string; business_unit: string; status: string;
  numero_oc: string | null; numero_remito: string | null; transportista: string | null;
  patente: string | null; chofer: string | null; requires_quarantine: boolean;
  received_at: string | null; created_at: string;
  reception_items?: RawReceptionItem[] | null;
  custody_reforzada?: boolean | null;
  custody_physical_units?: RawCustodyUnit[] | null;
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
       custody_reforzada,
       reception_items(status),
       custody_physical_units(id, custody_events(event_type))`
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listReceptions: ${error.message}`);

  return ((data ?? []) as unknown as RawReception[]).map((r): ReceptionRow => {
    const items = Array.isArray(r.reception_items) ? r.reception_items : [];
    const unidades = Array.isArray(r.custody_physical_units) ? r.custody_physical_units : [];
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
      // S2-2 · señal visible de que esta recepción tiene custodia.
      custody_reforzada: r.custody_reforzada ?? false,
      custody_units: unidades.length,
      custody_units_con_foto: unidades.filter((u) =>
        (u.custody_events ?? []).some((e) => e.event_type === "foto_ingreso"),
      ).length,
    };
  });
}

// ── Alta de cabecera y líneas (inserts directos) ──────────────────────────

export interface NewReceptionInput extends ClientSelectionInput {
  business_unit: BusinessUnit;
  numero_oc?: string | null;
  numero_remito?: string | null;
  transportista?: string | null;
  patente?: string | null;
  chofer?: string | null;
  requires_quarantine?: boolean;
  notes?: string | null;
  /** D3 · eleva este ingreso a custodia reforzada (nivel 2). Nunca degrada. */
  custody_reforzada?: boolean;
}

/**
 * P3-N1B: lookup canónico de cliente, SOLO por UUID, server-side. Usa el admin
 * client (igual que src/lib/data/clients.ts) para leer la fila canónica.
 */
export async function lookupCanonicalClient(clientId: string): Promise<CanonicalClientRef | null> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase admin no configurado");
  const { data, error } = await admin
    .from("clients")
    .select("id, razon, activo")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(`lookupCanonicalClient: ${error.message}`);
  return (data as CanonicalClientRef | null) ?? null;
}

export async function createReception(input: NewReceptionInput): Promise<string> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  // P3-N1B: el navegador no es autoridad sobre el cliente. Se resuelve el UUID
  // canónico y se deriva client_name server-side; la fila se construye
  // EXPLÍCITAMENTE (sin spread) para que ningún campo extra del payload llegue
  // a la tabla. PRECONDICIÓN: 0219 aplicada (columna client_id).
  const cliente = await resolveClientSelection(input, lookupCanonicalClient);
  const { data, error } = await supabase
    .from("receptions")
    .insert({
      client_id: cliente.client_id,
      client_name: cliente.client_name,
      business_unit: input.business_unit,
      numero_oc: input.numero_oc ?? null,
      numero_remito: input.numero_remito ?? null,
      transportista: input.transportista ?? null,
      patente: input.patente ?? null,
      chofer: input.chofer ?? null,
      notes: input.notes ?? null,
      requires_quarantine: input.requires_quarantine ?? false,
      // D3 · casilla «custodia digital reforzada». ELEVA este ingreso a nivel 2
      // aunque el cliente no lo tenga contratado. Nunca degrada.
      custody_reforzada: input.custody_reforzada ?? false,
      status: "borrador",
    })
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

/**
 * A-6 · La posición es obligatoria, y la validación vive acá.
 *
 * La nave de cada línea se deriva de la posición por la jerarquía física
 * posición → rack → zona → sector → piso → depósito. Retirado el aislamiento
 * por sede, la columna `warehouse_id` de la cabecera desapareció y esa
 * jerarquía pasó a ser el ÚNICO lugar donde vive la nave: una línea sin
 * posición ya no queda mal permisada, queda sin nave, y el stock por depósito
 * deja de poder contarla.
 *
 * El tipo la declara opcional y hasta ahora sólo la exigía el formulario
 * (`NewReceptionForm.tsx:67`), de modo que cualquier llamador que no fuera esa
 * pantalla —o un payload construido a mano— dejaba la línea sin ubicar.
 */
export function assertPositionRequired(item: { sku?: string; position_id?: string | null }): void {
  if (!item.position_id) {
    throw new Error(
      `addReceptionItem: la línea ${item.sku ?? "(sin SKU)"} necesita una posición: ` +
        "de ella se deriva la nave y la sede de la línea.",
    );
  }
}

/**
 * Devuelve el id del ítem creado.
 *
 * Antes no devolvía nada. Hace falta para 2-A: la foto de ingreso se liga a la
 * unidad física que el trigger materializa AL CONFIRMAR, y la única forma no
 * ambigua de saber qué unidad corresponde a qué foto es
 * `custody_physical_units.reception_item_id`, que es único. Emparejar por SKU y
 * lote fallaría en cuanto una recepción trajera dos líneas iguales.
 *
 * JUNTURA 2-A/2-B · las dos cosas conviven: Fase B exige la posición ANTES de
 * escribir —de ella se deriva la nave— y Custodia necesita el id de vuelta. Ni
 * la guarda se pierde ni el retorno: la guarda es la primera sentencia y el id
 * sale al final.
 */
export async function addReceptionItem(item: NewReceptionItemInput): Promise<string> {
  assertPositionRequired(item);
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  // business_unit lo setea el trigger desde la cabecera; el CHECK ANMAT valida lote/vencimiento.
  const { data, error } = await supabase
    .from("reception_items")
    .insert({ ...item, status: "pendiente" })
    .select("id")
    .single();
  if (error) throw new Error(`addReceptionItem: ${error.message}`);
  return (data as { id: string }).id;
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
