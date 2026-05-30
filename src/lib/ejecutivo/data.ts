/**
 * Data layer del Cockpit ejecutivo — agrega KPIs cross-módulo.
 *
 * QW Fase 1 (2026-05-29):
 *  - Se ELIMINARON los KPIs hardcoded ("OS operativas: 324",
 *    "ANMAT compliance: 100%", deltas/trends ficticios, activity feed mock).
 *  - Solo se muestran KPIs con fuente REAL verificable. Los que aún no tienen
 *    fuente devuelven `value: null` y la UI debe renderizar "Dato no disponible".
 *  - Las trends y deltas se omiten (null) hasta que exista historización real.
 *  - El activity feed queda vacío hasta que exista una tabla `event_log`
 *    cross-módulo (planificado F2).
 *
 * Fuentes reales actualmente disponibles:
 *  - Conteo de OCs → Supabase via `listPurchaseOrders` (compras)
 *  - Conteo de OSs → Supabase via `listOrders` (servicios)
 *
 * Fuentes pendientes de integración real (devuelven null):
 *  - Ocupación m² real-time (requiere sondas IoT o entrada manual)
 *  - ANMAT compliance score (requiere módulo ANMAT real)
 *  - Activity feed cross-módulo (requiere event_log)
 */

import { listPurchaseOrders } from "@/lib/compras/data";
import { listOrders } from "@/lib/data/orders";
import type { PurchaseOrder } from "@/lib/types-po";
import { LOCATIONS, type LocationStatus } from "./locations";

export type { LocationStatus } from "./locations";
export { LOCATIONS } from "./locations";

export interface CockpitKpi {
  label: string;
  /** Valor formateado para mostrar. `null` = "Dato no disponible". */
  value: string | null;
  /** Delta vs período previo. `null` = no hay historización aún. */
  delta?: string | null;
  /** Serie temporal para sparkline. `null` = sin historización. */
  trend?: number[] | null;
  /** Tooltip o nota explicativa cuando value=null. */
  pendingReason?: string;
  featured?: boolean;
}

export interface ActivityFeedItem {
  ts: string;
  kind: "oc_created" | "oc_signed" | "os_signed" | "anmat_event" | "cctv_event" | "doc_uploaded";
  title: string;
  detail: string;
  actor?: string;
}

export interface CockpitData {
  kpis: CockpitKpi[];
  locations: LocationStatus[];
  activity: ActivityFeedItem[];
  activityPendingIntegration: boolean;
  recentOrders: PurchaseOrder[];
}

export async function getCockpitData(): Promise<CockpitData> {
  // -------------------------------------------------------------
  // FUENTES REALES (Supabase)
  // -------------------------------------------------------------
  let recentOrders: PurchaseOrder[] = [];
  let ocTotal: number | null = null;
  let osTotal: number | null = null;

  try {
    const r = await listPurchaseOrders({ pageSize: 6 });
    recentOrders = r.rows;
    ocTotal = r.total;
  } catch {
    // listPurchaseOrders falla → mantener null, UI mostrará "Dato no disponible"
  }

  try {
    const o = await listOrders({ pageSize: 1 });
    osTotal = o.total;
  } catch {
    // idem
  }

  // -------------------------------------------------------------
  // KPIs · sólo valores con fuente real verificable
  // -------------------------------------------------------------
  const kpis: CockpitKpi[] = [
    {
      label: "Órdenes de compra",
      value: ocTotal !== null ? String(ocTotal) : null,
      delta: null,
      trend: null,
      featured: true,
      pendingReason: ocTotal === null ? "Conexión a Supabase no disponible." : undefined,
    },
    {
      label: "Órdenes de servicio",
      value: osTotal !== null ? String(osTotal) : null,
      delta: null,
      trend: null,
      pendingReason: osTotal === null ? "Conexión a Supabase no disponible." : undefined,
    },
    {
      label: "Ocupación m²",
      value: null,
      delta: null,
      trend: null,
      pendingReason: "Pendiente de integración con sondas / entrada operativa real.",
    },
    {
      label: "Compliance ANMAT",
      value: null,
      delta: null,
      trend: null,
      pendingReason: "Pendiente de integración con módulo ANMAT real.",
    },
  ];

  // -------------------------------------------------------------
  // ACTIVITY FEED · sin fuente real todavía → vacío + flag
  // -------------------------------------------------------------
  const activity: ActivityFeedItem[] = [];

  return {
    kpis,
    locations: LOCATIONS,
    activity,
    activityPendingIntegration: true,
    recentOrders,
  };
}
