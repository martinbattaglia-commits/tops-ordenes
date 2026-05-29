/**
 * Data layer del Cockpit ejecutivo — agrega KPIs cross-módulo.
 * En demo mode usa los mocks existentes; en producción consulta
 * vistas materializadas (TODO Fase 2).
 */

import { listPurchaseOrders } from "@/lib/compras/data";
import type { PurchaseOrder } from "@/lib/types-po";
import { LOCATIONS, type LocationStatus } from "./locations";

export type { LocationStatus } from "./locations";
export { LOCATIONS } from "./locations";

export interface CockpitKpi {
  label: string;
  value: string;
  delta?: string;
  trend?: number[];
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
  recentOrders: PurchaseOrder[];
}

export async function getCockpitData(): Promise<CockpitData> {
  const { rows } = await listPurchaseOrders({ pageSize: 6 });

  // Cross-módulo KPIs (en F2: agregar OS, CCTV uptime, ANMAT compliance real)
  const totalM2 = LOCATIONS.reduce((a, l) => a + l.m2, 0);
  const occupied = LOCATIONS.reduce((a, l) => a + (l.m2 * l.occupancyPct) / 100, 0);
  const avgOccupancy = Math.round((occupied / totalM2) * 100);
  const ocMonth = rows.length;

  const kpis: CockpitKpi[] = [
    {
      label: "Ocupación m²",
      value: `${avgOccupancy}%`,
      delta: "+3 pts",
      trend: [62, 65, 70, 72, 78, 82, avgOccupancy],
      featured: true,
    },
    {
      label: "OC firmadas mes",
      value: String(ocMonth),
      delta: "+18%",
      trend: [12, 14, 18, 22, 28, 34, ocMonth],
    },
    {
      label: "OS operativas",
      value: "324",
      delta: "+12%",
      trend: [240, 255, 270, 285, 295, 310, 324],
    },
    {
      label: "ANMAT compliance",
      value: "100%",
      delta: "RNE vigente",
      trend: [98, 99, 100, 100, 100, 100, 100],
    },
  ];

  const activity: ActivityFeedItem[] = [
    {
      ts: "hace 8 min",
      kind: "oc_signed",
      title: "OC-2026-0348 firmada",
      detail: "Distribuidora Norte Office · $ 18.948.600",
      actor: "José Luis Battaglia",
    },
    {
      ts: "hace 14 min",
      kind: "cctv_event",
      title: "Movimiento detectado · Magaldi sector D",
      detail: "Cámara CAM-MAG-04 · acceso autorizado",
      actor: "CCTV / Hikvision",
    },
    {
      ts: "hace 22 min",
      kind: "os_signed",
      title: "OS-201567 firmada por Bidcom",
      detail: "Mariano Stella · 18 pallets recibidos",
      actor: "Bidcom S.A.",
    },
    {
      ts: "hace 38 min",
      kind: "anmat_event",
      title: "Reporte de temperatura cadena de frío",
      detail: "Magaldi · cámara 2 · 4.8°C estable",
      actor: "Sistema ANMAT",
    },
    {
      ts: "hace 1 h",
      kind: "doc_uploaded",
      title: "Contrato ANMAT v2 subido",
      detail: "Cliente Laboratorios Bagó · firmado",
      actor: "Ruth Cardozo",
    },
    {
      ts: "hace 2 h",
      kind: "oc_created",
      title: "OC-2026-0347 creada · Pallets Sur",
      detail: "60 pallets europeos · pendiente firma",
      actor: "Sistema",
    },
  ];

  return {
    kpis,
    locations: LOCATIONS,
    activity,
    recentOrders: rows,
  };
}

