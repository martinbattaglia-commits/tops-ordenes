/**
 * Data layer del módulo ANMAT.
 *
 * QW Fase 1 (2026-05-29):
 *  - Se ELIMINARON los datos ficticios de credenciales, temperaturas,
 *    documentos y auditorías que aparecían hardcoded acá.
 *  - Hasta que exista una tabla `anmat_credentials` real + sondas IoT
 *    integradas + flujo de auditorías documental, este módulo queda
 *    como **pendiente de integración**.
 *  - Los arrays siguen exportándose vacíos para que las páginas que los
 *    importen no se rompan, pero la UI debe mostrar el estado pendiente.
 *
 * Cuando se conecte la integración real (Fase 2):
 *  1. Migrar `anmat_credentials`, `anmat_temperatures`, `anmat_audits` a Supabase.
 *  2. Reemplazar estas constantes vacías por funciones async que consulten DB.
 *  3. Conectar el feed de temperatura con las sondas IoT existentes en Magaldi.
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

/**
 * Estado de integración del módulo. Mientras sea `true`, la UI debe
 * mostrar el aviso "Pendiente de integración" y NO presentar los arrays
 * como información regulatoria válida.
 */
export const ANMAT_INTEGRATION_PENDING = true;

export const CREDENTIALS: AnmatCredential[] = [];

export const TEMPERATURES: TempReading[] = [];

export const DOCS: AnmatDoc[] = [];

export const AUDITS: AnmatAudit[] = [];
