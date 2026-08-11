/**
 * transport.ts — LINK-WA R1A · Transporte Meta con contrato estricto.
 *
 * Reemplaza al `sendText` histórico de `meta.ts` para el flujo del inbox. La
 * diferencia clave es el manejo del resultado, no el HTTP:
 *
 *   · `accepted`  — Meta devolvió 2xx Y un `messages[0].id` real. Único caso en
 *                   el que el mensaje puede considerarse entregado al proveedor.
 *   · `rejected`  — Meta rechazó de forma DETERMINISTA (HTTP no exitoso o JSON
 *                   inválido en una respuesta NO-2xx). Es seguro marcar
 *                   `failed`: no hay mensaje en vuelo.
 *   · `ambiguous` — timeout, error de red, o un 2xx que no permite afirmar el
 *                   resultado (cuerpo vacío, no parseable, o sin wamid). NO se
 *                   sabe si Meta aceptó: nunca se reintenta automáticamente,
 *                   queda `reconciliation_required`.
 *
 * Se eliminó el fallback `"(sin id)"` de `meta.ts`: un 2xx sin `messages[0].id`
 * producía un `ok:true` con un wamid falso que jamás casaba con los statuses del
 * webhook, dejando el mensaje eternamente en `sent`.
 *
 * El transporte es un puerto inyectable: los tests usan un fake y NUNCA tocan la
 * red ni la API real de Meta.
 */

export type MetaSendOutcome =
  | { kind: "accepted"; wamid: string }
  | {
      kind: "rejected";
      reason: "http_error" | "invalid_json" | "not_configured";
      status: number | null;
      detail: string;
    }
  | {
      kind: "ambiguous";
      /**
       * R5 · un 2xx que no permite afirmar el resultado es AMBIGUO, no un
       * rechazo reintentable: Meta pudo haber aceptado el mensaje.
       *  · `contract_unknown` — 2xx sin `messages[0].id`, o con wamid inválido.
       *  · `invalid_2xx`      — 2xx con cuerpo vacío o JSON no parseable.
       */
      reason:
        | "timeout"
        | "network"
        | "contract_unknown"
        | "invalid_2xx"
        /** 5xx, 408 y gateways: el mensaje pudo haber sido aceptado. */
        | "server_error";
      detail: string;
    };

export interface MetaTextTransport {
  sendText(input: { to: string; text: string }): Promise<MetaSendOutcome>;
}

export interface MetaHttpTransportConfig {
  token: string | undefined;
  phoneNumberId: string | undefined;
  /** Inyectable para tests. Por defecto el `fetch` global. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  graphBase?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const GRAPH = "https://graph.facebook.com/v22.0";

/** 408 (timeout) y 5xx/gateway: resultado indeterminado, nunca rechazo. */
export function isAmbiguousStatus(status: number): boolean {
  return status === 408 || status >= 500;
}

/** Extrae el wamid respetando el contrato. `null` ⇒ resultado desconocido. */
export function extractWamid(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const first = messages[0];
  if (!first || typeof first !== "object") return null;
  const id = (first as { id?: unknown }).id;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null;
}

/** ¿El resultado deja el mensaje potencialmente en vuelo en Meta? */
export function requiresReconciliation(outcome: MetaSendOutcome): boolean {
  return outcome.kind === "ambiguous";
}

export function createMetaHttpTransport(config: MetaHttpTransportConfig): MetaTextTransport {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = config.graphBase ?? GRAPH;

  return {
    async sendText({ to, text }): Promise<MetaSendOutcome> {
      const token = config.token?.trim();
      const phoneNumberId = config.phoneNumberId?.trim();
      if (!token || !phoneNumberId) {
        return {
          kind: "rejected",
          reason: "not_configured",
          status: null,
          detail: "META_WA_TOKEN / META_WA_PHONE_NUMBER_ID ausentes",
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${base}/${phoneNumberId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: to.replace(/\D/g, ""),
            type: "text",
            text: { body: text, preview_url: false },
          }),
          signal: controller.signal,
        });
      } catch (e) {
        // Abort o fallo de red: el POST pudo haber llegado. Ambiguo por definición.
        const aborted = e instanceof Error && e.name === "AbortError";
        return {
          kind: "ambiguous",
          reason: aborted ? "timeout" : "network",
          detail: aborted ? `timeout ${timeoutMs}ms` : "fallo de red",
        };
      } finally {
        clearTimeout(timer);
      }

      let parsed: unknown;
      try {
        const text = await res.text();
        if (res.ok && text.trim().length === 0) {
          // 2xx vacío: no se puede afirmar nada sobre la aceptación.
          return { kind: "ambiguous", reason: "invalid_2xx", detail: "2xx con cuerpo vacío" };
        }
        parsed = JSON.parse(text);
      } catch {
        if (res.ok) {
          return { kind: "ambiguous", reason: "invalid_2xx", detail: "2xx no parseable" };
        }
        if (isAmbiguousStatus(res.status)) {
          return { kind: "ambiguous", reason: "server_error", detail: `HTTP ${res.status}` };
        }
        return {
          kind: "rejected",
          reason: "invalid_json",
          status: res.status,
          detail: "respuesta no parseable",
        };
      }

      if (!res.ok) {
        // §5 · sólo un 4xx inequívoco es un RECHAZO. 408 y 5xx dejan el
        // resultado indeterminado: Meta pudo haber aceptado antes de fallar.
        if (isAmbiguousStatus(res.status)) {
          return { kind: "ambiguous", reason: "server_error", detail: `HTTP ${res.status}` };
        }
        // El mensaje del proveedor NO se propaga: sólo el código.
        return {
          kind: "rejected",
          reason: "http_error",
          status: res.status,
          detail: `HTTP ${res.status}`,
        };
      }

      const wamid = extractWamid(parsed);
      if (!wamid) {
        // R5 · 2xx SIN wamid: contrato roto y resultado DESCONOCIDO. No es un
        // rechazo — Meta pudo haber aceptado y devuelto una forma inesperada.
        // Devolverlo como `rejected` habilitaría un reintento que duplicaría.
        return {
          kind: "ambiguous",
          reason: "contract_unknown",
          detail: "2xx sin messages[0].id",
        };
      }
      return { kind: "accepted", wamid };
    },
  };
}
