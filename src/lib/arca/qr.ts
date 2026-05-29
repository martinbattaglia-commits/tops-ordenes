/**
 * QR fiscal obligatorio — RG 4892/2020.
 *
 * El contenido es un JSON con campos fijos, codificado en base64 y embebido
 * en la URL pública de ARCA. El consumidor escanea el QR y ARCA valida el
 * comprobante contra el CAE. Guardamos el JSON crudo, la URL y un hash
 * sha256 del payload para verificación futura.
 *
 * IMPORTANTE: el host es siempre afip.gob.ar (ARCA mantuvo el endpoint del
 * QR). No cambiar a otro dominio.
 */

import { createHash } from "crypto";

const QR_BASE_URL = "https://www.afip.gob.ar/fe/qr/";

/** Estructura exacta del payload del QR fiscal (orden y nombres oficiales). */
export interface FiscalQrPayload {
  ver: 1;
  fecha: string; // yyyy-mm-dd
  cuit: number; // CUIT del emisor (sin guiones)
  ptoVta: number;
  tipoCmp: number; // código de comprobante ARCA
  nroCmp: number;
  importe: number; // total
  moneda: string; // 'PES'
  ctz: number; // cotización
  tipoDocRec: number; // 80/86/96/99
  nroDocRec: number; // doc del receptor (0 si CF sin doc)
  tipoCodAut: "E" | "A"; // E = CAE, A = CAEA
  codAut: number; // CAE numérico
}

export interface FiscalQr {
  payload: FiscalQrPayload;
  /** JSON serializado tal como se codifica (se guarda en qr_data). */
  json: string;
  /** Base64 del JSON. */
  base64: string;
  /** URL final embebida en el QR (qr_url). */
  url: string;
  /** sha256 del JSON crudo (qr_hash). */
  hash: string;
}

export interface BuildQrInput {
  fecha: string; // yyyy-mm-dd (fecha de emisión)
  cuitEmisor: string; // con o sin guiones
  ptoVta: number;
  cbteTipo: number;
  nroCmp: number;
  importeTotal: number;
  moneda?: string;
  cotizacion?: number;
  docTipoReceptor: number;
  docNroReceptor: string; // con o sin guiones
  cae: string;
  tipoCodAut?: "E" | "A";
}

function onlyDigits(s: string): number {
  const n = Number(String(s).replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Construye el QR fiscal completo a partir de los datos del comprobante autorizado. */
export function buildFiscalQr(input: BuildQrInput): FiscalQr {
  const payload: FiscalQrPayload = {
    ver: 1,
    fecha: input.fecha,
    cuit: onlyDigits(input.cuitEmisor),
    ptoVta: input.ptoVta,
    tipoCmp: input.cbteTipo,
    nroCmp: input.nroCmp,
    importe: Number(input.importeTotal.toFixed(2)),
    moneda: input.moneda ?? "PES",
    ctz: input.cotizacion ?? 1,
    tipoDocRec: input.docTipoReceptor,
    nroDocRec: onlyDigits(input.docNroReceptor),
    tipoCodAut: input.tipoCodAut ?? "E",
    codAut: onlyDigits(input.cae),
  };

  const json = JSON.stringify(payload);
  const base64 = Buffer.from(json, "utf-8").toString("base64");
  const url = `${QR_BASE_URL}?p=${base64}`;
  const hash = createHash("sha256").update(json).digest("hex");

  return { payload, json, base64, url, hash };
}
