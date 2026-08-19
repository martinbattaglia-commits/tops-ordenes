// Nexus Link (bounded context `connect`) — modelo de datos en código (RC1.1).
// Espejo TS de las tablas/vistas de RC1.0 (migs 0142-0149). snake_case = forma de fila (DB);
// camelCase = forma de dominio/UI. Los mappers viven en read/ y data.ts.
// NO se importa nada de otros bounded contexts (acoplamiento débil por (entity_type, entity_id)).

// ───────────────────────── Enums (1:1 con 0143_connect_schema) ─────────────────────────
export type ConversationKind = "dm" | "group" | "channel" | "erp" | "incident" | "whatsapp" | "ai";
export type MemberRole = "owner" | "moderator" | "member" | "guest";
export type MessageKind = "text" | "system" | "ai" | "file" | "call_link" | "whatsapp" | "audio";
export type ParticipantType = "staff" | "client" | "provider" | "ai" | "system" | "whatsapp";

/**
 * WA-8R3 · proyección WhatsApp SANITIZADA para la UI.
 *
 * Es un DTO cerrado del contexto `connect`: deliberadamente NO importa nada de
 * `whatsapp` (el header de este archivo lo prohíbe). `realtime-status.ts`, que
 * sí puede tocar ese contexto, verifica en compilación que este espejo siga
 * siendo compatible con la máquina canónica.
 *
 * Nunca lleva `meta` crudo, `external_msg_id`, wamid, teléfono, texto del
 * proveedor, tokens ni errores internos: sólo dirección, estado canónico,
 * evidencia de auditoría y un instante propio para ordenar eventos.
 */
export type WaDirection = "inbound" | "outbound" | "unknown";

export type WaProviderState =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "reconciliation_required";

/**
 * WA-8R7 · procedencia del estado. Describe QUIÉN observó o escribió el hecho,
 * no qué tan importante es. `unknown` es fail-closed.
 */
/**
 * Procedencia del estado del outbound.
 *
 * WA-8R9 · H-3 · `historical_unknown` NO es un `unknown` más. Distingue la fila
 * que SÍ tiene un estado registrado pero cuya procedencia no se puede acreditar
 * —las anteriores a WA-8R7 y las del import histórico— de la que simplemente no
 * tiene estado. La diferencia importa para la UI: la primera nunca puede
 * mostrarse como intento en curso ni como confirmada, y la segunda es
 * sencillamente una fila sin egress.
 */
export type WaStateSource = "server" | "meta" | "unknown" | "historical_unknown";

export interface WaProjection {
  direction: WaDirection;
  /** Ganador único entre los candidatos, o `null` si hay ambigüedad. */
  providerState: WaProviderState | null;
  audited: boolean;
  stateAt: string | null;
  /**
   * WA-8R5 · estados canónicos observados en `stateAt`.
   *
   * Deduplicado y ordenado determinísticamente por la progresión canónica, de
   * modo que el resultado dependa del CONJUNTO de hechos y no del orden de
   * llegada. Conservarlos permite además que un evento posterior sólo resuelva
   * la ambigüedad si es alcanzable desde TODOS ellos.
   *
   * Cerrado a `WaProviderState`: nunca `meta` crudo, WAMID, teléfono, texto,
   * token ni payload del proveedor.
   */
  candidates: readonly WaProviderState[];
  /**
   * WA-8R7 · dominio de reloj y autoridad del estado.
   *
   * `meta.wa.status_at` mezcla dos relojes: el del servidor (con milisegundos) y
   * el de Meta (segundos enteros). Compararlos como texto hacía que un `failed`
   * real de Meta a las `12:00:03.000Z` pareciera anterior a un `sent` local de
   * las `12:00:03.500Z` y se descartara, dejando la burbuja en éxito auditado
   * hasta el próximo reload. Los instantes sólo se comparan dentro del mismo
   * dominio; entre dominios manda la procedencia.
   *
   * No lleva PII: es una de tres etiquetas cerradas.
   */
  stateSource: WaStateSource;
}

/** Vocabulario de entidades ERP vinculables (CHECK de connect_conversation_links, 0143). */
export const CONNECT_ENTITY_TYPES = [
  "clients", "orders", "purchase_orders", "customer_invoices", "supplier_invoices",
  "fleet_vehicles", "warehouses", "crm_leads", "crm_opportunities", "crm_contracts",
  "contracts", "prospeccion_prospects", "vendors", "compliance_items",
] as const;
export type ConnectEntityType = (typeof CONNECT_ENTITY_TYPES)[number];

/** Etiqueta legible por cada entity_type (UI). */
export const ENTITY_TYPE_LABELS: Record<ConnectEntityType, string> = {
  clients: "Cliente",
  orders: "Orden de servicio",
  purchase_orders: "Orden de compra",
  customer_invoices: "Factura de cliente",
  supplier_invoices: "Factura de proveedor",
  fleet_vehicles: "Vehículo",
  warehouses: "Depósito",
  crm_leads: "Lead",
  crm_opportunities: "Oportunidad",
  crm_contracts: "Contrato CRM",
  contracts: "Contrato",
  prospeccion_prospects: "Prospecto",
  vendors: "Proveedor",
  compliance_items: "Expediente compliance",
};

// ───────────────────────── Dominio (camelCase, forma UI) ─────────────────────────

/** Una conversación: la unidad de "contexto" de Nexus Link (D-RC1-5/6). */
export interface Conversation {
  id: string;
  /** Context ID permanente CTX-AAAA-NNNNNN (D-RC1-6): referencia estable transversal. */
  contextId: string;
  kind: ConversationKind;
  slug: string | null;
  title: string | null;
  visibility: "public" | "private" | null;
  topic: string | null;
  archivedAt: string | null;
  createdBy: string | null;
  lastMessageSeq: number | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface Participant {
  id: string;
  conversationId: string;
  participantType: ParticipantType;
  profileId: string | null;
  memberRole: MemberRole;
  joinedAt: string;
  lastReadSeq: number;
  mutedUntil: string | null;
  notifPref: string | null;
  isFavorite: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  seq: number;
  authorParticipantId: string | null;
  authorProfileId: string | null;
  authorName?: string | null; // denormalizado para UI (resuelto en read)
  kind: MessageKind;
  body: string | null;
  bodyFormat: string;
  replyToMessageId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  redacted: boolean;
  createdAt: string;
  /**
   * WA-8R3 · proyección WhatsApp sanitizada, derivada server-side.
   *
   * Su PRESENCIA significa «el servidor miró la fila»: por eso una burbuja
   * optimista local (que no la tiene) no se confunde con un mensaje hidratado
   * sin evidencia, que es exactamente el caso que no puede mostrarse confirmado.
   */
  wa?: WaProjection;
}

export interface ConversationLink {
  id: string;
  conversationId: string;
  entityType: ConnectEntityType;
  entityId: string | null;
  entityIdText: string | null;
  linkedBy: string | null;
  createdAt: string;
}

/** Fila de bandeja (v_connect_inbox): conversación + mi estado de lectura. */
export interface InboxItem {
  conversationId: string;
  contextId: string;
  kind: ConversationKind;
  title: string | null;
  slug: string | null;
  topic: string | null;
  lastMessageAt: string | null;
  lastMessageSeq: number | null;
  lastReadSeq: number;
  unreadCount: number;
  isFavorite: boolean;
  mutedUntil: string | null;
  archivedAt: string | null;
  /**
   * INC-01/D-3 · espejo server-side de lo que evalúan las RPC de archivado
   * (`connect_archive_entity_thread` + `connect_archive_conversation`). Lo calcula
   * `read/archive-capability.ts` reusando las MISMAS funciones del motor; la UI sólo
   * lo refleja. `undefined` = sin veredicto (demo/seeds o bandeja de Archivo): el
   * control queda habilitado y manda el servidor, como antes de INC-01.
   */
  canArchive?: boolean;
  /** Redacción humana de por qué no se puede archivar. Tooltip del control. */
  archiveBlockedMessage?: string | null;
}

/** Canal visible (v_connect_channels). */
export interface ChannelItem {
  id: string;
  contextId: string;
  slug: string | null;
  title: string | null;
  topic: string | null;
  visibility: "public" | "private" | null;
  lastMessageAt: string | null;
  isMember: boolean;
  /** DEFECT-6 (piloto F3): si está archivado, el directorio/sidebar lo excluyen y la vista es read-only. */
  archivedAt: string | null;
}

// ───────────────────────── Filas DB (snake_case) — entrada de los mappers ─────────────────────────
export interface ConversationRow {
  id: string;
  context_id: string;
  kind: ConversationKind;
  slug: string | null;
  title: string | null;
  visibility: "public" | "private" | null;
  topic: string | null;
  archived_at: string | null;
  created_by: string | null;
  last_message_seq: number | null;
  last_message_at: string | null;
  created_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  seq: number;
  author_participant_id: string | null;
  author_profile_id: string | null;
  kind: MessageKind;
  body: string | null;
  body_format: string;
  reply_to_message_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  redacted: boolean;
  created_at: string;
  /**
   * WA-8R3 · columnas leídas SÓLO para derivar la proyección. No se propagan al
   * cliente: `mapMessage` las consume y las descarta.
   */
  meta?: unknown;
  external_msg_id?: unknown;
}

export interface InboxRow {
  conversation_id: string;
  context_id: string;
  kind: ConversationKind;
  title: string | null;
  slug: string | null;
  topic: string | null;
  last_message_at: string | null;
  last_message_seq: number | null;
  last_read_seq: number;
  unread_count: number;
  is_favorite: boolean;
  muted_until: string | null;
  archived_at: string | null;
}

// ───────────────────────── F4.2 · Centro de Incidentes (0164) ─────────────────────────

/** Estados del incidente (enum connect_incident_status_t, Addendum A2 / D4). */
export const INCIDENT_STATUSES = [
  "abierto", "en_progreso", "en_espera", "resuelto", "cerrado",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Severidades (enum connect_incident_severity_t). */
export const INCIDENT_SEVERITIES = ["baja", "media", "alta", "critica"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  abierto: "Abierto",
  en_progreso: "En progreso",
  en_espera: "En espera",
  resuelto: "Resuelto",
  cerrado: "Cerrado",
};

export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  critica: "Crítica",
};

/** Incidente (forma dominio/UI). Nombres denormalizados resueltos en read. */
export interface Incident {
  id: string;
  /** INC-AAAA-NNNN (sequence + trigger de 0164). */
  publicId: string;
  conversationId: string;
  titulo: string;
  sector: string | null;
  ubicacion: string | null;
  tipoAveria: string | null;
  severidad: IncidentSeverity;
  estado: IncidentStatus;
  reportadoPor: string | null;
  asignadoA: string | null;
  reportadoPorName?: string | null;
  asignadoAName?: string | null;
  slaDueAt: string | null;
  resueltoAt: string | null;
  resolucionText: string | null;
  createdAt: string;
  updatedAt: string;
}

// ───────────────────────── F4.3 · Tareas colaborativas (0167-0169) ─────────────────────────

/** Estados de tarea (enum connect_task_status_t, ADR-F4-3 §4). */
export const TASK_STATUSES = ["pendiente", "en_progreso", "completada", "cancelada"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Prioridades (enum connect_task_priority_t). */
export const TASK_PRIORITIES = ["baja", "media", "alta", "urgente"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  completada: "Completada",
  cancelada: "Cancelada",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  urgente: "Urgente",
};

/** Tarea (forma dominio/UI). Nombres denormalizados resueltos en read. */
export interface Task {
  id: string;
  /** TSK-AAAA-NNNN (sequence + trigger de 0168). */
  publicId: string;
  titulo: string;
  descripcion: string | null;
  estado: TaskStatus;
  prioridad: TaskPriority;
  /** INFORMATIVO (ADR §9): ordena/colorea, no dispara nada. */
  dueAt: string | null;
  creadoPor: string | null;
  asignadoA: string | null;
  creadoPorName?: string | null;
  asignadoAName?: string | null;
  /** Hilo LAZY (ADR §10): null hasta el primer comentario. */
  conversationId: string | null;
  incidentId: string | null;
  workflowInstanceId: string | null;
  stepNo: number | null;
  area: string | null;
  cancelReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRow {
  id: string;
  public_id: string;
  titulo: string;
  descripcion: string | null;
  estado: TaskStatus;
  prioridad: TaskPriority;
  due_at: string | null;
  creado_por: string | null;
  asignado_a: string | null;
  conversation_id: string | null;
  incident_id: string | null;
  workflow_instance_id: string | null;
  step_no: number | null;
  area: string | null;
  cancel_reason: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Seguidor de tarea (ADR §7). */
export interface TaskFollower {
  taskId: string;
  profileId: string;
  name?: string | null;
}

/** Plantilla de workflow lineal (catálogo por seed, D-F43-6). */
export interface WorkflowTemplate {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  steps: Array<{ stepNo: number; titulo: string; rolSugerido: string | null }>;
}

/** Fila DB de connect_incidents (entrada del mapper de read). */
export interface IncidentRow {
  id: string;
  public_id: string;
  conversation_id: string;
  titulo: string;
  sector: string | null;
  ubicacion: string | null;
  tipo_averia: string | null;
  severidad: IncidentSeverity;
  estado: IncidentStatus;
  reportado_por: string | null;
  asignado_a: string | null;
  sla_due_at: string | null;
  resuelto_at: string | null;
  resolucion_text: string | null;
  created_at: string;
  updated_at: string;
}
