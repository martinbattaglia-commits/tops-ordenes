/**
 * realtime-status.ts — LINK-WA WA-8R3 · Proyección WhatsApp sanitizada y
 * reconciliación por la máquina canónica.
 *
 * ── QUÉ CORRIGE RESPECTO DE WA-8R2 ─────────────────────────────────────────
 *
 * WA-8R2 inventó una retícula propia (`unconfirmed < failed <
 * reconciliation_required < audited_confirmed`) y la usó como si fuera la
 * máquina de estados. No lo era: sustituía `canTransition` por un orden elegido
 * a mano, y divergía del canon en casos reales — `sent → failed` quedaba
 * bloqueado por el tope terminal, y `failed → reconciliation_required` quedaba
 * permitido cuando el canon lo prohíbe.
 *
 * Acá la ÚNICA autoridad de transición es `canTransition` de
 * `outbound-state.ts` (congelado por WA-7C4). Este módulo no decide qué
 * transición es legal: se lo pregunta.
 *
 * ── LOS TRES HECHOS SE GUARDAN POR SEPARADO ────────────────────────────────
 *
 *  · `direction`     — inbound / outbound / unknown;
 *  · `providerState` — estado canónico del proveedor;
 *  · `audited`       — el marcador de auditoría existe, es válido y coincide
 *                      con el wamid sellado.
 *
 * Confundirlos fue el origen de los defectos anteriores: un status de progreso
 * no implica auditoría, y una auditoría no vuelve inmutable el estado operativo.
 *
 * ── ORDENAMIENTO ───────────────────────────────────────────────────────────
 *
 * `canTransition` NO es conmutativa (`sent→failed` es legal y `failed→sent`
 * también), así que aplicarla en orden de LLEGADA haría que el resultado
 * dependiera de la red. El mandato exige que un evento ANTERIOR sea no-op, y eso
 * sólo es decidible con un instante: se usa `meta.wa.status_at`, validado con el
 * mismo `isCanonicalIsoUtc` del core. Un evento sin instante no puede pisar un
 * estado que sí lo tiene — el resultado de la acción es una foto que pudo
 * quedar vieja mientras viajaba, y realtime trae el estado durable fechado.
 *
 * NADA de `meta` crudo, wamid, teléfono ni payload cruza esta frontera: sólo
 * los tres hechos anteriores más un instante propio.
 */

import type {
  WaDirection, WaProjection, WaProviderState, WaStateSource,
} from "./types";
import {
  canTransition,
  readAuditMarker,
  isAuditConfirmed,
  isCanonicalIsoUtc,
  AUDITABLE_STATUSES,
  type WaOutboundState,
} from "@/lib/whatsapp/outbound-state";

/** Estados del proveedor reconocidos. Espejo cerrado de `WaOutboundState`. */
export const WA_REALTIME_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
  "reconciliation_required",
] as const;

/** Falla la compilación si el canon agrega un estado y acá no se entera. */
type StatusesAreExhaustive = WaOutboundState extends (typeof WA_REALTIME_STATUSES)[number]
  ? true
  : never;
const _statusesAreExhaustive: StatusesAreExhaustive = true;
void _statusesAreExhaustive;

/**
 * El DTO vive en `types.ts` (contexto `connect`, sin dependencias de
 * `whatsapp`). Acá se verifica que su espejo del estado siga siendo compatible
 * con la máquina canónica: si el canon agrega un estado, esto deja de compilar.
 */
type MirrorIsExhaustive = WaOutboundState extends WaProviderState ? true : never;
const _mirrorIsExhaustive: MirrorIsExhaustive = true;
void _mirrorIsExhaustive;

type MirrorIsNotWider = WaProviderState extends WaOutboundState ? true : never;
const _mirrorIsNotWider: MirrorIsNotWider = true;
void _mirrorIsNotWider;

export type { WaDirection, WaProjection, WaStateSource } from "./types";

export type ParsedWaStatus =
  | { known: true; status: WaOutboundState | null }
  | { known: false };

const UNKNOWN: ParsedWaStatus = { known: false };

/** Lee `meta.wa` de forma fail-closed. Nunca arroja. */
function readWa(meta: unknown): Record<string, unknown> | null {
  if (meta == null || typeof meta !== "object" || Array.isArray(meta)) return null;
  const wa = (meta as Record<string, unknown>).wa;
  if (wa == null || typeof wa !== "object" || Array.isArray(wa)) return null;
  return wa as Record<string, unknown>;
}

/** Extrae `meta.wa.status`. Cualquier valor fuera del enum ⇒ desconocido. */
export function parseWaRealtimeStatus(meta: unknown): ParsedWaStatus {
  const wa = readWa(meta);
  if (!wa) return UNKNOWN;
  const status = wa.status;
  if (status === null) return { known: true, status: null };
  if (typeof status !== "string") return UNKNOWN;
  if (!(WA_REALTIME_STATUSES as readonly string[]).includes(status)) return UNKNOWN;
  return { known: true, status: status as WaOutboundState };
}

/** Dirección declarada. Ausente o malformada ⇒ `unknown` (fail-closed). */
export function parseWaDirection(meta: unknown): WaDirection {
  const wa = readWa(meta);
  if (!wa) return "unknown";
  if (wa.direction === "inbound") return "inbound";
  if (wa.direction === "outbound") return "outbound";
  return "unknown";
}

/**
 * WA-8R7 · pares fuente/estado VÁLIDOS.
 *
 * El servidor sólo puede haber escrito los estados de su propio flujo; Meta sólo
 * puede haber observado los que su webhook reporta. Una combinación fuera de
 * esta tabla no es un hecho confiable: queda `unknown` y fail-closed. Es una
 * tabla de PROCEDENCIA, no una prioridad por estado.
 */
const SOURCE_STATES: Record<
  // `unknown` e `historical_unknown` no figuran a propósito: no son procedencias
  // ACREDITABLES, son la ausencia de una. Ningún estado les pertenece.
  Exclude<WaStateSource, "unknown" | "historical_unknown">,
  readonly WaProviderState[]
> = {
  server: ["queued", "sending", "sent", "failed", "reconciliation_required"],
  meta: ["sent", "delivered", "read", "failed"],
};

/**
 * Procedencia declarada en la fila, validada contra el estado observado.
 *
 * Nunca se infiere: si la fila no la declara —por ejemplo porque se escribió
 * antes de WA-8R7— queda `unknown`. Adivinar el origen a partir del estado
 * sería exactamente lo que el contrato prohíbe.
 */
export function parseWaStateSource(meta: unknown, state: WaProviderState | null): WaStateSource {
  const wa = readWa(meta);
  const raw = wa?.status_source;
  if (raw !== "server" && raw !== "meta") return "unknown";
  if (state === null) return "unknown";
  return SOURCE_STATES[raw].includes(state) ? raw : "unknown";
}

/** Autoridad relativa: `unknown` no tiene ninguna; Meta observa al proveedor. */
const SOURCE_AUTHORITY: Record<WaStateSource, number> = {
  // Un estado histórico no acredita NADA: pesa lo mismo que no saber. Darle
  // autoridad intermedia lo dejaría ganarle a un hecho real del servidor.
  unknown: 0,
  historical_unknown: 0,
  server: 1,
  meta: 2,
};

/** Proyección vacía: no se sabe nada del mensaje. */
export const EMPTY_PROJECTION: WaProjection = {
  direction: "unknown",
  providerState: null,
  audited: false,
  stateAt: null,
  candidates: [],
  stateSource: "unknown",
};

/** Orden canónico de los candidatos: el de la progresión, no el alfabético. */
const CANON_INDEX = new Map<WaProviderState, number>(
  WA_REALTIME_STATUSES.map((s, i) => [s, i]),
);

/** Une dos conjuntos de candidatos: deduplicado y ordenado determinísticamente. */
function unionCandidates(
  a: readonly WaProviderState[],
  b: readonly WaProviderState[],
): readonly WaProviderState[] {
  const set = new Set<WaProviderState>([...a, ...b]);
  return [...set].sort((x, y) => (CANON_INDEX.get(x) ?? 0) - (CANON_INDEX.get(y) ?? 0));
}

/**
 * WA-8R5 · GANADOR ÚNICO entre candidatos del mismo instante.
 *
 * Un estado gana si TODO otro candidato puede llegar a él — es decir, si es
 * igual a él o `canTransition` lo autoriza. Cero o varios ganadores significa
 * que el conjunto de hechos no determina un estado, y eso es una AMBIGÜEDAD.
 *
 * El criterio depende sólo del CONJUNTO, así que el resultado es idéntico para
 * cualquier permutación: la conmutatividad y la asociatividad salen de la
 * definición, no de probar orden por orden. Y sigue sin haber jerarquía propia:
 * la única pregunta que se hace es `canTransition`.
 */
export function resolveWinner(
  candidates: readonly WaProviderState[],
): WaProviderState | null {
  const winners = candidates.filter((w) =>
    candidates.every((c) => c === w || canTransition(c, w)),
  );
  return winners.length === 1 ? winners[0] : null;
}

/** ¿`next` es alcanzable desde TODOS los candidatos conservados? */
function reachableFromAll(
  candidates: readonly WaProviderState[],
  next: WaProviderState,
): boolean {
  if (candidates.length === 0) return true;
  return candidates.every((c) => c === next || canTransition(c, next));
}

/**
 * Proyecta una fila (realtime o hidratación) a los tres hechos sanitizados.
 * `meta` y `externalMsgId` entran como `unknown` y NO salen.
 */
export function projectWaMessage(input: {
  meta: unknown;
  externalMsgId: unknown;
}): WaProjection {
  const direction = parseWaDirection(input.meta);

  // C · un inbound no tiene estado de egress y jamás lo adquiere.
  if (direction === "inbound") {
    return {
      direction: "inbound", providerState: null, audited: false, stateAt: null,
      candidates: [], stateSource: "unknown",
    };
  }

  const parsed = parseWaRealtimeStatus(input.meta);
  const providerState = parsed.known ? parsed.status : null;

  const wa = readWa(input.meta);
  const rawAt = wa?.status_at;
  const stateAt = isCanonicalIsoUtc(rawAt) ? rawAt : null;

  // WA-8R4 · sólo una fila que se declara SALIENTE puede acreditar auditoría.
  // Una dirección ausente o malformada no dice de quién es el mensaje, así que
  // su marcador y su wamid no prueban que ESTE tenant haya enviado nada: queda
  // fail-closed aunque el status sea auditable y el marcador válido.
  const marker = direction === "outbound" ? readAuditMarker(wa) : null;
  const externalMsgId =
    direction === "outbound" &&
    typeof input.externalMsgId === "string" &&
    input.externalMsgId.trim().length > 0
      ? input.externalMsgId
      : null;
  // WA-8R7 · una fuente desconocida no puede acreditar auditoría: no se sabe
  // quién escribió el estado sobre el que se apoyaría la confirmación.
  const parsedSource = parseWaStateSource(input.meta, providerState);
  // WA-8R9 · H-3 · hay un estado registrado pero nadie puede acreditar quién lo
  // escribió: es una fila HISTÓRICA. Se marca como tal en vez de confundirla
  // con la ausencia de estado, porque la UI las trata distinto.
  const stateSource: WaStateSource =
    parsedSource === "unknown" && providerState !== null
      ? "historical_unknown"
      : parsedSource;
  const audited =
    direction === "outbound" &&
    stateSource !== "unknown" &&
    stateSource !== "historical_unknown" &&
    isAuditConfirmed(marker?.wamid ?? null, externalMsgId, providerState);

  return {
    direction,
    providerState,
    audited,
    stateAt,
    candidates: providerState === null ? [] : [providerState],
    stateSource,
  };
}

/**
 * Proyección equivalente al resultado de la Server Action.
 *
 * `sent` acredita auditoría porque el core sólo devuelve `ok: true` después de
 * `markAudited`, o vía `isAuditConfirmed` en el intento reutilizado
 * (`reply-core.executeReply` / `resolveClosedAttempt`, congelados por WA-7C4).
 *
 * Sin `stateAt`: el resultado de la acción es una foto que pudo quedar vieja
 * mientras viajaba, así que no puede pisar un estado fechado por realtime.
 */
export function projectionFromActionOutcome(outcome: {
  status: "sent" | "pending" | "failed";
}): WaProjection {
  const providerState: WaOutboundState =
    outcome.status === "sent"
      ? "sent"
      : outcome.status === "pending"
        ? "reconciliation_required"
        : "failed";
  return {
    direction: "outbound",
    providerState,
    audited: outcome.status === "sent",
    stateAt: null,
    candidates: [providerState],
    // El resultado de la acción lo produce el servidor: su procedencia es
    // `server`, y sus estados están dentro de los que el servidor puede escribir.
    stateSource: "server",
  };
}

/** Parte de la proyección que gobierna `canTransition`: candidatos e instante. */
type StatePart = {
  providerState: WaProviderState | null;
  stateAt: string | null;
  candidates: readonly WaProviderState[];
  stateSource: WaStateSource;
};

/**
 * WA-8R5 · resuelve el estado canónico acumulando los hechos del instante.
 *
 * WA-8R4 resolvía bien los PARES empatados, pero al detectar una ambigüedad
 * reemplazaba el estado por `null` y perdía los candidatos que la habían
 * causado. Con tres eventos en el mismo instante eso rompía la asociatividad:
 * `sent → failed → delivered` quedaba ambiguo y `sent → delivered → failed`
 * terminaba en `delivered`, con el mismo conjunto de hechos.
 *
 * Ahora el instante conserva su CONJUNTO de candidatos y el ganador se recalcula
 * completo cada vez, así que el resultado depende del conjunto y no del orden.
 * `canTransition` sigue siendo la única autoridad para las TRANSICIONES.
 *
 * WA-8R6 · además se distingue lo PROVISIONAL de lo DURABLE. El resultado de la
 * acción no trae instante: es una foto que pudo quedar vieja en el viaje. Una
 * fila fechada la reemplaza sin preguntarle a `canTransition`, porque no se
 * trata de una transición del proveedor sino de sustituir una foto por el estado
 * durable observado. Exigir alcanzabilidad ahí conservaba la foto y volvía el
 * resultado dependiente del orden.
 */
function resolveState(current: StatePart, incoming: StatePart): StatePart {
  const next = incoming.providerState;
  if (next === null) return current;

  /** Sustituye por completo el hecho entrante. */
  const replace = (): StatePart => ({
    providerState: next,
    stateAt: incoming.stateAt,
    candidates: incoming.candidates,
    stateSource: incoming.stateSource,
  });

  /** Sustituye sólo si el canon autoriza llegar desde todos los candidatos. */
  const advanceIfCanonical = (): StatePart =>
    reachableFromAll(current.candidates, next) ? replace() : current;

  const cs = current.stateSource;
  const is = incoming.stateSource;

  // ── WA-8R7 · PROCEDENCIA ANTES QUE RELOJ ───────────────────────────────
  // Una fuente desconocida no tiene autoridad: no pisa a una conocida.
  if (is === "unknown" && cs !== "unknown") return current;
  // Y una fuente conocida desplaza a una desconocida sin negociar: el estado
  // actual no tiene procedencia verificable contra la cual comparar.
  if (cs === "unknown" && is !== "unknown") return replace();

  if (cs !== is) {
    // Dominios de reloj DISTINTOS: sus instantes no son comparables, así que no
    // se comparan. Manda quién observó el hecho.
    //
    //  · un hecho de Meta es la observación REAL del proveedor y desplaza al
    //    estado local del servidor;
    //  · un estado del servidor NO puede pisar un hecho de Meta ya observado.
    //
    // El reemplazo cruzado es incondicional a propósito, y el único par donde
    // eso importa es `reconciliation_required` (servidor) + `failed` (Meta):
    // el canon prohíbe esa transición porque un `failed` NUESTRO no puede pisar
    // una reconciliación pendiente —no sabemos si el mensaje salió—, pero un
    // `failed` observado por Meta es justamente la información que resuelve esa
    // incógnita. Bloquearlo dejaría la burbuja en «pendiente» para siempre y,
    // peor, haría que el resultado dependiera del orden de llegada.
    //
    // `canTransition` no se modifica y sigue gobernando DENTRO de cada dominio:
    // en particular `delivered`/`read` → `failed` sigue prohibido, porque ahí
    // ambos hechos son de Meta y se comparan en su propio dominio.
    return is === "meta" ? replace() : current;
  }

  // ── MISMO DOMINIO: los instantes SÍ son comparables ────────────────────
  const ca = current.stateAt;
  const ia = incoming.stateAt;

  // §4 · una proyección provisional no pisa una fechada.
  if (ca !== null && ia === null) return current;
  // §2 · una proyección durable reemplaza a la provisional, venga como venga.
  if (ca === null && ia !== null) return replace();
  // §5 · ambas provisionales: conjunto determinista.
  if (ca === null && ia === null) {
    const candidates = unionCandidates(current.candidates, incoming.candidates);
    return {
      providerState: resolveWinner(candidates), stateAt: null, candidates, stateSource: is,
    };
  }

  const ti = Date.parse(ia as string);
  const tc = Date.parse(ca as string);

  if (ti < tc) return current; // anterior: no-op
  if (ti > tc) return advanceIfCanonical(); // posterior: contrato canónico

  // §6 · mismo instante y mismo dominio: se acumula y se recalcula.
  const candidates = unionCandidates(current.candidates, incoming.candidates);
  if (candidates.length === current.candidates.length && current.providerState !== null) {
    return current; // idempotente
  }
  return {
    providerState: resolveWinner(candidates), stateAt: ca, candidates, stateSource: is,
  };
}

/**
 * Fusiona dos proyecciones. La transición la autoriza `canTransition`, nunca
 * este módulo.
 *
 *  · `direction` conocida no se degrada a `unknown`;
 *  · `inbound` es absorbente: un mensaje recibido nunca adquiere estado de egress;
 *  · `audited` es monótono — el marcador durable no se des-escribe (`sealSent`
 *    sólo puede limpiarlo desde `sending`, inalcanzable después de auditar);
 *  · un evento anterior, repetido o no ordenable es no-op sobre el estado.
 */
export function mergeWaProjection(
  current: WaProjection | undefined,
  incoming: WaProjection | null,
): WaProjection | undefined {
  if (!incoming) return current;
  if (!current) return incoming;

  if (current.direction === "inbound" || incoming.direction === "inbound") {
    return {
      direction: "inbound", providerState: null, audited: false, stateAt: null,
      candidates: [], stateSource: "unknown",
    };
  }

  const direction = incoming.direction !== "unknown" ? incoming.direction : current.direction;
  const audited = current.audited || incoming.audited;

  const resolved = resolveState(
    {
      providerState: current.providerState,
      stateAt: current.stateAt,
      candidates: current.candidates,
      stateSource: current.stateSource,
    },
    {
      providerState: incoming.providerState,
      stateAt: incoming.stateAt,
      candidates: incoming.candidates,
      stateSource: incoming.stateSource,
    },
  );

  return {
    direction,
    providerState: resolved.providerState,
    // Una ambigüedad es fail-closed también para la auditoría: mientras el
    // conjunto de hechos no determine un estado, no se acredita ningún cierre.
    // Ambigüedad o procedencia desconocida ⇒ fail-closed también para la auditoría.
    audited:
      resolved.providerState === null || resolved.stateSource === "unknown" ? false : audited,
    stateAt: resolved.stateAt,
    candidates: resolved.candidates,
    stateSource: resolved.stateSource,
  };
}

/** ¿La confirmación es afirmativa? Único criterio para limpiar el error. */
export function isAuditedConfirmation(wa: WaProjection | undefined): boolean {
  // WA-8R4 · dirección OUTBOUND explícita, literal. `inbound` no tiene egress y
  // `unknown` no permite afirmar nada: ambos fail-closed.
  if (!wa || wa.direction !== "outbound") return false;
  // WA-8R7 · defensa en profundidad: aunque `audited` viniera en `true`, una
  // procedencia desconocida no acredita nada.
  if (wa.stateSource === "unknown") return false;
  const s = wa.providerState;
  return wa.audited && s !== null && AUDITABLE_STATUSES.includes(s);
}

/** Estado visual de la burbuja. `undefined` ⇒ sin marca de egress. */
/**
 * Estado VISUAL de la burbuja.
 *
 * WA-8R9 · H-3 · `historical` es un estado propio y no un `undefined`. La
 * diferencia es la que causaba el defecto: `undefined` significa "sin
 * indicador", que en una burbuja SALIENTE se lee como entregada. Una fila sin
 * procedencia acreditable no puede afirmar ni éxito ni intento en curso, así
 * que necesita su propio estado neutro.
 */
export type BubbleStatus = "sending" | "pending" | "failed" | "historical" | undefined;

/**
 * Estado visual derivado de la proyección.
 *
 * D · `undefined` NO equivale por sí mismo a éxito: sólo se llega ahí con
 * evidencia afirmativa (auditoría válida) o porque el mensaje es inbound y no
 * tiene egress que reportar.
 *
 * La AUSENCIA de proyección significa burbuja optimista local todavía en vuelo.
 * Una proyección presente sin estado del proveedor significa lo contrario: el
 * servidor miró la fila y no encontró evidencia — eso es `pending`, no éxito.
 */
export function bubbleStatusFromProjection(wa: WaProjection | undefined): BubbleStatus {
  if (!wa) return "sending";
  if (wa.direction === "inbound") return undefined;

  // ── WA-8R9 · H-3 · NEUTRALIDAD DE LO NO ACREDITABLE ─────────────────────
  //
  // Antes, cualquier proyección que no encajara en las ramas de abajo caía en
  // el `return "pending"` final. Eso pintaba como "pendiente de confirmación"
  // dos poblaciones que no son intentos en curso:
  //
  //  · filas de dirección DESCONOCIDA — no se sabe siquiera si este tenant las
  //    envió, así que anunciar un envío pendiente es una afirmación inventada;
  //  · filas HISTÓRICAS — tienen estado registrado pero nadie puede acreditar
  //    quién lo escribió. Mostrarlas como pendientes sugiere que hay algo por
  //    resolver, cuando lo único cierto es que no hay evidencia.
  //
  // Ambas quedan NEUTRAS: sin indicador. La hora del mensaje se sigue
  // mostrando; lo que desaparece es la afirmación sobre su envío.
  if (wa.direction === "unknown") return "historical";
  if (wa.stateSource === "historical_unknown") return "historical";

  const s = wa.providerState;
  if (s === "failed") return "failed";
  if (s === "reconciliation_required") return "pending";
  // WA-8R4 · la confirmación se decide en UN solo lugar. Mirar `wa.audited` en
  // crudo dejaba confirmar una proyección de dirección desconocida.
  if (s !== null && AUDITABLE_STATUSES.includes(s)) {
    return isAuditedConfirmation(wa) ? undefined : "pending";
  }
  if (s === "queued" || s === "sending") return "sending";
  return "pending";
}



/** Memoria por mensaje: proyección sanitizada + estado visual derivado. */
export interface MessageState {
  wa?: WaProjection;
  status: BubbleStatus;
}

export type EvidenceSource = "realtime" | "action";

/**
 * ÚNICA política de reducción, aplicada por realtime y por la acción sobre el
 * estado más reciente.
 *
 * No-WhatsApp conserva EXACTAMENTE la semántica Connect vigente: la fila real
 * limpia la marca optimista, porque ahí la existencia de la fila sí implica que
 * el mensaje se posteó.
 */
export function reduceMessageState({
  kind,
  source,
  current,
  incoming,
}: {
  kind: unknown;
  source: EvidenceSource;
  current: { wa?: WaProjection; status?: BubbleStatus };
  incoming: WaProjection | null;
}): MessageState {
  if (kind !== "whatsapp") {
    if (source === "realtime") return { wa: undefined, status: undefined };
    return {
      wa: undefined,
      status: incoming?.providerState === "failed" ? "failed" : undefined,
    };
  }

  const wa = mergeWaProjection(current.wa, incoming);
  return { wa, status: bubbleStatusFromProjection(wa) };
}

/**
 * Estado con el que se hidrata un mensaje que viene del servidor.
 *
 * B · carga inicial, recarga y cambio de conversación pasan por acá y producen
 * la misma semántica que realtime. Un mensaje hidratado SIEMPRE trae proyección
 * (aunque sea vacía), y por eso no puede confundirse con una burbuja optimista.
 */
export function hydrateMessageState(kind: unknown, wa: WaProjection | undefined): MessageState {
  if (kind !== "whatsapp") return { wa: undefined, status: undefined };
  const projection = wa ?? EMPTY_PROJECTION;
  return { wa: projection, status: bubbleStatusFromProjection(projection) };
}

/**
 * ¿Este resultado limpia el error del mensaje?
 *
 * D · en WhatsApp exige confirmación auditada afirmativa; en Connect basta con
 * que la acción haya resuelto sin fallo. Vive acá y no en el componente para
 * que `ThreadView` no vuelva a comparar `kind` y tomar decisiones por su cuenta.
 */
export function clearsSendError(kind: unknown, state: MessageState): boolean {
  if (kind !== "whatsapp") return state.status === undefined;
  return isAuditedConfirmation(state.wa);
}

/** Estado inicial de una burbuja optimista local: sin proyección, en vuelo. */
export function initialMessageState(kind: unknown): MessageState {
  if (kind !== "whatsapp") return { status: "sending" };
  return { wa: undefined, status: "sending" };
}
