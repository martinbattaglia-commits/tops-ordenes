/**
 * inbound-consumer.ts — LINK-WA WA-8R9 · M-4 · consumidor durable de la cola.
 *
 * ─── EL PROBLEMA QUE RESUELVE ──────────────────────────────────────────────
 *
 * El webhook contesta HTTP 200 a Meta incluso cuando la proyección no se
 * completó: es lo correcto, porque un 5xx haría que Meta reintente en bucle y
 * el problema no está de su lado. A cambio, el evento queda con
 * `processed = false` en `wa_inbound_events`.
 *
 * Hasta acá nadie leía esa cola. Un status de Meta que no se pudo aplicar —una
 * carrera perdida, una reconciliación, un status llegado antes que el sello—
 * desaparecía sin dejar error en ningún lado. Este módulo es el consumidor que
 * faltaba.
 *
 * ─── FORMA ─────────────────────────────────────────────────────────────────
 *
 * Núcleo PURO con puertos inyectados: no crea clientes, no lee `process.env`,
 * no usa `Date` global y no hace egress. El claim atómico y el backoff viven en
 * PostgreSQL (0229), donde `for update skip locked` los resuelve de verdad;
 * acá vive la orquestación y el saneamiento del error.
 */

/** Un evento reclamado por este worker. */
export interface ClaimedEvent {
  seq: number;
  payload: unknown;
  attempts: number;
}

/** Desenlace del procesamiento de un evento. */
export type EventOutcome = "done" | "retryable" | "permanent";

export interface InboundConsumerPorts {
  /** Reclama hasta `limit` eventos. El claim es atómico: un ganador por fila. */
  claim(token: string, limit: number): Promise<ClaimedEvent[]>;
  /** Registra el desenlace. La cola aplica backoff o marca terminal. */
  release(seq: number, token: string, outcome: EventOutcome, error: string | null): Promise<string>;
  /** Proyecta un evento. Debe ser IDEMPOTENTE: puede correr más de una vez. */
  project(payload: unknown): Promise<{ complete: boolean; errors: string[] }>;
  /** Token opaco de este worker. Inyectado para que el núcleo sea determinista. */
  newToken(): string;
}

export interface ConsumeResult {
  claimed: number;
  done: number;
  requeued: number;
  terminal: number;
  /** Motivos SANEADOS, en el mismo orden en que ocurrieron. */
  errors: string[];
}

/**
 * ── HIGH-3 · TRANSITORIO vs PERMANENTE ────────────────────────────────────
 *
 * `tenant_unresolved` significa que falta `META_WA_PHONE_NUMBER_ID` en la
 * configuración del proceso. NO es un defecto del evento: el payload puede ser
 * perfectamente válido y el mismo evento se procesará bien apenas la variable
 * esté puesta. Tratarlo como permanente era descartar hechos reales de Meta por
 * un error de despliegue —y encima marcarlos `processed`, con lo que ni siquiera
 * quedaban en la cola para recuperarlos—.
 *
 * Los transitorios se evalúan ANTES que los permanentes y ganan: si un lote
 * mezcla ambos, el evento vuelve a la cola. Preferimos reintentar de más antes
 * que perder un hecho del proveedor.
 */
const TRANSITORIOS = [
  "tenant_unresolved", // falta configuración del número comercial
  "state_unavailable", // la base no respondió
  "timeout",
  "network",
  "retryable",
  "reconciliation_required",
] as const;

/**
 * Errores que NO mejoran reintentando: describen el CONTENIDO del evento o una
 * decisión del dominio, no una condición del entorno.
 *
 * `not_whatsapp_object`, `not_object` y `tenant_mismatch` son payloads que este
 * tenant nunca va a poder proyectar; `rejected` es una decisión firme de la RPC.
 */
const PERMANENTES = [
  "rejected",
  "unmatched_permanent",
  "malformed",
  "not_whatsapp_object",
  "not_object",
  "tenant_mismatch",
] as const;

/** ¿Este motivo es una condición del ENTORNO, recuperable por sí sola? */
export function isTransient(error: string): boolean {
  const e = error.toLowerCase();
  return (TRANSITORIOS as readonly string[]).some((t) => e.includes(t));
}

/**
 * Saneamiento del error ANTES de que toque la base.
 *
 * `wa_inbound_events` contiene teléfonos y texto libre de terceros; el mensaje
 * de error es lo único de ese evento que se copia a una columna consultable, y
 * por eso es la frontera donde puede filtrarse PII sin que nadie lo note.
 *
 * Se conserva sólo un CÓDIGO: la primera palabra reconocible del mensaje,
 * normalizada. Nunca el mensaje entero, nunca el payload.
 */
export function sanitizeError(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") return "error_desconocido";
  const token = raw
    .toLowerCase()
    // Se conservan letras ASCII, dígitos y separadores; todo lo demás se corta.
    .replace(/[^a-z0-9_ -]+/g, " ")
    .trim()
    .split(/\s+/)[0];
  if (!token) return "error_desconocido";
  // Un identificador largo suele ser un dato, no un código: se descarta.
  if (token.length > 40 || /^\d+$/.test(token)) return "error_desconocido";
  return token.slice(0, 40);
}

/** ¿Este conjunto de errores es permanente? */
export function isPermanent(errors: readonly string[]): boolean {
  if (errors.length === 0) return false;
  // Un solo motivo TRANSITORIO alcanza para que valga la pena reintentar todo
  // el evento: la condición del entorno puede desaparecer sola.
  if (errors.some(isTransient)) return false;
  return errors.every((e) =>
    (PERMANENTES as readonly string[]).some((p) => e.toLowerCase().includes(p)),
  );
}

/**
 * Una pasada del consumidor.
 *
 * No lanza: cualquier fallo de un evento se traduce en su desenlace y el lote
 * continúa. Un evento que rompe no puede bloquear a los demás — ése es
 * justamente el modo en que una cola se atasca en silencio.
 */
export async function consumeInboundBatch(
  ports: InboundConsumerPorts,
  limit = 10,
): Promise<ConsumeResult> {
  const token = ports.newToken();
  const res: ConsumeResult = { claimed: 0, done: 0, requeued: 0, terminal: 0, errors: [] };

  let claimed: ClaimedEvent[];
  try {
    claimed = await ports.claim(token, limit);
  } catch (e) {
    // Sin claim no hay trabajo tomado: nada que liberar, nada que perder.
    res.errors.push(sanitizeError(e instanceof Error ? e.message : String(e)));
    return res;
  }
  res.claimed = claimed.length;

  for (const ev of claimed) {
    let outcome: EventOutcome;
    let motivo: string | null = null;

    try {
      const proyeccion = await ports.project(ev.payload);
      if (proyeccion.complete) {
        outcome = "done";
      } else {
        motivo = sanitizeError(proyeccion.errors[0]);
        // La proyección incompleta se reintenta salvo que TODOS sus errores
        // sean de los que no mejoran insistiendo.
        outcome = isPermanent(proyeccion.errors) ? "permanent" : "retryable";
      }
    } catch (e) {
      motivo = sanitizeError(e instanceof Error ? e.message : String(e));
      // Una excepción es ambigua por definición: se reintenta.
      outcome = "retryable";
    }

    if (motivo) res.errors.push(motivo);

    let estado: string;
    try {
      estado = await ports.release(ev.seq, token, outcome, motivo);
    } catch {
      // No se pudo registrar el desenlace: el evento queda reclamado y volverá
      // por vencimiento. NO se cuenta como hecho.
      res.errors.push("release_fallido");
      continue;
    }

    if (estado === "done") res.done += 1;
    else if (estado === "terminal") res.terminal += 1;
    else if (estado === "requeued") res.requeued += 1;
    // `not_claimed`: otro worker se quedó con la fila. No se acredita nada.
  }

  return res;
}
