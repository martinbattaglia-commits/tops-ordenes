// Nexus Link (Connect) — tipos canónicos del sistema de mensajería (RC1.0).
// Mapea el modelo de 0143_connect_schema.sql. Todo ID es UUID v4.

export type ConversationKind =
  | "dm"
  | "group"
  | "channel"
  | "erp"
  | "incident"
  | "task"
  | "whatsapp"
  | "ai";

export type ParticipantType = "staff" | "whatsapp" | "system" | "bot";

export type MemberRole = "owner" | "moderator" | "member" | "guest";

export type MessageKind =
  | "text"
  | "audio"
  | "file"
  | "image"
  | "system"
  | "whatsapp";

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
export type WaStateSource = "server" | "meta" | "unknown" | "historical_unknown";

export interface WaProjection {
  direction: WaDirection;
  /** Ganador único entre los candidatos, o `null` si hay ambigüedad. */
  providerState: WaProviderState | null;
  audited: boolean;
  stateAt: string | null;
  /**
   * WA-8R5 · estados canónicos observados en `stateAt`.
   */
  candidates: readonly WaProviderState[];
  /**
   * WA-8R7 · dominio de reloj y autoridad del estado.
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

/** Reacción emoji a un mensaje (P3). */
export interface MessageReaction {
  id: string;
  emoji: string;
  participantId?: string | null;
  count: number;
  myReaction: boolean;
}

/** Mensaje citado/referenciado (P3). */
export interface QuotedMessage {
  id: string;
  authorName: string | null;
  body: string | null;
}

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
  /** Estado persistido del handover WhatsApp. Ausente en conversaciones legacy/no-WA. */
  handoverState?: "BOT_ACTIVE" | "PAUSED_HUMAN";
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

/**
 * H-1 · el adjunto, tal como VIAJA al cliente.
 */
export interface MessageAttachment {
  id: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  scanStatus: string;
}

export interface Message {
  id: string;
  conversationId: string;
  seq: number;
  authorParticipantId: string | null;
  authorProfileId: string | null;
  authorName?: string | null; // denormalizado para UI (resuelto en read)
  authorAvatarUrl?: string | null; // P2: avatar foto/url resuelto en read
  kind: MessageKind;
  body: string | null;
  bodyFormat: string;
  replyToMessageId: string | null;
  replyToMessage?: QuotedMessage | null; // P3: datos del mensaje citado
  reactions?: MessageReaction[]; // P3: reacciones agregadas
  editedAt: string | null;
  deletedAt: string | null;
  redacted: boolean;
  createdAt: string;
  /**
   * WA-8R3 · proyección WhatsApp sanitizada, derivada server-side.
   */
  wa?: WaProjection;
  /**
   * H-1 · adjuntos del mensaje.
   */
  attachments?: MessageAttachment[];
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
  canArchive?: boolean;
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
  handover_state?: "BOT_ACTIVE" | "PAUSED_HUMAN" | null;
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
  meta?: unknown;
  external_msg_id?: unknown;
  connect_attachments?: Array<{
    id: string;
    file_name: string | null;
    mime_type: string | null;
    file_size: number | string | null;
    scan_status: string | null;
  }> | null;
  connect_message_reactions?: Array<{
    id: string;
    emoji: string;
    participant_id: string;
    created_at: string;
  }> | null;
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

export const INCIDENT_STATUSES = [
  "abierto", "en_progreso", "en_espera", "resuelto", "cerrado",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

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

export interface Incident {
  id: string;
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

export const TASK_STATUSES = ["pendiente", "en_progreso", "completada", "cancelada"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

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

export interface Task {
  id: string;
  publicId: string;
  titulo: string;
  descripcion: string | null;
  estado: TaskStatus;
  prioridad: TaskPriority;
  dueAt: string | null;
  creadoPor: string | null;
  asignadoA: string | null;
  creadoPorName?: string | null;
  asignadoAName?: string | null;
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

export interface TaskFollower {
  taskId: string;
  profileId: string;
  name?: string | null;
}

export interface WorkflowTemplate {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  steps: Array<{ stepNo: number; titulo: string; rolSugerido: string | null }>;
}

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
