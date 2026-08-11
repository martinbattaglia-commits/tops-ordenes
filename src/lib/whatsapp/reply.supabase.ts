/**
 * reply.supabase.ts — LINK-WA 1B-1D · Factory de puertos del outbound.
 *
 * Todo entra por inyección: cliente de sesión, admin nullable, autorización de
 * operadores, decisión sandbox, reloj y transporte. La factory NO crea
 * clientes, NO lee `process.env`, NO usa `Date` global y NO hace egress al
 * construirse — por eso puede ejercitarse con un builder grabador que verifica
 * la consulta exacta enviada a Supabase.
 *
 * Fail-closed en todos los adaptadores: un error de lectura o escritura nunca
 * se degrada a `null`, a "carrera perdida" ni a éxito.
 */

import {
  readAuditMarker,
  isCanonicalIsoUtc,
  AUDITABLE_STATUSES,
  WA_AUDIT_MARKER_KEY,
  type WaOutboundState,
} from "./outbound-state";
import { isValidClientMsgId } from "./reply-core";
import type { ClaimOutcome, ClaimSnapshot, ReplyPorts } from "./reply-core";

/** Superficie mínima usada del cliente Supabase (sesión o service_role). */
type QueryClient = {
  from: (table: string) => any; // eslint-disable-line
  rpc: (fn: string, args: Record<string, unknown>) => any; // eslint-disable-line
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
};
type AdminClient = {
  from: (table: string) => any; // eslint-disable-line
  /** WA-8R9 · el estado del outbound se escribe por RPC transaccional. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
} | null;

/**
 * WA-8R7 · procedencia de TODA escritura de estado de este adaptador.
 *
 * `meta.wa.status_at` mezcla el reloj del servidor (milisegundos) con el de Meta
 * (segundos enteros). Sin marcar quién escribió el hecho, la UI comparaba
 * instantes de relojes distintos y descartaba un `failed` real de Meta por
 * parecer anterior a un `sent` local. La fuente la fija el adaptador que conoce
 * el origen: nunca se acepta desde la UI, FormData, body público ni payload.
 */
export const WA_STATUS_SOURCE_SERVER = "server" as const;

/** Columnas canónicas del snapshot del intento. */
export const CLAIM_COLUMNS =
  "id, conversation_id, author_profile_id, client_msg_id, body, external_msg_id";

/** Estados desde los que un egress NUEVO es admisible. `failed` ya no lo es. */
const CLAIMABLE: Array<WaOutboundState | null> = [null, "queued"];

/**
 * WA-7R3 · Intentos TOTALES del CAS de `markAudited` (no reintentos extra).
 *
 * Tres alcanzan de sobra: cada vuelta perdida implica que otro escritor avanzó
 * el estado de la fila, y la progresión `sent → delivered → read` es finita y
 * monótona. Agotarlos devuelve `false` y deja el intento sin acreditar, que es
 * la lectura honesta: el core lo tratará como reconciliación pendiente.
 */
export const MARK_AUDITED_MAX_ATTEMPTS = 3;

/**
 * Estados canónicos reconocidos.
 *
 * CLOSEOUT · H · ya no se usa para validar en tiempo de ejecución —eso lo hace
 * la RPC dentro de su transacción—, pero la comprobación de EXHAUSTIVIDAD de
 * abajo se conserva a propósito: si el canon agrega un estado y esta copia no se
 * entera, la compilación falla. Es una guarda de tipos, no código muerto.
 */
const KNOWN_STATES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
  "reconciliation_required",
] as const;

type KnownIsExhaustive = WaOutboundState extends (typeof KNOWN_STATES)[number] ? true : never;
const _knownIsExhaustive: KnownIsExhaustive = true;
void _knownIsExhaustive;


/**
 * WA-7R · D · ALLOWLIST del sink de auditoría — universo de claves conocidas.
 *
 * El adaptador es la última frontera antes de una fila persistida y consultable
 * por operadores: acá se decide qué se graba, no quien construye el payload.
 * Sólo campos de CORRELACIÓN — identificadores opacos, un instante y un código
 * interno estable.
 *
 * Queda fuera por construcción, incluso si el llamador lo pasa:
 * texto del mensaje, teléfono, wamid/external_msg_id, tokens o cabeceras
 * `Bearer`, `detail`/`payload` crudo del proveedor y CUALQUIER clave desconocida.
 *
 * WA-7R3 · esta lista es el UNIVERSO de claves, no el permiso. Pertenecer a ella
 * ya no basta: cada acción declara en `AUDIT_SCHEMAS` cuáles de estas claves
 * exige, cuáles admite y qué debe contener cada una.
 */
export const AUDIT_PAYLOAD_ALLOWLIST = [
  "actor",
  "conversationId",
  "messageId",
  "clientMsgId",
  "reason",
  "at",
] as const;

/**
 * WA-7R2 · Acciones admitidas. Enum CERRADO: una acción desconocida no se
 * registra "por las dudas", se rechaza. El nombre de la acción termina en una
 * fila consultable y es tan parte del contrato como el payload.
 */
export const AUDIT_ACTIONS = [
  "reply_attempt",
  "reply_denied",
  "reply_sandbox_rejected",
  "reply_ambiguous",
  "reply_failed",
  "reply_seal_failed",
  "reply_sent",
  "reply_audit_marker_failed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * ── WA-7R3 · CONTRATO SEMÁNTICO POR ACCIÓN ────────────────────────────────
 *
 * La revisión independiente de WA-7R2 encontró que la allowlist por NOMBRE de
 * clave más un formato laxo (`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`) admitía como
 * identificador un número de teléfono sin prefijo internacional, un documento o
 * clave fiscal, una palabra suelta y cualquier token alfanumérico. Es decir: la
 * clave estaba permitida y el valor podía ser PII o un secreto, exactamente lo
 * que la frontera existe para impedir.
 *
 * El contrato pasa a ser SEMÁNTICO y por acción: cada acción declara sus campos
 * obligatorios, sus opcionales y — cuando corresponde — el enum CERRADO de
 * `reason` que le pertenece. Un `reason` legítimo de otra acción es tan inválido
 * como uno inventado: `http_error` describe un rechazo del transporte y no tiene
 * sentido bajo `reply_ambiguous`, donde el mensaje pudo haber salido.
 *
 * Nada fuera de este mapa entra: ninguna clave desconocida, ningún campo de más
 * para la acción, ningún objeto/arreglo/número/booleano y ningún payload vacío.
 */
interface AuditActionSchema {
  /** Deben estar TODOS. Su ausencia rechaza el registro completo. */
  required: readonly string[];
  /** Pueden estar o no. Nada más puede estar. */
  optional: readonly string[];
  /** Enum cerrado de `reason` para esta acción. Ausente ⇒ no acepta `reason`. */
  reasons?: readonly string[];
}

/** Motivos de una DENEGACIÓN: el intento nunca llegó al transporte. */
const DENIED_REASONS = [
  "not_operator",
  "not_tenant_member",
  "rbac_denied",
  "attempt_not_verifiable",
  "attempt_binding_mismatch",
] as const;

/** Motivos AMBIGUOS del transporte: Meta pudo haber aceptado el mensaje. */
const AMBIGUOUS_REASONS = [
  "timeout",
  "network",
  "contract_unknown",
  "invalid_2xx",
  "server_error",
] as const;

/** Motivos de un RECHAZO inequívoco del transporte. */
const FAILED_REASONS = ["http_error", "invalid_json", "not_configured"] as const;

export const AUDIT_SCHEMAS: Record<AuditAction, AuditActionSchema> = {
  reply_attempt: {
    required: ["actor", "conversationId", "messageId", "clientMsgId", "at"],
    optional: [],
  },
  // `messageId` es opcional a propósito: las denegaciones tempranas ocurren
  // ANTES de que exista una fila de mensaje que correlacionar.
  reply_denied: { required: ["actor", "reason"], optional: ["messageId"], reasons: DENIED_REASONS },
  reply_sandbox_rejected: { required: ["actor", "messageId"], optional: [] },
  reply_ambiguous: {
    required: ["actor", "messageId", "reason"],
    optional: [],
    reasons: AMBIGUOUS_REASONS,
  },
  reply_failed: {
    required: ["actor", "messageId", "reason"],
    optional: [],
    reasons: FAILED_REASONS,
  },
  reply_seal_failed: { required: ["actor", "messageId"], optional: [] },
  reply_sent: { required: ["actor", "conversationId", "messageId", "at"], optional: [] },
  reply_audit_marker_failed: { required: ["actor", "messageId"], optional: [] },
};

/**
 * Unión de los `reason` admitidos por alguna acción. Se deriva del mapa para que
 * no pueda quedar desincronizada: agregar un motivo acá sin asignarlo a una
 * acción no lo vuelve grabable.
 */
export const AUDIT_REASONS = [
  ...DENIED_REASONS,
  ...AMBIGUOUS_REASONS,
  ...FAILED_REASONS,
] as const;

/**
 * UUID canónico (RFC 4122, 8-4-4-4-12 con nibbles de versión y variante).
 *
 * Sin `trim`: el valor debe venir ya canónico. Descarta por construcción todo lo
 * que la expresión anterior dejaba pasar — teléfonos con y sin prefijo
 * internacional, documentos y claves fiscales, cabeceras de autorización,
 * tokens alfanuméricos, identificadores del proveedor, palabras y frases —
 * porque ninguno tiene la estructura de un UUID. Los ejemplos concretos viven
 * en el banco de pruebas, no en el fuente.
 */
const AUDIT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validador por campo. `reason` se resuelve aparte porque depende de la acción. */
const FIELD_VALIDATORS: Record<string, (value: string) => boolean> = {
  actor: (v) => AUDIT_UUID_RE.test(v),
  conversationId: (v) => AUDIT_UUID_RE.test(v),
  messageId: (v) => AUDIT_UUID_RE.test(v),
  // Exactamente la gramática que el core exige para un intento.
  clientMsgId: (v) => isValidClientMsgId(v),
  at: (v) => isCanonicalIsoUtc(v),
};

/**
 * Valida el payload contra el contrato de SU acción. `null` cuando algo no cumple.
 *
 * FAIL-CLOSED, no truncado: si un valor es inválido NO se recorta ni se descarta
 * para grabar el resto — se rechaza el registro completo. Truncar y persistir
 * dejaría una fila que parece legítima y oculta que hubo un intento de meter
 * datos que no corresponden; el core, además, trata el fallo de auditoría como
 * bloqueante, que es exactamente la reacción correcta.
 */
function validateAuditPayload(
  action: string,
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!(AUDIT_ACTIONS as readonly string[]).includes(action)) return null;
  const schema = AUDIT_SCHEMAS[action as AuditAction];
  if (!schema) return null;
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return null;

  const keys = Object.keys(payload);
  // Ningún payload vacío: toda acción exige al menos su correlación mínima.
  if (keys.length === 0) return null;

  const admitted = new Set<string>([...schema.required, ...schema.optional]);
  if (schema.reasons) admitted.add("reason");

  const safe: Record<string, unknown> = {};
  for (const key of keys) {
    // Ni clave desconocida, ni campo de más para ESTA acción.
    if (!admitted.has(key)) return null;

    const value = payload[key];
    // Sólo cadenas: un objeto, arreglo, número o booleano bajo una clave
    // permitida es un vector de exfiltración tan real como una clave desconocida.
    if (typeof value !== "string") return null;

    if (key === "reason") {
      if (!schema.reasons || !schema.reasons.includes(value)) return null;
    } else {
      const check = FIELD_VALIDATORS[key];
      if (!check || !check(value)) return null;
    }
    safe[key] = value;
  }

  // Todos los obligatorios presentes: un campo faltante no se completa con un
  // valor por defecto, se rechaza.
  for (const key of schema.required) {
    if (!(key in safe)) return null;
  }
  return safe;
}

export interface ReplyPortsDeps {
  supabase: QueryClient;
  admin: AdminClient;
  isOperator(profileId: string): boolean;
  isSandboxAllowed(phoneE164: string): boolean;
  clock: { now(): string };
  transport: ReplyPorts["transport"];
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * SCR-LINK-WA-002: CERRADO LOCALMENTE — WA-8R9
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── EL DEFECTO, TAL COMO ERA ───────────────────────────────────────────────
 *
 * `claimSending`, `sealSent`, `stamp` y `markAudited` hacían un
 * READ-MODIFY-WRITE del objeto `meta` COMPLETO: leían la fila, fundían
 * `{...meta, wa:{...}}` en el proceso Node y reescribían la columna entera. El
 * `WHERE` era atómico respecto de la FILA; el CONTENIDO de `meta` no.
 *
 * El ataque: T1 lee `meta`; T2 escribe `meta.wa.audit_sent` (o el status de un
 * webhook); T1 hace su UPDATE con el `meta` que leyó. El CAS acierta y reporta
 * ÉXITO, pero la escritura de T2 quedó PISADA. El CAS protegía `wa.status` y no
 * las claves vecinas.
 *
 * ── CÓMO QUEDÓ CERRADO ─────────────────────────────────────────────────────
 *
 * `stamp` y `markAudited` ya no leen ni funden nada: delegan en las RPC
 * transaccionales de la migración 0227, que toman el lock de la fila
 * (`for update`), leen BAJO el lock y escriben con `jsonb_set` sobre una ruta
 * acotada. La lectura no puede quedar rancia porque nadie más puede
 * intercalarse, y las claves vecinas sobreviven por construcción.
 *
 *   · `connect_wa_apply_status`  — estado, procedencia, instante y error.
 *   · `connect_wa_mark_audited`  — únicamente la clave `audit_sent`.
 *
 * Ambas devuelven un resultado DISCRIMINADO
 * (`applied | duplicate | retryable | reconciliation_required | rejected |
 * unmatched`): un error, una cardinalidad anómala o una carrera perdida jamás
 * se degradan a "no había nada que hacer".
 *
 * ── LA PROMESA QUE SE RETIRÓ ───────────────────────────────────────────────
 *
 * La versión anterior de este contrato prometía una transición
 * `sent → reconciliation_required`. La máquina canónica la PROHÍBE: sólo se
 * entra en reconciliación desde `queued` o `sending`. La corrección no fue
 * agregarla al canon —eso habría debilitado la única autoridad de transición—
 * sino dejar de prometerla: la reconciliación se representa como un HECHO
 * ADJUNTO, `meta.wa.reconciliation`, que preserva intactos el estado confirmado
 * por Meta y el marcador `audit_sent`.
 *
 * ── ALCANCE DEL CIERRE ─────────────────────────────────────────────────────
 *
 * Verificado contra PostgreSQL 17 real en `tests/db/t-wa-r9-01-atomic-status.test.ts`,
 * incluida la carrera bidireccional webhook ↔ markAudited y la serialización
 * observable del lock. Las migraciones 0227/0228/0229 están ENTREGADAS y NO
 * APLICADAS a ningún entorno remoto: el cierre es LOCAL.
 *
 * Residual conocido: `claimSending` y `sealSent` conservan su CAS por columnas.
 * Su ventana es distinta —ambos exigen `external_msg_id is null`, que es lo que
 * impide un segundo egress— y no participan de la carrera que este SCR
 * describe, pero migrarlos a la misma RPC queda como trabajo pendiente
 * declarado.
 */
/**
 * Devuelve `meta.wa` SIN el marcador de auditoría.
 *
 * Existe para que la ausencia del marcador sea una decisión explícita y no un
 * efecto de qué claves trae el spread: `sealSent` debe dejar el intento
 * sellado pero NO auditado, siempre.
 */
function stripAuditMarker(wa: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...wa };
  delete copy[WA_AUDIT_MARKER_KEY];
  return copy;
}

export function createSupabaseReplyPorts(deps: ReplyPortsDeps): ReplyPorts {
  const { supabase, admin, clock } = deps;

  /** Lee `meta` de la fila. Lanza ante error o ausencia (fail-closed). */
  async function readMeta(messageId: string): Promise<Record<string, unknown>> {
    if (!admin) throw new Error("state_unavailable");
    const { data, error } = await admin
      .from("connect_messages")
      .select("meta")
      .eq("id", messageId)
      .maybeSingle();
    if (error || !data) throw new Error("state_unavailable");
    return ((data.meta ?? {}) as Record<string, unknown>) ?? {};
  }

  return {
    session: {
      async getActor() {
        const { data } = await supabase.auth.getUser();
        return data.user ? { id: data.user.id } : null;
      },
    },

    operators: { isAuthorized: deps.isOperator },

    tenant: {
      async getMembership(profileId) {
        const { data, error } = await supabase
          .from("profiles")
          .select("active, role, client_id")
          .eq("id", profileId)
          .maybeSingle();
        if (error || !data) return null;
        return {
          active: data.active === true,
          role: (data.role as string | null) ?? null,
          clientId: (data.client_id as string | null) ?? null,
        };
      },
    },

    conversations: {
      async get(conversationId) {
        const { data, error } = await supabase
          .from("connect_conversations")
          .select("id, kind, context_id")
          .eq("id", conversationId)
          .maybeSingle();
        if (error || !data) return null;
        return {
          id: String(data.id),
          kind: String(data.kind),
          contextId: String(data.context_id ?? ""),
        };
      },
    },

    sandbox: { isAllowed: deps.isSandboxAllowed },

    claim: {
      async acquire({ conversationId, body, clientMsgId }): Promise<ClaimOutcome> {
        const { data, error } = await supabase.rpc("connect_post_message", {
          p_conversation_id: conversationId,
          p_body: body,
          p_reply_to: null,
          p_client_msg_id: clientMsgId,
          p_attachment_ids: [],
          p_mentions: null,
        });
        // WA-7R · C · CARDINALIDAD EXACTA del RPC.
        //  · error        → indisponibilidad: NO es una denegación RBAC. Etiquetarlo
        //                   como `denied` mentía sobre la causa y confundía un fallo
        //                   de infraestructura con una decisión de autorización.
        //  · 0 filas      → el RPC no autorizó el intento: fail-closed (denied).
        //  · exactamente 1 → único caso que continúa.
        //  · >1 filas     → predicado ambiguo: no se sabe cuál fila es el intento.
        //                   `not_verifiable` SIN relectura y sin egress.
        if (error) return { kind: "not_verifiable" };
        if (data == null) return { kind: "denied", reason: "rbac_denied" };
        // Una forma no-array impide verificar la cardinalidad: no se asume 1.
        if (!Array.isArray(data)) return { kind: "not_verifiable" };
        if (data.length === 0) return { kind: "denied", reason: "rbac_denied" };
        if (data.length > 1) return { kind: "not_verifiable" };
        const row = data[0] as { id?: string } | undefined;
        if (!row?.id) return { kind: "not_verifiable" };

        // R3 · relectura CANÓNICA con el cliente de SESIÓN. El RPC devuelve la
        // fila previa al reutilizar clientMsgId: sin este snapshot podría
        // persistirse el texto A y transportarse el texto B.
        const { data: snap, error: snapErr } = await supabase
          .from("connect_messages")
          .select(CLAIM_COLUMNS)
          .eq("id", row.id)
          .maybeSingle();
        if (snapErr || !snap || !snap.id || !snap.conversation_id) {
          return { kind: "not_verifiable" };
        }
        const snapshot: ClaimSnapshot = {
          id: String(snap.id),
          conversationId: String(snap.conversation_id),
          authorProfileId: (snap.author_profile_id as string | null) ?? null,
          clientMsgId: (snap.client_msg_id as string | null) ?? null,
          body: (snap.body as string | null) ?? null,
          externalMsgId: (snap.external_msg_id as string | null) ?? null,
        };
        return { kind: "claimed", snapshot };
      },
    },

    state: {
      async read(messageId) {
        if (!admin) throw new Error("state_unavailable");
        const { data, error } = await admin
          .from("connect_messages")
          .select("meta, external_msg_id")
          .eq("id", messageId)
          .maybeSingle();
        // Un error o una fila ausente NO son "sin estado".
        if (error || !data) throw new Error("state_unavailable");
        const wa = ((data.meta ?? {}) as Record<string, unknown>).wa as
          | Record<string, unknown>
          | undefined;
        return {
          status: (wa?.status as WaOutboundState | undefined) ?? null,
          wamid: (data.external_msg_id as string | null) ?? null,
          // WA-7R2 · tercer hecho, leído de la misma fila y nunca inferido del
          // estado: un marcador con forma inválida vale exactamente `null`.
          auditedWamid: readAuditMarker(wa)?.wamid ?? null,
        };
      },

      async claimSending(messageId) {
        if (!admin) throw new Error("state_unavailable");
        const meta = await readMeta(messageId); // lanza ante error o ausencia
        const wa = ((meta.wa ?? {}) as Record<string, unknown>) ?? {};
        const current = (wa.status as WaOutboundState | undefined) ?? null;
        if (!CLAIMABLE.includes(current)) return false;

        let q = admin
          .from("connect_messages")
          .update({
            meta: {
              ...meta,
              wa: {
                ...wa,
                direction: "outbound",
                status: "sending",
                status_at: clock.now(),
                // WA-8R7 · procedencia del hecho. La asigna el adaptador que
                // conoce el origen; nunca llega desde la UI ni de un payload.
                status_source: WA_STATUS_SOURCE_SERVER,
              },
            },
          })
          .eq("id", messageId);
        q = current
          ? q.eq("meta->wa->>status", current)
          : q.is("meta->wa->>status", null);
        // WA-7R · A · TERCERA precondición, no derivable de la lectura previa.
        // Entre `readMeta` y este UPDATE puede sellarse un wamid (webhook o
        // competidor). Sin este filtro el CAS reclamaría una fila YA enviada y
        // habilitaría un segundo egress con la misma fila. La lectura previa no
        // sustituye al filtro: sólo el WHERE es atómico respecto del UPDATE.
        q = q.is("external_msg_id", null);
        const { data: rows, error } = await q.select("id");
        // Un error NO es una carrera perdida: es indisponibilidad.
        if (error) throw new Error("state_unavailable");
        // Exactamente una fila: 0 (perdió la carrera) y >1 (predicado ambiguo)
        // son ambos fail-closed.
        return (rows ?? []).length === 1;
      },

      async sealSent(messageId, wamid) {
        if (!admin) return false;
        let meta: Record<string, unknown>;
        try {
          meta = await readMeta(messageId);
        } catch {
          return false;
        }
        const wa = ((meta.wa ?? {}) as Record<string, unknown>) ?? {};
        const { data: rows, error } = await admin
          .from("connect_messages")
          .update({
            external_msg_id: wamid,
            meta: {
              ...meta,
              // WA-7R2 · el sello deja el intento SELLADO PERO NO AUDITADO.
              // `stripAuditMarker` es explícito a propósito: un marcador residual
              // arrastrado por el spread acreditaría una auditoría que no ocurrió.
              wa: {
                ...stripAuditMarker(wa),
                direction: "outbound",
                status: "sent",
                status_at: clock.now(),
                status_source: WA_STATUS_SOURCE_SERVER,
              },
            },
          })
          .eq("id", messageId)
          // Precondición: sigue en `sending` y todavía sin wamid. Así el sello
          // no pisa un delivered/read ni reemplaza un wamid anterior.
          .eq("meta->wa->>status", "sending")
          .is("external_msg_id", null)
          .select("id");
        if (error) return false;
        return (rows ?? []).length === 1;
      },

      /**
       * WA-7R2 · sella el marcador durable de auditoría. Sólo lo invoca el core
       * DESPUÉS de que `reply_sent` pasó.
       *
       * ── WA-7R3 · CAS SOBRE EL ESTADO EXACTO, CON REINTENTO ACOTADO ────────
       *
       * WA-7R2 filtraba con `.in("meta->wa->>status", [sent, delivered, read])`.
       * Ese predicado ACIERTA aunque el estado haya cambiado entre la lectura y
       * el UPDATE, y como la escritura es un read-modify-write del `meta`
       * COMPLETO, reescribía el `wa` viejo: un webhook que había avanzado
       * `sent → delivered` quedaba pisado y el mensaje REGRESABA a `sent`.
       * Auditar un intento no puede deshacer un hecho del proveedor.
       *
       * Ahora la precondición es el estado EXACTO que se acaba de observar, de
       * modo que la única escritura posible es la que reafirma ese mismo estado:
       *  · `id`                    — la fila del intento;
       *  · `external_msg_id = wamid` — el marcador acredita ESTE wamid, no otro;
       *  · `meta->wa->>status = <observado>` — si alguien avanzó el estado, el
       *    WHERE ya no acierta, PostgREST devuelve CERO filas y se relee.
       *
       * `AUDITABLE_STATUSES` sigue gobernando qué se ACEPTA al leer (`sent`,
       * `delivered`, `read`; nunca `failed` ni `reconciliation_required`), pero
       * ya no viaja como conjunto en el WHERE.
       *
       * Reintento acotado: cero filas es una carrera perdida, no un fallo, y
       * releer resuelve la carrera contra un webhook que avanza el estado una
       * sola vez. Se agota en `MARK_AUDITED_MAX_ATTEMPTS` y devuelve `false`
       * (fail-closed) en vez de girar indefinidamente. Más de una fila NO se
       * reintenta: el predicado es ambiguo y reintentar no lo desambigua.
       */
      async markAudited(messageId, wamid) {
        if (!admin) return false;

        // El instante se valida ANTES de tocar la fila: un reloj que devuelve
        // una fecha inválida no debe dejar un marcador que luego no acredite.
        const at = clock.now();
        if (!isCanonicalIsoUtc(at)) return false;

        /**
         * WA-8R9 · B-1, la otra mitad. Antes esto reconstruía `meta.wa` entero
         * desde un snapshot y reintentaba tres veces con CAS. Si entre la
         * lectura y la escritura llegaba un status de Meta, el marcador lo
         * REGRESABA — los dos escritores se borraban mutuamente.
         *
         * Ahora se escribe SÓLO la clave `audit_sent`, bajo el lock de la fila.
         * No hay reintentos porque no hay carrera que perder: la transacción
         * serializa. Estado, procedencia e instante quedan intactos por
         * construcción.
         */
        const { data, error } = await admin.rpc("connect_wa_mark_audited", {
          p_message_id: messageId,
          p_wamid: wamid,
          p_at: at,
        });
        if (error) return false;

        // `duplicate`: ya estaba acreditado con ESTE mismo wamid — el hecho
        // durable existe, que es lo que el core necesita.
        return data === "applied" || data === "duplicate";
      },

      /**
       * ── WA-8R8 · CAS DURABLE ────────────────────────────────────────────
       *
       * `stamp` era un UPDATE incondicional acotado sólo por `id`, y eso
       * destruía hechos durables del proveedor. La carrera real:
       *
       *  1. `sealSent` deja la fila en `sent/server` con el wamid;
       *  2. un webhook de Meta la avanza a `delivered/meta`;
       *  3. falla `audit.record("reply_sent")`;
       *  4. el core llama `stamp(reconciliation_required)`;
       *  5. el UPDATE pisaba `delivered/meta` y dejaba
       *     `reconciliation_required/server`.
       *
       * Eso violaba la precedencia de procedencia, la monotonicidad canónica
       * (`canTransition("delivered","reconciliation_required")` es `false`) y la
       * hidratación segura de la UI.
       *
       * Ahora se lee el snapshot durable, se valida, y el UPDATE va con CAS
       * exacto sobre estado, procedencia e instante observados. Una escritura
       * del servidor NUNCA pisa un hecho de Meta, aunque el estado nuevo
       * pareciera admisible.
       */
      async stamp(messageId, patch) {
        if (!admin) return false;
        /**
         * WA-8R9 · §1 · CERO read-modify-write cliente, también acá.
         *
         * `stamp` era el último escritor que leía la fila, decidía en JS y
         * escribía con un CAS por columnas JSON. Aun con seis precondiciones,
         * ese diseño arrastra el defecto de fondo: entre la lectura y el UPDATE
         * la fila puede cambiar, y la fusión del objeto `meta.wa` parte de un
         * snapshot que ya no la describe.
         *
         * Ahora la decisión entera —dirección, procedencia, canon, instante y
         * escritura— ocurre dentro de la transacción de `connect_wa_apply_status`,
         * con el lock de la fila tomado. Este adaptador sólo declara la
         * intención y traduce el resultado.
         */
        const { data, error } = await admin.rpc("connect_wa_apply_status", {
          p_message_id: messageId,
          p_status: patch.status,
          // La procedencia la fija ESTE adaptador, que sabe que el hecho lo
          // produjo el servidor. Nunca llega del llamador ni de un payload.
          p_source: WA_STATUS_SOURCE_SERVER,
          // El instante de un hecho del servidor lo pone el servidor de base:
          // no se envía reloj del proceso Node.
          p_at: null,
          p_error: patch.error ?? null,
        });
        // Un error de transporte NO es una carrera perdida ni un éxito.
        if (error) return false;

        switch (data) {
          // El hecho quedó escrito.
          case "applied":
            return true;

          // Ya estaba escrito idéntico: el trazo durable existe, que es lo que
          // el core necesita saber. Un `false` acá provocaría un reintento
          // inútil sobre un estado que ya es el deseado.
          case "duplicate":
            return true;

          // No se escribió el estado pedido. `reconciliation_required` además
          // dejó marca durable propia (M-1), pero el estado NO avanzó, así que
          // el core no puede tratarlo como sellado.
          case "reconciliation_required":
          case "retryable":
          case "rejected":
          case "unmatched":
            return false;

          default:
            // Resultado no previsto: fail-closed, jamás éxito.
            return false;
        }
      },
    },

    audit: {
      async record(action, payload) {
        if (!admin) return false;
        // WA-7R · D / WA-7R2 · el sink NUNCA persiste el payload tal cual, y un
        // payload que no cumple el contrato no se graba recortado: no se graba.
        const safe = validateAuditPayload(action, payload);
        if (!safe) return false; // fail-closed: sin fila, sin verdad a medias
        const entityId = typeof safe.messageId === "string" ? safe.messageId : null;
        const { error } = await admin.from("audit_log").insert({
          entity: "whatsapp_reply",
          entity_id: entityId,
          action,
          payload: safe,
        });
        return !error;
      },
    },

    clock,
    transport: deps.transport,
  };
}
