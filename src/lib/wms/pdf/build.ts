import { renderToBuffer } from "@react-pdf/renderer";
import type React from "react";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtTime } from "@/lib/utils";
import {
  RemitoEntradaPdfDocument,
  type RemitoEntradaData,
} from "./RemitoEntradaPdfDocument";
import {
  RemitoSalidaPdfDocument,
  type RemitoSalidaData,
} from "./RemitoSalidaPdfDocument";
import { depotFromWarehouse, type DepotInfo, type RemitoLine } from "./remito-common";

/**
 * Capacidad máxima de líneas que un remito puede renderizar dentro del
 * presupuesto de tiempo de una función serverless.
 *
 * Medición local (Apple M-series, sin acceso a base, fuentes ya registradas):
 * 400 líneas ≈ 1,4 s · 1000 ≈ 4,7 s · 2000 ≈ 14,9 s con 522 MB de RSS. El
 * crecimiento es superlineal y la lambda de Netlify corta a los 10 s. Se fija
 * el tope en 400 para dejar margen frente a un runtime más lento que este.
 *
 * Por encima del tope NO se trunca: el documento se rechaza con un error
 * funcional explícito. Un remito al que le faltan líneas en silencio es peor
 * que un remito que no se emite.
 */
export const MAX_LINEAS_REMITO = 400;


/**
 * Carga de datos + render on-demand de los remitos WMS. SOLO LECTURA:
 * cliente Supabase de sesión (RLS aplica), sin escritura a DB ni storage.
 * Sin QR: recepciones/despachos no tienen URL pública de validación.
 *
 * ⚠️ Colisión conocida de prefijo: las recepciones WMS usan `REC-YYYY-NNNN`
 * (0025) y los recibos de Tesorería `REC-YYYY-NNNNNN` (0053). Acá no se
 * resuelve: cada route handler consulta su propia tabla.
 */

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function fmtQty(n: number | string | null | undefined): string | null {
  const v = Number(n ?? 0);
  if (!v) return null;
  return v.toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

// Cadena física canónica hasta el depósito (misma forma que dispatch.ts).
const POSITION_WAREHOUSE_SELECT = `position:warehouse_positions(code,
  rack:warehouse_racks(zone:warehouse_zones(sector:warehouse_sectors(
    floor:warehouse_floors(warehouse:warehouses(code, name))))))`;

interface WhEmbed { code?: string | null; name?: string | null }

function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

/** Acceso laxo a embeds de PostgREST (objeto o array según cardinalidad). */
function pick(o: unknown, key: string): unknown {
  const obj = one(o as Record<string, unknown> | Record<string, unknown>[] | null);
  return obj ? obj[key] : null;
}

/** Extrae el warehouse (code, name) de la cadena rack→…→warehouse embebida. */
function warehouseFromChain(pos: unknown): WhEmbed | null {
  const wh = pick(pick(pick(pick(pick(pos, "rack"), "zone"), "sector"), "floor"), "warehouse");
  return one(wh as WhEmbed | WhEmbed[] | null);
}

/**
 * Depósito del documento, derivado de la cadena física de sus líneas.
 *
 * Si las líneas abarcan MÁS de un depósito, el documento no tiene un depósito
 * único: se devuelve la etiqueta de la primera para el encabezado, pero con
 * `depotCode: null`. Así el control de ámbito falla cerrado en vez de asignar
 * el documento al depósito que PostgREST haya devuelto primero — un orden que
 * no está garantizado y que, de otro modo, entregaría a un jefe de depósito
 * las líneas del otro.
 */
function depotFromPositions(positions: unknown[]): DepotInfo | null {
  let primero: DepotInfo | null = null;
  const codigos = new Set<string>();
  for (const pos of positions) {
    const wh = warehouseFromChain(pos);
    const d = depotFromWarehouse(wh?.code ?? null, wh?.name ?? null);
    if (!d) continue;
    if (!primero) primero = d;
    if (d.depotCode) codigos.add(d.depotCode);
  }
  if (!primero) return null;
  if (codigos.size > 1) return { ...primero, depotCode: null };
  return primero;
}

// ── Remito de ENTRADA ← recepciones (0025) ────────────────────────────────

interface RawReceptionItem {
  sku: string | null;
  description: string | null;
  lot_number: string | null;
  quantity: number | string | null;
  position?: unknown;
}

interface RawReception {
  id: string;
  public_id: string;
  client_name: string | null;
  business_unit: string | null;
  numero_oc: string | null;
  numero_remito: string | null;
  transportista: string | null;
  patente: string | null;
  chofer: string | null;
  received_at: string | null;
  created_at: string;
  notes: string | null;
  reception_items?: RawReceptionItem[] | null;
}

export async function getRemitoEntradaData(
  idOrPublicId: string
): Promise<RemitoEntradaData | null> {
  const supabase = createClient();
  if (!supabase) return null;

  let qb = supabase
    .from("receptions")
    .select(
      `id, public_id, client_name, business_unit, numero_oc, numero_remito,
       transportista, patente, chofer, received_at, created_at, notes,
       reception_items(sku, description, lot_number, quantity, ${POSITION_WAREHOUSE_SELECT})`
    );
  qb = isUuid(idOrPublicId) ? qb.eq("id", idOrPublicId) : qb.eq("public_id", idOrPublicId);
  // Acota el embed igual que en el remito de salida: +1 alcanza para detectar
  // el desborde de capacidad sin traer una recepción entera a memoria.
  qb = qb.limit(MAX_LINEAS_REMITO + 1, { referencedTable: "reception_items" });
  const { data, error } = await qb.maybeSingle();
  if (error) throw new Error(`getRemitoEntradaData: ${error.message}`);
  if (!data) return null;

  const r = data as unknown as RawReception;
  const items = r.reception_items ?? [];
  const lineas: RemitoLine[] = items.map((it) => ({
    descripcion: it.description ?? "",
    sku: it.sku ?? null,
    lote: it.lot_number ?? null,
    bultos: null, // no existe en el modelo → casillero en blanco
    unidades: fmtQty(it.quantity),
  }));

  return {
    numero: r.public_id,
    fecha: fmtDate(r.received_at ?? r.created_at) || null,
    horaArribo: r.received_at ? fmtTime(r.received_at) || null : null,
    depot: depotFromPositions(items.map((it) => it.position)),
    remitenteRazon: r.client_name ?? null,
    remitoOrigen: r.numero_remito ?? null,
    referencia: r.numero_oc ?? null,
    transportista: r.transportista ?? null,
    chofer: r.chofer ?? null,
    dominio: r.patente ?? null,
    lineas,
    observaciones: r.notes ?? null,
    productoAnmat: r.business_unit === "ANMAT",
  };
}

export async function buildRemitoEntradaPdf(data: RemitoEntradaData): Promise<Buffer> {
  return renderToBuffer(
    RemitoEntradaPdfDocument({ data }) as unknown as React.ReactElement
  );
}

// ── Remito de SALIDA ← shipments (0035) ───────────────────────────────────

interface RawShipmentOrder {
  id: string;
  public_id: string | null;
  client_name: string | null;
  notes: string | null;
}

interface RawShipment {
  id: string;
  public_id: string;
  order_id: string;
  carrier: string | null;
  vehicle_ref: string | null;
  dispatched_at: string | null;
  received_by_name: string | null;
  notes: string | null;
  order?: RawShipmentOrder | RawShipmentOrder[] | null;
}

interface RawAllocLine {
  lot_number: string | null;
  quantity: number | string | null;
  logistics_order_items?:
    | { sku?: string | null; description?: string | null }
    | { sku?: string | null; description?: string | null }[]
    | null;
  inventory_items?: { position?: unknown } | { position?: unknown }[] | null;
}

export async function getRemitoSalidaData(
  idOrPublicId: string
): Promise<RemitoSalidaData | null> {
  const supabase = createClient();
  if (!supabase) return null;

  let qb = supabase
    .from("shipments")
    .select(
      `id, public_id, order_id, carrier, vehicle_ref, dispatched_at,
       received_by_name, notes,
       order:logistics_orders(id, public_id, client_name, notes)`
    );
  qb = isUuid(idOrPublicId) ? qb.eq("id", idOrPublicId) : qb.eq("public_id", idOrPublicId);
  const { data, error } = await qb.maybeSingle();
  if (error) throw new Error(`getRemitoSalidaData: ${error.message}`);
  if (!data) return null;

  const ship = data as unknown as RawShipment;
  const order = one(ship.order);

  // Contenido egresado: reservas despachadas del pedido (lote FEFO real).
  const { data: allocs, error: aErr } = await supabase
    .from("stock_allocations")
    .select(
      `lot_number, quantity, status,
       logistics_order_items!inner(order_id, sku, description),
       inventory_items!inner(${POSITION_WAREHOUSE_SELECT})`
    )
    .eq("logistics_order_items.order_id", ship.order_id)
    .eq("status", "despachada")
    // +1 permite detectar el desborde de capacidad sin traer la tabla entera.
    .limit(MAX_LINEAS_REMITO + 1);
  if (aErr) throw new Error(`getRemitoSalidaData.allocs: ${aErr.message}`);

  const rawLines = (allocs ?? []) as unknown as RawAllocLine[];
  const lineas: RemitoLine[] = rawLines.map((a) => {
    const oi = one(a.logistics_order_items);
    return {
      descripcion: oi?.description ?? "",
      sku: oi?.sku ?? null,
      lote: a.lot_number ?? null,
      bultos: null, // el bulto vive en packing_units, no por línea → en blanco
      unidades: fmtQty(a.quantity),
    };
  });

  return {
    numero: ship.public_id,
    fecha: fmtDate(ship.dispatched_at) || null,
    horaSalida: ship.dispatched_at ? fmtTime(ship.dispatched_at) || null : null,
    depot: depotFromPositions(
      rawLines.map((a) => (one(a.inventory_items) as { position?: unknown } | null)?.position)
    ),
    destinatarioRazon: order?.client_name ?? null,
    ordenServicio: order?.public_id ?? null,
    transportista: ship.carrier ?? null,
    chofer: null, // no existe en el modelo de shipments → línea en blanco
    dominio: ship.vehicle_ref ?? null,
    lineas,
    observaciones: ship.notes ?? order?.notes ?? null,
    conformeDestinatario: ship.received_by_name ?? null,
  };
}

export async function buildRemitoSalidaPdf(data: RemitoSalidaData): Promise<Buffer> {
  return renderToBuffer(
    RemitoSalidaPdfDocument({ data }) as unknown as React.ReactElement
  );
}
