/**
 * Presidential Command Center — capa de datos del Cockpit Ejecutivo 2.0.
 *
 * Consolida el estado GLOBAL de Logística TOPS para Presidencia:
 *  - Estado de los 9 sistemas (operativo/degradado/offline)
 *  - Salud corporativa (normal/atención/crítico)
 *  - Alertas críticas (solo excepciones; se omiten si no hay)
 *  - KPIs ejecutivos + KPI maestro (Cash Flow proyectado)
 *
 * SOLO LECTURA de otros módulos (env, analytics/executive-data, drive). No los modifica.
 * KPIs sin fuente real → value:null → la UI muestra "Dato no disponible" (filosofía honesta del cockpit).
 */
import { getExecutiveSnapshot } from "@/lib/analytics/executive-data";
import { isDriveConfigured } from "@/lib/drive/client";
import { env } from "@/lib/env";
import { fmtCurrency } from "@/lib/compras/format";
import { listFleet, deriveLiveStatus } from "@/lib/tracking/data";
import { listCamerasSafe } from "@/lib/cctv/hikvision";
import { listInvoices, getFiscalConfig } from "@/lib/invoicing/data";
import { isFiscallyValid } from "@/lib/invoicing/fiscal-validity";
import { signoComprobante } from "@/lib/invoicing/calc";

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

/**
 * Facturación de ventas del mes en curso. null si no hay fuente.
 * H2 (FISCAL-HARDENING): aplica la regla de corte de validez fiscal — solo
 * comprobantes AUTORIZADOS, no anulados y del ambiente vigente; las NC restan.
 */
async function billingThisMonth(): Promise<number | null> {
  try {
    const [inv, config] = await Promise.all([
      listInvoices({ pageSize: 500 }),
      getFiscalConfig(),
    ]);
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    let sum = 0;
    let matched = 0;
    for (const row of inv.rows) {
      if (!isFiscallyValid(row, config.ambiente)) continue;
      const d = new Date(row.created_at);
      if (d.getFullYear() === y && d.getMonth() === m) {
        sum += signoComprobante(row.tipo_comprobante) * Number(row.total ?? 0);
        matched++;
      }
    }
    // Sin facturas válidas en el mes → null (no inventar $0 como "dato real")
    return matched > 0 ? sum : 0;
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
  const [snap, vehiculos, camaras, facturacionMes] = await Promise.all([
    getExecutiveSnapshot(),
    fleetOnline(),
    camerasOnline(),
    billingThisMonth(),
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

  // ---- KPI maestro: Cash Flow proyectado ----
  const master = {
    label: "Cash Flow Proyectado",
    value: snap.financiero.ok ? fmtCurrency(snap.financiero.flujoProyectadoAcumulado) : null,
    pendingReason: snap.financiero.ok ? undefined : "Tesorería no disponible.",
    href: "/tesoreria/flujo-fondos",
  };

  // ---- 8 KPIs ejecutivos (grid 4x2) ----
  const m2 = (n: number) => `${n.toLocaleString("es-AR")} m²`;
  const kpis: ExecKpi[] = [
    {
      label: "Facturación del mes",
      value: facturacionMes !== null ? fmtCurrency(facturacionMes) : null,
      pendingReason: facturacionMes !== null ? undefined : "Facturación no disponible.",
      href: "/billing",
    },
    {
      label: "Cobranza pendiente",
      value: snap.financiero.ok ? fmtCurrency(snap.financiero.porCobrar) : null,
      pendingReason: snap.financiero.ok ? undefined : "Tesorería no disponible.",
      href: "/tesoreria/cobranzas",
    },
    {
      label: "Ocupación logística total",
      value: snap.wms.ok ? m2(snap.wms.ocupadoM2) : null,
      pendingReason: snap.wms.ok ? undefined : "WMS no disponible.",
      href: "/wms",
    },
    {
      label: "Vacancia comercial",
      value: snap.wms.ok ? m2(snap.wms.comercializableM2) : null,
      sub: snap.wms.ok ? `${snap.wms.vacanciaComercialPct}% disponible` : null,
      pendingReason: snap.wms.ok ? undefined : "WMS no disponible.",
      href: "/comercial/dashboard-vacancia",
    },
    {
      label: "Leads activos",
      value: snap.comercial.configured ? String(snap.comercial.leads) : null,
      sub: "Clientify",
      pendingReason: snap.comercial.configured ? undefined : "Clientify no configurado.",
      href: "/comercial/leads",
    },
    {
      label: "Oportunidades abiertas",
      value: snap.comercial.configured ? String(snap.comercial.oportunidades) : null,
      sub: "Pipeline",
      pendingReason: snap.comercial.configured ? undefined : "Clientify no configurado.",
      href: "/comercial/oportunidades",
    },
    {
      label: "Vehículos online",
      value: vehiculos ? `${vehiculos.online}/${vehiculos.total}` : null,
      sub: "Tracking",
      pendingReason: vehiculos ? undefined : "Tracking no disponible.",
      href: "/operaciones/tracking",
    },
    {
      label: "Cámaras online",
      value: camaras ? `${camaras.online}/${camaras.total}` : null,
      sub: "CCTV",
      pendingReason: camaras ? undefined : "NVR no disponible.",
      href: "/cctv",
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
