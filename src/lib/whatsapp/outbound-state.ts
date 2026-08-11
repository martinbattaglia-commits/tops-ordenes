/**
 * outbound-state.ts — LINK-WA R1A · Máquina de estados del mensaje WhatsApp.
 *
 * Estados y única progresión admitida:
 *
 *   queued → sending → sent → delivered → read
 *
 * Reglas duras (C4):
 *  · `failed` SÓLO puede cerrar un intento ANTES de `delivered`. Un `failed`
 *    tardío jamás pisa `delivered` ni `read` (Meta puede emitir un error de
 *    plantilla o de reintento después de que el mensaje ya llegó).
 *  · `reconciliation_required` es terminal-hasta-reconciliar: expresa que no se
 *    sabe si Meta aceptó. No retrocede a `failed` ni habilita un segundo egress,
 *    pero SÍ puede avanzar si aparece un status real del webhook (sent en
 *    adelante), que es justamente la reconciliación.
 *  · Eventos repetidos o anteriores son no-op.
 *
 * Puro y sin I/O: el CAS real (update condicional + verificación de row count)
 * vive en el adaptador; acá está la decisión.
 */

export type WaOutboundState =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "reconciliation_required";

/** Orden de la progresión feliz. Los estados fuera de ella no tienen rango. */
const PROGRESS: Record<string, number> = {
  queued: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export function isProgressState(s: string): boolean {
  return s in PROGRESS;
}

/** ¿`delivered` o posterior? A partir de ahí `failed` deja de poder aplicarse. */
export function isDeliveredOrBeyond(state: WaOutboundState | null | undefined): boolean {
  return state === "delivered" || state === "read";
}

/**
 * Decide si `incoming` debe reemplazar a `current`.
 * Devuelve false para no-op (repetido, anterior, o prohibido).
 */
export function canTransition(
  current: WaOutboundState | null | undefined,
  incoming: WaOutboundState,
): boolean {
  if (!current) return true;
  if (current === incoming) return false;

  if (incoming === "failed") {
    // Nunca pisa delivered/read. Tampoco reabre una reconciliación pendiente:
    // ahí no sabemos si el mensaje llegó, y marcarlo failed mentiría.
    return !isDeliveredOrBeyond(current) && current !== "reconciliation_required";
  }

  if (incoming === "reconciliation_required") {
    // Sólo se entra en reconciliación desde un intento en curso.
    return current === "queued" || current === "sending";
  }

  if (current === "failed") {
    // Un intento cerrado como fallido no revive salvo evidencia real de Meta
    // (un status de progreso), que es exactamente lo que reconcilia.
    return isProgressState(incoming) && PROGRESS[incoming] >= PROGRESS.sent;
  }

  if (current === "reconciliation_required") {
    // La reconciliación se resuelve con un status real del proveedor.
    return isProgressState(incoming) && PROGRESS[incoming] >= PROGRESS.sent;
  }

  if (!isProgressState(current) || !isProgressState(incoming)) return false;
  return PROGRESS[incoming] > PROGRESS[current];
}

/**
 * ── WA-7R2 · MARCADOR DURABLE DE AUDITORÍA ────────────────────────────────
 *
 * El estado del proveedor y la auditoría de cierre son hechos DISTINTOS y hasta
 * ahora se confundían. `sent`/`delivered`/`read` sólo dicen que Meta progresó;
 * NO dicen que el intento haya quedado auditado. Un intento cuyo `reply_sent`
 * falló queda sellado con wamid y con estado de progreso, y sin este marcador el
 * reintento lo leía como éxito.
 *
 * El marcador se ata al WAMID, no al mensaje: un marcador viejo no puede
 * acreditar un sello nuevo. Vive en `meta.wa.audit_sent` y sólo lo escribe
 * `markAudited`, DESPUÉS de que `reply_sent` pasó.
 */
export const WA_AUDIT_MARKER_KEY = "audit_sent";

export interface WaAuditMarker {
  /** WAMID que esta auditoría cerró. Debe coincidir con `external_msg_id`. */
  wamid: string;
  at: string;
}

/**
 * ── WA-7R3 · INSTANTE ISO-8601 UTC CANÓNICO ───────────────────────────────
 *
 * Un instante de auditoría no es "una cadena con forma de fecha": es el único
 * dato del marcador que un operador puede correlacionar con el resto del
 * sistema. La forma SINTÁCTICA no alcanza — `2026-02-30T00:00:00Z` y
 * `2026-13-45T99:99:99Z` la satisfacen y no existen —, así que se valida
 * también que la fecha sea REAL y NORMALIZABLE.
 *
 * Sólo se admite el perfil canónico UTC con `Z` literal:
 *   `YYYY-MM-DDTHH:MM:SS[.sss]Z`
 * Un offset (`+00:00`, `-03:00`), un espacio en vez de `T`, una `z` minúscula o
 * más de tres dígitos de milisegundo NO son canónicos y se rechazan: dos
 * escrituras que designan el mismo instante con dos textos distintos vuelven la
 * traza ambigua justo cuando hay que auditarla.
 */
const ISO_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function daysInMonth(year: number, month: number): number {
  if (month !== 2) return MONTH_DAYS[month - 1];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return leap ? 29 : 28;
}

/**
 * ¿`value` es un instante ISO-8601 UTC canónico, real y normalizable?
 *
 * Puro: `Date.UTC` y `new Date(t)` son aritmética sobre el valor recibido, no
 * lecturas del reloj del proceso (la pureza del core prohíbe `new Date()` y
 * `Date.now()`, no el parseo de un argumento).
 *
 * Nota deliberada: los años `0000`–`0099` se rechazan porque `Date.UTC` los
 * remapea a 1900+año y el ida y vuelta deja de cerrar. No son timestamps
 * plausibles y fallar cerrado es preferible a acreditar un instante que la
 * plataforma no reproduce.
 */
export function isCanonicalIsoUtc(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_UTC_RE.exec(value);
  if (!m) return false;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  // `.5` y `.500` designan el mismo instante: se normaliza a milisegundos.
  const ms = m[7] ? Number(m[7].padEnd(3, "0")) : 0;

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  // Sin segundo bisiesto: `:60` no es representable y por lo tanto no es
  // normalizable a un instante.
  if (hour > 23 || minute > 59 || second > 59) return false;

  const t = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  if (!Number.isFinite(t)) return false;

  // Ida y vuelta EXACTA: si algún componente no sobrevive al parseo, la fecha
  // se "arregló" sola (roll-over) y no es la que el llamador escribió.
  const back = new Date(t);
  return (
    back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day &&
    back.getUTCHours() === hour &&
    back.getUTCMinutes() === minute &&
    back.getUTCSeconds() === second &&
    back.getUTCMilliseconds() === ms
  );
}

/**
 * Lee el marcador de un `meta.wa` arbitrario. Cualquier forma inválida ⇒ `null`.
 *
 * WA-7R3 · ESTRUCTURA EXACTA Y NO AMBIGUA. El marcador es lo único que
 * distingue un intento auditado de uno meramente sellado, así que se acepta
 * exactamente `{ wamid, at }` y nada más: ni claves de sobra (que sugerirían
 * otro esquema y otra semántica), ni un `at` con forma de fecha pero imposible,
 * ni un arreglo disfrazado de objeto. Ante la duda, `null`: un marcador que no
 * se entiende no acredita auditoría.
 */
export function readAuditMarker(wa: unknown): WaAuditMarker | null {
  if (!wa || typeof wa !== "object" || Array.isArray(wa)) return null;
  const raw = (wa as Record<string, unknown>)[WA_AUDIT_MARKER_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const marker = raw as Record<string, unknown>;
  const keys = Object.keys(marker);
  if (keys.length !== 2) return null;
  if (!keys.includes("wamid") || !keys.includes("at")) return null;

  const { wamid, at } = marker;
  if (typeof wamid !== "string" || wamid.trim().length === 0) return null;
  if (!isCanonicalIsoUtc(at)) return null;
  return { wamid, at };
}

/**
 * ¿La auditoría de cierre está confirmada PARA ESTE wamid?
 *
 * Exige los tres hechos a la vez. Un marcador presente pero de otro wamid no
 * acredita nada: es residuo de un intento anterior, no una auditoría de éste.
 */
export function isAuditConfirmed(
  auditedWamid: string | null | undefined,
  wamid: string | null | undefined,
  status: WaOutboundState | null | undefined,
): boolean {
  if (!wamid || !auditedWamid) return false;
  if (auditedWamid !== wamid) return false;
  return status === "sent" || status === "delivered" || status === "read";
}

/**
 * Estados compatibles con sellar el marcador: el sello ya ocurrió y el webhook
 * pudo haber avanzado el estado mientras tanto. Nunca `queued`/`sending`
 * (no hubo sello) ni `failed`/`reconciliation_required` (el intento no cerró bien).
 */
export const AUDITABLE_STATUSES: ReadonlyArray<WaOutboundState> = ["sent", "delivered", "read"];

/**
 * Estados desde los que un segundo egress automático está PROHIBIDO.
 *
 * 1B-1D · `failed` TAMBIÉN bloquea: un `clientMsgId` es UN solo intento de red.
 * Reutilizar la fila de un intento fallido abría esta carrera —
 *   failed con wamid anterior → webhook tardío `delivered`/`read` →
 *   segundo envío → sello `sent` con wamid nuevo → regresión de estado.
 * Un reintento humano debe crear un `clientMsgId` nuevo.
 */
export function blocksAutomaticResend(state: WaOutboundState | null | undefined): boolean {
  return (
    state === "sending" ||
    state === "reconciliation_required" ||
    state === "sent" ||
    state === "delivered" ||
    state === "read" ||
    state === "failed"
  );
}
