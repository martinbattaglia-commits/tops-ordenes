/**
 * Cliente ARCA de PRODUCCIÓN / HOMOLOGACIÓN (WSFEv1 sobre SOAP + WSAA).
 *
 * Orquesta:
 *   1. WSAA  → obtiene/cachea el Ticket de Acceso (Token+Sign) firmando un TRA
 *              con el certificado X.509 + clave privada del host.
 *   2. WSFEv1 → consume FECompUltimoAutorizado y FECAESolicitar con el bloque
 *              Auth { Token, Sign, Cuit }.
 *
 * Reglas de seguridad (rector "NO ASUMIR. VERIFICAR"):
 *  - La clave privada NUNCA vive en la base ni en el repo: se referencia por
 *    path (ARCA_CERT_PATH / ARCA_KEY_PATH) y se usa SOLO en el host.
 *  - Si faltan credenciales en PRODUCCION → ArcaConfigError SIEMPRE. Jamás se
 *    simula un CAE real (no hay fallback a Mock en producción).
 *  - En HOMOLOGACION, el fallback a Mock solo se permite con
 *    ARCA_ALLOW_MOCK_FALLBACK=1 (dev/preview), y queda registrado en el log.
 *  - Nunca se loguea Token/Sign/clave/CMS en claro (ver logger.maskSecret).
 *
 * READY ≠ emitir en producción: este cliente queda credential-gated. Habilitar
 * la emisión real requiere cert/clave válidos + ambiente PRODUCCION en
 * fiscal_config bajo gate ejecutivo (fuera del alcance de FASE E).
 */

import { env } from "../env";
import { WsaaClient } from "./wsaa";
import { hasArcaCredentials } from "./credentials";
import { Wsfev1Client, Wsfev1Error, type FeAuth } from "./wsfev1";
import { MockArcaService } from "./mock-service";
import { consoleArcaLogger, maskSecret, type ArcaLogger } from "./logger";
import type {
  IArcaService,
  ArcaEmisor,
  CbteTipoCode,
  FECAESolicitarRequest,
  FECAESolicitarResponse,
} from "./types";

/** Falta de credenciales / configuración fiscal (no es un error de red). */
export class ArcaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArcaConfigError";
  }
}

/** URLs oficiales por ambiente (host afip.gov.ar — fijas). */
const OFFICIAL_URLS = {
  HOMOLOGACION: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfev1: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  PRODUCCION: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfev1: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
} as const;

export interface ProductionArcaConfig {
  ambiente: ArcaEmisor["ambiente"];
  cuit?: string;
  certPath?: string;
  keyPath?: string;
  wsaaUrl?: string;
  wsfev1Url?: string;
  marginSeconds?: number;
  allowMockFallback?: boolean;
  logger?: ArcaLogger;
  fetchImpl?: typeof fetch;
  /** Inyectables para tests. */
  wsaa?: WsaaClient;
  wsfev1?: Wsfev1Client;
}

/** Resuelve URLs: override explícito > default por ambiente. */
function resolveUrls(
  ambiente: "HOMOLOGACION" | "PRODUCCION",
  cfg: ProductionArcaConfig
): { wsaa: string; wsfev1: string } {
  const official = OFFICIAL_URLS[ambiente];
  const wsaa =
    cfg.wsaaUrl ?? (env.arca.wsaaUrlExplicit ? env.arca.wsaaUrl : official.wsaa);
  const wsfev1 =
    cfg.wsfev1Url ??
    (env.arca.wsfev1UrlExplicit ? env.arca.wsfev1Url : official.wsfev1);
  return { wsaa, wsfev1 };
}

export class ProductionArcaService implements IArcaService {
  readonly ambiente: ArcaEmisor["ambiente"];

  private readonly cuit: string;
  private readonly certPath: string;
  private readonly keyPath: string;
  private readonly logger: ArcaLogger;
  private readonly wsaa: WsaaClient | null;
  private readonly wsfev1: Wsfev1Client | null;

  /** Activo solo si faltan credenciales en ambiente NO productivo + flag. */
  private readonly fallback: MockArcaService | null;

  constructor(
    ambienteOrConfig: ArcaEmisor["ambiente"] | ProductionArcaConfig = "PRODUCCION"
  ) {
    const cfg: ProductionArcaConfig =
      typeof ambienteOrConfig === "string"
        ? { ambiente: ambienteOrConfig }
        : ambienteOrConfig;

    this.ambiente = cfg.ambiente;
    this.logger = cfg.logger ?? consoleArcaLogger;
    this.cuit = (cfg.cuit ?? env.arca.cuit).replace(/\D/g, "");
    this.certPath = cfg.certPath ?? env.arca.certPath;
    this.keyPath = cfg.keyPath ?? env.arca.keyPath;

    // Credenciales por path (override de cfg/env) o por contenido PEM en env
    // (serverless). El firmador resuelve la fuente real al firmar.
    const hasCreds = Boolean(this.certPath && this.keyPath) || hasArcaCredentials();
    const allowFallback = cfg.allowMockFallback ?? env.arca.allowMockFallback;

    if (!hasCreds) {
      // PRODUCCION: nunca simular. HOMOLOGACION: solo con flag explícito.
      if (this.ambiente === "PRODUCCION" || !allowFallback) {
        // Difiere el error al momento de uso (constructor no debe lanzar para
        // no romper el factory en rutas que sólo consultan el ambiente).
        this.fallback = null;
        this.wsaa = null;
        this.wsfev1 = null;
        return;
      }
      // HOMOLOGACION + fallback permitido → Mock (queda logueado al usar).
      this.fallback = new MockArcaService();
      this.wsaa = null;
      this.wsfev1 = null;
      this.logger.warn({
        op: "arca.fallback.mock",
        ambiente: this.ambiente,
        msg: "Sin credenciales: fallback a Mock habilitado por ARCA_ALLOW_MOCK_FALLBACK. Sin validez fiscal.",
      });
      return;
    }

    this.fallback = null;
    const target = (this.ambiente === "PRODUCCION" ? "PRODUCCION" : "HOMOLOGACION") as
      | "PRODUCCION"
      | "HOMOLOGACION";
    const urls = resolveUrls(target, cfg);

    this.wsaa =
      cfg.wsaa ??
      new WsaaClient({
        wsaaUrl: urls.wsaa,
        certPath: this.certPath,
        keyPath: this.keyPath,
        service: "wsfe",
        marginSeconds: cfg.marginSeconds ?? env.arca.taMarginSeconds,
        logger: this.logger,
        fetchImpl: cfg.fetchImpl,
      });
    this.wsfev1 =
      cfg.wsfev1 ??
      new Wsfev1Client({
        wsfev1Url: urls.wsfev1,
        fetchImpl: cfg.fetchImpl,
      });
  }

  /** Lanza si no hay credenciales (ni fallback). Mensaje accionable. */
  private requireReady(): void {
    if (this.fallback) return;
    if (!this.wsaa || !this.wsfev1) {
      throw new ArcaConfigError(
        `ARCA ${this.ambiente}: faltan credenciales fiscales. Definí ARCA_CERT_PEM / ` +
          `ARCA_KEY_PEM (PEM o base64, recomendado en serverless) o ARCA_CERT_PATH / ` +
          `ARCA_KEY_PATH (host con filesystem). La clave privada nunca vive en repo/DB. ` +
          `Como alternativa, usá ambiente SANDBOX (Mock). ` +
          (this.ambiente === "PRODUCCION"
            ? `En PRODUCCION no existe fallback a Mock (jamás se simula un CAE real).`
            : `Para dev/preview podés habilitar ARCA_ALLOW_MOCK_FALLBACK=1.`)
      );
    }
    if (!this.cuit) {
      throw new ArcaConfigError(
        `ARCA ${this.ambiente}: falta el CUIT del emisor (ARCA_CUIT / fiscal_config.cuit).`
      );
    }
  }

  /** Obtiene el bloque Auth (Token+Sign del TA + Cuit) para WSFEv1. */
  private async getAuth(cuitOverride?: string): Promise<FeAuth> {
    const ta = await this.wsaa!.getTicket();
    const cuit = (cuitOverride ?? this.cuit).replace(/\D/g, "");
    if (!cuit) {
      throw new ArcaConfigError(
        `ARCA ${this.ambiente}: CUIT del emisor ausente para el bloque Auth.`
      );
    }
    return { Token: ta.token, Sign: ta.sign, Cuit: cuit };
  }

  /** ¿El error sugiere TA inválido/expirado? (para reintentar tras invalidar). */
  private isAuthError(e: unknown): boolean {
    if (e instanceof Wsfev1Error) {
      const code = Number(e.code);
      // 600/601/602/... familia de errores de token en WSFEv1.
      if (code >= 600 && code < 700) return true;
      return /token|sign|ticket|expir|autenticaci/i.test(e.message);
    }
    return false;
  }

  async ultimoComprobanteAutorizado(
    ptoVta: number,
    cbteTipo: CbteTipoCode
  ): Promise<number> {
    if (this.fallback) return this.fallback.ultimoComprobanteAutorizado(ptoVta, cbteTipo);
    this.requireReady();

    const t0 = Date.now();
    try {
      const auth = await this.getAuth();
      const nro = await this.wsfev1!.ultimoAutorizado(auth, ptoVta, cbteTipo);
      this.logger.info({
        op: "wsfev1.ultimoAutorizado",
        ambiente: this.ambiente,
        ptoVta,
        cbteTipo,
        resultado: String(nro),
        ms: Date.now() - t0,
      });
      return nro;
    } catch (e) {
      if (this.isAuthError(e)) {
        // TA pudo expirar entre obtención y uso: invalidar y reintentar 1 vez.
        this.wsaa!.invalidate();
        const auth = await this.getAuth();
        return this.wsfev1!.ultimoAutorizado(auth, ptoVta, cbteTipo);
      }
      this.logger.error({
        op: "wsfev1.ultimoAutorizado",
        ambiente: this.ambiente,
        ptoVta,
        cbteTipo,
        ms: Date.now() - t0,
        msg: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  async solicitarCAE(
    req: FECAESolicitarRequest,
    emisor: ArcaEmisor
  ): Promise<FECAESolicitarResponse> {
    if (this.fallback) return this.fallback.solicitarCAE(req, emisor);
    this.requireReady();

    const t0 = Date.now();
    const run = async (): Promise<FECAESolicitarResponse> => {
      const auth = await this.getAuth(emisor.cuit);
      return this.wsfev1!.solicitarCAE(auth, req);
    };

    try {
      let resp: FECAESolicitarResponse;
      try {
        resp = await run();
      } catch (e) {
        if (this.isAuthError(e)) {
          this.wsaa!.invalidate();
          resp = await run();
        } else {
          throw e;
        }
      }

      const det = resp.FeDetResp[0];
      this.logger.info({
        op: "wsfev1.solicitarCAE",
        ambiente: this.ambiente,
        cuit: maskSecret(emisor.cuit),
        ptoVta: req.FeCabReq.PtoVta,
        cbteTipo: req.FeCabReq.CbteTipo,
        cantReg: req.FeCabReq.CantReg,
        resultado: resp.FeCabResp.Resultado,
        cae: det?.CAE ? `len=${det.CAE.length}` : "∅",
        caeVto: det?.CAEFchVto,
        obs: det?.Observaciones?.map((o) => o.Code).join(","),
        errors: resp.Errors?.map((er) => er.Code).join(","),
        ms: Date.now() - t0,
      });
      return resp;
    } catch (e) {
      this.logger.error({
        op: "wsfev1.solicitarCAE",
        ambiente: this.ambiente,
        cuit: maskSecret(emisor.cuit),
        ptoVta: req.FeCabReq.PtoVta,
        cbteTipo: req.FeCabReq.CbteTipo,
        ms: Date.now() - t0,
        msg: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  /** Health-check directo de WSFEv1 (FEDummy). No requiere Auth. */
  async dummy(): Promise<{ appServer?: string; dbServer?: string; authServer?: string }> {
    if (this.fallback) return { appServer: "MOCK", dbServer: "MOCK", authServer: "MOCK" };
    this.requireReady();
    return this.wsfev1!.dummy();
  }
}
