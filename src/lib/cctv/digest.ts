import { createHash, randomBytes } from "crypto";

/**
 * HTTP Digest Authentication client minimalista.
 *
 * Hikvision (y la mayoría de NVR / cámaras IP industriales) requiere Digest
 * auth, no Basic. El flow es:
 *   1. GET sin auth → 401 + WWW-Authenticate: Digest realm="...", nonce="...", qop="auth"
 *   2. Calculamos response = MD5( HA1 : nonce : nc : cnonce : qop : HA2 )
 *      donde HA1 = MD5( user : realm : pass )  y HA2 = MD5( method : uri )
 *   3. Reenviamos con Authorization: Digest ...
 *
 * Soporta solo MD5 (no SHA-256), single chunk, qop=auth — suficiente para
 * Hikvision ISAPI estándar.
 */

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

function parseChallenge(header: string): DigestChallenge | null {
  if (!header.toLowerCase().startsWith("digest")) return null;
  const out: Record<string, string> = {};
  const re = /([a-z]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header))) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  }
  if (!out.realm || !out.nonce) return null;
  return {
    realm: out.realm,
    nonce: out.nonce,
    qop: out.qop,
    opaque: out.opaque,
    algorithm: out.algorithm,
  };
}

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

function buildAuthHeader(opts: {
  user: string;
  password: string;
  method: string;
  uri: string;
  challenge: DigestChallenge;
  nc?: string;
}): string {
  const { user, password, method, uri, challenge } = opts;
  const cnonce = randomBytes(8).toString("hex");
  const nc = opts.nc ?? "00000001";

  const ha1 = md5(`${user}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = challenge.qop?.split(",")[0]?.trim() || undefined;

  let response: string;
  if (qop === "auth") {
    response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  } else {
    response = md5(`${ha1}:${challenge.nonce}:${ha2}`);
  }

  const parts = [
    `username="${user}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm="${challenge.algorithm || "MD5"}"`,
  ];
  if (qop) {
    parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  }
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  return "Digest " + parts.join(", ");
}

export interface DigestFetchOpts {
  user: string;
  password: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  headers?: Record<string, string>;
  body?: BodyInit;
  /** Timeout en ms — default 10s. */
  timeoutMs?: number;
  /** Opcional: AbortSignal externo. */
  signal?: AbortSignal;
}

/**
 * fetch() con HTTP Digest auth. Hace 2 round-trips siempre (no cachea nonce
 * entre llamadas para mantener simple). Para alta frecuencia, agregar caché
 * de nonce por host en F3.
 */
export async function digestFetch(url: string, opts: DigestFetchOpts): Promise<Response> {
  const method = opts.method ?? "GET";
  const parsedUrl = new URL(url);
  const uri = parsedUrl.pathname + parsedUrl.search;

  const ctrl = new AbortController();
  const externalSignal = opts.signal;
  const cleanup = () => clearTimeout(timer);
  const timer = setTimeout(() => ctrl.abort(new Error("Digest fetch timeout")), opts.timeoutMs ?? 10_000);
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort(externalSignal.reason);
    else externalSignal.addEventListener("abort", () => ctrl.abort(externalSignal.reason), { once: true });
  }

  try {
    // 1er request — esperamos 401
    const first = await fetch(url, {
      method,
      headers: opts.headers,
      body: opts.body,
      signal: ctrl.signal,
      // Hikvision a veces sirve con certs autofirmados en HTTPS
      // @ts-expect-error: node fetch tolerates this
      rejectUnauthorized: false,
    });

    if (first.status !== 401) {
      // No requirió auth (raro, pero válido)
      cleanup();
      return first;
    }

    // Drenar el body del primer response (best-effort)
    try {
      await first.arrayBuffer();
    } catch {}

    const wwwAuth = first.headers.get("www-authenticate") || first.headers.get("WWW-Authenticate") || "";
    const challenge = parseChallenge(wwwAuth);
    if (!challenge) {
      cleanup();
      throw new Error(`Digest auth: WWW-Authenticate inválido o ausente — recibido: "${wwwAuth.slice(0, 200)}"`);
    }

    // 2do request — con Authorization
    const authHeader = buildAuthHeader({
      user: opts.user,
      password: opts.password,
      method,
      uri,
      challenge,
    });

    const res = await fetch(url, {
      method,
      headers: { ...opts.headers, Authorization: authHeader },
      body: opts.body,
      signal: ctrl.signal,
      // @ts-expect-error: node fetch tolerates this
      rejectUnauthorized: false,
    });
    cleanup();
    return res;
  } catch (e) {
    cleanup();
    throw e;
  }
}
