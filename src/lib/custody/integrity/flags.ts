/**
 * Feature flags del módulo. Todos OFF por defecto, fuera y dentro del sandbox.
 *
 * El entorno entra por parámetro: este módulo no importa `@/lib/env` (archivo
 * compartido) ni lee `process.env` implícitamente, para poder testearse y para
 * no acoplar el dominio a la configuración global.
 *
 * Sólo el literal "1" habilita. Cualquier otra cosa —incluido "true", "on",
 * vacío o ausente— deja el flag apagado. Un flag no debe poder encenderse por
 * accidente tipográfico.
 */

export const CUSTODY_IA_FLAGS = {
  /** UI de recepción/ingreso de activo bajo custodia. */
  ingressUi: "NEXT_PUBLIC_CUSTODY_IA_INGRESS_UI",
  /** Comparación visual asistida por IA. */
  visionCompare: "CUSTODY_IA_VISION_COMPARE",
  /** Enforcement del hold sobre reserva/picking/packing/carga/despacho. */
  holdEnforcement: "CUSTODY_IA_HOLD_ENFORCEMENT",
  /** Verificación pública del certificado (`/cert/[token]`). */
  publicCertificate: "NEXT_PUBLIC_CUSTODY_IA_PUBLIC_CERT",
} as const;

export type CustodyIaFlag = keyof typeof CUSTODY_IA_FLAGS;

export type FlagEnvironment = Readonly<Record<string, string | undefined>>;

/** ¿Está encendido este flag? Default OFF. */
export function isFlagEnabled(flag: CustodyIaFlag, environment: FlagEnvironment): boolean {
  return environment[CUSTODY_IA_FLAGS[flag]] === "1";
}

/** Instantánea de todos los flags, para logs y para el reporte de estado. */
export function readFlags(environment: FlagEnvironment): Record<CustodyIaFlag, boolean> {
  return {
    ingressUi: isFlagEnabled("ingressUi", environment),
    visionCompare: isFlagEnabled("visionCompare", environment),
    holdEnforcement: isFlagEnabled("holdEnforcement", environment),
    publicCertificate: isFlagEnabled("publicCertificate", environment),
  };
}
