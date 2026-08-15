import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  MOCK_PURCHASE_ORDERS,
  MOCK_VENDORS,
  MOCK_PRODUCTS,
  buildMockEvents,
  buildMockEmails,
} from "./compras-mock";
import type {
  PurchaseOrder,
  PoStatus,
  Vendor,
  Product,
  POEvent,
  POEmailSend,
} from "@/lib/types-po";
import type { Depot } from "@/lib/types";
import { realPurchaseAmount, summarizePurchaseAmounts } from "./order-amounts";

/**
 * Data accessors del módulo OC. Patrón idéntico a `src/lib/data/orders.ts`
 * (módulo OS): prod = Supabase, demo = mock en memoria.
 */

export interface PoFilters {
  status?: PoStatus | "todas";
  depot?: Depot | "todos";
  vendor_id?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
}

export interface PoListResult {
  rows: PurchaseOrder[];
  total: number;
  counts: Record<string, number>;
  /** Suma exclusiva de importes reales conocidos o conciliados. */
  sumTotal: number;
  /** Órdenes excluidas de la suma por precio estimado o pendiente. */
  nonRealAmountCount: number;
}

const PAGE_DEFAULT = 18;

export class PurchaseAccessError extends Error {
  readonly status: 401 | 403 | 503;

  constructor(code: "PURCHASE_AUTH_REQUIRED" | "PURCHASE_FORBIDDEN" | "PURCHASE_AUTH_UNAVAILABLE", status: 401 | 403 | 503) {
    super(code);
    this.name = "PurchaseAccessError";
    this.status = status;
  }
}

type PurchasePermission = "compras.view" | "compras.export";
type UserSupabaseClient = NonNullable<ReturnType<typeof createClient>>;

async function assertPurchasePermission(
  supabase: UserSupabaseClient,
  permission: PurchasePermission,
): Promise<void> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new PurchaseAccessError("PURCHASE_AUTH_REQUIRED", 401);
  }
  const { data: allowed, error: permissionError } = await supabase.rpc("has_permission", {
    p_slug: permission,
  });
  if (permissionError) {
    throw new PurchaseAccessError("PURCHASE_AUTH_UNAVAILABLE", 503);
  }
  if (allowed !== true) {
    throw new PurchaseAccessError("PURCHASE_FORBIDDEN", 403);
  }
}

/** Frontera reutilizable por route handlers; nunca entrega datos ni errores internos. */
export async function requirePurchasePermission(permission: PurchasePermission): Promise<void> {
  if (env.app.demoMode) return;
  const supabase = createClient();
  if (!supabase) {
    throw new PurchaseAccessError("PURCHASE_AUTH_UNAVAILABLE", 503);
  }
  await assertPurchasePermission(supabase, permission);
}

/**
 * La identidad documental de una OC sale del snapshot inmutable. El join al
 * maestro conserva sólo campos auxiliares de UI; nunca puede reemplazar razón,
 * CUIT, contacto, email ni condiciones congeladas al emitir.
 */
function withDocumentVendor(row: PurchaseOrder): PurchaseOrder {
  const snapshot = row.vendor_snapshot;
  if (!snapshot?.id || !snapshot.razon || !snapshot.cuit) return row;
  return {
    ...row,
    vendor: {
      ...(row.vendor ?? snapshot),
      ...snapshot,
      tags: row.vendor?.tags ?? snapshot.tags ?? [],
      active: snapshot.active ?? true,
      created_at: row.vendor?.created_at ?? snapshot.created_at ?? row.date,
    },
  };
}

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

// ------------------------------------------------------------------
// PURCHASE ORDERS
// ------------------------------------------------------------------

export async function listPurchaseOrders(filters: PoFilters = {}): Promise<PoListResult> {
  if (isMock()) return listMock(filters);

  const supabase = createClient();
  if (!supabase) return listMock(filters);
  await assertPurchasePermission(supabase, "compras.view");

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? PAGE_DEFAULT;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from("purchase_orders")
    .select(
      `*, vendor:vendors(*), items:po_items(*)`,
      { count: "exact" }
    )
    .order("date", { ascending: false })
    .range(from, to);

  if (filters.status && filters.status !== "todas") q = q.eq("status", filters.status);
  if (filters.depot && filters.depot !== "todos") q = q.eq("depot", filters.depot);
  if (filters.vendor_id) q = q.eq("vendor_id", filters.vendor_id);
  if (filters.search) {
    const s = sanitize(filters.search);
    if (s) q = q.ilike("public_id", `%${s}%`);
  }
  if (filters.from) q = q.gte("date", filters.from);
  if (filters.to) q = q.lte("date", filters.to);

  const { data, error, count } = await q;
  if (error) throw new Error("LIST_PURCHASE_ORDERS_FAILED");

  // El resumen económico se agrega en PostgreSQL sobre el MISMO universo U
  // filtrado, antes de paginar. Así no queda truncado por el max-rows de
  // PostgREST y nunca presenta una fila pendiente como importe cero.
  const { data: metricsRaw, error: metricsError } = await supabase.rpc(
    "purchase_order_list_metrics",
    {
      p_status: filters.status && filters.status !== "todas" ? filters.status : null,
      p_depot: filters.depot && filters.depot !== "todos" ? filters.depot : null,
      p_vendor_id: filters.vendor_id ?? null,
      p_search: filters.search ? sanitize(filters.search) || null : null,
      p_from: filters.from ?? null,
      p_to: filters.to ?? null,
    },
  );
  if (metricsError || !metricsRaw || Array.isArray(metricsRaw)) {
    throw new Error("LIST_PURCHASE_ORDER_METRICS_FAILED");
  }
  const metrics = metricsRaw as {
    counts?: Record<string, number>;
    total?: number;
    real_total?: number | string;
    non_real_count?: number;
  };
  const counts: Record<string, number> = { todas: 0, ...(metrics.counts ?? {}) };

  return {
    rows: ((data ?? []) as PurchaseOrder[]).map(withDocumentVendor),
    total: count ?? metrics.total ?? 0,
    counts,
    sumTotal: Number(metrics.real_total ?? 0),
    nonRealAmountCount: Number(metrics.non_real_count ?? 0),
  };
}

export async function getPurchaseOrder(idOrPublic: string): Promise<PurchaseOrder | null> {
  if (isMock()) {
    const po =
      MOCK_PURCHASE_ORDERS.find((o) => o.id === idOrPublic || o.public_id === idOrPublic) ??
      null;
    if (!po) return null;
    return { ...po, events: buildMockEvents(po), emails: buildMockEmails(po) };
  }

  const supabase = createClient();
  if (!supabase) return null;
  await assertPurchasePermission(supabase, "compras.view");

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    idOrPublic
  );

  let q = supabase
    .from("purchase_orders")
    .select(
      `*, vendor:vendors(*), items:po_items(*),
       events:po_events(*),
       emails:po_email_sends(*)`
    )
    .limit(1);
  q = isUuid ? q.eq("id", idOrPublic) : q.eq("public_id", idOrPublic);

  const { data, error } = await q.maybeSingle();
  if (error) throw new Error("GET_PURCHASE_ORDER_FAILED");
  return data ? withDocumentVendor(data as PurchaseOrder) : null;
}

export async function listRecentPurchaseOrders(limit = 6): Promise<PurchaseOrder[]> {
  const { rows } = await listPurchaseOrders({ pageSize: limit });
  return rows;
}

// ------------------------------------------------------------------
// VENDORS
// ------------------------------------------------------------------

export async function listVendors(): Promise<Vendor[]> {
  if (isMock()) return MOCK_VENDORS;
  const supabase = createClient();
  if (!supabase) return MOCK_VENDORS;

  // Intento principal: vendors + embed de la vista vendor_stats.
  // PostgREST a veces no infiere la relación tabla↔view, especialmente
  // si la vista no tiene FK declarada — en ese caso caemos a un select plano.
  const withStats = await supabase
    .from("vendors")
    .select(`*, stats:vendor_stats(oc_count, ytd_spend, last_oc_at)`)
    .eq("active", true)
    .order("razon");

  if (!withStats.error) {
    return ((withStats.data ?? []) as Array<
      Vendor & { stats?: { oc_count: number; ytd_spend: number | null; last_oc_at: string | null }[] }
    >).map((v) => ({
      ...v,
      oc_count: v.stats?.[0]?.oc_count ?? 0,
      // `null` significa que no existe importe real YTD; no se representa como $0.
      ytd_spend: v.stats?.[0]?.ytd_spend ?? undefined,
      last_oc_at: v.stats?.[0]?.last_oc_at ?? null,
    })) as Vendor[];
  }

  console.warn("[compras] vendor_stats embed falló, usando fallback sin stats", {
    code: "VENDOR_STATS_EMBED_FAILED",
  });

  // Fallback: select plano. El monto queda desconocido, nunca $0 aparente.
  const plain = await supabase
    .from("vendors")
    .select("*")
    .eq("active", true)
    .order("razon");
  if (plain.error) {
    throw new Error("LIST_VENDORS_FAILED");
  }
  return ((plain.data ?? []) as Vendor[]).map((v) => ({
    ...v,
    oc_count: 0,
    ytd_spend: undefined,
    last_oc_at: null,
  }));
}

export async function getVendor(id: string): Promise<Vendor | null> {
  if (isMock()) return MOCK_VENDORS.find((v) => v.id === id) ?? null;
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("GET_VENDOR_FAILED");
  return (data as Vendor) ?? null;
}

export async function searchVendors(q: string, limit = 10): Promise<Vendor[]> {
  const term = q.trim();
  if (!term) return (await listVendors()).slice(0, limit);
  if (isMock()) {
    const lo = term.toLowerCase();
    return MOCK_VENDORS.filter(
      (v) =>
        v.razon.toLowerCase().includes(lo) ||
        v.cuit.includes(lo) ||
        (v.contacto ?? "").toLowerCase().includes(lo)
    ).slice(0, limit);
  }
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .or(`razon.ilike.%${sanitize(term)}%,cuit.ilike.%${sanitize(term)}%`)
    .limit(limit);
  if (error) throw new Error("SEARCH_VENDORS_FAILED");
  return (data ?? []) as Vendor[];
}

// ------------------------------------------------------------------
// PRODUCTS
// ------------------------------------------------------------------

export async function listProducts(): Promise<Product[]> {
  if (isMock()) return MOCK_PRODUCTS;
  const supabase = createClient();
  if (!supabase) return MOCK_PRODUCTS;
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("active", true)
    .order("label");
  if (error) throw new Error("LIST_PRODUCTS_FAILED");
  return (data ?? []) as Product[];
}

export async function searchProducts(q: string, limit = 10): Promise<Product[]> {
  const term = q.trim();
  if (!term) return (await listProducts()).slice(0, limit);
  if (isMock()) {
    const lo = term.toLowerCase();
    return MOCK_PRODUCTS.filter(
      (p) => p.label.toLowerCase().includes(lo) || p.sku.toLowerCase().includes(lo)
    ).slice(0, limit);
  }
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .or(`label.ilike.%${sanitize(term)}%,sku.ilike.%${sanitize(term)}%`)
    .limit(limit);
  if (error) throw new Error("SEARCH_PRODUCTS_FAILED");
  return (data ?? []) as Product[];
}

// ------------------------------------------------------------------
// EVENTS / EMAILS (timeline)
// ------------------------------------------------------------------

export async function listOrderEvents(orderId: string): Promise<POEvent[]> {
  if (isMock()) {
    const po = MOCK_PURCHASE_ORDERS.find((o) => o.id === orderId);
    return po ? buildMockEvents(po) : [];
  }
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("po_events")
    .select("*")
    .eq("order_id", orderId)
    .order("ts", { ascending: true });
  if (error) throw new Error("LIST_PURCHASE_ORDER_EVENTS_FAILED");
  return (data ?? []) as POEvent[];
}

export async function listOrderEmails(orderId: string): Promise<POEmailSend[]> {
  if (isMock()) {
    const po = MOCK_PURCHASE_ORDERS.find((o) => o.id === orderId);
    return po ? buildMockEmails(po) : [];
  }
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("po_email_sends")
    .select("*")
    .eq("order_id", orderId)
    .order("sent_at", { ascending: true });
  if (error) throw new Error("LIST_PURCHASE_ORDER_EMAILS_FAILED");
  return (data ?? []) as POEmailSend[];
}

// ------------------------------------------------------------------
// KPIs / Dashboard
// ------------------------------------------------------------------

export interface PoKpis {
  ocThisMonth: number;
  ocDelta: string;
  spendThisMonth: number;
  spendDelta: string;
  /** OCs del mes sin importe real; no se computan como cero. */
  nonRealThisMonth: number;
  reconciledPct: number;
  reconciledDelta: string;
  signaturePct: number;
  signatureDelta: string;
  serie6m: { months: string[]; emitidas: number[]; conciliadas: number[] };
  categoryMix: Array<{ label: string; pct: number; color: string; amount: number }>;
  recentOrders: PurchaseOrder[];
  byVendor: Array<{ vendor: string; amount: number; pct: number }>;
}

const CHART_PALETTE = ["#050555", "#214576", "#3a6db0", "#C90812", "#B45309", "#8A94A6"];
const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export async function getDashboardKpis(): Promise<PoKpis> {
  let orders: PurchaseOrder[];
  if (isMock()) {
    orders = MOCK_PURCHASE_ORDERS;
  } else {
    const supabase = createClient();
    if (!supabase) {
      orders = MOCK_PURCHASE_ORDERS;
    } else {
      const since = new Date();
      since.setMonth(since.getMonth() - 7);
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("*, vendor:vendors(razon, categoria)")
        .gte("date", since.toISOString())
        .order("date", { ascending: false });
      if (error) throw new Error("PURCHASE_DASHBOARD_KPIS_FAILED");
      orders = ((data ?? []) as PurchaseOrder[]).map(withDocumentVendor);
    }
  }
  return computeKpis(orders);
}

export function computeKpis(orders: PurchaseOrder[], now = new Date()): PoKpis {
  const month = now.getMonth();
  const year = now.getFullYear();
  const previous = new Date(year, month - 1, 1);
  const filterActive = (o: PurchaseOrder) =>
    !(["borrador", "anulada"] as PoStatus[]).includes(o.status);
  const inMonth = (o: PurchaseOrder, targetYear: number, targetMonth: number) => {
    const date = new Date(o.date);
    return date.getFullYear() === targetYear && date.getMonth() === targetMonth;
  };

  const thisMonth = orders.filter(
    (o) => filterActive(o) && inMonth(o, year, month)
  );
  const prevMonth = orders.filter(
    (o) => filterActive(o) && inMonth(o, previous.getFullYear(), previous.getMonth())
  );

  const thisMonthAmounts = summarizePurchaseAmounts(thisMonth);
  const prevMonthAmounts = summarizePurchaseAmounts(prevMonth);
  const spend = thisMonthAmounts.realTotal;
  const prevSpend = prevMonthAmounts.realTotal;
  const reconciledThis = thisMonth.filter((o) => o.status === "conciliada").length;
  const reconciledPrev = prevMonth.filter((o) => o.status === "conciliada").length;
  const signedThis = thisMonth.filter((o) => o.signed_at).length;
  const signedPrev = prevMonth.filter((o) => o.signed_at).length;

  const deltaPct = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? "+100%" : "0%";
    const d = ((cur - prev) / prev) * 100;
    const sign = d >= 0 ? "+" : "";
    return `${sign}${d.toFixed(1).replace(".", ",")}%`;
  };

  const reconciledPct = thisMonth.length
    ? Math.round((reconciledThis / thisMonth.length) * 100)
    : 0;
  const reconciledPrevPct = prevMonth.length
    ? Math.round((reconciledPrev / prevMonth.length) * 100)
    : 0;
  const signaturePct = thisMonth.length
    ? Math.round((signedThis / thisMonth.length) * 100)
    : 0;
  const signaturePrevPct = prevMonth.length
    ? Math.round((signedPrev / prevMonth.length) * 100)
    : 0;

  // 6 meses serie
  const months: string[] = [];
  const emitidas: number[] = [];
  const conciliadas: number[] = [];
  for (let i = 5; i >= 0; i--) {
    const target = new Date(year, month - i, 1);
    const targetMonth = target.getMonth();
    months.push(MONTH_LABELS[targetMonth]);
    const inM = orders.filter(
      (o) => filterActive(o) && inMonth(o, target.getFullYear(), targetMonth)
    );
    emitidas.push(summarizePurchaseAmounts(inM).realTotal);
    conciliadas.push(summarizePurchaseAmounts(
      inM.filter((o) => o.status === "conciliada"),
    ).realTotal);
  }

  // Mix categorías
  const catMap = new Map<string, number>();
  thisMonth.forEach((o) => {
    const amount = realPurchaseAmount(o);
    if (amount === null) return;
    const cat = o.vendor?.categoria || o.categoria || "Otros";
    catMap.set(cat, (catMap.get(cat) ?? 0) + amount);
  });
  const totalMix = Array.from(catMap.values()).reduce((a, b) => a + b, 0) || 1;
  const categoryMix = Array.from(catMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, amount], i) => ({
      label,
      amount,
      pct: Math.round((amount / totalMix) * 100),
      color: CHART_PALETTE[i % CHART_PALETTE.length],
    }));

  // Top vendors
  const vMap = new Map<string, number>();
  orders.forEach((o) => {
    if (!filterActive(o)) return;
    const amount = realPurchaseAmount(o);
    if (amount === null) return;
    const name = o.vendor?.razon ?? "—";
    vMap.set(name, (vMap.get(name) ?? 0) + amount);
  });
  const vTotal = Array.from(vMap.values()).reduce((a, b) => a + b, 0) || 1;
  const byVendor = Array.from(vMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([vendor, amount]) => ({
      vendor,
      amount,
      pct: Math.round((amount / vTotal) * 100),
    }));

  return {
    ocThisMonth: thisMonth.length,
    ocDelta: deltaPct(thisMonth.length, prevMonth.length),
    spendThisMonth: spend,
    spendDelta: deltaPct(spend, prevSpend),
    nonRealThisMonth: thisMonthAmounts.nonRealOrders,
    reconciledPct,
    reconciledDelta: `${reconciledPct >= reconciledPrevPct ? "+" : ""}${
      reconciledPct - reconciledPrevPct
    } pts`,
    signaturePct,
    signatureDelta: `${signaturePct >= signaturePrevPct ? "+" : ""}${
      signaturePct - signaturePrevPct
    } pts`,
    serie6m: { months, emitidas, conciliadas },
    categoryMix,
    recentOrders: orders.slice(0, 6),
    byVendor,
  };
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function listMock(filters: PoFilters): PoListResult {
  let facetRows = MOCK_PURCHASE_ORDERS;
  if (filters.depot && filters.depot !== "todos") {
    facetRows = facetRows.filter((o) => o.depot === filters.depot);
  }
  if (filters.vendor_id) facetRows = facetRows.filter((o) => o.vendor_id === filters.vendor_id);
  if (filters.search) {
    const q = sanitize(filters.search).toLowerCase();
    facetRows = facetRows.filter((o) => o.public_id.toLowerCase().includes(q));
  }
  if (filters.from) facetRows = facetRows.filter((o) => o.date >= filters.from!);
  if (filters.to) facetRows = facetRows.filter((o) => o.date <= filters.to!);

  let rows = facetRows;
  if (filters.status && filters.status !== "todas") {
    rows = rows.filter((o) => o.status === filters.status);
  }

  const counts: Record<string, number> = { todas: facetRows.length };
  const allStatuses: PoStatus[] = [
    "borrador",
    "pendiente",
    "firmada",
    "enviada",
    "recibida_parcial",
    "conciliada",
    "facturada",
    "anulada",
  ];
  allStatuses.forEach((s) => {
    counts[s] = facetRows.filter((o) => o.status === s).length;
  });

  const amountSummary = summarizePurchaseAmounts(rows);

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? PAGE_DEFAULT;
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    counts,
    sumTotal: amountSummary.realTotal,
    nonRealAmountCount: amountSummary.nonRealOrders,
  };
}

function sanitize(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&").trim().slice(0, 80);
}
