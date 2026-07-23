/**
 * Decisión MiPyME / Factura de Crédito Electrónica (FCE) — req. 3 (Contadora).
 *
 * Función PURA: no consulta ARCA ni DB. Recibe el estado ya resuelto
 * (emisor MiPyME, cliente en Registro MiPyME, monto, mínimo, validación activa)
 * y decide si corresponde emitir FCE MiPyME. La obtención del estado del cliente
 * (manual o vía padrón ARCA) está detrás del puerto `MiPyMEPadronProvider`.
 */

export interface MiPyMEDecisionInput {
  /** Validación FCE activa (mipyme_config.activo). Seguro por defecto: false. */
  activo: boolean;
  /** El emisor (VEROTIN) es MiPyME habilitado a emitir FCE. */
  emisorEsMiPyme: boolean;
  /** El cliente está inscripto en el Registro MiPyME. */
  clienteEsMiPyme: boolean;
  /** Importe total del comprobante. */
  montoTotal: number;
  /** Monto mínimo a partir del cual la FCE es obligatoria (mipyme_config.monto_minimo). */
  montoMinimo: number;
}

export interface MiPyMEDecision {
  corresponde: boolean;
  motivo: string;
  comprobanteSugerido: "FCE_MIPYME" | null;
}

/** ¿Corresponde emitir Factura de Crédito Electrónica MiPyME? */
export function evaluarMiPyME(input: MiPyMEDecisionInput): MiPyMEDecision {
  const { activo, emisorEsMiPyme, clienteEsMiPyme, montoTotal, montoMinimo } = input;

  if (!activo) {
    return { corresponde: false, comprobanteSugerido: null, motivo: "Validación MiPyME desactivada." };
  }
  if (!emisorEsMiPyme) {
    return { corresponde: false, comprobanteSugerido: null, motivo: "El emisor no está registrado como MiPyME." };
  }
  if (!clienteEsMiPyme) {
    return { corresponde: false, comprobanteSugerido: null, motivo: "El cliente no pertenece al Registro MiPyME." };
  }
  if (montoTotal < montoMinimo) {
    return {
      corresponde: false,
      comprobanteSugerido: null,
      motivo: `El importe (${montoTotal}) no supera el mínimo MiPyME (${montoMinimo}).`,
    };
  }
  return {
    corresponde: true,
    comprobanteSugerido: "FCE_MIPYME",
    motivo: "Cliente en Registro MiPyME e importe sobre el mínimo: corresponde Factura de Crédito Electrónica MiPyME.",
  };
}

export interface MiPyMEGuardInput extends MiPyMEDecisionInput {
  /** El comprobante que se intenta emitir ya pertenece a la familia FCE MiPyME. */
  esComprobanteFCE: boolean;
}

export interface MiPyMEGuardResult {
  /** True ⇒ impedir la emisión de comprobante común. */
  bloquear: boolean;
  motivo: string;
  decision: MiPyMEDecision;
}

/**
 * Guard de pre-emisión: si corresponde FCE y se intenta emitir un comprobante
 * común (no FCE), bloquea con un mensaje claro indicando el motivo.
 */
export function evaluarMiPyMEParaEmision(input: MiPyMEGuardInput): MiPyMEGuardResult {
  const decision = evaluarMiPyME(input);
  if (decision.corresponde && !input.esComprobanteFCE) {
    return {
      bloquear: true,
      decision,
      motivo:
        "Este cliente pertenece al Registro MiPyME y el importe supera el mínimo: " +
        "corresponde emitir Factura de Crédito Electrónica MiPyME (FCE), no un comprobante común.",
    };
  }
  return { bloquear: false, decision, motivo: decision.motivo };
}
