/**
 * Capa de servicio ARCA (ex-AFIP) — WSFEv1.
 *
 * Desacoplada del resto de la app: invoicing sólo consume `getArcaService`
 * y la interfaz `IArcaService`. El cambio sandbox↔producción es un switch
 * de ambiente, sin tocar la lógica de emisión.
 */

export * from "./types";
export * from "./qr";
export { getArcaService } from "./service";
export { MockArcaService } from "./mock-service";
export { ProductionArcaService } from "./production-service";
