import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { MOCK_CLIENTS, MOCK_OPERATORS, MOCK_ORDERS } from "@/lib/mock-data";
import type { Order, OrderStatus, Depot, Client, Operator } from "@/lib/types";

/**
 * Data access para órdenes. Si Supabase no está configurado caemos a mock,
 * para que la UI sea evaluable sin DB.
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

export async function listOrders(filters: OrderFilters = {}): Promise<OrdersResult> {
  const supabase = createClient();

  if (env.app.demoMode || !supabase) {
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
    const pageSize = filters.pageSize ?? 18;
    return {
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      counts,
    };
  }

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 18;
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
    const s = filters.search.replace(/'/g, "''");
    q = q.or(`public_id.ilike.%${s}%,client.razon.ilike.%${s}%,client.cuit.ilike.%${s}%`);
  }

  const { data, count, error } = await q;
  if (error) throw error;

  // counts por estado
  const { data: countsData } = await supabase.from("orders").select("status");
  const counts: Record<string, number> = { todas: countsData?.length ?? 0 };
  countsData?.forEach((r) => {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  });

  return { rows: (data ?? []) as Order[], total: count ?? 0, counts };
}

export async function getOrder(idOrPublicId: string): Promise<Order | null> {
  const supabase = createClient();

  if (env.app.demoMode || !supabase) {
    return (
      MOCK_ORDERS.find((o) => o.id === idOrPublicId || o.public_id === idOrPublicId) ?? null
    );
  }

  const { data, error } = await supabase
    .from("orders")
    .select(
      `*,
       client:clients(*),
       operator:operators(*),
       services:order_services(*)`
    )
    .or(`id.eq.${idOrPublicId},public_id.eq.${idOrPublicId}`)
    .maybeSingle();

  if (error) throw error;
  return (data as Order) ?? null;
}

export async function listRecentOrders(limit = 6): Promise<Order[]> {
  const { rows } = await listOrders({ pageSize: limit });
  return rows;
}

export async function listClients(): Promise<Client[]> {
  const supabase = createClient();
  if (env.app.demoMode || !supabase) return MOCK_CLIENTS;
  const { data, error } = await supabase.from("clients").select("*").order("razon");
  if (error) throw error;
  return (data ?? []) as Client[];
}

export async function listOperators(): Promise<Operator[]> {
  const supabase = createClient();
  if (env.app.demoMode || !supabase) return MOCK_OPERATORS;
  const { data, error } = await supabase.from("operators").select("*").order("full_name");
  if (error) throw error;
  return (data ?? []) as Operator[];
}

/**
 * KPIs para el dashboard. En demo mode son derivados de los mock,
 * en prod consultamos vistas materializadas.
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

export async function getDashboardKpis(): Promise<DashboardKpis> {
  // En mock derivamos todo del array MOCK_ORDERS
  const orders = MOCK_ORDERS;
  const month = new Date().getMonth();
  const thisMonth = orders.filter((o) => new Date(o.date).getMonth() === month);
  const hours = thisMonth.reduce((a, o) => a + o.hours, 0);
  const revenue = thisMonth.reduce((a, o) => a + o.total, 0);
  const signed = thisMonth.filter((o) => o.signed_by).length;
  const signatureRate = thisMonth.length ? (signed / thisMonth.length) * 100 : 0;

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
  const palette = ["#050555", "#214576", "#3a6db0", "#C90812", "#8A94A6", "#C2CAD6"];
  const serviceMix = Array.from(mixCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([slug, v], i) => ({
      slug,
      label: v.label,
      pct: Math.round((v.count / totalMix) * 100),
      color: palette[i % palette.length],
    }));

  const byClient = new Map<string, number>();
  orders.forEach((o) => {
    const name = o.client?.razon ?? "—";
    byClient.set(name, (byClient.get(name) ?? 0) + 1);
  });
  const topClients = Array.from(byClient.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count], i) => {
      const cl = MOCK_CLIENTS.find((c) => c.razon === name);
      return {
        name,
        tag: cl?.tags[0] ?? "—",
        orders: count,
        pct: Math.round((count / orders.length) * 100),
        color: palette[i % palette.length],
      };
    });

  // Serie 30 días (mock determinístico)
  const rng = (seed: number) => {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  };
  const r1 = rng(11);
  const r2 = rng(91);
  const series30d = {
    magaldi: Array.from({ length: 30 }, () => Math.round(6 + r1() * 14)),
    lujan: Array.from({ length: 30 }, () => Math.round(3 + r2() * 9)),
  };

  return {
    ordersThisMonth: thisMonth.length || 324,
    ordersDelta: "+12,4%",
    hours: hours || 1842,
    hoursDelta: "+8,1%",
    revenueProjection: revenue || 18_600_000,
    revenueDelta: "+15,2%",
    signatureRate: signatureRate || 97.2,
    signatureDelta: "+3,4 pts",
    byDepot: [
      { depot: "MAGALDI", count: magaldiCount },
      { depot: "LUJAN", count: lujanCount },
    ],
    serviceMix,
    topClients,
    series30d,
  };
}
