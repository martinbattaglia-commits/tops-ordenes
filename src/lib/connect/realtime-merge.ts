/**
 * realtime-merge.ts — LINK-WA 1B-1 · Reconciliación pura de eventos realtime
 * de `connect_messages`.
 *
 * Hasta R1A el handler de ThreadView descartaba todo lo que no fuera `INSERT`,
 * así que un `UPDATE` (por ejemplo el sello de `meta.wa.status`) nunca llegaba
 * en vivo. Acá vive la decisión, separada del componente: pura, determinística
 * y sin React, para poder probar convergencia y ausencia de duplicados.
 *
 * Garantías:
 *  · localización por `id` primero; luego `clientMsgId`; luego `seq` real.
 *  · el mensaje se actualiza EN SU POSICIÓN — no se reordena la lista.
 *  · un payload parcial no borra campos: sólo pisa las claves presentes.
 *  · un eco optimista se reconcilia en lugar de agregar una segunda burbuja.
 *  · `UPDATE` repetido no cambia la cantidad de mensajes.
 *  · `INSERT` y `UPDATE` desordenados convergen al mismo resultado.
 *  · un evento de otra conversación se ignora.
 *
 * Es agnóstica al tipo concreto de mensaje: el llamador aporta el mapeo
 * fila→mensaje, que es donde vive el conocimiento de la UI.
 */

export type RealtimeEventType = "INSERT" | "UPDATE" | "DELETE" | string;

export interface RealtimeEvent {
  eventType: RealtimeEventType;
  new?: Record<string, unknown> | null;
}

/** Contrato mínimo que la lista de mensajes debe cumplir para reconciliar. */
export interface MergeableMessage {
  id: string;
  conversationId: string;
  seq: number;
  clientMsgId?: string;
  /** Marca de optimismo local: `undefined` ⇒ ya es el mensaje real. */
  status?: string;
}

/**
 * Índice del mensaje que corresponde al entrante, o -1.
 * Orden de preferencia: id → clientMsgId → seq real.
 */
export function matchIndex<T extends MergeableMessage>(
  prev: readonly T[],
  incoming: Pick<MergeableMessage, "id"> & Partial<MergeableMessage>,
): number {
  const byId = prev.findIndex((m) => m.id === incoming.id);
  if (byId >= 0) return byId;

  if (incoming.clientMsgId) {
    const byClient = prev.findIndex((m) => m.clientMsgId === incoming.clientMsgId);
    if (byClient >= 0) return byClient;
  }

  // `seq` sólo identifica cuando el candidato local ya es real: dos mensajes
  // optimistas pueden compartir un seq provisional.
  if (typeof incoming.seq === "number" && Number.isFinite(incoming.seq)) {
    const bySeq = prev.findIndex((m) => m.seq === incoming.seq && m.status === undefined);
    if (bySeq >= 0) return bySeq;
  }
  return -1;
}

/**
 * Fusiona el parcial sobre el existente.
 *
 * El criterio es PRESENCIA DE CLAVE, no valor: una clave ausente preserva lo
 * anterior; una clave presente con `undefined` LIMPIA el campo. Esa distinción
 * es la que permite que el eco realtime borre la marca optimista
 * (`status: undefined`) sin que un payload parcial pierda body, autor o fecha.
 */
export function mergePartial<T extends MergeableMessage>(existing: T, incoming: Partial<T>): T {
  const out = { ...existing };
  for (const k of Object.keys(incoming)) {
    (out as Record<string, unknown>)[k] = (incoming as Record<string, unknown>)[k];
  }
  return out;
}

export interface ApplyOptions<T extends MergeableMessage> {
  /** Conversación del hilo abierto: cualquier otra se descarta. */
  conversationId: string;
  /** Mapea la fila cruda del canal a un mensaje de la UI. */
  build: (row: Record<string, unknown>, existing: T | null) => Partial<T> & { id: string };
}

/**
 * Aplica un evento realtime a la lista y devuelve la lista resultante.
 * Devuelve la MISMA referencia cuando el evento es un no-op, para no forzar
 * re-render innecesario en React.
 */
export function applyRealtimeEvent<T extends MergeableMessage>(
  prev: readonly T[],
  event: RealtimeEvent,
  opts: ApplyOptions<T>,
): readonly T[] {
  if (event.eventType !== "INSERT" && event.eventType !== "UPDATE") return prev;
  const row = event.new;
  if (!row) return prev;

  const rowConversationId = row.conversation_id;
  if (typeof rowConversationId === "string" && rowConversationId !== opts.conversationId) {
    return prev;
  }

  // Localización previa al build: el mapeo necesita saber si ya existe para
  // poder preservar lo que el payload parcial no trae.
  const probe = {
    id: String(row.id ?? ""),
    clientMsgId: typeof row.client_msg_id === "string" ? row.client_msg_id : undefined,
    seq: Number(row.seq),
  };
  if (!probe.id) return prev;

  const idx = matchIndex(prev, probe);
  const existing = idx >= 0 ? prev[idx] : null;
  const built = opts.build(row, existing);

  if (idx < 0) {
    // Sin correspondencia: alta. Un UPDATE sin INSERT previo también inserta —
    // así converge cuando los eventos llegan desordenados.
    return [...prev, built as T];
  }

  const merged = mergePartial(prev[idx], built as Partial<T>);
  // Idempotencia: si nada cambió, se conserva la referencia original.
  if (shallowEqual(prev[idx] as Record<string, unknown>, merged as Record<string, unknown>)) {
    return prev;
  }
  const next = prev.slice();
  next[idx] = merged;
  return next;
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}
