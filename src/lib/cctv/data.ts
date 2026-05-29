/**
 * Mock data del módulo CCTV (Hikvision integration placeholder).
 * En F2 se reemplaza por consultas reales al NVR vía RTSP/ONVIF + snapshots.
 */

export type CameraStatus = "online" | "offline" | "alert";
export type CameraType = "domo-4k" | "fixed-fhd" | "ptz-4k" | "thermal";

export interface Camera {
  id: string;
  name: string;
  location: string;
  sector: string;
  type: CameraType;
  status: CameraStatus;
  resolution: string;
  fps: number;
  recording: boolean;
  lastEventTs?: string;
  lastEventKind?: "motion" | "access" | "alarm" | "temp";
}

export interface CctvEvent {
  ts: string;
  cameraId: string;
  cameraName: string;
  kind: "motion" | "access" | "alarm" | "temp";
  detail: string;
  severity: "info" | "warn" | "danger";
}

export const CAMERAS: Camera[] = [
  {
    id: "MAG-01",
    name: "Acceso principal",
    location: "Magaldi",
    sector: "Recepción",
    type: "domo-4k",
    status: "online",
    resolution: "3840x2160",
    fps: 30,
    recording: true,
    lastEventTs: "hace 3 min",
    lastEventKind: "access",
  },
  {
    id: "MAG-02",
    name: "Muelle de carga 1",
    location: "Magaldi",
    sector: "Expedición",
    type: "ptz-4k",
    status: "online",
    resolution: "3840x2160",
    fps: 30,
    recording: true,
    lastEventTs: "hace 8 min",
    lastEventKind: "motion",
  },
  {
    id: "MAG-03",
    name: "Sector ANMAT pasillo A",
    location: "Magaldi",
    sector: "ANMAT",
    type: "domo-4k",
    status: "online",
    resolution: "3840x2160",
    fps: 25,
    recording: true,
  },
  {
    id: "MAG-04",
    name: "Sector ANMAT pasillo B",
    location: "Magaldi",
    sector: "ANMAT",
    type: "domo-4k",
    status: "online",
    resolution: "3840x2160",
    fps: 25,
    recording: true,
    lastEventTs: "hace 14 min",
    lastEventKind: "motion",
  },
  {
    id: "MAG-05",
    name: "Cámara fría sector 2",
    location: "Magaldi",
    sector: "Cadena de frío",
    type: "thermal",
    status: "online",
    resolution: "1920x1080",
    fps: 25,
    recording: true,
  },
  {
    id: "MAG-06",
    name: "Perímetro norte",
    location: "Magaldi",
    sector: "Perímetro",
    type: "fixed-fhd",
    status: "online",
    resolution: "1920x1080",
    fps: 25,
    recording: true,
  },
  {
    id: "BAR-01",
    name: "Acceso principal",
    location: "Barracas",
    sector: "Recepción",
    type: "domo-4k",
    status: "online",
    resolution: "3840x2160",
    fps: 30,
    recording: true,
  },
  {
    id: "BAR-02",
    name: "Estanterías generales",
    location: "Barracas",
    sector: "General",
    type: "fixed-fhd",
    status: "online",
    resolution: "1920x1080",
    fps: 25,
    recording: true,
  },
  {
    id: "BAR-03",
    name: "Muelle de carga",
    location: "Barracas",
    sector: "Expedición",
    type: "ptz-4k",
    status: "alert",
    resolution: "3840x2160",
    fps: 30,
    recording: true,
    lastEventTs: "hace 1 min",
    lastEventKind: "motion",
  },
  {
    id: "LUJ-01",
    name: "Acceso playa de camiones",
    location: "Luján",
    sector: "Distribución",
    type: "ptz-4k",
    status: "online",
    resolution: "3840x2160",
    fps: 30,
    recording: true,
  },
  {
    id: "LUJ-02",
    name: "Perímetro este",
    location: "Luján",
    sector: "Perímetro",
    type: "thermal",
    status: "online",
    resolution: "1920x1080",
    fps: 25,
    recording: true,
  },
  {
    id: "LUJ-03",
    name: "Galpón principal",
    location: "Luján",
    sector: "General",
    type: "fixed-fhd",
    status: "offline",
    resolution: "1920x1080",
    fps: 25,
    recording: false,
    lastEventTs: "hace 42 min",
    lastEventKind: "alarm",
  },
];

/**
 * QW Fase 1 (2026-05-29):
 *  - El feed de eventos en vivo era 100% hardcoded (6 eventos ficticios).
 *  - Se vació hasta que exista integración real con eventos del NVR vía
 *    ISAPI Subscribe Event API o tabla `cctv_events` en Supabase.
 *  - El array `CAMERAS` (configuración estática de cámaras mock) tampoco
 *    se usa en la UI: la página de /cctv consume `listCamerasSafe()` real
 *    de `src/lib/cctv/hikvision.ts`. Se mantiene aquí únicamente para
 *    compatibilidad de tipos hasta que se borre en una iteración futura.
 */
export const EVENTS: CctvEvent[] = [];

export function getCameraStats() {
  const total = CAMERAS.length;
  const online = CAMERAS.filter((c) => c.status === "online").length;
  const recording = CAMERAS.filter((c) => c.recording).length;
  const alerts = CAMERAS.filter((c) => c.status === "alert").length;
  const offline = CAMERAS.filter((c) => c.status === "offline").length;
  return {
    total,
    online,
    recording,
    alerts,
    offline,
    uptime: total ? Math.round((online / total) * 1000) / 10 : 0,
  };
}
