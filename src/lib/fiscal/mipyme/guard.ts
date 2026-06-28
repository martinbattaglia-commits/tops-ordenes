import { getMiPyMEConfig, getClientMiPyMEStatus } from "./data";
import { evaluarMiPyMEParaEmision } from "./decision";

/**
 * Guard de pre-emisión MiPyME (req. 3). Combina configuración + estado del
 * cliente y decide si hay que BLOQUEAR la emisión de un comprobante común
 * porque corresponde Factura de Crédito Electrónica MiPyME (FCE).
 *
 * Seguro por defecto: si la validación está desactivada o el emisor no es
 * MiPyME, no consulta al cliente ni bloquea. Pensado para ser llamado por las
 * server actions de emisión ANTES de solicitar el CAE.
 */
export interface PreEmisionInput {
  clientId: string | null;
  montoTotal: number;
  /** El comprobante solicitado ya es FCE (familia 20x). Por defecto false. */
  esComprobanteFCE?: boolean;
}

export interface PreEmisionResult {
  bloquear: boolean;
  corresponde: boolean;
  motivo: string;
}

export async function chequearMiPyMEPreEmision(input: PreEmisionInput): Promise<PreEmisionResult> {
  const cfg = await getMiPyMEConfig();
  // Short-circuit: validación apagada o emisor no-MiPyME ⇒ nunca bloquea.
  if (!cfg.activo || !cfg.emisorEsMiPyme) {
    return { bloquear: false, corresponde: false, motivo: "Validación MiPyME desactivada." };
  }
  const status = await getClientMiPyMEStatus(input.clientId);
  const g = evaluarMiPyMEParaEmision({
    activo: cfg.activo,
    emisorEsMiPyme: cfg.emisorEsMiPyme,
    clienteEsMiPyme: status.esMiPyme,
    montoTotal: input.montoTotal,
    montoMinimo: cfg.montoMinimo,
    esComprobanteFCE: input.esComprobanteFCE ?? false,
  });
  return { bloquear: g.bloquear, corresponde: g.decision.corresponde, motivo: g.motivo };
}
