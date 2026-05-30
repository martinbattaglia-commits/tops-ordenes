/**
 * Logging estructurado del subsistema ARCA (FASE E3).
 *
 * REGLA DE SEGURIDAD: jamás registrar material sensible (Token, Sign, clave
 * privada, CMS firmado) en claro. Se loguea metadata de diagnóstico
 * (operación, ambiente, latencia, códigos de error/observación, expiración,
 * longitudes/hashes truncados).
 */

export interface ArcaLogFields {
  op: string;
  ambiente?: string;
  cuit?: string;
  ptoVta?: number;
  cbteTipo?: number;
  ms?: number;
  resultado?: string;
  attempt?: number;
  errorCode?: number | string;
  msg?: string;
  [k: string]: unknown;
}

export interface ArcaLogger {
  info(fields: ArcaLogFields): void;
  warn(fields: ArcaLogFields): void;
  error(fields: ArcaLogFields): void;
}

/** Enmascara un secreto dejando solo longitud + hash corto no reversible. */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return "∅";
  return `len=${value.length}`;
}

function emit(level: "info" | "warn" | "error", fields: ArcaLogFields): void {
  const line = { ts: new Date().toISOString(), level, scope: "arca", ...fields };
  // Salida estructurada en una sola línea (parseable por el colector de logs).
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(line));
}

/** Logger por defecto: consola estructurada. Inyectable para tests/colectores. */
export const consoleArcaLogger: ArcaLogger = {
  info: (f) => emit("info", f),
  warn: (f) => emit("warn", f),
  error: (f) => emit("error", f),
};
