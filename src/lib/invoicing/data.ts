import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type {
  ArcaAmbiente,
  CustomerInvoice,
  FiscalConfig,
  PuntoVenta,
  InvoiceAuditEntry,
  InvoiceArcaStatus,
} from "./types";

/**
 * Data accessors del módulo de Facturación. Mismo patrón que
 * `src/lib/compras/data.ts`: producción = Supabase, demo = mock en memoria.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

// ------------------------------------------------------------------
// Mock (demo mode) — config fiscal de VEROTIN + 0 facturas iniciales
// ------------------------------------------------------------------

const MOCK_FISCAL_CONFIG: FiscalConfig = {
  id: 1,
  razon_social: "VEROTIN S.A.",
  nombre_fantasia: "Logística TOPS",
  cuit: "33-60489698-9",
  ingresos_brutos: "646677-10",
  inicio_actividades: "1985-03-01",
  domicilio_comercial: "Agustín Magaldi 1765",
  localidad: "Ciudad Autónoma de Buenos Aires",
  provincia: "CABA",
  condicion_iva: "RESPONSABLE_INSCRIPTO",
  ambiente: "SANDBOX",
  cert_alias: null,
  default_punto_venta: 2,
  logo_url: null,
  pie_legal:
    "No abonándose esta factura a su vencimiento devengará intereses punitorios a razón de la tasa bancaria actual.",
  updated_at: new Date().toISOString(),
  updated_by: null,
};

const MOCK_PUNTOS_VENTA: PuntoVenta[] = [
  {
    id: "pv-2",
    numero: 2,
    descripcion: "Casa Central — Magaldi",
    tipo: "CONTROLADOR_FISCAL",
    activo: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "pv-3",
    numero: 3,
    descripcion: "Web Service — Nexus",
    tipo: "WEBSERVICE",
    activo: true,
    created_at: new Date().toISOString(),
  },
];

/** Facturas emitidas en demo mode (vive en el proceso). */
const MOCK_INVOICES: CustomerInvoice[] = [];

export function mockStore() {
  return { config: MOCK_FISCAL_CONFIG, puntosVenta: MOCK_PUNTOS_VENTA, invoices: MOCK_INVOICES };
}

// ------------------------------------------------------------------
// FISCAL CONFIG
// ------------------------------------------------------------------

export async function getFiscalConfig(): Promise<FiscalConfig> {
  if (isMock()) return MOCK_FISCAL_CONFIG;
  const supabase = createClient();
  if (!supabase) return MOCK_FISCAL_CONFIG;
  const { data, error } = await supabase
    .from("fiscal_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`getFiscalConfig: ${error.message}`);
  return (data as FiscalConfig) ?? MOCK_FISCAL_CONFIG;
}

// ------------------------------------------------------------------
// PUNTOS DE VENTA
// ------------------------------------------------------------------

export async function listPuntosVenta(
  opts: { includeInactive?: boolean } = {}
): Promise<PuntoVenta[]> {
  if (isMock()) return MOCK_PUNTOS_VENTA;
  const supabase = createClient();
  if (!supabase) return MOCK_PUNTOS_VENTA;
  let q = supabase.from("puntos_venta").select("*").order("numero");
  if (!opts.includeInactive) q = q.eq("activo", true);
  const { data, error } = await q;
  if (error) throw new Error(`listPuntosVenta: ${error.message}`);
  return (data ?? []) as PuntoVenta[];
}

// ------------------------------------------------------------------
// CUSTOMER INVOICES
// ------------------------------------------------------------------

export interface InvoiceFilters {
  estado?: InvoiceArcaStatus | "todas";
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface InvoiceListResult {
  rows: CustomerInvoice[];
  total: number;
  counts: Record<string, number>;
  sumTotal: number;
}

const PAGE_DEFAULT = 20;

export async function listInvoices(
  filters: InvoiceFilters = {}
): Promise<InvoiceListResult> {
  if (isMock()) return listInvoicesMock(filters);

  const supabase = createClient();
  if (!supabase) return listInvoicesMock(filters);

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? PAGE_DEFAULT;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from("customer_invoices")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.estado && filters.estado !== "todas") {
    q = q.eq("estado_arca", filters.estado);
  }
  if (filters.search) {
    const s = sanitize(filters.search);
    if (s) q = q.or(`razon_social.ilike.%${s}%,cae.ilike.%${s}%`);
  }

  const { data, error, count } = await q;
  if (error) throw new Error(`listInvoices: ${error.message}`);

  const { data: countsData, error: cErr } = await supabase
    .from("customer_invoices")
    .select("estado_arca, total");
  if (cErr) throw new Error(`listInvoices.counts: ${cErr.message}`);

  const counts: Record<string, number> = { todas: countsData?.length ?? 0 };
  let sumTotal = 0;
  countsData?.forEach((r) => {
    counts[r.estado_arca] = (counts[r.estado_arca] ?? 0) + 1;
    sumTotal += Number(r.total ?? 0);
  });

  return {
    rows: (data ?? []) as CustomerInvoice[],
    total: count ?? 0,
    counts,
    sumTotal,
  };
}

export async function getInvoice(id: string): Promise<CustomerInvoice | null> {
  if (isMock()) {
    const inv = MOCK_INVOICES.find((i) => i.id === id) ?? null;
    return inv ? { ...inv } : null;
  }
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("customer_invoices")
    .select("*, items:invoice_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getInvoice: ${error.message}`);
  return (data as CustomerInvoice) ?? null;
}

/**
 * H4 (FISCAL-HARDENING) — guard de idempotencia: OS ya referenciadas por un
 * comprobante fiscalmente vigente (autorizado, no anulado, no NC). No depende
 * del update post-CAE: aunque la marca FACTURADA haya fallado, el conflicto
 * se detecta acá y bloquea la re-emisión.
 */
export async function findBilledOrderConflicts(
  orderIds: string[]
): Promise<{ orderId: string; comprobante: string }[]> {
  if (orderIds.length === 0) return [];

  if (isMock()) {
    const conflicts: { orderId: string; comprobante: string }[] = [];
    for (const inv of MOCK_INVOICES) {
      if (
        inv.estado_arca !== "AUTORIZADO_ARCA" ||
        inv.anulada ||
        inv.tipo_comprobante.startsWith("NOTA_CREDITO")
      )
        continue;
      for (const it of inv.items ?? []) {
        if (it.order_id && orderIds.includes(it.order_id)) {
          conflicts.push({
            orderId: it.order_id,
            comprobante: `${inv.tipo_comprobante} ${inv.punto_venta}-${inv.numero_comprobante ?? "?"}`,
          });
        }
      }
    }
    return conflicts;
  }

  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("invoice_items")
    .select(
      "order_id, invoice:customer_invoices!inner(tipo_comprobante, punto_venta, numero_comprobante, estado_arca, anulada)"
    )
    .in("order_id", orderIds)
    .eq("invoice.estado_arca", "AUTORIZADO_ARCA")
    .eq("invoice.anulada", false);
  if (error) throw new Error(`findBilledOrderConflicts: ${error.message}`);

  type InvRef = Pick<
    CustomerInvoice,
    "tipo_comprobante" | "punto_venta" | "numero_comprobante"
  >;
  return (data ?? [])
    .map((r) => ({ orderId: r.order_id as string, inv: r.invoice as unknown as InvRef | null }))
    .filter((r) => r.inv && !r.inv.tipo_comprobante.startsWith("NOTA_CREDITO"))
    .map((r) => ({
      orderId: r.orderId,
      comprobante: `${r.inv!.tipo_comprobante} ${r.inv!.punto_venta}-${r.inv!.numero_comprobante ?? "?"}`,
    }));
}

/**
 * Mayor numero_comprobante ya persistido para (punto de venta, tipo, ambiente).
 * Usado en SANDBOX: el mock ARCA numera en memoria por proceso (se resetea por
 * instancia serverless) → sin esto, una lambda nueva propone números ya usados
 * y colisiona con UNIQUE (punto_venta, cbte_tipo_arca, numero_comprobante).
 * En HOMOLOGACION/PRODUCCION no se usa: la numeración la manda ARCA.
 */
export async function maxNumeroComprobante(
  puntoVenta: number,
  cbteTipo: number,
  ambiente: ArcaAmbiente
): Promise<number> {
  if (isMock()) {
    return MOCK_INVOICES.filter(
      (i) =>
        i.punto_venta === puntoVenta &&
        i.cbte_tipo_arca === cbteTipo &&
        i.ambiente === ambiente
    ).reduce((a, i) => Math.max(a, i.numero_comprobante ?? 0), 0);
  }
  const supabase = createClient();
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("customer_invoices")
    .select("numero_comprobante")
    .eq("punto_venta", puntoVenta)
    .eq("cbte_tipo_arca", cbteTipo)
    .eq("ambiente", ambiente)
    .not("numero_comprobante", "is", null)
    .order("numero_comprobante", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`maxNumeroComprobante: ${error.message}`);
  return Number(data?.numero_comprobante ?? 0);
}

/**
 * H1 — Total ya acreditado contra un comprobante: Σ de las NC autorizadas y
 * no anuladas que lo referencian. Tope para nuevas NC (no se puede acreditar
 * más que el total del original).
 */
export async function sumNotasCreditoDe(asociadoId: string): Promise<number> {
  if (isMock()) {
    return MOCK_INVOICES.filter(
      (i) =>
        i.comprobante_asociado_id === asociadoId &&
        i.estado_arca === "AUTORIZADO_ARCA" &&
        i.anulada === false &&
        i.tipo_comprobante.startsWith("NOTA_CREDITO")
    ).reduce((a, i) => a + Number(i.total ?? 0), 0);
  }
  const supabase = createClient();
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("customer_invoices")
    .select("total, tipo_comprobante")
    .eq("comprobante_asociado_id", asociadoId)
    .eq("estado_arca", "AUTORIZADO_ARCA")
    .eq("anulada", false)
    .in("tipo_comprobante", ["NOTA_CREDITO_A", "NOTA_CREDITO_B", "NOTA_CREDITO_C"]);
  if (error) throw new Error(`sumNotasCreditoDe: ${error.message}`);
  return (data ?? []).reduce((a, r) => a + Number(r.total ?? 0), 0);
}

export async function listInvoiceAudit(
  invoiceId: string
): Promise<InvoiceAuditEntry[]> {
  if (isMock()) return [];
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("invoice_audit")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("ts", { ascending: true });
  if (error) throw new Error(`listInvoiceAudit: ${error.message}`);
  return (data ?? []) as InvoiceAuditEntry[];
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function listInvoicesMock(filters: InvoiceFilters): InvoiceListResult {
  let rows = [...MOCK_INVOICES];
  if (filters.estado && filters.estado !== "todas") {
    rows = rows.filter((i) => i.estado_arca === filters.estado);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(
      (i) =>
        i.razon_social.toLowerCase().includes(q) ||
        (i.cae ?? "").includes(q)
    );
  }
  const counts: Record<string, number> = { todas: MOCK_INVOICES.length };
  MOCK_INVOICES.forEach((i) => {
    counts[i.estado_arca] = (counts[i.estado_arca] ?? 0) + 1;
  });
  const sumTotal = rows.reduce((a, i) => a + Number(i.total ?? 0), 0);
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? PAGE_DEFAULT;
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    counts,
    sumTotal,
  };
}

function sanitize(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&").trim().slice(0, 80);
}
