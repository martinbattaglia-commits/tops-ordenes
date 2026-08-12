/**
 * make-relay.ts — puente validado Nexus → Make para eventos de Meta.
 *
 * El llamador ya verificó la firma HMAC de Meta. Este módulo conserva el body
 * crudo byte a byte y lo entrega al webhook de Make sin parsearlo ni volverlo a
 * serializar. Está apagado por defecto: habilitarlo exige una env explícita y
 * una URL HTTPS del host de hooks autorizado.
 *
 * Nunca registra la URL, la firma, el body ni la respuesta de Make.
 */

const MAKE_RELAY_HOST = "hook.us2.make.com";
const DEFAULT_TIMEOUT_MS = 4_000;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 5_000;

export type RelayFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface MakeRelayConfig {
  enabled: boolean;
  endpoint?: string | null;
  /** Identidad estable del evento (SHA-256 del body crudo) para dedupe downstream. */
  relayId?: string | null;
  timeoutMs?: number;
  fetchImpl?: RelayFetch;
}

export type MakeRelayResult =
  | { ok: true; state: "disabled" | "delivered" }
  | {
      ok: false;
      state: "misconfigured" | "timeout" | "network" | "upstream_rejected";
    };

/**
 * El relay es un egress privilegiado. La allowlist evita que una variable mal
 * cargada convierta al webhook público en un proxy SSRF.
 */
export function validateMakeRelayEndpoint(raw: string | null | undefined): URL | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== MAKE_RELAY_HOST) return null;
    if (url.port || url.username || url.password) return null;
    if (url.search || url.hash) return null;
    if (!/^\/[A-Za-z0-9_-]+$/.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

function boundedTimeout(raw: number | undefined): number {
  if (!Number.isFinite(raw)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(raw as number), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/** Entrega exacta del POST firmado de Meta a Make. */
export async function relayToMake(
  rawBody: string,
  signatureHeader: string | null,
  config: MakeRelayConfig,
): Promise<MakeRelayResult> {
  if (!config.enabled) return { ok: true, state: "disabled" };

  const endpoint = validateMakeRelayEndpoint(config.endpoint);
  if (!endpoint) return { ok: false, state: "misconfigured" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedTimeout(config.timeoutMs));
  const fetchImpl = config.fetchImpl ?? fetch;

  const headers = new Headers({
    "content-type": "application/json",
    "x-nexus-relay": "whatsapp-meta-v1",
  });
  if (signatureHeader) headers.set("x-hub-signature-256", signatureHeader);
  if (config.relayId && /^[a-f0-9]{64}$/.test(config.relayId)) {
    headers.set("x-nexus-relay-id", config.relayId);
  }

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: rawBody,
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    try {
      if (!response.ok) return { ok: false, state: "upstream_rejected" };
      return { ok: true, state: "delivered" };
    } finally {
      // Nunca leemos el body de Make (podría ser grande o contener datos), pero
      // lo cancelamos para liberar el stream/conexión de forma acotada.
      await response.body?.cancel().catch(() => {});
    }
  } catch {
    return controller.signal.aborted
      ? { ok: false, state: "timeout" }
      : { ok: false, state: "network" };
  } finally {
    clearTimeout(timeout);
  }
}
