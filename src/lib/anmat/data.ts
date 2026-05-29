/**
 * Mock data del módulo ANMAT.
 * En F2 se conecta con el módulo de cumplimiento real (vencimientos en
 * tabla `anmat_credentials` + sondas IoT de temperatura).
 */

export interface AnmatCredential {
  id: string;
  type: "RNE" | "Habilitación" | "Certificado" | "Auditoría";
  number: string;
  holder: string;
  status: "vigente" | "por_vencer" | "vencido";
  issuedAt: string;
  expiresAt: string;
  daysToExpiry: number;
}

export interface TempReading {
  zoneId: string;
  zone: string;
  location: string;
  currentC: number;
  minC: number;
  maxC: number;
  setpointMin: number;
  setpointMax: number;
  status: "ok" | "warn" | "alarm";
  lastUpdate: string;
  trend: number[];
}

export interface AnmatDoc {
  id: string;
  title: string;
  type: "Contrato" | "Habilitación" | "Auditoría" | "Procedimiento" | "Capacitación";
  client?: string;
  uploadedAt: string;
  size: string;
  hash: string;
}

export interface AnmatAudit {
  id: string;
  date: string;
  auditor: string;
  scope: string;
  result: "Aprobada" | "Aprobada con observaciones" | "Pendiente";
  observations: number;
}

export const CREDENTIALS: AnmatCredential[] = [
  {
    id: "rne-001",
    type: "RNE",
    number: "RNE 2-051-00427",
    holder: "Verotin S.A.",
    status: "vigente",
    issuedAt: "2023-08-14",
    expiresAt: "2028-08-14",
    daysToExpiry: 832,
  },
  {
    id: "hab-mag",
    type: "Habilitación",
    number: "DISP. ANMAT 4521/22",
    holder: "Depósito Magaldi · CABA",
    status: "vigente",
    issuedAt: "2022-04-10",
    expiresAt: "2027-04-10",
    daysToExpiry: 685,
  },
  {
    id: "hab-bar",
    type: "Habilitación",
    number: "DISP. ANMAT 6890/23",
    holder: "Depósito Barracas · CABA",
    status: "vigente",
    issuedAt: "2023-11-22",
    expiresAt: "2028-11-22",
    daysToExpiry: 932,
  },
  {
    id: "cert-frio",
    type: "Certificado",
    number: "Calibración sondas 2026-I",
    holder: "Cadena de frío Magaldi",
    status: "por_vencer",
    issuedAt: "2025-08-01",
    expiresAt: "2026-08-01",
    daysToExpiry: 67,
  },
  {
    id: "cert-dt",
    type: "Certificado",
    number: "DT habilitado · matrícula 9821",
    holder: "Lic. María Inés Cardozo",
    status: "vigente",
    issuedAt: "2024-02-15",
    expiresAt: "2029-02-15",
    daysToExpiry: 1023,
  },
];

export const TEMPERATURES: TempReading[] = [
  {
    zoneId: "mag-cf1",
    zone: "Cámara fría 1",
    location: "Magaldi",
    currentC: 4.8,
    minC: 4.2,
    maxC: 5.1,
    setpointMin: 2,
    setpointMax: 8,
    status: "ok",
    lastUpdate: "hace 2 min",
    trend: [4.6, 4.7, 4.5, 4.8, 4.9, 4.7, 4.8],
  },
  {
    zoneId: "mag-cf2",
    zone: "Cámara fría 2",
    location: "Magaldi",
    currentC: 5.3,
    minC: 4.8,
    maxC: 5.5,
    setpointMin: 2,
    setpointMax: 8,
    status: "ok",
    lastUpdate: "hace 2 min",
    trend: [5.1, 5.2, 5.3, 5.4, 5.3, 5.2, 5.3],
  },
  {
    zoneId: "mag-amb",
    zone: "Ambiente controlado",
    location: "Magaldi",
    currentC: 22.4,
    minC: 21.8,
    maxC: 23.1,
    setpointMin: 18,
    setpointMax: 25,
    status: "ok",
    lastUpdate: "hace 3 min",
    trend: [22.1, 22.3, 22.5, 22.4, 22.2, 22.3, 22.4],
  },
  {
    zoneId: "bar-cf1",
    zone: "Cámara fría 1",
    location: "Barracas",
    currentC: 7.8,
    minC: 6.9,
    maxC: 8.1,
    setpointMin: 2,
    setpointMax: 8,
    status: "warn",
    lastUpdate: "hace 1 min",
    trend: [6.4, 6.8, 7.2, 7.5, 7.8, 7.9, 7.8],
  },
];

export const DOCS: AnmatDoc[] = [
  {
    id: "doc-001",
    title: "Contrato almacenaje ANMAT — Laboratorios Bagó",
    type: "Contrato",
    client: "Laboratorios Bagó",
    uploadedAt: "2026-05-16",
    size: "501 KB",
    hash: "a3f29c4b1e8a92...",
  },
  {
    id: "doc-002",
    title: "Procedimiento operativo cadena de frío",
    type: "Procedimiento",
    uploadedAt: "2026-04-22",
    size: "248 KB",
    hash: "7d2e91a4b6c8f3...",
  },
  {
    id: "doc-003",
    title: "Auditoría interna Q1 2026 — Magaldi",
    type: "Auditoría",
    uploadedAt: "2026-04-08",
    size: "1.2 MB",
    hash: "9f4a2c7e1b5d8a...",
  },
  {
    id: "doc-004",
    title: "Certificado calibración sondas 2026",
    type: "Habilitación",
    uploadedAt: "2026-02-14",
    size: "186 KB",
    hash: "3e8c1d6f2a9b4e...",
  },
  {
    id: "doc-005",
    title: "Capacitación BPM y trazabilidad Q4",
    type: "Capacitación",
    uploadedAt: "2025-12-12",
    size: "892 KB",
    hash: "5b9d3f1a7c4e8b...",
  },
];

export const AUDITS: AnmatAudit[] = [
  {
    id: "aud-q2-2026",
    date: "2026-04-12",
    auditor: "Auditoría interna",
    scope: "Magaldi · sector ANMAT",
    result: "Aprobada",
    observations: 0,
  },
  {
    id: "aud-anmat-2026",
    date: "2026-02-28",
    auditor: "Inspección ANMAT",
    scope: "Depósito Magaldi · RNE",
    result: "Aprobada",
    observations: 0,
  },
  {
    id: "aud-q4-2025",
    date: "2025-11-15",
    auditor: "Auditoría interna",
    scope: "Barracas · cadena de frío",
    result: "Aprobada con observaciones",
    observations: 2,
  },
  {
    id: "aud-q3-2025",
    date: "2025-08-22",
    auditor: "Cliente Bagó",
    scope: "Visita de cliente · Magaldi",
    result: "Aprobada",
    observations: 0,
  },
];
