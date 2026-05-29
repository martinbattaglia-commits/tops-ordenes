/**
 * WSAA — Web Service de Autenticación y Autorización de ARCA (ex-AFIP).
 *
 * Entrega un Ticket de Acceso (TA = Token + Sign) válido ~12 h que autoriza a
 * consumir WSFEv1. Flujo: armar TRA (XML) → firmarlo como CMS/PKCS#7 con el
 * certificado X.509 + clave privada (SOLO en host) → LoginCms (SOAP) → parsear
 * Token/Sign/expiración → cachear hasta el vencimiento.
 *
 * La clave privada NUNCA vive en la base ni en el repo: se referencia por path
 * (ARCA_KEY_PATH) y se usa para firmar localmente. El firmador es inyectable
 * (interfaz CmsSigner); el default usa el binario `openssl` del host.
 */

import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import { soapPost, extractTag, escapeXml, unescapeXml } from "./soap";
import { consoleArcaLogger, maskSecret, type ArcaLogger } from "./logger";

export interface AccessTicket {
  token: string;
  sign: string;
  /** epoch ms de expiración (de <expirationTime> del TA). */
  expiresAt: number;
}

export class WsaaAuthError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "WsaaAuthError";
    this.code = code;
  }
}

/** Firma un TRA (XML) como CMS/PKCS#7 y devuelve el DER en base64. */
export interface CmsSigner {
  sign(traXml: string): Promise<string>;
}

export interface WsaaConfig {
  wsaaUrl: string;
  certPath: string;
  keyPath: string;
  /** Servicio a autorizar (WSFEv1 = 'wsfe'). */
  service?: string;
  /** Margen de seguridad antes de la expiración (segundos). */
  marginSeconds?: number;
  signer?: CmsSigner;
  logger?: ArcaLogger;
  fetchImpl?: typeof fetch;
}

/** Formatea una fecha como ISO-8601 local con offset (requerido por WSAA). */
function isoWithOffset(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const tzMin = -d.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-";
  const abs = Math.abs(tzMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Construye el TRA (loginTicketRequest) XML. */
export function buildTra(service: string, now: Date = new Date()): string {
  const gen = new Date(now.getTime() - 10 * 60_000); // -10 min
  const exp = new Date(now.getTime() + 10 * 60_000); // +10 min
  const uniqueId = Math.floor(now.getTime() / 1000);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header>` +
    `<uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${isoWithOffset(gen)}</generationTime>` +
    `<expirationTime>${isoWithOffset(exp)}</expirationTime>` +
    `</header>` +
    `<service>${escapeXml(service)}</service>` +
    `</loginTicketRequest>`
  );
}

/**
 * Firmador CMS basado en el binario `openssl` del host.
 *   openssl smime -sign -signer cert -inkey key -outform DER -nodetach
 * Requiere `openssl` instalado y los archivos de cert/clave legibles.
 */
export function opensslSigner(certPath: string, keyPath: string): CmsSigner {
  return {
    async sign(traXml: string): Promise<string> {
      // Validar lectura de los archivos (falla claro si faltan/no legibles).
      await Promise.all([readFile(certPath), readFile(keyPath)]);
      return await new Promise<string>((resolve, reject) => {
        const proc = spawn("openssl", [
          "smime",
          "-sign",
          "-signer",
          certPath,
          "-inkey",
          keyPath,
          "-outform",
          "DER",
          "-nodetach",
        ]);
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        proc.stdout.on("data", (d) => out.push(d as Buffer));
        proc.stderr.on("data", (d) => err.push(d as Buffer));
        proc.on("error", (e) =>
          reject(new WsaaAuthError(`openssl no disponible: ${e.message}`))
        );
        proc.on("close", (code) => {
          if (code !== 0) {
            reject(
              new WsaaAuthError(
                `openssl smime falló (code ${code}): ${Buffer.concat(err).toString()}`
              )
            );
            return;
          }
          // El CMS DER va embebido en el SOAP como base64.
          resolve(Buffer.concat(out).toString("base64"));
        });
        proc.stdin.write(traXml);
        proc.stdin.end();
      });
    },
  };
}

/** Envelope SOAP 1.1 para LoginCms. */
function loginCmsEnvelope(cmsBase64: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>` +
    `<wsaa:loginCms><wsaa:in0>${cmsBase64}</wsaa:in0></wsaa:loginCms>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

/** Parsea el loginTicketResponse (viene XML-escapado dentro de loginCmsReturn). */
export function parseLoginResponse(soapXml: string): AccessTicket {
  const ret = extractTag(soapXml, "loginCmsReturn");
  const inner = ret ?? soapXml;
  // `inner` puede venir doblemente escapado; extractTag ya des-escapa una vez.
  const xml = /loginTicketResponse/.test(inner) ? inner : unescapeXml(inner);

  const token = extractTag(xml, "token");
  const sign = extractTag(xml, "sign");
  const expISO = extractTag(xml, "expirationTime");
  if (!token || !sign) {
    const fault =
      extractTag(soapXml, "faultstring") ?? "WSAA: respuesta sin token/sign";
    throw new WsaaAuthError(fault);
  }
  const expiresAt = expISO ? Date.parse(expISO) : Date.now() + 11 * 3600_000;
  return { token, sign, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 11 * 3600_000 };
}

/**
 * Cliente WSAA con cache de TA en memoria (por proceso) y de-dup de login.
 */
export class WsaaClient {
  private readonly cfg: Required<Omit<WsaaConfig, "signer" | "logger" | "fetchImpl">> &
    Pick<WsaaConfig, "signer" | "logger" | "fetchImpl">;
  private readonly logger: ArcaLogger;
  private cache = new Map<string, AccessTicket>();
  private inflight = new Map<string, Promise<AccessTicket>>();

  constructor(config: WsaaConfig) {
    this.cfg = {
      wsaaUrl: config.wsaaUrl,
      certPath: config.certPath,
      keyPath: config.keyPath,
      service: config.service ?? "wsfe",
      marginSeconds: config.marginSeconds ?? 600,
      signer: config.signer,
      logger: config.logger,
      fetchImpl: config.fetchImpl,
    };
    this.logger = config.logger ?? consoleArcaLogger;
  }

  private cacheKey(): string {
    return `${this.cfg.certPath}:${this.cfg.service}`;
  }

  private isValid(ta: AccessTicket | undefined): ta is AccessTicket {
    if (!ta) return false;
    return ta.expiresAt - this.cfg.marginSeconds * 1000 > Date.now();
  }

  /** Devuelve un TA válido (cacheado o recién obtenido). De-dup de login concurrente. */
  async getTicket(): Promise<AccessTicket> {
    const key = this.cacheKey();
    const cached = this.cache.get(key);
    if (this.isValid(cached)) return cached;

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const p = this.login()
      .then((ta) => {
        this.cache.set(key, ta);
        return ta;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Invalida el TA cacheado (p. ej. tras un AuthError de WSFEv1). */
  invalidate(): void {
    this.cache.delete(this.cacheKey());
  }

  private async login(): Promise<AccessTicket> {
    const t0 = Date.now();
    const signer = this.cfg.signer ?? opensslSigner(this.cfg.certPath, this.cfg.keyPath);
    const tra = buildTra(this.cfg.service);
    const cms = await signer.sign(tra);

    const respXml = await soapPost({
      url: this.cfg.wsaaUrl,
      soapAction: "",
      body: loginCmsEnvelope(cms),
      fetchImpl: this.cfg.fetchImpl,
    });
    const ta = parseLoginResponse(respXml);
    this.logger.info({
      op: "wsaa.login",
      service: this.cfg.service,
      ms: Date.now() - t0,
      token: maskSecret(ta.token),
      sign: maskSecret(ta.sign),
      expiresAt: new Date(ta.expiresAt).toISOString(),
      cmsHash: createHash("sha256").update(cms).digest("hex").slice(0, 12),
    });
    return ta;
  }
}
