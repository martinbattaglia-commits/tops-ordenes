/**
 * Presidential Command Center — capa de datos del Cockpit Ejecutivo 2.0.
 *
 * Consolida el estado GLOBAL de Logística TOPS para Presidencia:
 *  - Estado de los 9 sistemas (operativo/degradado/offline)
 *  - Salud corporativa (normal/atención/crítico)
 *  - Alertas críticas (solo excepciones; se omiten si no hay)
 *  - KPIs ejecutivos + KPI maestro estrictamente operativo
 *
 * SOLO LECTURA de otros módulos (env, analytics/executive-data, drive). No los modifica.
 * KPIs sin fuente real → value:null → la UI muestra "Dato no disponible" (filosofía honesta del cockpit).
 */
import { getExecutiveSnapshot } from "@/lib/analytics/executive-data";
import { isDriveConfigured } from "@/lib/drive/client";
import { env } from "@/lib/env";
import { listFleet, deriveLiveStatus } from "@/lib/tracking/data";
import { listCamerasSafe } from "@/lib/cctv/hikvision";

/** Vehículos online/total desde Tracking (Traccar). null si no hay fuente. */
async function fleetOnline(): Promise<{ online: number; total: number } | null> {
  try {
    const r = await listFleet();
    if (!r.ok) return null;
    const now = Date.now();
    const total = r.vehicles.length;
    const online = r.vehicles.filter((v) => deriveLiveStatus(v.last_position, now) === "online").length;
    return { online, total };
  } catch {
    return null;
  }
}

/** Cámaras online/total desde CCTV (Hikvision NVR). null si no hay fuente. */
async function camerasOnline(): Promise<{ online: number; total: number } | null> {
  try {
    const channels = (await listCamerasSafe()).filter((c) => c.streamType === 1);
    const total = channels.length;
    if (total === 0) return null;
    const online = channels.filter((c) => c.enabled).length;
    return { online, total };
  } catch {
    return null;
  }
}

export type SystemStatus = "operative" | "degraded" | "offline";
export type HealthLevel = "normal" | "atencion" | "critico";

export interface SystemState {
  id: string;
  label: string;
  status: SystemStatus;
  detail: string;
  critical: boolean; // pesa más en la salud corporativa
  href: string; // deep link al módulo relacionado
}

export interface CriticalAlert {
  id: string;
  severity: "warning" | "critical";
  title: string;
  detail: string;
  href: string; // deep link al sistema de origen de la alerta
}

export interface ExecKpi {
  label: string;
  value: string | null;
  sub?: string | null;
  pendingReason?: string;
  href: string; // deep link al módulo que explica la métrica
  /** Color del valor (hex). Da identidad por tarjeta sin romper el tema oscuro. */
  tone?: string;
  /** 0-100 → dibuja una barra de progreso bajo el valor (p. ej. vacancia). */
  progress?: number;
  /** KPI financiero: sólo visible con permiso ejecutivo (cockpit.view). */
  exec?: boolean;
}

export interface CommandCenter {
  systems: SystemState[];
  operativeCount: number;
  totalSystems: number;
  health: HealthLevel;
  headline: string;
  alerts: CriticalAlert[];
  master: { label: string; value: string | null; pendingReason?: string; href: string };
  kpis: ExecKpi[];
  generatedAt: string;
}

export async function getCommandCenter(): Promise<CommandCenter> {
  const [snap, vehiculos, camaras] = await Promise.all([
    getExecutiveSnapshot(),
    fleetOnline(),
    camerasOnline(),
  ]);
  const driveOk = (() => {
    try {
      return isDriveConfigured();
    } catch {
      return false;
    }
  })();
  const dbOk = env.supabase.configured; // sistemas DB-backed dependen de Supabase

  // ---- 9 sistemas (incluye RRHH; el orden no es visual) ----
  const comercialStatus: SystemStatus = snap.comercial.configured
    ? snap.comercial.ok
      ? "operative"
      : "degraded"
    : "offline";

  const systems: SystemState[] = [
    { id: "comercial", label: "Comercial", critical: false, status: comercialStatus, href: "/comercial/pipeline",
      detail: comercialStatus === "operative" ? "Clientify conectado" : comercialStatus === "degraded" ? "Clientify configurado, API con error" : "Clientify no configurado" },
    { id: "compras", label: "Compras", critical: false, status: snap.compras.ok ? "operative" : "offline", href: "/compras",
      detail: snap.compras.ok ? "OC y facturas operativas" : "Sin conexión a datos" },
    { id: "operaciones", label: "Operaciones", critical: false, status: snap.operaciones.ok ? "operative" : "offline", href: "/dashboard",
      detail: snap.operaciones.ok ? `${snap.operaciones.total} órdenes` : "Sin conexión a datos" },
    { id: "finanzas", label: "Finanzas", critical: true, status: snap.financiero.ok ? "operative" : "offline", href: "/tesoreria",
      detail: snap.financiero.ok ? "Tesorería operativa" : "Sin conexión a Tesorería" },
    { id: "compliance", label: "Compliance ANMAT", critical: true, status: dbOk ? "operative" : "offline", href: "/anmat",
      detail: dbOk ? "Base regulatoria operativa" : "Base no disponible" },
    { id: "tracking", label: "Tracking", critical: false, status: env.tracking.configured ? "operative" : "offline", href: "/operaciones/tracking",
      detail: env.tracking.configured ? "Ingesta Traccar habilitada" : "Ingesta no configurada" },
    { id: "cctv", label: "CCTV", critical: false, status: env.hikvision.configured ? "operative" : "offline", href: "/cctv",
      detail: env.hikvision.configured ? "NVR Hikvision configurado" : "NVR no configurado" },
    { id: "drive", label: "Drive Corporativo", critical: false, status: driveOk ? "operative" : "offline", href: "/drive",
      detail: driveOk ? "Google Drive conectado" : "Drive no configurado" },
    { id: "rrhh", label: "RRHH", critical: false, status: dbOk ? "operative" : "offline", href: "/rrhh",
      detail: dbOk ? "Módulo RRHH operativo" : "Base no disponible" },
  ];

  const totalSystems = systems.length;
  const offline = systems.filter((s) => s.status !== "operative");
  const operativeCount = totalSystems - offline.length;
  const criticalDown = offline.filter((s) => s.critical).length;

  let health: HealthLevel;
  if (offline.length === 0) health = "normal";
  else if (criticalDown > 0 || offline.length >= 2) health = "critico";
  else health = "atencion";

  const headline =
    health === "normal"
      ? "OPERACIÓN NORMAL"
      : health === "atencion"
        ? "OPERACIÓN DEGRADADA"
        : "OPERACIÓN CRÍTICA";

  // ---- Alertas críticas (solo excepciones; vacío si todo operativo) ----
  const alerts: CriticalAlert[] = offline.map((s) => ({
    id: s.id,
    severity: s.critical ? "critical" : "warning",
    title: `${s.label} ${s.status === "degraded" ? "degradado" : "offline"}`,
    detail: s.detail,
    href: s.href,
  }));

  // ---- KPI maestro: salud operativa (sin exposición monetaria) ----
  const master = {
    label: "Sistemas operativos",
    value: `${operativeCount}/${totalSystems}`,
    pendingReason: undefined,
    href: "/ejecutivo",
  };

  // ---- 8 KPIs ejecutivos (grilla 4×2) ----
  // FILA 1: financieros (gated a ejecutivo vía `exec`) + operativos en vivo.
  // FILA 2: ocupación logística (capacidad / disponible / ocupado / vacancia).
  // `tone` da color por tarjeta; `progress` dibuja la barra (vacancia). Verdes
  // y rojo alineados con el dashboard de vacancia (#16a34a / #dc2626).
  const m2 = (n: number) => `${n.toLocaleString("es-AR")} m²`;
  const kpis: ExecKpi[] = [
    // ── Fila 1 — Rendimiento y Operaciones ──
    {
      label: "Órdenes en curso",
      value: snap.operaciones.ok ? `${snap.operaciones.abiertas}` : null,
      sub: snap.operaciones.ok ? `${snap.operaciones.cerradas} completadas` : null,
      pendingReason: snap.operaciones.ok ? undefined : "Operaciones no disponible.",
      href: "/dashboard",
      tone: "#3b82f6",
    },
    {
      label: "Servicios operativos",
      value: snap.operaciones.ok ? `${snap.operaciones.total}` : null,
      sub: "Logística TOPS",
      pendingReason: snap.operaciones.ok ? undefined : "Operaciones no disponible.",
      href: "/dashboard",
      tone: "#16a34a",
    },
    {
      label: "Vehículos online",
      value: vehiculos ? `${vehiculos.online}/${vehiculos.total}` : null,
      sub: "Tracking",
      pendingReason: vehiculos ? undefined : "Tracking no disponible.",
      href: "/operaciones/tracking",
      tone: "#3b82f6",
    },
    {
      label: "Cámaras online",
      value: camaras ? `${camaras.online}/${camaras.total}` : null,
      sub: "CCTV",
      pendingReason: camaras ? undefined : "NVR no disponible.",
      href: "/cctv",
      tone: "#06b6d4",
    },
    // ── Fila 2 — Ocupación logística ──
    {
      label: "Capacidad comercializable",
      value: snap.wms.ok ? m2(snap.wms.comercializableM2) : null,
      pendingReason: snap.wms.ok ? undefined : "WMS no disponible.",
      href: "/comercial/dashboard-vacancia",
    },
    {
      label: "Ocupado",
      value: snap.wms.ok ? m2(snap.wms.ocupadoM2) : null,
      pendingReason: snap.wms.ok ? undefined : "WMS no disponible.",
      href: "/wms",
      tone: "#dc2626",
    },
    {
      label: "Disponible",
      value: snap.wms.ok ? m2(snap.wms.disponibleM2) : null,
      pendingReason: snap.wms.ok ? undefined : "WMS no disponible.",
      href: "/comercial/dashboard-vacancia",
      tone: "#16a34a",
    },
    {
      label: "Vacancia corporativa",
      value: snap.wms.ok ? `${snap.wms.vacanciaComercialPct}%` : null,
      sub: snap.wms.ok ? `${m2(snap.wms.disponibleM2)} libres` : null,
      pendingReason: snap.wms.ok ? undefined : "WMS no disponible.",
      href: "/comercial/dashboard-vacancia",
      tone: "#16a34a",
      progress: snap.wms.vacanciaComercialPct,
    },
  ];

  return {
    systems,
    operativeCount,
    totalSystems,
    health,
    headline,
    alerts,
    master,
    kpis,
    generatedAt: snap.generatedAt,
  };
}
