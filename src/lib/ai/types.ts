// F5.2-lite · Nexus AI Copilot read-only — tipos del bounded context `ai`.
// Regla estructural: NO existe ningún tipo de acción de escritura. El catálogo
// de tools es cerrado y de solo lectura (Master Plan §8 / D-F5-2).

/** Nombres del catálogo CERRADO de herramientas de lectura. */
export const TOOL_NAMES = [
  "search_knowledge",
  "connect_search",
  "incidents_overview",
  "tasks_overview",
  "workflows_stuck",
  "entity_timeline",
  "entity_360",
  "compliance_pending",
  "clients_health",
  "ops_digest",
  "my_agenda",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Chunk de evidencia recuperada — la ÚNICA materia prima de una respuesta. */
export interface SourceChunk {
  /** Id de cita estable dentro del request: S1, S2, … */
  sourceId: string;
  tool: ToolName;
  entityType: string;
  entityId: string;
  publicId: string | null;
  title: string;
  /** Texto ya pasado por redacción PII y truncado. */
  excerpt: string;
  date: string | null;
  /** Deep-link interno de Nexus (null si no hay ruta conocida). */
  url: string | null;
}

export interface ToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Pedido de un turno de razonamiento al provider. */
export interface ProviderTurnRequest {
  system: string;
  question: string;
  history: ChatTurn[];
  /** Evidencia acumulada hasta ahora (ya delimitada/redactada). */
  chunks: SourceChunk[];
  round: number;
  maxRounds: number;
  /** true si el turno anterior citó fuentes inválidas (único reintento). */
  retryAfterInvalidCitations?: boolean;
}

export type ProviderTurnResponse =
  | { kind: "tool_calls"; toolCalls: ToolCall[] }
  | { kind: "final"; answer: string };

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  plan(req: ProviderTurnRequest): Promise<ProviderTurnResponse>;
}

export type CopilotOutcome =
  | "answered"
  | "no_evidence"
  | "error"
  | "budget"
  | "killed"
  | "denied";

export interface CopilotAnswer {
  outcome: CopilotOutcome;
  answer: string;
  /** Solo las fuentes efectivamente citadas en la respuesta. */
  sources: SourceChunk[];
  /** Id del mensaje assistant auditado (para feedback); null en demo/mock. */
  messageId: string | null;
  sessionId: string;
}

export interface CopilotRequest {
  sessionId: string;
  question: string;
  history: ChatTurn[];
  channel: "page" | "panel";
  /** Contexto de entidad activa, p.ej. "incident:uuid" (panel lateral). */
  entityContext?: string | null;
}
