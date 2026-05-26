import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { MOCK_CLIENTS, MOCK_OPERATORS, MOCK_ORDERS } from "@/lib/mock-data";
import type { Order, OrderStatus, Depot, Client, Operator } from "@/lib/types";

/**
 * Data access para órdenes.
 *
 * Estrategia:
 *  - PRODUCCIÓN: usa Supabase. Cualquier query fallida tira un error claro
 *    (el caller maneja con error boundary).
 *  - DEMO MODE explícito (`NEXT_PUBLIC_DEMO_MODE=1`): usa data mock en memoria.
 *  - Sin DEMO_MODE y sin Supabase configurado: la app falla al boot con un
 *    mensaje útil (ver `env.requireSupabase`).
 */

export interface OrderFilters {
  status?: OrderStatus | "todas";
  depot?: Depot | "todos";
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface OrdersResult {
  rows: Order[];
  total: number;
  counts: Record<string, number>;
}

const PAGE_DEFAULT = 18;

function shouldUseMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

export async function listOrders(filters: OrderFilters = {}): Promise<OrdersResult> {
  if (shouldUseMock()) return listOrdersMock(filters);

  const supabase = createClient();
  if (!supabase) return listOrdersMock(filters);

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? PAGE_DEFAULT;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from("orders")
    .select(
      `*,
       client:clients(*),
       operator:operators(*),
       services:order_services(*)`,
      { count: "exact" }
    )
    .order("date", { ascending: false })
    .range(from, to);

  if (filters.status && filters.status !== "todas") q = q.eq("status", filters.status);
  if (filters.depot && filters.depot !== "todos") q = q.eq("depot", filters.depot);
  if (filters.search) {
    const s = sanitizeSearch(filters.search);
    if (s) {
      // public_id directo + search en cliente vía RPC fallback
      q = q.ilike("public_id", `%${s}%`);
    }
  }

  const { data, count, error } = await q;
  if (error) throw new Error(`listOrders: ${error.message}`);

  // counts por estado (light query, sin joins)
  const { data: countsData, error: cErr } = await supabase
    .from("orders")
    .select("status", { head: false });
  if (cErr) throw new Error(`listOrders.counts: ${cErr.message}`);

  const counts: Record<string, number> = { todas: countsData?.length ?? 0 };
  countsData?.forEach((r) => {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  });

  return { rows: (data ?? []) as Order[], total: count ?? 0, counts };
}

export async function getOrder(idOrPublicId: string): Promise<Order | null> {
  if (shouldUseMock()) {
    return (
      MOCK_ORDERS.find((o) => o.id === idOrPublicId || o.public_id === idOrPublicId) ?? null
    );
  }

  const supabase = createClient();
  if (!supabase) return null;

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    idOrPublicId
  );

  let q = supabase
    .from("orders")
    .select(
      `*,
       client:clients(*),
       operator:operators(*),
       services:order_services(*),
       attachments(*)`
    )
    .limit(1);
  q = isUuid ? q.eq("id", idOrPublicId) : q.eq("public_id", idOrPublicId);

  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`getOrder: ${error.message}`);
  return (data as Order) ?? null;
}

export async function listRecentOrders(limit = 6): Promise<Order[]> {
  const { rows } = await listOrders({ pageSize: limit });
  return rows;
}

export async function listClients(): Promise<Client[]> {
  if (shouldUseMock()) return MOCK_CLIENTS;
  const supabase = createClient();
  if (!supabase) return MOCK_CLIENTS;
  const { data, error } = await supabase.from("clients").select("*").order("razon");
  if (error) throw new Error(`listClients: ${error.message}`);
  return (data ?? []) as Client[];
}

export async function listOperators(): Promise<Operator[]> {
  if (shouldUseMock()) return MOCK_OPERATORS;
  const supabase = createClient();
  if (!supabase) return MOCK_OPERATORS;
  const { data, error } = await supabase
    .from("operators")
    .select("*")
    .eq("active", true)
    .order("full_name");
  if (error) throw new Error(`listOperators: ${error.message}`);
  return (data ?? []) as Operator[];
}

/**
 * KPIs del dashboard. En prod intentamos consulta agregada eficiente;
 * en demo derivamos del array de mock.
 */
export interface DashboardKpis {
  ordersThisMonth: number;
  ordersDelta: string;
  hours: number;
  hoursDelta: string;
  revenueProjection: number;
  revenueDelta: string;
  signatureRate: number;
  signatureDelta: string;
  byDepot: Array<{ depot: Depot; count: number }>;
  serviceMix: Array<{ slug: string; label: string; pct: number; color: string }>;
  topClients: Array<{ name: string; tag: string; orders: number; pct: number; color: string }>;
  series30d: { magaldi: number[]; lujan: number[] };
}

const PALETTE = ["#050555", "#214576", "#3a6db0", "#C90812", "#8A94A6", "#C2CAD6"];

export async function getDashboardKpis(): Promise<DashboardKpis> {
  if (shouldUseMock()) return buildKpisFromOrders(MOCK_ORDERS);

  const supabase = createClient();
  if (!supabase) return buildKpisFromOrders(MOCK_ORDERS);

  // Trae las últimas 90 días → derivamos KPIs en memoria. Para >10k órdenes
  // pasar a vistas materializadas o RPC dedicada.
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const { data, error } = await supabase
    .from("orders")
    .select(
      `*,
       client:clients(razon, cuit, tags),
       services:order_services(service_slug, label, qty, rate, subtotal)`
    )
    .gte("date", since.toISOString())
    .order("date", { ascending: false });

  if (error) throw new Error(`getDashboardKpis: ${error.message}`);
  return buildKpisFromOrders((data ?? []) as Order[]);
}

// ---------------- helpers ----------------

function buildKpisFromOrders(orders: Order[]): DashboardKpis {
  const now = new Date();
  const month = now.getMonth();
  const lastMonth = month === 0 ? 11 : month - 1;

  const thisMonth = orders.filter((o) => new Date(o.date).getMonth() === month);
  const prevMonth = orders.filter((o) => new Date(o.date).getMonth() === lastMonth);

  const hours = thisMonth.reduce((a, o) => a + (o.hours ?? 0), 0);
  const revenue = thisMonth.reduce((a, o) => a + Number(o.total ?? 0), 0);
  const signed = thisMonth.filter((o) => o.signed_by).length;
  const signatureRate = thisMonth.length ? (signed / thisMonth.length) * 100 : 0;

  const deltaPct = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? "+100%" : "0%";
    const d = ((cur - prev) / prev) * 100;
    const sign = d >= 0 ? "+" : "";
    return `${sign}${d.toFixed(1).replace(".", ",")}%`;
  };

  const ordersDelta = deltaPct(thisMonth.length, prevMonth.length);
  const hoursDelta = deltaPct(hours, prevMonth.reduce((a, o) => a + (o.hours ?? 0), 0));
  const revenueDelta = deltaPct(
    revenue,
    prevMonth.reduce((a, o) => a + Number(o.total ?? 0), 0)
  );
  const prevSignRate = prevMonth.length
    ? (prevMonth.filter((o) => o.signed_by).length / prevMonth.length) * 100
    : 0;
  const signatureDelta = `${signatureRate >= prevSignRate ? "+" : ""}${(
    signatureRate - prevSignRate
  )
    .toFixed(1)
    .replace(".", ",")} pts`;

  const magaldiCount = orders.filter((o) => o.depot === "MAGALDI").length;
  const lujanCount = orders.filter((o) => o.depot === "LUJAN").length;

  const mixCounts = new Map<string, { label: string; count: number }>();
  orders.forEach((o) => {
    o.services?.forEach((s) => {
      const cur = mixCounts.get(s.service_slug) ?? { label: s.label, count: 0 };
      cur.count += 1;
      mixCounts.set(s.service_slug, cur);
    });
  });
  const totalMix = Array.from(mixCounts.values()).reduce((a, b) => a + b.count, 0) || 1;
  const serviceMix = Array.from(mixCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([slug, v], i) => ({
      slug,
      label: v.label,
      pct: Math.round((v.count / totalMix) * 100),
      color: PALETTE[i % PALETTE.length],
    }));

  const byClient = new Map<string, { count: number; tag: string }>();
  orders.forEach((o) => {
    const name = o.client?.razon ?? "—";
    const cur = byClient.get(name) ?? { count: 0, tag: o.client?.tags?.[0] ?? "—" };
    cur.count += 1;
    byClient.set(name, cur);
  });
  const topClients = Array.from(byClient.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, v], i) => ({
      name,
      tag: v.tag,
      orders: v.count,
      pct: orders.length ? Math.round((v.count / orders.length) * 100) : 0,
      color: PALETTE[i % PALETTE.length],
    }));

  // Serie por día de los últimos 30 días para cada depósito
  const days30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (29 - i));
    return d.toISOString().slice(0, 10);
  });

  const series30d = {
    magaldi: days30.map(
      (day) =>
        orders.filter(
          (o) => o.depot === "MAGALDI" && o.date.slice(0, 10) === day
        ).length
    ),
    lujan: days30.map(
      (day) =>
        orders.filter((o) => o.depot === "LUJAN" && o.date.slice(0, 10) === day).length
    ),
  };

  return {
    ordersThisMonth: thisMonth.length,
    ordersDelta,
    hours,
    hoursDelta,
    revenueProjection: revenue,
    revenueDelta,
    signatureRate,
    signatureDelta,
    byDepot: [
      { depot: "MAGALDI", count: magaldiCount },
      { depot: "LUJAN", count: lujanCount },
    ],
    serviceMix,
    topClients,
    series30d,
  };
}

function sanitizeSearch(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&").trim().slice(0, 80);
}

function listOrdersMock(filters: OrderFilters): OrdersResult {
  let rows = MOCK_ORDERS;
  if (filters.status && filters.status !== "todas") {
    rows = rows.filter((o) => o.status === filters.status);
  }
  if (filters.depot && filters.depot !== "todos") {
    rows = rows.filter((o) => o.depot === filters.depot);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(
      (o) =>
        o.public_id.toLowerCase().includes(q) ||
        (o.client?.razon.toLowerCase().includes(q) ?? false) ||
        (o.client?.cuit.includes(q) ?? false)
    );
  }
  const counts: Record<string, number> = {
    todas: MOCK_ORDERS.length,
    FIRMADA: MOCK_ORDERS.filter((o) => o.status === "FIRMADA").length,
    PENDIENTE_FIRMA: MOCK_ORDERS.filter((o) => o.status === "PENDIENTE_FIRMA").length,
    EN_CURSO: MOCK_ORDERS.filter((o) => o.status === "EN_CURSO").length,
    OBSERVADA: MOCK_ORDERS.filter((o) => o.status === "OBSERVADA").length,
  };
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? PAGE_DEFAULT;
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    counts,
  };
}
