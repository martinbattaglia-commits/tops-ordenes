import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type {
  CostCenter,
  SupplierInvoice,
  SupplierInvoiceStatus,
} from "./types";

/**
 * Data accessors del módulo ERP financiero (Fase 3). Mismo patrón que
 * `src/lib/compras/data.ts`: producción = Supabase, demo = mock en memoria.
 * En producción, si las tablas (migración 0014) aún no están aplicadas, los
 * accessors lanzan y la página degrada con <ModuleUnavailable/>.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

// ------------------------------------------------------------------
// Mock (demo mode)
// ------------------------------------------------------------------

const MOCK_COST_CENTERS: CostCenter[] = [
  { id: "cc-oper", code: "CC-OPER", name: "Operaciones", description: "Costos operativos de depósito y logística", parent_id: null, depot: null, active: true, created_at: new Date().toISOString() },
  { id: "cc-flota", code: "CC-FLOTA", name: "Flota & Transporte", description: "Combustible, mantenimiento y seguros de flota", parent_id: null, depot: null, active: true, created_at: new Date().toISOString() },
  { id: "cc-admin", code: "CC-ADMIN", name: "Administración", description: "Gastos administrativos y de estructura", parent_id: null, depot: null, active: true, created_at: new Date().toISOString() },
  { id: "cc-comerc", code: "CC-COMERC", name: "Comercial", description: "Marketing, ventas y comisiones", parent_id: null, depot: null, active: true, created_at: new Date().toISOString() },
  { id: "cc-mant", code: "CC-MANT", name: "Mantenimiento & Infra", description: "Mantenimiento edilicio e infraestructura", parent_id: null, depot: null, active: true, created_at: new Date().toISOString() },
];

const MOCK_SUPPLIER_INVOICES: SupplierInvoice[] = [
  {
    id: "si-1", short_id: 1, public_id: "FP-2026-0001",
    vendor_id: "v-1", cost_center_id: "cc-flota", purchase_order_id: null,
    tipo_comprobante: "FACTURA_A", punto_venta: 4, numero: "00012345", cae: "74110000123456",
    fecha_emision: "2026-05-12", fecha_vencimiento: "2026-06-11", moneda: "ARS",
    neto: 1240000, iva: 260400, percepciones: 0, total: 1500400,
    status: "conciliada", observ: null, pdf_url: null, created_at: "2026-05-12T10:00:00Z",
    vendor: { id: "v-1", razon: "YPF S.A.", cuit: "30-54668997-9" },
    cost_center: { id: "cc-flota", code: "CC-FLOTA", name: "Flota & Transporte" },
  },
  {
    id: "si-2", short_id: 2, public_id: "FP-2026-0002",
    vendor_id: "v-2", cost_center_id: "cc-mant", purchase_order_id: null,
    tipo_comprobante: "FACTURA_B", punto_venta: 2, numero: "00008891", cae: null,
    fecha_emision: "2026-05-20", fecha_vencimiento: "2026-06-19", moneda: "ARS",
    neto: 380000, iva: 79800, percepciones: 5400, total: 465200,
    status: "pendiente", observ: "Reparación portón depósito Magaldi", pdf_url: null, created_at: "2026-05-20T14:30:00Z",
    vendor: { id: "v-2", razon: "Ferretería Industrial Sur SRL", cuit: "30-71234567-4" },
    cost_center: { id: "cc-mant", code: "CC-MANT", name: "Mantenimiento & Infra" },
  },
  {
    id: "si-3", short_id: 3, public_id: "FP-2026-0003",
    vendor_id: "v-3", cost_center_id: "cc-admin", purchase_order_id: null,
    tipo_comprobante: "FACTURA_A", punto_venta: 1, numero: "00045012", cae: "74110000987654",
    fecha_emision: "2026-05-25", fecha_vencimiento: "2026-05-31", moneda: "ARS",
    neto: 92000, iva: 19320, percepciones: 0, total: 111320,
    status: "aprobada", observ: null, pdf_url: null, created_at: "2026-05-25T09:15:00Z",
    vendor: { id: "v-3", razon: "Telecom Argentina S.A.", cuit: "30-63945373-8" },
    cost_center: { id: "cc-admin", code: "CC-ADMIN", name: "Administración" },
  },
];

// ------------------------------------------------------------------
// COST CENTERS
// ------------------------------------------------------------------

export async function listCostCenters(
  opts: { includeInactive?: boolean } = {}
): Promise<CostCenter[]> {
  if (isMock()) return MOCK_COST_CENTERS;
  const supabase = createClient();
  if (!supabase) return MOCK_COST_CENTERS;
  let q = supabase.from("cost_centers").select("*").order("code");
  if (!opts.includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(`listCostCenters: ${error.message}`);
  return (data ?? []) as CostCenter[];
}

// ------------------------------------------------------------------
// SUPPLIER INVOICES (cuentas por pagar)
// ------------------------------------------------------------------

export interface SupplierInvoiceFilters {
  status?: SupplierInvoiceStatus | "todas";
  vendor_id?: string;
  cost_center_id?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface SupplierInvoiceListResult {
  rows: SupplierInvoice[];
  total: number;
  counts: Record<string, number>;
  sumTotal: number;
  sumPendiente: number;
}

const PAGE_DEFAULT = 20;

export async function listSupplierInvoices(
  filters: SupplierInvoiceFilters = {}
): Promise<SupplierInvoiceListResult> {
  if (isMock()) return listMock(filters);

  const supabase = createClient();
  if (!supabase) return listMock(filters);

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? PAGE_DEFAULT;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from("supplier_invoices")
    .select(
      `*, vendor:vendors(id, razon, cuit), cost_center:cost_centers(id, code, name)`,
      { count: "exact" }
    )
    .order("fecha_emision", { ascending: false })
    .range(from, to);

  if (filters.status && filters.status !== "todas") q = q.eq("status", filters.status);
  if (filters.vendor_id) q = q.eq("vendor_id", filters.vendor_id);
  if (filters.cost_center_id) q = q.eq("cost_center_id", filters.cost_center_id);
  if (filters.search) {
    const s = sanitize(filters.search);
    if (s) q = q.or(`public_id.ilike.%${s}%,numero.ilike.%${s}%`);
  }

  const { data, error, count } = await q;
  if (error) throw new Error(`listSupplierInvoices: ${error.message}`);

  const { data: countsData, error: cErr } = await supabase
    .from("supplier_invoices")
    .select("status, total");
  if (cErr) throw new Error(`listSupplierInvoices.counts: ${cErr.message}`);

  const counts: Record<string, number> = { todas: countsData?.length ?? 0 };
  let sumTotal = 0;
  let sumPendiente = 0;
  countsData?.forEach((r) => {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    sumTotal += Number(r.total ?? 0);
    if (r.status === "pendiente" || r.status === "conciliada" || r.status === "aprobada") {
      sumPendiente += Number(r.total ?? 0);
    }
  });

  return {
    rows: (data ?? []) as SupplierInvoice[],
    total: count ?? 0,
    counts,
    sumTotal,
    sumPendiente,
  };
}

export async function getSupplierInvoice(id: string): Promise<SupplierInvoice | null> {
  if (isMock()) return MOCK_SUPPLIER_INVOICES.find((i) => i.id === id) ?? null;
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("supplier_invoices")
    .select(`*, vendor:vendors(id, razon, cuit), cost_center:cost_centers(id, code, name)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getSupplierInvoice: ${error.message}`);
  return (data as SupplierInvoice) ?? null;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function listMock(filters: SupplierInvoiceFilters): SupplierInvoiceListResult {
  let rows = [...MOCK_SUPPLIER_INVOICES];
  if (filters.status && filters.status !== "todas") {
    rows = rows.filter((i) => i.status === filters.status);
  }
  if (filters.vendor_id) rows = rows.filter((i) => i.vendor_id === filters.vendor_id);
  if (filters.cost_center_id) rows = rows.filter((i) => i.cost_center_id === filters.cost_center_id);
  if (filters.search) {
    const s = filters.search.toLowerCase();
    rows = rows.filter(
      (i) => i.public_id.toLowerCase().includes(s) || i.numero.toLowerCase().includes(s)
    );
  }

  const counts: Record<string, number> = { todas: MOCK_SUPPLIER_INVOICES.length };
  let sumPendiente = 0;
  MOCK_SUPPLIER_INVOICES.forEach((i) => {
    counts[i.status] = (counts[i.status] ?? 0) + 1;
    if (i.status === "pendiente" || i.status === "conciliada" || i.status === "aprobada") {
      sumPendiente += Number(i.total ?? 0);
    }
  });

  const sumTotal = rows.reduce((a, i) => a + Number(i.total ?? 0), 0);
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? PAGE_DEFAULT;
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    counts,
    sumTotal,
    sumPendiente,
  };
}

function sanitize(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&").trim().slice(0, 80);
}
