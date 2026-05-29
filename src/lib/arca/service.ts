/**
 * Factory del servicio ARCA: elige Mock o Producción según el ambiente.
 *
 * El ambiente proviene de `fiscal_config.ambiente` (administrable desde el
 * panel) — se pasa explícito para no acoplar esta capa a la DB. SANDBOX usa
 * el Mock; HOMOLOGACION/PRODUCCION usan el cliente real (hoy stub).
 */

import type { IArcaService, ArcaEmisor } from "./types";
import { MockArcaService } from "./mock-service";
import { ProductionArcaService } from "./production-service";

export function getArcaService(
  ambiente: ArcaEmisor["ambiente"]
): IArcaService {
  switch (ambiente) {
    case "PRODUCCION":
    case "HOMOLOGACION":
      return new ProductionArcaService(ambiente);
    case "SANDBOX":
    default:
      return new MockArcaService();
  }
}
