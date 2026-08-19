// Nexus Link · INC-01 · política de archivado de un hilo de la bandeja.
//
// Módulo PURO (sin IO, sin Supabase): acá vive la ÚNICA definición de «por qué no
// se puede archivar este hilo» y su redacción humana. Lo consumen dos caminos que
// tienen que decir exactamente lo mismo:
//
//   · REACTIVO  — `classifyArchiveFailure`: traduce los errores REALES de las dos
//     RPC a una causa. Antes se descartaban y se devolvía una frase fija que
//     nombraba las dos causas a la vez (INC-01/D-1).
//   · PREVENTIVO — `evaluateArchiveCapability`: espejo ESTRICTO de lo que las RPC
//     evalúan, para deshabilitar el control antes de fallar (INC-01/D-3).
//
// ⚠️ Las RPC siguen siendo la compuerta: re-validan todo y nada de acá las
// reemplaza. Este módulo se ALINEA a ellas; si divergen, manda el servidor.
//
// ⚠️ Nunca se muestra el error crudo de PostgreSQL. El texto del servidor se usa
// para CLASIFICAR (distinguir tarea de incidencia dentro de check_violation) y se
// descarta; a la pantalla sólo llega la redacción de `ARCHIVE_BLOCK_MESSAGE`.

/** SQLSTATE que levantan las RPC de archivado (medidos en prod, no supuestos). */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";
const SQLSTATE_CHECK_VIOLATION = "23514";
const SQLSTATE_NO_DATA_FOUND = "02000";

/**
 * Una causa por mensaje. Nada de «X y además Y»: si dos puertas están cerradas,
 * se informa la que la persona puede efectivamente abrir.
 */
export type ArchiveBlockReason =
  | "entity_task_open"
  | "entity_incident_open"
  | "no_role"
  | "depot_manager_blocked"
  | "session_expired"
  | "unknown";

export const ARCHIVE_BLOCK_MESSAGE: Record<ArchiveBlockReason, string> = {
  entity_task_open:
    "Este hilo pertenece a una tarea que sigue abierta. Cerrala o cancelala y después vas a poder archivarlo.",
  entity_incident_open:
    "Este hilo pertenece a una incidencia que sigue abierta. Cerrala y después vas a poder archivarlo.",
  no_role:
    "No sos administrador ni moderador de este hilo, así que no podés archivarlo. Pedíselo a un administrador del hilo.",
  depot_manager_blocked:
    "Tu usuario de depósito no tiene acceso a las acciones de Nexus Link. Pedíle a un administrador que archive el hilo.",
  session_expired:
    "Se cerró tu sesión. Volvé a entrar a Nexus y probá de nuevo.",
  unknown:
    "No se pudo archivar el hilo. Probá de nuevo y, si sigue igual, avisá a Sistemas.",
};

/** Forma mínima de un error de PostgREST/Supabase. No se propaga a la pantalla. */
export type RpcErrorLike = { code?: string | null; message?: string | null } | null;

function sqlstate(e: RpcErrorLike): string {
  return (e?.code ?? "").trim();
}

/**
 * DEUDA DECLARADA (INC-01/LOW-2): distinguir tarea de incidencia dentro del mismo
 * SQLSTATE 23514 obliga a mirar el texto de la excepción. No hay forma de anclarlo con
 * una prueba de contrato desde el repo: `connect_archive_entity_thread` está aplicada
 * en prod pero AUSENTE de `supabase/migrations` (hueco de linaje P3, 0205-0218). Si
 * alguien reformula ese `raise exception`, la causa cae a `unknown` — que sigue siendo
 * un mensaje humano y accionable, nunca un error mudo ni texto del motor en pantalla.
 */
function says(e: RpcErrorLike, needle: string): boolean {
  return (e?.message ?? "").toLowerCase().includes(needle);
}

/**
 * D-1 · qué falló de verdad.
 *
 * `entityError` viene de `connect_archive_entity_thread` (vía entidad terminada) y
 * `manualError` de `connect_archive_conversation` (owner/moderator/admin). Se llama
 * SÓLO cuando las dos fallaron: si alguna anduvo, el hilo quedó archivado.
 *
 * Prioridad: si la entidad sigue abierta (`check_violation`), ésa es la causa que se
 * informa aunque además falte el rol — es la única puerta que la persona puede abrir
 * por sus propios medios. Un hilo sin tarea ni incidencia (`no_data_found`, el caso
 * de WhatsApp) no tiene esa puerta: ahí la causa real es la del camino manual.
 */
export function classifyArchiveFailure(
  entityError: RpcErrorLike,
  manualError: RpcErrorLike,
): ArchiveBlockReason {
  if (sqlstate(entityError) === SQLSTATE_CHECK_VIOLATION) {
    // El servidor distingue tarea de incidencia; el texto se usa para clasificar
    // y se descarta acá — no llega a la pantalla.
    if (says(entityError, "incidente")) return "entity_incident_open";
    if (says(entityError, "tarea")) return "entity_task_open";
  }
  if (
    sqlstate(entityError) === SQLSTATE_INSUFFICIENT_PRIVILEGE &&
    says(entityError, "sesión")
  ) {
    return "session_expired";
  }
  if (sqlstate(manualError) === SQLSTATE_INSUFFICIENT_PRIVILEGE) {
    if (says(manualError, "no autorizado")) return "depot_manager_blocked";
    return "no_role";
  }
  // Ni la entidad ni el rol explican la falla: no se inventa una causa, pero tampoco
  // se calla. `unknown` tiene su propia redacción y ofrece un camino.
  return "unknown";
}

/** Traducción lista para pantalla. Nunca devuelve texto del motor. */
export function archiveFailureMessage(
  entityError: RpcErrorLike,
  manualError: RpcErrorLike,
): { reason: ArchiveBlockReason; message: string } {
  const reason = classifyArchiveFailure(entityError, manualError);
  return { reason, message: ARCHIVE_BLOCK_MESSAGE[reason] };
}

// ───────────────────────── D-3 · el espejo preventivo ─────────────────────────

/** Estados terminales que `connect_archive_entity_thread` acepta (medidos en prod). */
const TASK_TERMINAL = new Set(["completada", "cancelada"]);
const INCIDENT_TERMINAL = "cerrado";

/** Rol de participante que `connect_archive_conversation` acepta. */
const MANUAL_ROLES = new Set(["owner", "moderator"]);

/** Entidad vinculada al hilo, tal como la leen las RPC. */
export type ArchiveEntityFacts =
  | { kind: "task"; estado: string | null; asignadoA: string | null; creadoPor: string | null }
  | { kind: "incident"; estado: string | null; reportadoPor: string | null; asignadoA: string | null }
  | null;

/** Hechos del usuario y del hilo. Los provee la capa de lectura, server-side. */
export type ArchiveFacts = {
  /** `public.is_admin()` — la MISMA función que evalúan las RPC. */
  isAdmin: boolean;
  /** `has_permission('connect.task_admin')` — lo que envuelve `_connect_task_is_admin()`. */
  isTaskAdmin: boolean;
  /** `has_permission('connect.incident_admin')`. */
  isIncidentAdmin: boolean;
  /** `nexus_is_depot_manager_principal()` — rechaza el camino manual. */
  isDepotManager: boolean;
  /** `auth.uid()` de la sesión. */
  profileId: string | null;
  /** `connect_participants.member_role` del usuario en este hilo, o null si no es miembro. */
  memberRole: string | null;
  entity: ArchiveEntityFacts;
};

export type ArchiveVerdict =
  | { can: true }
  | { can: false; reason: ArchiveBlockReason; message: string };

function deny(reason: ArchiveBlockReason): ArchiveVerdict {
  return { can: false, reason, message: ARCHIVE_BLOCK_MESSAGE[reason] };
}

/**
 * D-3 · ¿puede esta persona archivar este hilo?
 *
 * Reproduce la CADENA completa que ejecuta `archiveInboxItemAction`: la vía de entidad
 * y, ante cualquier error suyo, la manual. Son una DISYUNCIÓN — por eso la vía de
 * entidad acá sólo otorga, nunca deniega por sí sola. No usa
 * `canAccess` de rbac/guard: su bootstrap per-user mostraría el control a quien el
 * servidor rechaza. Los hechos que entran acá salen de las mismas funciones del motor
 * (`is_admin`, `has_permission`) y de las mismas tablas, leídas con la sesión.
 *
 * Ante hechos incompletos NO se habilita por las dudas: se niega con la causa que
 * corresponda (fail-closed), igual que el servidor.
 */
export function evaluateArchiveCapability(f: ArchiveFacts): ArchiveVerdict {
  // Camino 1 — vía ENTIDAD (`connect_archive_entity_thread`). Acá sólo se OTORGA:
  // que esta puerta esté cerrada no decide nada, porque la acción cae a la manual
  // ante CUALQUIER error. Se recuerda la causa por si al final hay que informarla.
  let entityOpen: ArchiveBlockReason | null = null;
  if (f.entity) {
    if (f.entity.kind === "task") {
      if (!TASK_TERMINAL.has((f.entity.estado ?? "").trim())) {
        entityOpen = "entity_task_open";
      } else if (
        f.isAdmin ||
        f.isTaskAdmin ||
        (!!f.entity.asignadoA && f.entity.asignadoA === f.profileId) ||
        (!!f.entity.creadoPor && f.entity.creadoPor === f.profileId)
      ) {
        return { can: true };
      }
    } else {
      if ((f.entity.estado ?? "").trim() !== INCIDENT_TERMINAL) {
        entityOpen = "entity_incident_open";
      } else if (
        f.isAdmin ||
        f.isIncidentAdmin ||
        (!!f.entity.reportadoPor && f.entity.reportadoPor === f.profileId) ||
        (!!f.entity.asignadoA && f.entity.asignadoA === f.profileId)
      ) {
        return { can: true };
      }
    }
  }

  // Camino 2 — MANUAL (`connect_archive_conversation`). Es independiente del estado
  // de la entidad: sólo mira el principal de depósito y el rol. Un admin/owner/
  // moderator archiva aunque la tarea siga abierta — el servidor lo permite y la UI
  // no puede negarlo.
  if (f.isDepotManager) return deny("depot_manager_blocked");
  if (f.isAdmin) return { can: true };
  if (f.memberRole && MANUAL_ROLES.has(f.memberRole)) return { can: true };

  // Las dos puertas cerradas. Se informa la que la persona puede abrir por sus propios
  // medios: cerrar la entidad si sigue abierta; si no, pedir el rol.
  return deny(entityOpen ?? "no_role");
}
