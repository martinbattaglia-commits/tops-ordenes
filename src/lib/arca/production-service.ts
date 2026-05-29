/**
 * Cliente ARCA de producción (WSFEv1 sobre SOAP + WSAA).
 *
 * STUB intencional: la conexión real requiere certificado X.509 + clave
 * privada para autenticar contra WSAA (genera Token+Sign válido ~12h) y luego
 * invocar WSFEv1 (`FECompUltimoAutorizado`, `FECAESolicitar`).
 *
 * La clave privada NUNCA vive en la base ni en el repo: se monta en el host
 * y se referencia por `cert_alias` en `fiscal_config`. Hasta tener esas
 * credenciales, cualquier llamada falla con un error claro en vez de simular.
 *
 * Pasos para activar (cuando existan credenciales):
 *  1. Obtener cert/clave de producción desde el portal ARCA.
 *  2. Implementar WSAA: armar TRA (XML), firmar CMS/PKCS#7, pedir Token+Sign.
 *  3. Implementar el cliente SOAP WSFEv1 contra
 *     https://servicios1.afip.gov.ar/wsfev1/service.asmx (prod)
 *     https://wswhomo.afip.gov.ar/wsfev1/service.asmx (homologación).
 *  4. Mapear FECAESolicitarRequest/Response (ya tipados en ./types).
 */

import type {
  IArcaService,
  ArcaEmisor,
  CbteTipoCode,
  FECAESolicitarRequest,
  FECAESolicitarResponse,
} from "./types";

const NOT_READY =
  "Conexión ARCA de producción no disponible: faltan credenciales fiscales " +
  "(certificado X.509 + clave privada para WSAA/WSFEv1). Configurá el " +
  "ambiente en SANDBOX para operar con el Mock, o completá las credenciales " +
  "en el host y referencialas desde fiscal_config.cert_alias.";

export class ProductionArcaService implements IArcaService {
  readonly ambiente: ArcaEmisor["ambiente"];

  constructor(ambiente: ArcaEmisor["ambiente"] = "PRODUCCION") {
    this.ambiente = ambiente;
  }

  async ultimoComprobanteAutorizado(
    _ptoVta: number,
    _cbteTipo: CbteTipoCode
  ): Promise<number> {
    throw new Error(NOT_READY);
  }

  async solicitarCAE(
    _req: FECAESolicitarRequest,
    _emisor: ArcaEmisor
  ): Promise<FECAESolicitarResponse> {
    throw new Error(NOT_READY);
  }
}
