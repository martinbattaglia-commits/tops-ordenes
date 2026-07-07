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
  // F5.1-b.0.1 · retrieval documental: grano contrato (contracts) + listado de fichas.
  "contracts_overview",
  "docs_browse",
  "clients_health",
  "ops_digest",
  "my_agenda",
  // P2 (fix/f5-2): dominios financieros/compras que antes NO tenían tool ni
  // proyección → el Copilot no podía responder "última factura/OC/proveedor".
  "customer_invoices_overview",
  "supplier_invoices_overview",
  "purchase_orders_overview",
  "suppliers_overview",
  // fix/f5-2: organigrama institucional (tool LOCAL, lee src/lib/orgchart.ts; sin DB).
  "organization_overview",
  // fix/f5-2 · analytics: agregados determinísticos (SQL calcula; el modelo narra).
  "billing_summary",
  "bank_balances_overview",
  "supplier_spend_overview",
  // smoke humano 2026-07-06: facturación agrupada POR CLIENTE (top-1 y ranking).
  "customer_revenue_overview",
  // estándar gerencial 2026-07-07: ingresos por CATEGORÍA (ANMAT/Cargas/Sin clasificar).
  "revenue_by_category_report",
  // fix/f5-2 · navegación: catálogo de secciones de Nexus (tool LOCAL).
  "nexus_sections_overview",
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

/** Consumo reportado por el provider en un turno (solo providers reales). */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type ProviderTurnResponse =
  | { kind: "tool_calls"; toolCalls: ToolCall[]; usage?: ProviderUsage }
  | { kind: "final"; answer: string; usage?: ProviderUsage };

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
