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

export const EVENTS: CctvEvent[] = [
  {
    ts: "hace 1 min",
    cameraId: "BAR-03",
    cameraName: "Barracas · Muelle de carga",
    kind: "motion",
    detail: "Movimiento detectado en zona restringida fuera de horario",
    severity: "warn",
  },
  {
    ts: "hace 3 min",
    cameraId: "MAG-01",
    cameraName: "Magaldi · Acceso principal",
    kind: "access",
    detail: "Acceso autorizado · Juan Carlos (encargado)",
    severity: "info",
  },
  {
    ts: "hace 8 min",
    cameraId: "MAG-02",
    cameraName: "Magaldi · Muelle de carga 1",
    kind: "motion",
    detail: "Operación de carga programada · OC-2026-0348",
    severity: "info",
  },
  {
    ts: "hace 14 min",
    cameraId: "MAG-04",
    cameraName: "Magaldi · ANMAT pasillo B",
    kind: "motion",
    detail: "Picking pallet 3-A · operario autorizado",
    severity: "info",
  },
  {
    ts: "hace 22 min",
    cameraId: "MAG-05",
    cameraName: "Magaldi · Cadena de frío",
    kind: "temp",
    detail: "Temperatura estable a 4.8°C · dentro de rango ANMAT",
    severity: "info",
  },
  {
    ts: "hace 42 min",
    cameraId: "LUJ-03",
    cameraName: "Luján · Galpón principal",
    kind: "alarm",
    detail: "Cámara offline · pérdida de señal · ticket abierto",
    severity: "danger",
  },
];

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
