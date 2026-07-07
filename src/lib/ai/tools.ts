// F5.2-lite · Catálogo CERRADO de tools read-only del Copilot.
// Cada tool = una RPC de lectura (0174) o una RPC permission-aware existente
// (connect_search, 0153). Args validados con zod ANTES de invocar; ningún
// argumento se interpola como SQL (las RPC son parámetros tipados).
// REGLA ESTRUCTURAL: acá no puede existir una tool de escritura (D-F5-2);
// el test tools.test.ts lo verifica contra una denylist de verbos.

import { z } from "zod";
import { resolveNexusSections } from "./nexus-sections";
import { resolveOrgChart } from "./org-source";
import type { SourceChunk, ToolName } from "./types";

// P1b (fix/f5-2): `limit` es un TOPE DE RESULTADOS, no un argumento semántico de
// la pregunta. Un valor fuera de rango del provider (Gemini mandó limit>50 → crash
// real en prod, todo el turno cayó en 'error') se CLAMPEA a [1,50] en vez de tirar
// —la RPC ya re-clampa con least(greatest(...,1),50)—. Los args SEMÁNTICOS
// (hours/dias/daysIdle) siguen siendo error duro fuera de rango: cambiarlos alteraría
// el significado de la consulta del usuario.
const limit = z
  .number()
  .int()
  .optional()
  .transform((n) => (n == null ? undefined : Math.min(50, Math.max(1, n))));

/** Deep-links internos conocidos — SIEMPRE a nivel MÓDULO (rutas reales del App
 *  Router; el test anti-404 verifica cada una contra page.tsx). El entityType
 *  alcanza para resolver; `publicId` es solo una PISTA (prefijo INC-/TSK-), NO un
 *  requisito: exigirlo dejaba chips sin link cuando la RPC devolvía ref=null
 *  (regresión real: ai_compliance_pending → 15/15 documentos con ref null en prod).
 *  Tipo desconocido → null (la UI muestra la cita sin link; nunca inventamos URLs). */
export function entityUrl(entityType: string, publicId: string | null): string | null {
  // fix/f5-2: organigrama = módulo institucional (sin id por miembro).
  if (entityType === "organization_member" || entityType === "organigrama")
    return "/organigrama";
  if (publicId?.startsWith("INC-") || entityType.includes("incident"))
    return "/connect/incidentes";
  if (publicId?.startsWith("TSK-") || entityType.includes("task")) return "/connect/tareas";
  // El módulo Compliance vive en /anmat ("Compliance Cockpit"). NO existe ruta
  // /compliance → los chips de compliance_documento/compliance_caso daban 404
  // (fix source-link fix/f5-2). Deep-link al módulo, no al binario de Drive.
  if (entityType.includes("compliance")) return "/anmat";
  // F5.1-b.0 (D6): fichas de contrato → módulo Comercial. El deep-link lleva al
  // módulo (no al binario de Drive): la cita es a la FICHA de metadata, no al PDF.
  if (entityType.includes("contrato") || entityType.includes("contract"))
    return "/comercial/contratos";
  // P2 (fix/f5-2): rutas internas reales de facturación/compras (verificadas en
  // src/app). Registros estructurados, NO documentos: no van bajo el guard metadata.
  if (entityType === "customer_invoice") return "/billing";
  if (entityType === "supplier_invoice") return "/compras/facturas";
  if (entityType === "purchase_order") return "/compras/ordenes";
  if (entityType === "supplier" || entityType === "vendor") return "/compras/proveedores";
  // fix/f5-2 · analytics: agregados → módulo que muestra el detalle.
  if (entityType === "billing_periodo") return "/billing";
  if (entityType === "bank_balance") return "/tesoreria/bancos";
  return null;
}

type RawRow = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const sn = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

export interface ToolSpec {
  /** RPC de lectura (ai_* o connect_search). Ausente en tools LOCALES (ver `resolve`). */
  rpc?: string;
  /** fix/f5-2: tool LOCAL — resuelve filas desde datos estáticos del repo (p.ej.
   *  organigrama), sin DB/RPC/service_role. Si está presente, `executeTool` la usa
   *  y NO llama a Supabase. Los args ya vienen validados por el schema zod. */
  resolve?: (args: Record<string, unknown>) => RawRow[];
  description: string;
  schema: z.ZodType<Record<string, unknown> | object>;
  toRpcArgs(args: Record<string, unknown>): Record<string, unknown>;
  rowToChunk(row: RawRow): Omit<SourceChunk, "sourceId" | "tool">;
}

export const TOOLS: Record<ToolName, ToolSpec> = {
  search_knowledge: {
    rpc: "ai_search_knowledge",
    description:
      "Búsqueda full-text (español) sobre el spine Knowledge: entidades de todos los módulos visibles para el usuario.",
    schema: z.object({
      query: z.string().min(2).max(200),
      types: z.array(z.string().max(40)).max(8).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({ p_query: a.query, p_types: a.types ?? null, p_limit: a.limit ?? 20 }),
    rowToChunk: (r) => ({
      entityType: s(r.entity_type),
      entityId: s(r.entity_id),
      publicId: sn(r.public_id),
      title: s(r.title) || s(r.entity_type),
      excerpt: s(r.excerpt),
      date: sn(r.entity_date),
      url: entityUrl(s(r.entity_type), sn(r.public_id)),
    }),
  },
  connect_search: {
    rpc: "connect_search",
    description:
      "Búsqueda en Nexus Link (mensajes/conversaciones donde el usuario es miembro). RPC existente permission-aware (0153).",
    schema: z.object({ query: z.string().min(2).max(200), limit }),
    toRpcArgs: (a) => ({ p_query: a.query, p_limit: a.limit ?? 20 }),
    // Columnas reales de connect_search (0157): result_type, conversation_id,
    // context_id, kind, title, snippet, entity_type, entity_ref, occurred_at.
    rowToChunk: (r) => ({
      entityType: s(r.entity_type) || "connect_message",
      entityId: s(r.entity_ref ?? r.conversation_id),
      publicId: null,
      title: s(r.title) || "Resultado de Nexus Link",
      excerpt: s(r.snippet),
      date: sn(r.occurred_at),
      url: "/connect/buscar",
    }),
  },
  incidents_overview: {
    rpc: "ai_incidents_overview",
    description:
      "Listado/estado de incidentes con filtros por estado (abierto|en_progreso|en_espera|resuelto|cerrado) y severidad (baja|media|alta|critica). Los conteos salen de acá, no se estiman.",
    schema: z.object({
      estados: z
        .array(z.enum(["abierto", "en_progreso", "en_espera", "resuelto", "cerrado"]))
        .max(5)
        .optional(),
      severidades: z.array(z.enum(["baja", "media", "alta", "critica"])).max(4).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({
      p_estados: a.estados ?? null,
      p_severidades: a.severidades ?? null,
      p_limit: a.limit ?? 30,
    }),
    rowToChunk: (r) => ({
      entityType: "connect_incident",
      entityId: s(r.public_id),
      publicId: sn(r.public_id),
      title: `${s(r.public_id)} · ${s(r.titulo)}`,
      excerpt: `Estado: ${s(r.estado)} · Severidad: ${s(r.severidad)}${
        r.sector ? ` · Sector: ${s(r.sector)}` : ""
      }${r.asignado ? ` · Asignado: ${s(r.asignado)}` : " · Sin asignar"}`,
      date: sn(r.created_at),
      url: entityUrl("connect_incident", sn(r.public_id)),
    }),
  },
  tasks_overview: {
    rpc: "ai_tasks_overview",
    description:
      "Listado de tareas abiertas por scope: abiertas | vencidas | mias | de_usuario (requiere user uuid). Incluye asignado, prioridad y vencimiento.",
    schema: z.object({
      scope: z.enum(["abiertas", "vencidas", "mias", "de_usuario"]),
      user: z.string().uuid().optional(),
      limit,
    }),
    toRpcArgs: (a) => ({ p_scope: a.scope, p_user: a.user ?? null, p_limit: a.limit ?? 30 }),
    rowToChunk: (r) => ({
      entityType: "connect_task",
      entityId: s(r.public_id),
      publicId: sn(r.public_id),
      title: `${s(r.public_id)} · ${s(r.titulo)}`,
      excerpt: `Estado: ${s(r.estado)} · Prioridad: ${s(r.prioridad)}${
        r.asignado ? ` · Asignado: ${s(r.asignado)}` : " · Vacante"
      }${r.due_at ? ` · Vence: ${s(r.due_at)}` : ""}${
        r.workflow ? ` · Workflow: ${s(r.workflow)}` : ""
      }`,
      date: sn(r.created_at),
      url: entityUrl("connect_task", sn(r.public_id)),
    }),
  },
  workflows_stuck: {
    rpc: "ai_workflows_stuck",
    description:
      "Workflows en curso sin actividad en el paso actual hace N días (default 3). Definición determinista de 'trabado'.",
    schema: z.object({ daysIdle: z.number().int().min(1).max(60).optional(), limit }),
    toRpcArgs: (a) => ({ p_days_idle: a.daysIdle ?? 3, p_limit: a.limit ?? 20 }),
    rowToChunk: (r) => ({
      entityType: "connect_workflow",
      entityId: s(r.task_public_id ?? r.workflow),
      publicId: sn(r.task_public_id),
      title: `Workflow ${s(r.workflow)} · paso ${s(r.current_step)}${
        r.step_titulo ? ` (${s(r.step_titulo)})` : ""
      }`,
      excerpt: `Sin actividad hace ${s(r.idle_days)} días${
        r.task_public_id ? ` · Tarea del paso: ${s(r.task_public_id)} (${s(r.task_estado)})` : " · El paso actual no tiene tarea creada"
      }`,
      date: sn(r.iniciado),
      url: "/connect/tareas",
    }),
  },
  entity_timeline: {
    rpc: "ai_entity_timeline",
    description:
      "Cronología de eventos de una entidad concreta del spine (entity_type + entity_id tal como aparecen en search_knowledge).",
    schema: z.object({
      entityType: z.string().min(2).max(60),
      entityId: z.string().min(1).max(80),
      limit,
    }),
    toRpcArgs: (a) => ({
      p_entity_type: a.entityType,
      p_entity_id: a.entityId,
      p_limit: a.limit ?? 40,
    }),
    rowToChunk: (r) => ({
      entityType: "knowledge_event",
      entityId: `${s(r.event_type)}@${s(r.occurred_at)}`,
      publicId: null,
      title: s(r.event_type),
      excerpt: `${s(r.summary)}${r.actor_label ? ` · Actor: ${s(r.actor_label)}` : ""}`,
      date: sn(r.occurred_at),
      url: null,
    }),
  },
  entity_360: {
    rpc: "ai_entity_360",
    description:
      "Vista 360 de una entidad: eventos + conceptos anotados del grafo Knowledge.",
    schema: z.object({
      entityType: z.string().min(2).max(60),
      entityId: z.string().min(1).max(80),
      limit,
    }),
    toRpcArgs: (a) => ({
      p_entity_type: a.entityType,
      p_entity_id: a.entityId,
      p_limit: a.limit ?? 40,
    }),
    rowToChunk: (r) => ({
      entityType: "knowledge_event",
      entityId: `${s(r.event_type)}@${s(r.occurred_at)}`,
      publicId: null,
      title: s(r.event_type),
      excerpt: `${s(r.summary)}${
        r.concept_label ? ` · Concepto: ${s(r.concept_label)}` : ""
      }`,
      date: sn(r.occurred_at),
      url: null,
    }),
  },
  compliance_pending: {
    rpc: "ai_compliance_pending",
    description:
      "SOLO compliance: casos activos y documentos de compliance vencidos o por vencer (90 días), con riesgo y próxima acción. NO cubre contratos comerciales (para contratos usá contracts_overview).",
    schema: z.object({ limit }),
    toRpcArgs: (a) => ({ p_limit: a.limit ?? 30 }),
    rowToChunk: (r) => ({
      entityType: `compliance_${s(r.kind)}`,
      entityId: s(r.ref),
      publicId: sn(r.ref),
      title: s(r.titulo),
      excerpt: `${s(r.kind) === "caso" ? "Caso" : "Documento"} · Estado: ${s(r.estado)}${
        r.riesgo ? ` · Riesgo: ${s(r.riesgo)}` : ""
      }${r.fecha_clave ? ` · Fecha clave: ${s(r.fecha_clave)}` : ""}${
        r.detalle ? ` · ${s(r.detalle)}` : ""
      }`,
      date: sn(r.fecha_clave),
      // Fuente única de deep-links (fix/f5-2): entityUrl → /anmat. Antes hardcodeaba
      // /compliance (404). compliance_documento y compliance_caso resuelven a /anmat.
      url: entityUrl(`compliance_${s(r.kind)}`, sn(r.ref)),
    }),
  },
  // F5.1-b.0.1 · contratos a GRANO CONTRATO (lee public.contracts vía ai_contracts_overview,
  // SECURITY INVOKER). Cierra el hueco: compliance_pending no cubre contratos y solo 4/57
  // contratos tienen fichas. entityType 'contrato' → bajo el guard metadata-vs-contenido.
  contracts_overview: {
    rpc: "ai_contracts_overview",
    description:
      "Contratos comerciales (metadata, NO el texto del contrato) por mode: por_vencer | vencidos | vigentes | firmados_recientes | todos. Devuelve razón social, tipo, estado, fecha de firma y fecha de fin. El filtro `query` matchea razón social, tipo (p.ej. 'ANMAT') o id. USALA para toda pregunta de vencimiento, vigencia o firma de CONTRATOS (compliance_pending no cubre contratos).",
    schema: z.object({
      mode: z
        .enum(["por_vencer", "vencidos", "vigentes", "firmados_recientes", "todos"])
        .optional(),
      dias: z.number().int().min(1).max(365).optional(),
      query: z.string().max(120).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({
      p_mode: a.mode ?? "todos",
      p_dias: a.dias ?? 90,
      p_query: a.query ?? null,
      p_limit: a.limit ?? 30,
    }),
    rowToChunk: (r) => ({
      entityType: "contrato",
      entityId: s(r.public_id),
      publicId: sn(r.public_id),
      title: `${s(r.razon_social) || "Contrato"}${r.tipo ? ` · ${s(r.tipo)}` : ""}`,
      excerpt: `[ficha metadata] ${s(r.detalle)}`,
      date: sn(r.fecha_fin) ?? sn(r.fecha_firma),
      url: entityUrl("contrato", sn(r.public_id)),
    }),
  },
  // F5.1-b.0.1 · listado determinista de FICHAS por tipo + nombre (lee searchable_items vía
  // ai_docs_browse, SECURITY INVOKER); no depende del FTS frágil. entity_type real de la ficha.
  docs_browse: {
    rpc: "ai_docs_browse",
    description:
      "USALA para LISTAR, BUSCAR o PEDIR archivos/documentos/fichas ya cargados (compliance o contratos): 'cuáles son los archivos de compliance', 'buscame/dame/pasame el archivo de X', 'qué archivos/documentos hay de MAGALDI', 'listá documentos de compliance', y '¿cuándo vence <un documento puntual>?'. tipo = compliance | contrato. query = 1-2 PALABRAS CLAVE del tema/entidad que aparezcan en el TÍTULO (p.ej. 'residuos', 'ambiental', 'plancheta', 'lujan', 'habilitacion'), NO la frase completa; si no hay resultados, reintentá con otra palabra clave. Devuelve la FICHA de metadata (título/categoría/fechas), NO el contenido interno del documento; para resumir/cláusulas/qué dice, NO la uses.",
    schema: z.object({
      tipo: z.enum(["compliance", "contrato"]).optional(),
      query: z.string().max(120).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({
      p_tipo: a.tipo ?? null,
      p_query: a.query ?? null,
      p_limit: a.limit ?? 30,
    }),
    rowToChunk: (r) => ({
      entityType: s(r.entity_type),
      entityId: s(r.entity_id),
      publicId: sn(r.public_id),
      title: s(r.title) || s(r.entity_type),
      excerpt: s(r.excerpt),
      date: sn(r.entity_date),
      url: entityUrl(s(r.entity_type), sn(r.public_id)),
    }),
  },
  clients_health: {
    rpc: "ai_clients_health",
    description:
      "Clientes con más incidentes/tareas abiertos (vía vínculos de conversación). Solo razón social, sin datos de contacto.",
    schema: z.object({ limit }),
    toRpcArgs: (a) => ({ p_limit: a.limit ?? 15 }),
    rowToChunk: (r) => ({
      entityType: "client",
      entityId: s(r.cliente),
      publicId: null,
      title: s(r.cliente),
      excerpt: `Incidentes abiertos: ${s(r.incidentes_abiertos)} · Tareas abiertas: ${s(
        r.tareas_abiertas
      )} · Total: ${s(r.total_abiertos)}`,
      date: null,
      url: null,
    }),
  },
  ops_digest: {
    rpc: "ai_ops_digest",
    description:
      "Digest de eventos operativos del spine en las últimas N horas (default 24, máx 168).",
    schema: z.object({ hours: z.number().int().min(1).max(168).optional(), limit }),
    toRpcArgs: (a) => ({ p_hours: a.hours ?? 24, p_limit: a.limit ?? 40 }),
    rowToChunk: (r) => ({
      entityType: s(r.entity_type),
      entityId: s(r.entity_id),
      publicId: null,
      title: s(r.event_type),
      excerpt: `${s(r.summary)}${r.actor_label ? ` · Actor: ${s(r.actor_label)}` : ""}`,
      date: sn(r.occurred_at),
      url: null,
    }),
  },
  my_agenda: {
    rpc: "ai_my_agenda",
    description:
      "Agenda del usuario actual: incidentes/tareas asignados abiertos + notificaciones sin leer, priorizados. Nunca agenda de terceros.",
    schema: z.object({ limit }),
    toRpcArgs: (a) => ({ p_limit: a.limit ?? 30 }),
    rowToChunk: (r) => ({
      entityType: `agenda_${s(r.kind)}`,
      entityId: s(r.public_id) || s(r.titulo),
      publicId: sn(r.public_id),
      title: `${s(r.kind)}${r.public_id ? ` ${s(r.public_id)}` : ""} · ${s(r.titulo)}`,
      excerpt: `${r.detalle ? `${s(r.detalle)} · ` : ""}Prioridad: ${
        s(r.prioridad) || "normal"
      }${r.fecha ? ` · Fecha: ${s(r.fecha)}` : ""}`,
      date: sn(r.created_at),
      url:
        s(r.kind) === "incidente"
          ? "/connect/incidentes"
          : s(r.kind) === "tarea"
            ? "/connect/tareas"
            : "/connect/notificaciones",
    }),
  },
  // ── P2 (fix/f5-2): facturas emitidas / de proveedor / OC / proveedores ──────
  // Determinístico: "último/recientes" lo calcula la RPC (order by fecha desc), el
  // modelo solo elige el mode y redacta. Registros estructurados (no fichas): el
  // guard metadata-vs-contenido no los toca. NUNCA exponen CUIT/contacto (la RPC
  // proyecta solo campos de negocio; el engine re-redacta PII igual).
  customer_invoices_overview: {
    rpc: "ai_customer_invoices_overview",
    description:
      "Facturas EMITIDAS a clientes (ventas). mode: ultima | recientes | por_cliente | todas. `query` filtra por razón social del cliente o número de comprobante. Devuelve comprobante, cliente, total, fecha de emisión y estado ARCA. USALA para 'cuál fue la última factura emitida', 'facturas de <cliente>', 'qué facturamos'.",
    schema: z.object({
      mode: z.enum(["ultima", "recientes", "por_cliente", "todas"]).optional(),
      query: z.string().max(120).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({
      p_mode: a.mode ?? "recientes",
      p_query: a.query ?? null,
      p_limit: a.limit ?? 30,
    }),
    rowToChunk: (r) => ({
      entityType: "customer_invoice",
      entityId: s(r.public_id),
      publicId: sn(r.public_id),
      title: `${s(r.razon_social) || "Cliente"} · ${s(r.public_id)}`,
      excerpt: s(r.detalle),
      date: sn(r.fecha),
      url: entityUrl("customer_invoice", sn(r.public_id)),
    }),
  },
  supplier_invoices_overview: {
    rpc: "ai_supplier_invoices_overview",
    description:
      "Facturas de PROVEEDORES (compras). mode: ultima | recientes | por_proveedor | pendientes_aprobacion | todas. `query` filtra por proveedor o número. Devuelve comprobante, proveedor, total, fecha, estado y estado de aprobación. USALA para 'última factura de proveedor', 'facturas de proveedor pendientes de aprobación'.",
    schema: z.object({
      mode: z
        .enum(["ultima", "recientes", "por_proveedor", "pendientes_aprobacion", "todas"])
        .optional(),
      query: z.string().max(120).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({
      p_mode: a.mode ?? "recientes",
      p_query: a.query ?? null,
      p_limit: a.limit ?? 30,
    }),
    rowToChunk: (r) => ({
      entityType: "supplier_invoice",
      entityId: s(r.public_id),
      publicId: sn(r.public_id),
      title: `${s(r.proveedor) || "Proveedor"} · ${s(r.public_id)}`,
      excerpt: s(r.detalle),
      date: sn(r.fecha),
      url: entityUrl("supplier_invoice", sn(r.public_id)),
    }),
  },
  purchase_orders_overview: {
    rpc: "ai_purchase_orders_overview",
    description:
      "Órdenes de compra (OC) emitidas. mode: ultima | recientes | por_proveedor | todas. `query` filtra por proveedor o public_id (OC-####). Devuelve OC, proveedor, total, fecha y estado. USALA para 'cuál fue la última orden de compra', 'OC de <proveedor>'.",
    schema: z.object({
      mode: z.enum(["ultima", "recientes", "por_proveedor", "todas"]).optional(),
      query: z.string().max(120).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({
      p_mode: a.mode ?? "recientes",
      p_query: a.query ?? null,
      p_limit: a.limit ?? 30,
    }),
    rowToChunk: (r) => ({
      entityType: "purchase_order",
      entityId: s(r.public_id),
      publicId: sn(r.public_id),
      title: `${s(r.public_id)}${r.proveedor ? ` · ${s(r.proveedor)}` : ""}`,
      excerpt: s(r.detalle),
      date: sn(r.fecha),
      url: entityUrl("purchase_order", sn(r.public_id)),
    }),
  },
  suppliers_overview: {
    rpc: "ai_suppliers_overview",
    description:
      "Proveedores (vendors) cargados. `query` filtra por razón social o categoría; sin query, ordena por más recientes (el primero = último proveedor cargado). Solo razón social, categoría y estado — NUNCA CUIT ni datos de contacto. USALA para 'cuál fue el último proveedor cargado', 'proveedores de <categoría>'.",
    schema: z.object({ query: z.string().max(120).optional(), limit }),
    toRpcArgs: (a) => ({ p_query: a.query ?? null, p_limit: a.limit ?? 15 }),
    rowToChunk: (r) => ({
      entityType: "supplier",
      entityId: s(r.public_id) || s(r.razon),
      publicId: sn(r.public_id),
      title: s(r.razon) || "Proveedor",
      excerpt: s(r.detalle),
      date: null,
      url: entityUrl("supplier", sn(r.public_id)),
    }),
  },
  // ── fix/f5-2: organigrama institucional (tool LOCAL, sin DB) ────────────────
  // Lee src/lib/orgchart.ts (misma fuente que /organigrama). NO expone email ni
  // equity. Cierra el hueco "¿quién es el presidente/vice/comercial…?".
  organization_overview: {
    resolve: (a) => resolveOrgChart(a),
    description:
      "Organigrama institucional de Logística TOPS / Verotin S.A. (jerarquía, cargos y personas: presidencia, vicepresidencia, dirección de operaciones, gerencia comercial/administración, áreas, encargados y asesores). `query` filtra por cargo, área o nombre (p.ej. 'presidente', 'comercial', 'operaciones'). USALA para 'quién es el presidente/vicepresidente', 'quién está a cargo de X', 'mostrame el organigrama'. NO devuelve emails ni datos de contacto.",
    schema: z.object({ query: z.string().max(120).optional(), limit }),
    toRpcArgs: (a) => ({ query: a.query ?? null, limit: a.limit ?? 30 }),
    rowToChunk: (r) => ({
      entityType: "organization_member",
      entityId: s(r.name),
      publicId: null,
      title: `${s(r.name)} · ${s(r.role)}`,
      excerpt: `${s(r.role)}${r.area ? ` · Área: ${s(r.area)}` : ""}${
        r.detail ? ` · ${s(r.detail)}` : ""
      }`,
      date: null,
      url: entityUrl("organization_member", null),
    }),
  },
  // ── fix/f5-2 · analytics: SQL calcula (sumas/saldos/rankings), el modelo narra ─
  billing_summary: {
    rpc: "ai_billing_summary",
    description:
      "TOTAL FACTURADO por período (agregado de facturas emitidas AUTORIZADAS, sin anuladas). mode: ultimo_mes (mes calendario cerrado; si no tiene datos cae al último mes CON datos y el período lo dice) | mes_actual | ultimos_meses (los últimos `meses` con datos). USALA para '¿cuánto se facturó el último mes/este mes/en junio?', 'facturación total/mensual'. NUNCA sumes facturas vos: este total ya viene calculado.",
    schema: z.object({
      mode: z.enum(["ultimo_mes", "mes_actual", "ultimos_meses"]).optional(),
      meses: z.number().int().min(1).max(12).optional(),
    }),
    toRpcArgs: (a) => ({ p_mode: a.mode ?? "ultimo_mes", p_meses: a.meses ?? 3 }),
    rowToChunk: (r) => ({
      entityType: "billing_periodo",
      entityId: s(r.periodo),
      publicId: sn(r.periodo),
      title: `Facturación ${s(r.periodo)}`,
      excerpt: s(r.detalle),
      date: sn(r.hasta) ?? sn(r.desde),
      url: entityUrl("billing_periodo", null),
    }),
  },
  bank_balances_overview: {
    rpc: "ai_bank_balances_overview",
    description:
      "SALDOS BANCARIOS y de caja de Tesorería (saldo actual derivado de movimientos). `query` filtra por banco/cuenta (p.ej. 'santander', 'galicia', 'caja'). USALA para '¿cuánta plata hay en el banco X?', '¿cuál es el saldo del Santander?', 'saldos de bancos'. El saldo ya viene calculado: no lo derives vos.",
    schema: z.object({ query: z.string().max(120).optional(), limit }),
    toRpcArgs: (a) => ({ p_query: a.query ?? null, p_limit: a.limit ?? 15 }),
    rowToChunk: (r) => ({
      entityType: "bank_balance",
      entityId: s(r.bank_name),
      publicId: sn(r.bank_name),
      title: `${s(r.bank_name)}${r.account_name ? ` · ${s(r.account_name)}` : ""}`,
      excerpt: s(r.detalle),
      date: null,
      url: entityUrl("bank_balance", null),
    }),
  },
  supplier_spend_overview: {
    rpc: "ai_supplier_spend_overview",
    description:
      "RANKING de proveedores por monto agregado. base: gasto (facturas de proveedor, sin anuladas) | compromiso (órdenes de compra firmadas/activas = presupuesto comprometido). periodo: todo | mes_actual | ultimo_mes | ultimos_30_dias. USALA para '¿cuál es el proveedor que más consume presupuesto?' (base=compromiso), '¿en qué proveedor gastamos más?' (base=gasto), 'ranking de proveedores por gasto'. Devuelve proveedor+monto ordenado: NO respondas estas preguntas con el catálogo de proveedores.",
    schema: z.object({
      base: z.enum(["gasto", "compromiso"]).optional(),
      periodo: z.enum(["todo", "mes_actual", "ultimo_mes", "ultimos_30_dias"]).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({
      p_base: a.base ?? "gasto",
      p_periodo: a.periodo ?? "todo",
      p_limit: a.limit ?? 10,
    }),
    rowToChunk: (r) => ({
      entityType: "supplier_spend",
      entityId: s(r.proveedor),
      publicId: sn(r.proveedor),
      title: `${s(r.proveedor)} · ${s(r.base) === "compromiso" ? "presupuesto comprometido" : "gasto"}`,
      excerpt: s(r.detalle),
      date: null,
      // Deep-link según la base del cálculo: gasto → facturas de proveedor;
      // compromiso → órdenes de compra (criterio pedido por Dirección).
      url:
        s(r.base) === "compromiso"
          ? entityUrl("purchase_order", null)
          : entityUrl("supplier_invoice", null),
    }),
  },
  // ── fix/f5-2 · navegación: mapa de secciones de Nexus (tool LOCAL) ──────────
  nexus_sections_overview: {
    resolve: (a) => resolveNexusSections(a),
    description:
      "Mapa de SECCIONES de Nexus (navegación): qué módulos existen y su ruta. `query` = la sección buscada ('órdenes de compra', 'proveedores', 'compliance', 'tracking'). USALA para '¿qué secciones tiene Nexus?', '¿dónde veo X?', '¿cómo llego a Y?'. NO devuelve datos de negocio, solo el mapa del sistema con el link a cada sección.",
    schema: z.object({ query: z.string().max(200).optional(), limit }),
    toRpcArgs: (a) => ({ query: a.query ?? null, limit: a.limit ?? 30 }),
    rowToChunk: (r) => ({
      entityType: "nexus_section",
      entityId: s(r.route),
      publicId: null,
      title: `${s(r.label)} (${s(r.section)})`,
      excerpt: `Sección de Nexus · ${s(r.section)} · ${s(r.label)} · ruta ${s(r.route)}`,
      date: null,
      // Cada sección linkea a SU ruta real (verificada por test anti-404).
      url: s(r.route) || null,
    }),
  },
};

// ── JSON Schemas del catálogo (formato Anthropic Messages API tools) ─────────
// Espejo de los schemas zod de arriba. Regla de la API: additionalProperties
// false + required explícito. El test tools.test.ts verifica la paridad de
// claves entre ambos. Solo los usa el provider real; el mock no los necesita.

const js = (
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const jsLimit = { type: "integer", minimum: 1, maximum: 50 };

export const TOOL_INPUT_SCHEMAS: Record<ToolName, Record<string, unknown>> = {
  search_knowledge: js(
    {
      query: { type: "string", description: "Términos de búsqueda (español)" },
      types: { type: "array", items: { type: "string" }, description: "Filtrar por entity_type" },
      limit: jsLimit,
    },
    ["query"]
  ),
  connect_search: js(
    { query: { type: "string" }, limit: jsLimit },
    ["query"]
  ),
  incidents_overview: js({
    estados: {
      type: "array",
      items: { type: "string", enum: ["abierto", "en_progreso", "en_espera", "resuelto", "cerrado"] },
    },
    severidades: {
      type: "array",
      items: { type: "string", enum: ["baja", "media", "alta", "critica"] },
    },
    limit: jsLimit,
  }),
  tasks_overview: js(
    {
      scope: { type: "string", enum: ["abiertas", "vencidas", "mias", "de_usuario"] },
      user: { type: "string", description: "uuid del usuario (solo scope de_usuario)" },
      limit: jsLimit,
    },
    ["scope"]
  ),
  workflows_stuck: js({ daysIdle: { type: "integer", minimum: 1, maximum: 60 }, limit: jsLimit }),
  entity_timeline: js(
    { entityType: { type: "string" }, entityId: { type: "string" }, limit: jsLimit },
    ["entityType", "entityId"]
  ),
  entity_360: js(
    { entityType: { type: "string" }, entityId: { type: "string" }, limit: jsLimit },
    ["entityType", "entityId"]
  ),
  compliance_pending: js({ limit: jsLimit }),
  contracts_overview: js({
    mode: {
      type: "string",
      enum: ["por_vencer", "vencidos", "vigentes", "firmados_recientes", "todos"],
    },
    dias: { type: "integer", minimum: 1, maximum: 365 },
    query: { type: "string", description: "Filtro por razón social, tipo (p.ej. ANMAT) o public_id" },
    limit: jsLimit,
  }),
  docs_browse: js({
    tipo: { type: "string", enum: ["compliance", "contrato"] },
    query: { type: "string", description: "Filtro por nombre/título de la entidad" },
    limit: jsLimit,
  }),
  clients_health: js({ limit: jsLimit }),
  ops_digest: js({ hours: { type: "integer", minimum: 1, maximum: 168 }, limit: jsLimit }),
  my_agenda: js({ limit: jsLimit }),
  customer_invoices_overview: js({
    mode: { type: "string", enum: ["ultima", "recientes", "por_cliente", "todas"] },
    query: { type: "string", description: "Filtro por razón social del cliente o comprobante" },
    limit: jsLimit,
  }),
  supplier_invoices_overview: js({
    mode: {
      type: "string",
      enum: ["ultima", "recientes", "por_proveedor", "pendientes_aprobacion", "todas"],
    },
    query: { type: "string", description: "Filtro por proveedor o número de comprobante" },
    limit: jsLimit,
  }),
  purchase_orders_overview: js({
    mode: { type: "string", enum: ["ultima", "recientes", "por_proveedor", "todas"] },
    query: { type: "string", description: "Filtro por proveedor o public_id (OC-####)" },
    limit: jsLimit,
  }),
  suppliers_overview: js({
    query: { type: "string", description: "Filtro por razón social o categoría del proveedor" },
    limit: jsLimit,
  }),
  organization_overview: js({
    query: { type: "string", description: "Filtro por cargo, área o nombre (p.ej. 'presidente')" },
    limit: jsLimit,
  }),
  billing_summary: js({
    mode: { type: "string", enum: ["ultimo_mes", "mes_actual", "ultimos_meses"] },
    meses: { type: "integer", minimum: 1, maximum: 12 },
  }),
  bank_balances_overview: js({
    query: { type: "string", description: "Banco/cuenta (p.ej. 'santander', 'galicia', 'caja')" },
    limit: jsLimit,
  }),
  supplier_spend_overview: js({
    base: { type: "string", enum: ["gasto", "compromiso"] },
    periodo: { type: "string", enum: ["todo", "mes_actual", "ultimo_mes", "ultimos_30_dias"] },
    limit: jsLimit,
  }),
  nexus_sections_overview: js({
    query: { type: "string", description: "Sección buscada (p.ej. 'órdenes de compra', 'compliance')" },
    limit: jsLimit,
  }),
};

/** Catálogo en el formato `tools` de la Messages API (para el provider real). */
export function toProviderTools(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return (Object.keys(TOOLS) as ToolName[]).map((name) => ({
    name,
    description: TOOLS[name].description,
    input_schema: TOOL_INPUT_SCHEMAS[name],
  }));
}

/** Denylist estructural: ningún nombre de tool/RPC puede sugerir escritura. */
export const WRITE_VERBS_DENYLIST = [
  "create",
  "insert",
  "update",
  "delete",
  "upsert",
  "send",
  "notify",
  "assign",
  "approve",
  "execute",
  "crear",
  "enviar",
  "borrar",
  "modificar",
] as const;
