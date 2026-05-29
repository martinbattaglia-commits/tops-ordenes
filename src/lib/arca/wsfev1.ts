/**
 * WSFEv1 — Web Service de Facturación Electrónica de ARCA (ex-AFIP).
 *
 * Consume las operaciones SOAP necesarias para emitir comprobantes:
 *  - FEDummy:                 health-check (no requiere Auth).
 *  - FECompUltimoAutorizado:  último Nro autorizado para (PtoVta, CbteTipo).
 *  - FECAESolicitar:          solicita CAE para uno o más comprobantes.
 *
 * Todas (salvo FEDummy) requieren el bloque `Auth` = { Token, Sign, Cuit },
 * donde Token/Sign provienen del TA de WSAA. El namespace del servicio es
 * `http://ar.gov.afip.dif.FEV1/`.
 *
 * El mapeo request/response es 1:1 con los tipos de ./types (que replican el
 * contrato oficial), usando el helper SOAP sin dependencias (./soap).
 */

import { soapPost, extractTag, extractAllTags, escapeXml } from "./soap";
import type {
  CbteTipoCode,
  FECAESolicitarRequest,
  FECAESolicitarResponse,
  FECAEDetRequest,
  FECAEDetResponse,
  FECAECabResponse,
  FEError,
  FEEvento,
  FEObservacion,
  FeResultado,
  ConceptoCode,
  DocTipoCode,
} from "./types";

const FEV1_NS = "http://ar.gov.afip.dif.FEV1/";

export class Wsfev1Error extends Error {
  readonly code?: number | string;
  constructor(message: string, code?: number | string) {
    super(message);
    this.name = "Wsfev1Error";
    this.code = code;
  }
}

/** Bloque de autenticación común a todas las operaciones de negocio. */
export interface FeAuth {
  Token: string;
  Sign: string;
  Cuit: string;
}

export interface Wsfev1Config {
  wsfev1Url: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
}

// ---- Helpers de armado XML ---------------------------------------------

function authXml(auth: FeAuth): string {
  return (
    `<ar:Auth>` +
    `<ar:Token>${escapeXml(auth.Token)}</ar:Token>` +
    `<ar:Sign>${escapeXml(auth.Sign)}</ar:Sign>` +
    `<ar:Cuit>${escapeXml(auth.Cuit)}</ar:Cuit>` +
    `</ar:Auth>`
  );
}

function envelope(bodyInner: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:ar="${FEV1_NS}">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>${bodyInner}</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

/** Número opcional → tag, omitido si undefined/null. */
function numTag(name: string, v: number | undefined | null): string {
  return v === undefined || v === null ? "" : `<ar:${name}>${v}</ar:${name}>`;
}

function strTag(name: string, v: string | undefined | null): string {
  return v === undefined || v === null || v === ""
    ? ""
    : `<ar:${name}>${escapeXml(v)}</ar:${name}>`;
}

/** Serializa un FECAEDetRequest al XML de FEDetReq esperado por WSFEv1. */
function detRequestXml(det: FECAEDetRequest): string {
  const ivaXml =
    det.Iva && det.Iva.length
      ? `<ar:Iva>` +
        det.Iva.map(
          (a) =>
            `<ar:AlicIva>` +
            `<ar:Id>${a.Id}</ar:Id>` +
            `<ar:BaseImp>${a.BaseImp}</ar:BaseImp>` +
            `<ar:Importe>${a.Importe}</ar:Importe>` +
            `</ar:AlicIva>`
        ).join("") +
        `</ar:Iva>`
      : "";

  const tribXml =
    det.Tributos && det.Tributos.length
      ? `<ar:Tributos>` +
        det.Tributos.map(
          (t) =>
            `<ar:Tributo>` +
            `<ar:Id>${t.Id}</ar:Id>` +
            strTag("Desc", t.Desc) +
            `<ar:BaseImp>${t.BaseImp}</ar:BaseImp>` +
            `<ar:Alic>${t.Alic}</ar:Alic>` +
            `<ar:Importe>${t.Importe}</ar:Importe>` +
            `</ar:Tributo>`
        ).join("") +
        `</ar:Tributos>`
      : "";

  const asocXml =
    det.CbtesAsoc && det.CbtesAsoc.length
      ? `<ar:CbtesAsoc>` +
        det.CbtesAsoc.map(
          (c) =>
            `<ar:CbteAsoc>` +
            `<ar:Tipo>${c.Tipo}</ar:Tipo>` +
            `<ar:PtoVta>${c.PtoVta}</ar:PtoVta>` +
            `<ar:Nro>${c.Nro}</ar:Nro>` +
            strTag("Cuit", c.Cuit) +
            strTag("CbteFch", c.CbteFch) +
            `</ar:CbteAsoc>`
        ).join("") +
        `</ar:CbtesAsoc>`
      : "";

  return (
    `<ar:FECAEDetRequest>` +
    `<ar:Concepto>${det.Concepto}</ar:Concepto>` +
    `<ar:DocTipo>${det.DocTipo}</ar:DocTipo>` +
    `<ar:DocNro>${det.DocNro}</ar:DocNro>` +
    `<ar:CbteDesde>${det.CbteDesde}</ar:CbteDesde>` +
    `<ar:CbteHasta>${det.CbteHasta}</ar:CbteHasta>` +
    `<ar:CbteFch>${det.CbteFch}</ar:CbteFch>` +
    `<ar:ImpTotal>${det.ImpTotal}</ar:ImpTotal>` +
    `<ar:ImpTotConc>${det.ImpTotConc}</ar:ImpTotConc>` +
    `<ar:ImpNeto>${det.ImpNeto}</ar:ImpNeto>` +
    `<ar:ImpOpEx>${det.ImpOpEx}</ar:ImpOpEx>` +
    `<ar:ImpTrib>${det.ImpTrib}</ar:ImpTrib>` +
    `<ar:ImpIVA>${det.ImpIVA}</ar:ImpIVA>` +
    strTag("FchServDesde", det.FchServDesde) +
    strTag("FchServHasta", det.FchServHasta) +
    strTag("FchVtoPago", det.FchVtoPago) +
    `<ar:MonId>${escapeXml(det.MonId)}</ar:MonId>` +
    `<ar:MonCotiz>${det.MonCotiz}</ar:MonCotiz>` +
    ivaXml +
    tribXml +
    asocXml +
    `</ar:FECAEDetRequest>`
  );
}

// ---- Parsers de respuesta ----------------------------------------------

/** Extrae el bloque <Errors> → FEError[] (si existe). */
function parseErrors(xml: string): FEError[] {
  const block = extractTag(xml, "Errors");
  if (!block) return [];
  const codes = extractAllTags(block, "Code");
  const msgs = extractAllTags(block, "Msg");
  return codes.map((c, i) => ({ Code: Number(c), Msg: msgs[i] ?? "" }));
}

function parseEvents(xml: string): FEEvento[] {
  const block = extractTag(xml, "Events");
  if (!block) return [];
  const codes = extractAllTags(block, "Code");
  const msgs = extractAllTags(block, "Msg");
  return codes.map((c, i) => ({ Code: Number(c), Msg: msgs[i] ?? "" }));
}

function parseObservaciones(detXml: string): FEObservacion[] {
  const block = extractTag(detXml, "Observaciones");
  if (!block) return [];
  const codes = extractAllTags(block, "Code");
  const msgs = extractAllTags(block, "Msg");
  return codes.map((c, i) => ({ Code: Number(c), Msg: msgs[i] ?? "" }));
}

/** Extrae cada bloque <FECAEDetResponse>…</FECAEDetResponse> como string. */
function splitDetResponses(xml: string): string[] {
  const re = /<(?:[\w.-]+:)?FECAEDetResponse(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?FECAEDetResponse>/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

// ---- Cliente -------------------------------------------------------------

export class Wsfev1Client {
  private readonly cfg: Required<Omit<Wsfev1Config, "fetchImpl">> &
    Pick<Wsfev1Config, "fetchImpl">;

  constructor(config: Wsfev1Config) {
    this.cfg = {
      wsfev1Url: config.wsfev1Url,
      timeoutMs: config.timeoutMs ?? 15_000,
      retries: config.retries ?? 2,
      fetchImpl: config.fetchImpl,
    };
  }

  private async post(soapAction: string, body: string): Promise<string> {
    return soapPost({
      url: this.cfg.wsfev1Url,
      // WSFEv1 (.NET) exige SOAPAction con el namespace + operación.
      soapAction: `${FEV1_NS}${soapAction}`,
      body,
      timeoutMs: this.cfg.timeoutMs,
      retries: this.cfg.retries,
      fetchImpl: this.cfg.fetchImpl,
    });
  }

  /** Health-check del servicio (AppServer/DbServer/AuthServer = OK). */
  async dummy(): Promise<{ appServer?: string; dbServer?: string; authServer?: string }> {
    const xml = await this.post(
      "FEDummy",
      envelope(`<ar:FEDummy/>`)
    );
    return {
      appServer: extractTag(xml, "AppServer") ?? undefined,
      dbServer: extractTag(xml, "DbServer") ?? undefined,
      authServer: extractTag(xml, "AuthServer") ?? undefined,
    };
  }

  /**
   * Último comprobante autorizado para (PtoVta, CbteTipo).
   * Devuelve 0 si aún no hay comprobantes (el primero a emitir será 1).
   */
  async ultimoAutorizado(
    auth: FeAuth,
    ptoVta: number,
    cbteTipo: CbteTipoCode
  ): Promise<number> {
    const body = envelope(
      `<ar:FECompUltimoAutorizado>` +
        authXml(auth) +
        `<ar:PtoVta>${ptoVta}</ar:PtoVta>` +
        `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>` +
        `</ar:FECompUltimoAutorizado>`
    );
    const xml = await this.post("FECompUltimoAutorizado", body);

    const errors = parseErrors(xml);
    if (errors.length) {
      throw new Wsfev1Error(
        `FECompUltimoAutorizado: ${errors.map((e) => `[${e.Code}] ${e.Msg}`).join("; ")}`,
        errors[0].Code
      );
    }
    const nro = extractTag(xml, "CbteNro");
    if (nro === null) {
      throw new Wsfev1Error("FECompUltimoAutorizado: respuesta sin CbteNro");
    }
    const n = Number(nro);
    if (!Number.isFinite(n)) {
      throw new Wsfev1Error(`FECompUltimoAutorizado: CbteNro inválido "${nro}"`);
    }
    return n;
  }

  /** Solicita CAE para uno o más comprobantes (FECAESolicitar). */
  async solicitarCAE(
    auth: FeAuth,
    req: FECAESolicitarRequest
  ): Promise<FECAESolicitarResponse> {
    const detsXml = req.FeDetReq.map(detRequestXml).join("");
    const body = envelope(
      `<ar:FECAESolicitar>` +
        authXml(auth) +
        `<ar:FeCAEReq>` +
        `<ar:FeCabReq>` +
        `<ar:CantReg>${req.FeCabReq.CantReg}</ar:CantReg>` +
        `<ar:PtoVta>${req.FeCabReq.PtoVta}</ar:PtoVta>` +
        `<ar:CbteTipo>${req.FeCabReq.CbteTipo}</ar:CbteTipo>` +
        `</ar:FeCabReq>` +
        `<ar:FeDetReq>${detsXml}</ar:FeDetReq>` +
        `</ar:FeCAEReq>` +
        `</ar:FECAESolicitar>`
    );
    const xml = await this.post("FECAESolicitar", body);

    const errors = parseErrors(xml);
    const events = parseEvents(xml);

    // La cabecera de respuesta puede no venir si hubo Errors de esquema/auth.
    const cabBlock = extractTag(xml, "FeCabResp");
    if (!cabBlock) {
      // Sin cabecera → error duro (auth/esquema). Propagar con los Errors.
      throw new Wsfev1Error(
        errors.length
          ? `FECAESolicitar: ${errors.map((e) => `[${e.Code}] ${e.Msg}`).join("; ")}`
          : "FECAESolicitar: respuesta sin FeCabResp",
        errors[0]?.Code
      );
    }

    const cab: FECAECabResponse = {
      Cuit: extractTag(cabBlock, "Cuit") ?? auth.Cuit,
      PtoVta: Number(extractTag(cabBlock, "PtoVta") ?? req.FeCabReq.PtoVta),
      CbteTipo: Number(
        extractTag(cabBlock, "CbteTipo") ?? req.FeCabReq.CbteTipo
      ) as CbteTipoCode,
      FchProceso: extractTag(cabBlock, "FchProceso") ?? "",
      CantReg: Number(extractTag(cabBlock, "CantReg") ?? req.FeCabReq.CantReg),
      Resultado: (extractTag(cabBlock, "Resultado") ?? "R") as FeResultado,
      Reproceso: (extractTag(cabBlock, "Reproceso") ?? "N") as "S" | "N",
    };

    const detRespBlock = extractTag(xml, "FeDetResp") ?? "";
    const detResp: FECAEDetResponse[] = splitDetResponses(detRespBlock).map(
      (d) => ({
        Concepto: Number(extractTag(d, "Concepto") ?? 0) as ConceptoCode,
        DocTipo: Number(extractTag(d, "DocTipo") ?? 0) as DocTipoCode,
        DocNro: Number(extractTag(d, "DocNro") ?? 0),
        CbteDesde: Number(extractTag(d, "CbteDesde") ?? 0),
        CbteHasta: Number(extractTag(d, "CbteHasta") ?? 0),
        CbteFch: extractTag(d, "CbteFch") ?? "",
        Resultado: (extractTag(d, "Resultado") ?? "R") as FeResultado,
        CAE: extractTag(d, "CAE") ?? "",
        CAEFchVto: extractTag(d, "CAEFchVto") ?? "",
        Observaciones: parseObservaciones(d),
      })
    );

    return {
      FeCabResp: cab,
      FeDetResp: detResp,
      Errors: errors.length ? errors : undefined,
      Events: events.length ? events : undefined,
    };
  }
}
