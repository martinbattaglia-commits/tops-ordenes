/**
 * Servicio ÚNICO de exclusión de retenciones (reqs. 5 y 6 — Contadora).
 *
 * Centraliza la decisión "¿esta operación queda EXCLUIDA del cálculo de
 * retención?" que hoy estaba dispersa entre el motor de Ganancias
 * (src/lib/compras/retencion-ganancias.ts) y el panel asistente
 * (RetenciongananciasPanel.tsx). Es PURO (sin IO) y reutilizable por
 * cualquier motor fiscal futuro (IVA/IIBB/percepciones).
 *
 * Orden de precedencia (preserva el comportamiento del motor v1.0):
 *   1. Proveedor exento individualmente.
 *   2. Tipo de comprobante ≠ Factura A:
 *        - Factura C (monotributista / régimen simplificado)
 *        - cualquier otro (B, NC, ND, RECIBO, OTRO) = operación no alcanzada.
 *   3. Concepto exento / no alcanzado (servicios públicos, seguros, etc.).
 */

export type CategoriaExclusion =
  | "exento_proveedor"
  | "factura_C"
  | "factura_no_A"
  | "concepto_excluido"
  | "certificado_vigente";

/** Conceptos exentos / no alcanzados por retención de Ganancias (lista base). */
export const CONCEPTOS_EXCLUIDOS = [
  "luz",
  "gas",
  "telefonia",
  "internet",
  "seguros",
] as const;

export interface ExclusionInput {
  /** Tipo de comprobante (ej. FACTURA_A, FACTURA_C, FACTURA_B, NOTA_CREDITO_A…). */
  tipoComprobante: string;
  /** Concepto de la operación (honorarios, servicios, luz, "excluido", …). */
  concepto?: string | null;
  /** El proveedor tiene exención individual (vendors.exento_ganancias). */
  exentoProveedor?: boolean;
}

export interface ExclusionResult {
  excluido: boolean;
  categoria: CategoriaExclusion | null;
  motivo: string;
  confianza: "automatico" | "validar";
}

/** ¿El concepto está exento / no alcanzado por retención? */
export function esConceptoExcluido(concepto?: string | null): boolean {
  if (!concepto) return false;
  return (CONCEPTOS_EXCLUIDOS as readonly string[]).includes(concepto) || concepto === "excluido";
}

/**
 * Decide si la operación queda excluida del cálculo de retención y por qué.
 * No calcula montos: solo la decisión de exclusión, ANTES de cualquier cálculo.
 */
export function evaluarExclusionRetencion(input: ExclusionInput): ExclusionResult {
  const { tipoComprobante, concepto, exentoProveedor } = input;

  // 1. Proveedor exento individualmente (precedencia máxima).
  if (exentoProveedor) {
    return {
      excluido: true,
      categoria: "exento_proveedor",
      confianza: "validar",
      motivo: "Proveedor exento de retención de Ganancias (resolución individual).",
    };
  }

  // 2. Tipo de comprobante distinto de Factura A.
  if (tipoComprobante !== "FACTURA_A") {
    const esC = tipoComprobante === "FACTURA_C";
    return {
      excluido: true,
      categoria: esC ? "factura_C" : "factura_no_A",
      confianza: "automatico",
      motivo: esC
        ? "Factura C (monotributista): no corresponde retención de Ganancias."
        : `${tipoComprobante.replace("_", " ")}: no corresponde retención (solo se practica sobre Factura A).`,
    };
  }

  // 3. Concepto exento / no alcanzado.
  if (esConceptoExcluido(concepto)) {
    return {
      excluido: true,
      categoria: "concepto_excluido",
      confianza: "automatico",
      motivo: "Concepto excluido de retención de Ganancias.",
    };
  }

  return { excluido: false, categoria: null, confianza: "automatico", motivo: "" };
}

/**
 * ¿El certificado de exclusión (vendors.cert_exclusion_hasta) está vigente a la
 * fecha de referencia? Helper compartido por el panel para su alerta/semáforo.
 * No fuerza la exclusión automática (el motor mantiene esa decisión).
 */
export function certificadoVigente(hasta?: string | null, fecha?: string): boolean {
  if (!hasta) return false;
  const venc = new Date(hasta);
  if (Number.isNaN(venc.getTime())) return false;
  const ref = fecha ? new Date(fecha) : new Date();
  return venc.getTime() >= ref.getTime();
}
