/**
 * reply-core.ts — LINK-WA 1B-1D · Orquestación testeable del outbound WhatsApp.
 *
 * Todo lo impuro entra por puertos. No importa clientes Supabase, no lee
 * `process.env`, no usa `fetch` ni el reloj global.
 *
 * Cambio central de 1B-1D (R3 · binding autoritativo del intento):
 * `connect_post_message` devuelve la fila PREVIA cuando se reutiliza un
 * `clientMsgId`. Si el core sólo recibía el `messageId`, podía persistirse el
 * texto A y transportarse el texto B. Ahora el claim devuelve un SNAPSHOT
 * canónico releído de la fila reclamada, y el core lo verifica contra
 * conversación, actor, clientMsgId y texto normalizado ANTES de cualquier
 * efecto: antes de leer el estado, de auditar, de hacer `claimSending`, de
 * resolver el teléfono y — sobre todo — antes de llamar a Meta.
 *
 * Un `clientMsgId` = UN solo intento de red. Una fila con `external_msg_id` o en
 * estado terminal jamás vuelve a salir; un reintento humano exige un
 * `clientMsgId` nuevo.
 */

import type { MetaTextTransport } from "./transport";
import {
  blocksAutomaticResend,
  isAuditConfirmed,
  AUDITABLE_STATUSES,
  type WaOutboundState,
} from "./outbound-state";

export interface ReplyActor {
  id: string;
}

export interface TenantMembership {
  active: boolean;
  role: string | null;
  clientId: string | null;
}

export interface ReplyConversation {
  id: string;
  kind: string;
  contextId: string;
}

/** Fila canónica reclamada, releída con el cliente de sesión. */
export interface ClaimSnapshot {
  id: string;
  conversationId: string;
  authorProfileId: string | null;
  clientMsgId: string | null;
  body: string | null;
  externalMsgId: string | null;
}

/** Unión discriminada: sin campos opcionales ambiguos. */
export type ClaimOutcome =
  | { kind: "claimed"; snapshot: ClaimSnapshot }
  | { kind: "denied"; reason: string }
  /** No se pudo releer la fila: error, ausencia o datos incompletos. */
  | { kind: "not_verifiable" };

/**
 * WA-7R2 · TRES HECHOS EXPLÍCITAMENTE DISTINTOS.
 *
 * Colapsarlos fue el defecto: `wamid + sent` se leía como "cerrado con éxito"
 * cuando sólo significaba "Meta progresó". La auditoría de cierre es un hecho
 * propio y viaja por separado.
 */
export interface OutboundStateSnapshot {
  /** Estado del PROVEEDOR. No dice nada sobre la auditoría. */
  status: WaOutboundState | null;
  /** WAMID sellado. Prueba que hubo egress, no que el intento cerró. */
  wamid: string | null;
  /**
   * WAMID que la auditoría final confirmó, o `null` si no hay marcador.
   * Sólo `markAudited` lo escribe, y sólo después de que `reply_sent` pasó.
   */
  auditedWamid: string | null;
}

export interface StampPatch {
  status: WaOutboundState;
  wamid?: string;
  error?: string;
}

export interface ReplyPorts {
  session: { getActor(): Promise<ReplyActor | null> };
  operators: { isAuthorized(profileId: string): boolean };
  tenant: { getMembership(profileId: string): Promise<TenantMembership | null> };
  conversations: { get(conversationId: string): Promise<ReplyConversation | null> };
  sandbox: { isAllowed(phoneE164: string): boolean };
  claim: {
    acquire(input: {
      conversationId: string;
      body: string;
      clientMsgId: string;
    }): Promise<ClaimOutcome>;
  };
  state: {
    /** `null` SÓLO si la fila existe y no tiene estado. Un error debe lanzar. */
    read(messageId: string): Promise<OutboundStateSnapshot>;
    stamp(messageId: string, patch: StampPatch): Promise<boolean>;
    /** CAS a `sending`. `true` sólo para el ganador. Un error debe lanzar. */
    claimSending(messageId: string): Promise<boolean>;
    /**
     * Sello final con precondición: exige estado `sending` y
     * `external_msg_id` nulo. `false` si no afectó exactamente una fila.
     *
     * WA-7R2 · deja el intento SELLADO PERO NO AUDITADO. Nunca escribe ni
     * conserva el marcador de auditoría.
     */
    sealSent(messageId: string, wamid: string): Promise<boolean>;
    /**
     * WA-7R2 · persiste el marcador durable de auditoría. Sólo se invoca
     * DESPUÉS de que `reply_sent` pasó, y está acotado por message id, wamid
     * esperado, estado compatible y exactamente una fila afectada.
     */
    markAudited(messageId: string, wamid: string): Promise<boolean>;
  };
  audit: { record(action: string, payload: Record<string, unknown>): Promise<boolean> };
  clock: { now(): string };
  transport: MetaTextTransport;
}

export interface ReplyCoreInput {
  conversationId: string;
  text: string;
  clientMsgId: string;
}

export type ReplyErrorCode =
  | "invalid_input"
  | "no_session"
  | "not_operator"
  | "not_tenant_member"
  | "no_thread"
  | "no_counterpart"
  | "rbac_denied"
  | "attempt_binding_mismatch"
  | "attempt_not_verifiable"
  | "attempt_closed"
  | "audit_failed"
  | "sandbox_denied"
  | "state_unavailable"
  | "send_failed"
  | "reconciliation_required"
  | "in_flight";

export type ReplyCoreResult =
  /**
   * §6 · el wamid NO se expone: queda persistido server-side y se correlaciona
   * por `messageId`. Devolverlo filtraba un identificador del proveedor a la UI.
   */
  | { ok: true; messageId: string; reused: boolean }
  | { ok: false; code: ReplyErrorCode; error: ReplyErrorMessage; messageId?: string };

/**
 * Mensajes internos ESTABLES. Nunca se propaga `outcome.detail`, `error.message`
 * del proveedor, teléfono, texto ni wamid crudo.
 */
export type ReplyErrorMessage =
  | "invalid_input"
  | "no_session"
  | "not_operator"
  | "not_tenant_member"
  | "no_thread"
  | "no_counterpart"
  | "rbac_denied"
  | "attempt_binding_mismatch"
  | "attempt_not_verifiable"
  | "attempt_closed"
  | "audit_unavailable"
  | "audit_reconciliation"
  /** Falló la auditoría de cierre Y no pudo persistirse la reconciliación. */
  | "reconciliation_persist_failed"
  /** Hay wamid pero el estado durable no acredita un cierre auditado. */
  | "reconciliation_unverified"
  /** Progreso real del proveedor SIN marcador durable de auditoría. */
  | "audit_unconfirmed"
  /** `reply_sent` pasó pero el marcador durable no pudo persistirse. */
  | "audit_marker_unpersisted"
  | "sandbox_denied"
  | "state_unavailable"
  | "meta_rejected"
  | "meta_unavailable"
  | "contract_unknown"
  | "reconciliation_required"
  | "seal_precondition_failed"
  | "in_flight";

const MAX_LEN = 4096;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * ÚNICA normalización canónica. Se aplica antes de persistir, antes de comparar
 * y antes de transportar: por eso `"  hola  "` y `"hola"` son el mismo intento.
 */
export function normalizeWhatsappText(text: string): string {
  return (text ?? "").trim();
}

export function isValidWhatsappText(text: string): boolean {
  if (typeof text !== "string") return false;
  const norm = normalizeWhatsappText(text);
  if (norm.length < 1 || norm.length > MAX_LEN) return false;
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(norm)) {
    return false;
  }
  return true;
}

/** El composer usa `crypto.randomUUID()`: un valor arbitrario no es un intento. */
export function isValidClientMsgId(value: string): boolean {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function counterpartPhoneFromContext(contextId: string): string | null {
  if (!contextId.startsWith("wa:")) return null;
  const phone = contextId.slice(3).trim();
  return /^\+\d{8,15}$/.test(phone) ? phone : null;
}

/**
 * ¿El snapshot reclamado es EXACTAMENTE el intento solicitado?
 * Pura y sin efectos: se evalúa antes de tocar estado, auditoría o red.
 */
export function snapshotMatchesAttempt(
  snapshot: ClaimSnapshot,
  expected: { conversationId: string; actorId: string; clientMsgId: string; body: string },
): boolean {
  if (!snapshot.id) return false;
  if (snapshot.conversationId !== expected.conversationId) return false;
  if (snapshot.authorProfileId !== expected.actorId) return false;
  if (snapshot.clientMsgId !== expected.clientMsgId) return false;
  if (normalizeWhatsappText(snapshot.body ?? "") !== expected.body) return false;
  return true;
}

function fail(code: ReplyErrorCode, error: ReplyErrorMessage, messageId?: string): ReplyCoreResult {
  return messageId ? { ok: false, code, error, messageId } : { ok: false, code, error };
}

/**
 * WA-7R · B / WA-7R2 · Resuelve un intento que YA no puede volver a salir a la red.
 *
 * Se invoca en cuanto aparece un wamid — en el snapshot del claim o en el
 * estado durable — y su contrato es asimétrico a propósito:
 *
 *  · CERO egress SIEMPRE. Ninguna rama vuelve a llamar al transporte.
 *  · `ok:true` SÓLO cuando coinciden LOS TRES hechos: wamid real, estado de
 *    progreso del proveedor y marcador durable de auditoría para ESE wamid.
 *  · `sent`/`delivered`/`read` SIN marcador NO son éxito. Ésa es la corrección
 *    de WA-7R2: antes bastaba el par (wamid, estado de progreso), y ese par
 *    también lo produce un intento cuya auditoría final falló — o un webhook
 *    que promueve `reconciliation_required → sent/delivered/read`.
 *  · Mientras la reconciliación siga pendiente el resultado NUNCA es `ok:true`.
 */
function resolveClosedAttempt(
  state: OutboundStateSnapshot,
  messageId: string,
): ReplyCoreResult {
  if (isAuditConfirmed(state.auditedWamid, state.wamid, state.status)) {
    return { ok: true, messageId, reused: true };
  }
  if (state.status === "reconciliation_required") {
    return fail("reconciliation_required", "reconciliation_required", messageId);
  }
  if (state.status === "sending") {
    return fail("in_flight", "in_flight", messageId);
  }
  if (state.status === "failed") {
    // Wamid presente y estado `failed`: el proveedor emitió un error posterior.
    // Cerrado, pero NO exitoso. Un reintento exige un `clientMsgId` nuevo.
    return fail("attempt_closed", "attempt_closed", messageId);
  }
  if (state.wamid && state.status && AUDITABLE_STATUSES.includes(state.status)) {
    // Progreso real del proveedor SIN auditoría confirmada. El mensaje pudo
    // haber llegado; lo que no existe es el cierre auditado. Reconciliación.
    return fail("reconciliation_required", "audit_unconfirmed", messageId);
  }
  // Wamid sin estado congruente (`null`/`queued`): la fila afirma que hubo
  // egress y la máquina de estados no lo registra. No es verificable como
  // éxito auditado, así que se trata como reconciliación.
  return fail("reconciliation_required", "reconciliation_unverified", messageId);
}

export async function executeReply(
  input: ReplyCoreInput,
  ports: ReplyPorts,
): Promise<ReplyCoreResult> {
  if (!isValidWhatsappText(input?.text ?? "")) {
    return fail("invalid_input", "invalid_input");
  }
  if (!input.conversationId || !isValidClientMsgId(input.clientMsgId ?? "")) {
    return fail("invalid_input", "invalid_input");
  }
  const body = normalizeWhatsappText(input.text);
  const clientMsgId = input.clientMsgId.trim().toLowerCase();

  const actor = await ports.session.getActor();
  if (!actor) return fail("no_session", "no_session");

  if (!ports.operators.isAuthorized(actor.id)) {
    await ports.audit.record("reply_denied", { reason: "not_operator", actor: actor.id });
    return fail("not_operator", "not_operator");
  }

  const membership = await ports.tenant.getMembership(actor.id);
  if (!membership || membership.active !== true || membership.role == null) {
    await ports.audit.record("reply_denied", { reason: "not_tenant_member", actor: actor.id });
    return fail("not_tenant_member", "not_tenant_member");
  }

  const conv = await ports.conversations.get(input.conversationId);
  if (!conv) return fail("no_thread", "no_thread");
  if (conv.kind !== "whatsapp") return fail("invalid_input", "invalid_input");

  const phone = counterpartPhoneFromContext(conv.contextId ?? "");
  if (!phone) return fail("no_counterpart", "no_counterpart");

  // ── CLAIM ────────────────────────────────────────────────────────────────
  const claim = await ports.claim.acquire({
    conversationId: input.conversationId,
    body,
    clientMsgId,
  });
  if (claim.kind === "denied") {
    await ports.audit.record("reply_denied", { reason: "rbac_denied", actor: actor.id });
    return fail("rbac_denied", "rbac_denied");
  }
  if (claim.kind === "not_verifiable") {
    await ports.audit.record("reply_denied", {
      reason: "attempt_not_verifiable",
      actor: actor.id,
    });
    return fail("attempt_not_verifiable", "attempt_not_verifiable");
  }

  const snapshot = claim.snapshot;
  const messageId = snapshot.id;

  // ── R3 · BINDING AUTORITATIVO, antes de cualquier efecto ─────────────────
  if (
    !snapshotMatchesAttempt(snapshot, {
      conversationId: input.conversationId,
      actorId: actor.id,
      clientMsgId,
      body,
    })
  ) {
    // Sin texto, sin teléfono, sin hash: sólo la correlación del intento.
    await ports.audit.record("reply_denied", {
      reason: "attempt_binding_mismatch",
      actor: actor.id,
      messageId,
    });
    return fail("attempt_binding_mismatch", "attempt_binding_mismatch", messageId);
  }

  // ── Estado durable ───────────────────────────────────────────────────────
  // Se lee SIEMPRE, incluso con wamid en el snapshot. El snapshot prueba que
  // hubo egress; sólo el estado durable dice si ese intento quedó auditado o
  // sigue en reconciliación, y esa diferencia decide entre éxito y fallo.
  let existing: OutboundStateSnapshot;
  try {
    existing = await ports.state.read(messageId);
  } catch {
    return fail("state_unavailable", "state_unavailable", messageId);
  }

  // Un wamid ya sellado cierra el intento: jamás un segundo egress con la
  // misma fila (evita la carrera failed→delivered tardío→reenvío→regresión).
  if (snapshot.externalMsgId || existing.wamid) {
    return resolveClosedAttempt(existing, messageId);
  }
  if (blocksAutomaticResend(existing.status)) {
    if (existing.status === "reconciliation_required") {
      return fail("reconciliation_required", "reconciliation_required", messageId);
    }
    if (existing.status === "failed") {
      // El intento está cerrado. Un reintento humano exige clientMsgId nuevo.
      return fail("attempt_closed", "attempt_closed", messageId);
    }
    return fail("in_flight", "in_flight", messageId);
  }

  // ── Auditoría PREVIA ─────────────────────────────────────────────────────
  const audited = await ports.audit.record("reply_attempt", {
    actor: actor.id,
    conversationId: input.conversationId,
    messageId,
    clientMsgId,
    at: ports.clock.now(),
  });
  if (!audited) {
    await ports.state.stamp(messageId, { status: "failed", error: "audit_unavailable" });
    return fail("audit_failed", "audit_unavailable", messageId);
  }

  if (!ports.sandbox.isAllowed(phone)) {
    await ports.state.stamp(messageId, { status: "failed", error: "sandbox_denied" });
    await ports.audit.record("reply_sandbox_rejected", { actor: actor.id, messageId });
    return fail("sandbox_denied", "sandbox_denied", messageId);
  }

  // ── CAS a `sending` ──────────────────────────────────────────────────────
  let won: boolean;
  try {
    won = await ports.state.claimSending(messageId);
  } catch {
    return fail("state_unavailable", "state_unavailable", messageId);
  }
  if (!won) {
    let after: OutboundStateSnapshot;
    try {
      after = await ports.state.read(messageId);
    } catch {
      return fail("state_unavailable", "state_unavailable", messageId);
    }
    // Perder el CAS también puede significar que apareció un wamid entre la
    // lectura inicial y el UPDATE: misma resolución, cero egress.
    if (after.wamid) return resolveClosedAttempt(after, messageId);
    if (after.status === "reconciliation_required") {
      return fail("reconciliation_required", "reconciliation_required", messageId);
    }
    if (after.status === "failed") return fail("attempt_closed", "attempt_closed", messageId);
    return fail("in_flight", "in_flight", messageId);
  }

  // ── Egress ───────────────────────────────────────────────────────────────
  const outcome = await ports.transport.sendText({ to: phone, text: body });

  if (outcome.kind === "ambiguous") {
    await ports.state.stamp(messageId, {
      status: "reconciliation_required",
      error: outcome.reason,
    });
    await ports.audit.record("reply_ambiguous", {
      actor: actor.id,
      messageId,
      reason: outcome.reason,
    });
    const message: ReplyErrorMessage =
      outcome.reason === "contract_unknown" ? "contract_unknown" : "meta_unavailable";
    return fail("reconciliation_required", message, messageId);
  }

  if (outcome.kind === "rejected") {
    await ports.state.stamp(messageId, { status: "failed", error: outcome.reason });
    await ports.audit.record("reply_failed", {
      actor: actor.id,
      messageId,
      reason: outcome.reason,
    });
    // `outcome.detail` NUNCA sale: sólo un código interno estable.
    return fail("send_failed", "meta_rejected", messageId);
  }

  // ── Sello con precondición (sending + external_msg_id nulo + 1 fila) ─────
  const sealed = await ports.state.sealSent(messageId, outcome.wamid);
  if (!sealed) {
    await ports.state.stamp(messageId, {
      status: "reconciliation_required",
      error: "seal_precondition_failed",
    });
    await ports.audit.record("reply_seal_failed", { actor: actor.id, messageId });
    return fail("reconciliation_required", "seal_precondition_failed", messageId);
  }

  // La auditoría final es OBLIGATORIA: sin ella no se declara éxito.
  const closed = await ports.audit.record("reply_sent", {
    actor: actor.id,
    conversationId: input.conversationId,
    messageId,
    at: ports.clock.now(),
  });
  if (!closed) {
    // WA-7R · B · La auditoría de cierre es CONSTITUTIVA del éxito. Sin ella el
    // intento no está cerrado, y eso debe quedar DURABLE: si sólo se devolviera
    // el error, el reintento leería la fila sellada y la declararía exitosa.
    const persisted = await ports.state.stamp(messageId, {
      status: "reconciliation_required",
      error: "audit_reconciliation",
    });
    if (!persisted) {
      // Ni siquiera pudo registrarse la reconciliación: fail-closed igual.
      // Residual honesto: sin escritura durable el sistema no puede RECORDAR
      // que este intento quedó sin auditar, y un reintento posterior vería la
      // fila sellada como éxito. WA-8R9 cierra la parte atómica —`stamp` y
      // `markAudited` escriben por RPC transaccional (0227), y la
      // reconciliación deja marca durable propia—, así que este camino sólo se
      // alcanza cuando la propia RPC no pudo escribir.
      return fail("reconciliation_required", "reconciliation_persist_failed", messageId);
    }
    return fail("reconciliation_required", "audit_reconciliation", messageId);
  }

  // ── WA-7R2 · Marcador durable, SIEMPRE después de `reply_sent` ───────────
  // Hasta acá la fila está sellada pero NO auditada: cualquier reintento la
  // lee como reconciliación. Recién este sello convierte el intento en un
  // éxito reutilizable, y va acotado al wamid que la auditoría cerró.
  const marked = await ports.state.markAudited(messageId, outcome.wamid);
  if (!marked) {
    await ports.audit.record("reply_audit_marker_failed", {
      actor: actor.id,
      messageId,
    });
    // La auditoría existe pero no quedó acreditada de forma durable. No se
    // declara éxito: el mismo `clientMsgId` queda bloqueado sin segundo egress.
    return fail("reconciliation_required", "audit_marker_unpersisted", messageId);
  }

  return { ok: true, messageId, reused: false };
}
