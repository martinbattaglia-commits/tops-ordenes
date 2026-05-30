/**
 * Helper SOAP mínimo y sin dependencias para ARCA (WSAA + WSFEv1).
 *
 * No usamos una librería SOAP completa a propósito: el contrato de ARCA es
 * acotado y estable, y mantener cero dependencias reduce la superficie de
 * auditoría de un módulo fiscal. Provee: POST con timeout + retries, detección
 * de SOAP Fault, y extracción de nodos XML por nombre (suficiente para las
 * respuestas .NET de AFIP, cuyos nombres de elemento son fijos).
 */

export class SoapFaultError extends Error {
  readonly faultCode?: string;
  constructor(message: string, faultCode?: string) {
    super(message);
    this.name = "SoapFaultError";
    this.faultCode = faultCode;
  }
}

export class SoapNetworkError extends Error {
  readonly transient: boolean;
  constructor(message: string, transient = true) {
    super(message);
    this.name = "SoapNetworkError";
    this.transient = transient;
  }
}

export interface SoapPostOptions {
  url: string;
  /** SOAPAction header (vacío para SOAP 1.2 / algunos endpoints AFIP). */
  soapAction?: string;
  /** Envelope XML completo. */
  body: string;
  timeoutMs?: number;
  retries?: number;
  /** Inyectable para tests (default global fetch). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * POST de un envelope SOAP con timeout y reintentos exponenciales para errores
 * transitorios (red/timeout/5xx). Devuelve el texto XML de la respuesta.
 * Lanza SoapFaultError si el cuerpo es un Fault; SoapNetworkError si se agotan
 * los reintentos.
 */
export async function soapPost(opts: SoapPostOptions): Promise<string> {
  const {
    url,
    soapAction = "",
    body,
    timeoutMs = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    fetchImpl = fetch,
  } = opts;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: soapAction,
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const text = await res.text();

      if (res.status >= 500) {
        // 5xx → puede ser transitorio; reintentar.
        lastErr = new SoapNetworkError(`HTTP ${res.status} de ${url}`, true);
      } else if (res.status >= 400) {
        // 4xx → normalmente determinístico; igual puede traer un SOAP Fault.
        const fault = extractFault(text);
        if (fault) throw new SoapFaultError(fault.message, fault.code);
        throw new SoapNetworkError(`HTTP ${res.status} de ${url}`, false);
      } else {
        const fault = extractFault(text);
        if (fault) throw new SoapFaultError(fault.message, fault.code);
        return text;
      }
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof SoapFaultError) throw e; // negocio: no reintentar
      const isAbort = e instanceof Error && e.name === "AbortError";
      lastErr =
        e instanceof SoapNetworkError
          ? e
          : new SoapNetworkError(
              isAbort ? `Timeout (${timeoutMs}ms) en ${url}` : `Red: ${(e as Error).message}`,
              true
            );
    }

    if (attempt < retries) {
      const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await sleep(backoff);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new SoapNetworkError(`Fallo SOAP tras ${retries + 1} intentos en ${url}`);
}

/** Detecta un SOAP Fault (1.1 o 1.2) y devuelve code + message, o null. */
export function extractFault(
  xml: string
): { code?: string; message: string } | null {
  if (!/faultstring|<faultcode|:Fault|<Fault/i.test(xml)) return null;
  const message =
    extractTag(xml, "faultstring") ??
    extractTag(xml, "Text") ??
    extractTag(xml, "Reason") ??
    "SOAP Fault";
  const code = extractTag(xml, "faultcode") ?? extractTag(xml, "Value") ?? undefined;
  return { code, message };
}

/**
 * Extrae el contenido del primer elemento `<name>…</name>` (ignora prefijo de
 * namespace y atributos). Devuelve null si no existe. Des-escapa entidades XML
 * básicas. Pensado para los nombres de elemento estables de WSAA/WSFEv1.
 */
export function extractTag(xml: string, name: string): string | null {
  // (?:\w+:)? tolera prefijos de namespace (soap:, ns2:, etc.)
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${escapeRe(
      name
    )}>`,
    "i"
  );
  const m = xml.match(re);
  if (!m) return null;
  return unescapeXml(m[1].trim());
}

/** Extrae TODOS los `<name>…</name>` (p. ej. múltiples <Obs> o <Err>). */
export function extractAllTags(xml: string, name: string): string[] {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${escapeRe(
      name
    )}>`,
    "gi"
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(unescapeXml(m[1].trim()));
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
