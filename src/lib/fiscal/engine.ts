/**
 * Framework Fiscal Genérico — Nexus
 *
 * Define las interfaces base para motores de retención y percepción.
 * Actualmente implementado: Ganancias (RG 2784 y concordantes).
 * Preparado para: IVA (RG 2408), Ingresos Brutos (por jurisdicción),
 * Percepciones, y otros regímenes.
 *
 * Patrón de extensión:
 *   1. Crear `src/lib/fiscal/<impuesto>/engine.ts` que implemente `FiscalEngine`
 *   2. Crear la migración de tablas (`<impuesto>_params`, `<impuesto>_retenciones`, etc.)
 *   3. Crear el RPC `ap_get_<impuesto>_context` en Supabase
 *   4. Crear `src/app/(app)/compras/facturas/nueva/<impuesto>-actions.ts`
 *   5. Reutilizar `<ImpostoPanel>` usando el mismo layout de "Asistente Fiscal"
 */

// ─── Semáforo unificado ───────────────────────────────────────

/** Estado visual del panel fiscal */
export type EstadoSemaforo = "ok" | "warn" | "revision";

/** Nivel de confianza en el resultado */
export type NivelConfianza = "automatico" | "validar";

// ─── Interfaces base ──────────────────────────────────────────

/** Parámetros mínimos que todo motor fiscal debe aceptar */
export interface FiscalBaseParams {
  tipoComprobante:  string;
  netoGravado:      number;
  acumuladoPrevio:  number;
  totalFactura?:    number;
  normativaVersion: string;
}

/** Resultado mínimo que todo motor fiscal debe producir */
export interface FiscalBaseResult {
  tipoComprobante:  string;
  netoGravado:      number;
  acumuladoPrevio:  number;
  acumuladoTotal:   number;
  totalFactura:     number;
  basePago:         number;
  baseImponible:    number;
  retencion:        number;
  netoPagar:        number;
  corresponde:      boolean;
  estado:           EstadoSemaforo;
  confianza:        NivelConfianza;
  motivo:           string;
  resumenEjecutivo: string;
  normativaVersion: string;
}

/** Contrato de un motor fiscal calculador */
export interface FiscalEngine<TParams extends FiscalBaseParams, TResult extends FiscalBaseResult> {
  impuesto: string;
  calcular: (params: TParams) => TResult;
}

// ─── Contexto de proveedor fiscal ────────────────────────────

/** Info fiscal del proveedor común a todos los regímenes */
export interface VendorFiscalBase {
  id:               string;
  razon:            string;
  cuit:             string;
  cond_iva:         string | null;
}

// ─── Registro de motores activos ─────────────────────────────
// Cuando se agregue un nuevo impuesto, registrarlo aquí para
// que el "Asistente Fiscal" pueda detectar y mostrar todos los
// motores aplicables a una factura de forma automática.

export const IMPUESTOS_REGISTRADOS = [
  "ganancias",
  // "iva",            // pendiente
  // "iibb_caba",      // pendiente
  // "iibb_pba",       // pendiente
  // "percepciones",   // pendiente
] as const;

export type Impuesto = typeof IMPUESTOS_REGISTRADOS[number];

// ─── Helpers compartidos ─────────────────────────────────────

export function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatPesosAR(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS",
  }).format(n);
}
