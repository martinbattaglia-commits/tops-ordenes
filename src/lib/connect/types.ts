// Nexus Link (bounded context `connect`) — modelo de datos en código (RC1.1).
// Espejo TS de las tablas/vistas de RC1.0 (migs 0142-0149). snake_case = forma de fila (DB);
// camelCase = forma de dominio/UI. Los mappers viven en read/ y data.ts.
// NO se importa nada de otros bounded contexts (acoplamiento débil por (entity_type, entity_id)).

// ───────────────────────── Enums (1:1 con 0143_connect_schema) ─────────────────────────
export type ConversationKind = "dm" | "group" | "channel" | "erp" | "incident" | "whatsapp" | "ai";
export type MemberRole = "owner" | "moderator" | "member" | "guest";
export type MessageKind = "text" | "system" | "ai" | "file" | "call_link" | "whatsapp";
export type ParticipantType = "staff" | "client" | "provider" | "ai" | "system" | "whatsapp";

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
