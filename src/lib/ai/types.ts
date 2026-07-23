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
  // smoke 2026-07-07: vacancia/capacidad/cubículos — misma fuente que el dashboard
  // (motor corporate-capacity + CommittedSnapshot del CRM; sin migración).
  "vacancy_overview",
  // fix/f5-2 · navegación: catálogo de secciones de Nexus (tool LOCAL).
  "nexus_sections_overview",
  // Copiloto de gestión (paradigma 2026-07-07): tool ORQUESTADORA read-only que
  // compone las tools de dominio existentes en un informe ejecutivo multi-dominio
  // (secciones + riesgos + oportunidades + brechas). Sin RPC propia, sin escritura.
  "management_brief",
  // Slice A (aceptación 2026-07-07): matriz de COBERTURA del Copilot (tool LOCAL).
  // Responde sobre el propio sistema y declara brechas específicas (WMS, caja
  // chica, movimientos) en vez de responder otro tema.
  "coverage_overview",
  // Slice B (aceptación 2026-07-07): comparador de compras/liquidez (ORQUESTADORA
  // sobre RPCs existentes): gasto vs compromiso · variación m/m de proveedores ·
  // saldo vs compromisos. Sin RPC nueva, sin migración.
  "spend_comparison_report",
  // Pirámide de conocimiento (2026-07-07): contexto GENERAL (tool LOCAL) —
  // fecha/hora del servidor + limitaciones honestas de actualidad (dólar,
  // noticias, clima, inflación) mientras no haya fuente externa conectada.
  "general_context",
  // C1 · Capa 2 (pirámide institucional 2026-07-07): conocimiento institucional
  // de Logística TOPS (servicios, propuesta de valor, web/landings, dossiers,
  // código de ética, identidad) ingerido desde la Knowledge Base de Drive →
  // tabla company_knowledge_documents (migración 0185, INVOKER/RLS). Separada
  // del spine operativo: no mezcla institucional con datos vivos.
  "company_knowledge_search",
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
  /** Pirámide de conocimiento (2026-07-07): la pregunta fue clasificada como
   *  CONOCIMIENTO GENERAL estático — el provider responde como asistente de IA
   *  general (sin tools de Nexus, con la aclaración de que es conocimiento
   *  general), en vez de la política Nexus-only. Decidido en CÓDIGO. */
  intent?: "general_static";
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

// ── Capa visual ejecutiva (estándar 2026-07-07) ──────────────────────────────
// Payload DETERMINÍSTICO construido por adaptadores tool→tablero (visuals.ts) a
// partir de las filas de la tool. El modelo NUNCA genera estos números: solo
// narra. La UI renderiza KPIs/tabla/chart; si no hay adaptador, respuesta
// compacta de texto (visual = null). Chart-ready por contrato.

export interface CopilotVisualKpi {
  label: string;
  value: string;
  hint?: string | null;
  /** 0-100: renderiza barra de progreso bajo el valor (estándar visual Nexus). */
  pct?: number | null;
  /** Tono semántico de la card (colores de estado estilo Cockpit/Compliance). */
  tone?: "brand" | "ok" | "warn" | "danger" | null;
  /** Acción INLINE de la card: ruta interna o URL externa real (p.ej. Drive). */
  url?: string | null;
  actionLabel?: string | null;
}

export interface CopilotVisualRowLink {
  url: string;
  label: string;
  /** Naturaleza de la acción (honestidad documental, smoke 2026-07-07):
   *  drive/folder = documento o carpeta REAL; crm = ficha; fallback = navegación
   *  al módulo — la UI la atenúa y NUNCA la presenta como fuente documental. */
  kind?: "drive" | "folder" | "crm" | "fallback";
}

export interface CopilotVisualTable {
  columns: string[];
  rows: string[][];
  /** Fuente INLINE por fila (alineado con `rows`); null = fila sin link. */
  rowLinks?: Array<CopilotVisualRowLink | null>;
}

export interface CopilotVisualChart {
  type: "donut" | "bar";
  labels: string[];
  /** Valores numéricos crudos (misma unidad), para render y para chart-ready. */
  values: number[];
  unit?: string | null;
  /** Título del gráfico cuando el tablero tiene más de uno (p.ej. "Por estado"). */
  title?: string | null;
}

export interface CopilotVisual {
  kind: "report" | "ranking" | "kpi" | "document";
  title: string;
  period?: string | null;
  kpis?: CopilotVisualKpi[];
  table?: CopilotVisualTable | null;
  chart?: CopilotVisualChart | null;
  /** Gráficos ADICIONALES al principal (dashboard multi-chart, p.ej. contratos:
   *  donut por tipo + barras por estado + disponibilidad documental). */
  charts?: CopilotVisualChart[];
  /** Insight ejecutivo calculado desde los datos (1-2 frases, determinístico). */
  insights?: string[];
  /** Brechas visibles (p.ej. 'Sin clasificar'): nunca se esconden. */
  warnings?: string[];
}

export interface CopilotAnswer {
  outcome: CopilotOutcome;
  answer: string;
  /** Solo las fuentes efectivamente citadas en la respuesta. */
  sources: SourceChunk[];
  /** Tablero ejecutivo determinístico (null = respuesta compacta de texto). */
  visual?: CopilotVisual | null;
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
