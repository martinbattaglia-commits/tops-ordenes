// F5.2-lite · Catálogo CERRADO de tools read-only del Copilot.
// Cada tool = una RPC de lectura (0174) o una RPC permission-aware existente
// (connect_search, 0153). Args validados con zod ANTES de invocar; ningún
// argumento se interpola como SQL (las RPC son parámetros tipados).
// REGLA ESTRUCTURAL: acá no puede existir una tool de escritura (D-F5-2);
// el test tools.test.ts lo verifica contra una denylist de verbos.

import { z } from "zod";
import type { SourceChunk, ToolName } from "./types";

const limit = z.number().int().min(1).max(50).optional();

/** Deep-links internos conocidos. Si no hay ruta confiable → null (la UI
 *  muestra la cita sin link; nunca inventamos URLs). */
export function entityUrl(entityType: string, publicId: string | null): string | null {
  if (!publicId) return null;
  if (publicId.startsWith("INC-") || entityType.includes("incident"))
    return "/connect/incidentes";
  if (publicId.startsWith("TSK-") || entityType.includes("task")) return "/connect/tareas";
  if (entityType.includes("compliance")) return "/compliance";
  // F5.1-b.0 (D6): fichas de contrato → módulo Comercial. El deep-link lleva al
  // módulo (no al binario de Drive): la cita es a la FICHA de metadata, no al PDF.
  if (entityType.includes("contrato") || entityType.includes("contract"))
    return "/comercial/contratos";
  return null;
}

type RawRow = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const sn = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

export interface ToolSpec {
  rpc: string;
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
      "Casos de compliance activos y documentos vencidos o por vencer (90 días), con riesgo y próxima acción.",
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
      url: "/compliance",
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
  clients_health: js({ limit: jsLimit }),
  ops_digest: js({ hours: { type: "integer", minimum: 1, maximum: 168 }, limit: jsLimit }),
  my_agenda: js({ limit: jsLimit }),
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
