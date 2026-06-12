/**
 * Tipos del web service de Facturación Electrónica de ARCA (ex-AFIP) — WSFEv1.
 *
 * Los nombres de campo replican el contrato oficial del SOAP `FECAESolicitar`
 * y `FECompUltimoAutorizado` para que el cliente de producción (futuro) pueda
 * mapear 1:1 sin renombrar. El servicio Mock devuelve estructuras idénticas.
 *
 * Refs:
 *  - Manual WSFEv1 (RG 4291) — afip.gob.ar
 *  - QR fiscal RG 4892/2020
 */

// ---- Tablas de códigos ARCA --------------------------------------------

/** Código numérico de comprobante (param FE: FEParamGetTiposCbte). */
export const CbteTipo = {
  FACTURA_A: 1,
  NOTA_DEBITO_A: 2,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,
  NOTA_DEBITO_B: 7,
  NOTA_CREDITO_B: 8,
  FACTURA_C: 11,
  NOTA_DEBITO_C: 12,
  NOTA_CREDITO_C: 13,
  FACTURA_E: 19,
} as const;
export type CbteTipoCode = (typeof CbteTipo)[keyof typeof CbteTipo];

/** 1 = Productos, 2 = Servicios, 3 = Productos y Servicios. */
export const Concepto = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3,
} as const;
export type ConceptoCode = (typeof Concepto)[keyof typeof Concepto];

/** Tipo de documento del receptor (FEParamGetTiposDoc). */
export const DocTipo = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  CONSUMIDOR_FINAL: 99,
} as const;
export type DocTipoCode = (typeof DocTipo)[keyof typeof DocTipo];

/** Id de alícuota de IVA (FEParamGetTiposIva). */
export const AlicIvaId = {
  CERO: 3, // 0%
  DIEZ_CINCO: 4, // 10,5%
  VEINTIUNO: 5, // 21%
  VEINTISIETE: 6, // 27%
  CINCO: 8, // 5%
  DOS_CINCO: 9, // 2,5%
} as const;
export type AlicIvaIdCode = (typeof AlicIvaId)[keyof typeof AlicIvaId];

/** Alícuotas de IVA válidas (espejo del CHECK de par AFIP en DB — G7). */
export const ALICUOTAS_VALIDAS = [0, 2.5, 5, 10.5, 21, 27] as const;

/**
 * Mapea porcentaje de alícuota → Id ARCA.
 * G7 (IVA VENTAS V1): una alícuota desconocida es un ERROR explícito —
 * nunca más el default silencioso a 21% que declaraba mal el débito fiscal.
 */
export function alicuotaToId(pct: number): AlicIvaIdCode {
  switch (pct) {
    case 0:
      return AlicIvaId.CERO;
    case 2.5:
      return AlicIvaId.DOS_CINCO;
    case 5:
      return AlicIvaId.CINCO;
    case 10.5:
      return AlicIvaId.DIEZ_CINCO;
    case 21:
      return AlicIvaId.VEINTIUNO;
    case 27:
      return AlicIvaId.VEINTISIETE;
    default:
      throw new Error(
        `Alícuota de IVA inválida: ${pct}%. Válidas: ${ALICUOTAS_VALIDAS.join(", ")}.`
      );
  }
}

/** Inverso: Id ARCA → porcentaje de alícuota. */
export function alicuotaFromId(id: AlicIvaIdCode): number {
  switch (id) {
    case AlicIvaId.CERO:
      return 0;
    case AlicIvaId.DOS_CINCO:
      return 2.5;
    case AlicIvaId.CINCO:
      return 5;
    case AlicIvaId.DIEZ_CINCO:
      return 10.5;
    case AlicIvaId.VEINTIUNO:
      return 21;
    case AlicIvaId.VEINTISIETE:
      return 27;
  }
}

/** Resultado de la operación FE (R aprobado, R parcial, R rechazado). */
export type FeResultado = "A" | "P" | "R";

// ---- Request: FECAESolicitar -------------------------------------------

/** Alícuota de IVA discriminada del comprobante. */
export interface AlicIva {
  Id: AlicIvaIdCode;
  BaseImp: number;
  Importe: number;
}

/** Tributo (percepciones, impuestos internos, etc.). */
export interface Tributo {
  Id: number;
  Desc?: string;
  BaseImp: number;
  Alic: number;
  Importe: number;
}

/** Comprobante asociado (obligatorio en Notas de Crédito/Débito). */
export interface CbteAsoc {
  Tipo: CbteTipoCode;
  PtoVta: number;
  Nro: number;
  Cuit?: string;
  CbteFch?: string; // yyyymmdd
}

/** Detalle de un comprobante a autorizar. */
export interface FECAEDetRequest {
  Concepto: ConceptoCode;
  DocTipo: DocTipoCode;
  DocNro: number;
  CbteDesde: number;
  CbteHasta: number;
  CbteFch: string; // yyyymmdd
  ImpTotal: number;
  ImpTotConc: number; // neto no gravado
  ImpNeto: number; // neto gravado
  ImpOpEx: number; // exento
  ImpIVA: number;
  ImpTrib: number;
  MonId: string; // 'PES', 'DOL'…
  MonCotiz: number;
  /** Obligatorias si Concepto = 2 o 3 (formato yyyymmdd). */
  FchServDesde?: string;
  FchServHasta?: string;
  FchVtoPago?: string;
  Iva?: AlicIva[];
  Tributos?: Tributo[];
  CbtesAsoc?: CbteAsoc[];
}

/** Cabecera del request: cantidad + punto de venta + tipo. */
export interface FECAECabRequest {
  CantReg: number;
  PtoVta: number;
  CbteTipo: CbteTipoCode;
}

export interface FECAESolicitarRequest {
  FeCabReq: FECAECabRequest;
  FeDetReq: FECAEDetRequest[];
}

// ---- Response: FECAESolicitar ------------------------------------------

export interface FEObservacion {
  Code: number;
  Msg: string;
}

export interface FEError {
  Code: number;
  Msg: string;
}

export interface FEEvento {
  Code: number;
  Msg: string;
}

export interface FECAEDetResponse {
  Concepto: ConceptoCode;
  DocTipo: DocTipoCode;
  DocNro: number;
  CbteDesde: number;
  CbteHasta: number;
  CbteFch: string;
  Resultado: FeResultado;
  CAE: string;
  CAEFchVto: string; // yyyymmdd
  Observaciones?: FEObservacion[];
}

export interface FECAECabResponse {
  Cuit: string;
  PtoVta: number;
  CbteTipo: CbteTipoCode;
  FchProceso: string; // yyyymmddHHmmss
  CantReg: number;
  Resultado: FeResultado;
  Reproceso: "S" | "N";
}

export interface FECAESolicitarResponse {
  FeCabResp: FECAECabResponse;
  FeDetResp: FECAEDetResponse[];
  Errors?: FEError[];
  Events?: FEEvento[];
}

// ---- Contrato del servicio ---------------------------------------------

/** Identifica al emisor frente a ARCA para una operación. */
export interface ArcaEmisor {
  cuit: string;
  ambiente: "SANDBOX" | "HOMOLOGACION" | "PRODUCCION";
}

/**
 * Interfaz que implementan tanto el Mock (sandbox) como el cliente real
 * de producción (WSFEv1 sobre SOAP + WSAA). La capa de invoicing sólo
 * conoce este contrato, nunca la implementación concreta.
 */
export interface IArcaService {
  readonly ambiente: ArcaEmisor["ambiente"];

  /**
   * Último número de comprobante autorizado para (PtoVta, CbteTipo).
   * Equivale a `FECompUltimoAutorizado`. El próximo a emitir es +1.
   */
  ultimoComprobanteAutorizado(
    ptoVta: number,
    cbteTipo: CbteTipoCode
  ): Promise<number>;

  /** Solicita CAE para uno o más comprobantes (`FECAESolicitar`). */
  solicitarCAE(
    req: FECAESolicitarRequest,
    emisor: ArcaEmisor
  ): Promise<FECAESolicitarResponse>;
}
