import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { SUPPLIER_COMPROBANTE_LABEL } from "./types";
import type { SupplierComprobante } from "./types";

/**
 * Capa de datos del Libro IVA Compras (ERP-B3).
 *
 * Fuente: vistas read-only de ERP-B1 (security_invoker → respetan RLS).
 *   · `supplier_invoice_fiscal`  → triple fiscal por comprobante (derivada del
 *     detalle canónico; excluye anuladas).
 *   · `supplier_invoice_vat_lines` → subtotales por alícuota (mismo detalle que
 *     `libro_iva_compras`, restringible al set filtrado).
 *   · joins de DISPLAY: `vendors` (razón/CUIT), `supplier_invoices` (PV/número,
 *     centro de costo).
 *
 * GARANTÍA: el frontend NO recalcula impuestos. Los importes (neto/IVA/
 * percepciones/total) vienen PRECOMPUTADOS por las vistas; acá solo se TOTALIZAN
 * (sumas) y se ENSAMBLAN con atributos de display. No se liquida ningún impuesto.
 *
 * No toca ERP-A, Tesorería, OCR, workflow AP ni las migraciones 0056-0059.
 */

const EXPORT_CAP = 5000;

export interface LibroIvaFilters {
  desde?: string | null; // YYYY-MM-DD
  hasta?: string | null; // YYYY-MM-DD
  vendorId?: string | null;
  cuit?: string | null;
  alicuota?: number | null; // 0|2.5|5|10.5|21|27
  costCenterId?: string | null;
  limit?: number;
}

export interface LibroIvaRow {
  invoiceId: string;
  publicId: string;
  fecha: string;
  proveedor: string;
  cuit: string;
  comprobante: string;
  netoGravado: number;
  iva: number;
  percepciones: number;
  totalComprobante: number;
  totalGravado: number; // neto + IVA (regla obligatoria)
  costCenter: string | null;
  approvalStatus: string;
}

export interface LibroIvaSubtotal {
  alicuota: number;
  comprobantes: number;
  netoGravado: number;
  iva: number;
  totalGravado: number;
}

export interface LibroIvaKpis {
  ivaCreditoFiscal: number;
  netoGravado: number;
  percepciones: number;
  cantidadComprobantes: number;
  totalGravado: number; // neto + IVA
}

export interface LibroIvaResult {
  rows: LibroIvaRow[];
  subtotales: LibroIvaSubtotal[];
  kpis: LibroIvaKpis;
  truncated: boolean;
  filters: LibroIvaFilters;
}

function n(v: unknown): number {
  const x = Number(v);
  return isFinite(x) ? x : 0;
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function comprobanteLabel(tipo: string, pv: number | null, numero: string | null): string {
  const t = SUPPLIER_COMPROBANTE_LABEL[tipo as SupplierComprobante] ?? tipo;
  const pvStr = pv != null ? String(pv).padStart(4, "0") : "----";
  const nroStr = numero ? numero.padStart(8, "0") : "--------";
  return `${t} ${pvStr}-${nroStr}`;
}

const EMPTY_KPIS: LibroIvaKpis = {
  ivaCreditoFiscal: 0,
  netoGravado: 0,
  percepciones: 0,
  cantidadComprobantes: 0,
  totalGravado: 0,
};

function emptyResult(filters: LibroIvaFilters): LibroIvaResult {
  return { rows: [], subtotales: [], kpis: { ...EMPTY_KPIS }, truncated: false, filters };
}

function intersect(prev: string[] | null, next: string[]): string[] {
  const dedup = [...new Set(next)];
  if (prev === null) return dedup;
  const s = new Set(dedup);
  return prev.filter((id) => s.has(id));
}

/**
 * Carga el Libro IVA Compras aplicando los filtros en la DB.
 * En demo/sin Supabase devuelve un resultado vacío (la página degrada limpia).
 */
export async function getLibroIvaCompras(
  filters: LibroIvaFilters = {}
): Promise<LibroIvaResult> {
  if (env.app.demoMode || env.app.needsSupabase) return emptyResult(filters);
  const supabase = createClient();
  if (!supabase) return emptyResult(filters);

  const cap = Math.min(filters.limit ?? EXPORT_CAP, EXPORT_CAP);

  // Resolución del filtro de proveedor por CUIT (si no hay vendorId explícito).
  let vendorIds: string[] | null = filters.vendorId ? [filters.vendorId] : null;
  if (!vendorIds && filters.cuit) {
    const digits = filters.cuit.replace(/\D/g, "");
    if (digits) {
      const { data, error } = await supabase.from("vendors").select("id").ilike("cuit", `%${digits}%`);
      if (error) throw new Error(`libro-iva.cuit: ${error.message}`);
      vendorIds = (data ?? []).map((r) => r.id as string);
      if (vendorIds.length === 0) return emptyResult(filters);
    }
  }

  // Restricción por invoice_id para filtros que no viven en la vista fiscal.
  let restrictIds: string[] | null = null;

  if (filters.alicuota != null) {
    const { data, error } = await supabase
      .from("supplier_invoice_vat_lines")
      .select("supplier_invoice_id")
      .eq("alicuota_iva", filters.alicuota);
    if (error) throw new Error(`libro-iva.alicuota: ${error.message}`);
    restrictIds = intersect(restrictIds, (data ?? []).map((r) => r.supplier_invoice_id as string));
  }

  if (filters.costCenterId) {
    const { data, error } = await supabase
      .from("supplier_invoices")
      .select("id")
      .eq("cost_center_id", filters.costCenterId);
    if (error) throw new Error(`libro-iva.cost_center: ${error.message}`);
    restrictIds = intersect(restrictIds, (data ?? []).map((r) => r.id as string));
  }

  if (restrictIds && restrictIds.length === 0) return emptyResult(filters);

  // Query principal: vista fiscal por comprobante.
  let q = supabase
    .from("supplier_invoice_fiscal")
    .select(
      "invoice_id, public_id, vendor_id, tipo_comprobante, fecha_emision, approval_status, neto_gravado, iva_pagado, percepciones, total_derivado"
    )
    .order("fecha_emision", { ascending: true })
    .limit(cap + 1);

  if (filters.desde) q = q.gte("fecha_emision", filters.desde);
  if (filters.hasta) q = q.lte("fecha_emision", filters.hasta);
  if (vendorIds) q = q.in("vendor_id", vendorIds);
  if (restrictIds) q = q.in("invoice_id", restrictIds);

  const { data: fiscal, error: fErr } = await q;
  if (fErr) throw new Error(`libro-iva.fiscal: ${fErr.message}`);

  const truncated = (fiscal?.length ?? 0) > cap;
  const fiscalRows = (fiscal ?? []).slice(0, cap);
  if (fiscalRows.length === 0) return emptyResult(filters);

  const invoiceIds = fiscalRows.map((r) => r.invoice_id as string);
  const usedVendorIds = [...new Set(fiscalRows.map((r) => r.vendor_id as string))];

  // Mapas de display.
  const { data: vendorsData, error: vErr } = await supabase
    .from("vendors")
    .select("id, razon, cuit")
    .in("id", usedVendorIds);
  if (vErr) throw new Error(`libro-iva.vendors: ${vErr.message}`);
  const vendorMap = new Map(
    (vendorsData ?? []).map((v) => [v.id as string, { razon: v.razon as string, cuit: v.cuit as string }])
  );

  const { data: invMeta, error: mErr } = await supabase
    .from("supplier_invoices")
    .select("id, punto_venta, numero, cost_center:cost_centers(code, name)")
    .in("id", invoiceIds);
  if (mErr) throw new Error(`libro-iva.meta: ${mErr.message}`);
  const metaMap = new Map(
    (invMeta ?? []).map((m) => {
      const cc = m.cost_center as { code?: string; name?: string } | null;
      return [
        m.id as string,
        {
          pv: m.punto_venta as number | null,
          numero: m.numero as string | null,
          costCenter: cc ? `${cc.code} · ${cc.name}` : null,
        },
      ];
    })
  );

  // Ensamblar filas (sin recalcular impuestos).
  const rows: LibroIvaRow[] = fiscalRows.map((r) => {
    const ven = vendorMap.get(r.vendor_id as string);
    const meta = metaMap.get(r.invoice_id as string);
    const neto = n(r.neto_gravado);
    const iva = n(r.iva_pagado);
    return {
      invoiceId: r.invoice_id as string,
      publicId: r.public_id as string,
      fecha: r.fecha_emision as string,
      proveedor: ven?.razon ?? "—",
      cuit: ven?.cuit ?? "",
      comprobante: comprobanteLabel(r.tipo_comprobante as string, meta?.pv ?? null, meta?.numero ?? null),
      netoGravado: neto,
      iva,
      percepciones: n(r.percepciones),
      totalComprobante: n(r.total_derivado),
      totalGravado: round2(neto + iva),
      costCenter: meta?.costCenter ?? null,
      approvalStatus: r.approval_status as string,
    };
  });

  // KPIs (totalización de valores ya derivados por la DB).
  const kpis: LibroIvaKpis = rows.reduce(
    (acc, r) => ({
      ivaCreditoFiscal: round2(acc.ivaCreditoFiscal + r.iva),
      netoGravado: round2(acc.netoGravado + r.netoGravado),
      percepciones: round2(acc.percepciones + r.percepciones),
      cantidadComprobantes: acc.cantidadComprobantes + 1,
      totalGravado: round2(acc.totalGravado + r.totalGravado),
    }),
    { ...EMPTY_KPIS }
  );

  // Subtotales por alícuota (detalle canónico restringido al set filtrado).
  const { data: vat, error: vatErr } = await supabase
    .from("supplier_invoice_vat_lines")
    .select("supplier_invoice_id, alicuota_iva, base_neto, importe_iva")
    .in("supplier_invoice_id", invoiceIds);
  if (vatErr) throw new Error(`libro-iva.subtotales: ${vatErr.message}`);

  const byAlic = new Map<number, { comp: Set<string>; neto: number; iva: number }>();
  (vat ?? []).forEach((l) => {
    const a = n(l.alicuota_iva);
    if (filters.alicuota != null && a !== filters.alicuota) return;
    const cur = byAlic.get(a) ?? { comp: new Set<string>(), neto: 0, iva: 0 };
    cur.comp.add(l.supplier_invoice_id as string);
    cur.neto = round2(cur.neto + n(l.base_neto));
    cur.iva = round2(cur.iva + n(l.importe_iva));
    byAlic.set(a, cur);
  });
  const subtotales: LibroIvaSubtotal[] = [...byAlic.entries()]
    .map(([alicuota, v]) => ({
      alicuota,
      comprobantes: v.comp.size,
      netoGravado: v.neto,
      iva: v.iva,
      totalGravado: round2(v.neto + v.iva),
    }))
    .sort((a, b) => b.alicuota - a.alicuota);

  return { rows, subtotales, kpis, truncated, filters };
}
