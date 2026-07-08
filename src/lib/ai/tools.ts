// F5.2-lite · Catálogo CERRADO de tools read-only del Copilot.
// Cada tool = una RPC de lectura (0174) o una RPC permission-aware existente
// (connect_search, 0153). Args validados con zod ANTES de invocar; ningún
// argumento se interpola como SQL (las RPC son parámetros tipados).
// REGLA ESTRUCTURAL: acá no puede existir una tool de escritura (D-F5-2);
// el test tools.test.ts lo verifica contra una denylist de verbos.

import { z } from "zod";
import { getCommittedSnapshot } from "@/lib/comercial/committed-capacity";
import {
  CAPACITY_CATEGORIES,
  CATEGORY_LABEL,
  getCorporateCapacity,
  getCorporateVacancySummary,
} from "@/lib/wms/corporate-capacity";
import { resolveCopilotCoverage } from "./coverage-source";
import { resolveGeneralContext } from "./general-source";
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
  if (entityType === "customer_revenue") return "/billing";
  if (entityType === "revenue_categoria") return "/billing";
  if (entityType === "vacancy_metric") return "/comercial/dashboard-vacancia";
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
  /** smoke 2026-07-07: tool de FUENTE COMPARTIDA — usa la MISMA lib server-side
   *  que la UI (p.ej. motor de capacidad + snapshot CRM vía cliente de sesión/RLS).
   *  Sin RPC propia y sin duplicar cálculo. En demo se usan los fixtures. */
  fetchRows?: (args: Record<string, unknown>) => Promise<RawRow[]>;
  /** Copiloto de gestión (2026-07-07): tool ORQUESTADORA — compone OTRAS tools
   *  del catálogo cerrado (cada sub-tool resuelve su demo/real y su RLS). Import
   *  dinámico para no crear ciclos de módulo. Sigue siendo read-only por
   *  construcción: solo puede invocar tools de este mismo catálogo. */
  orchestrate?: (args: Record<string, unknown>) => Promise<RawRow[]>;
  /** Slice B: filtro de FIXTURES en demo mode para args semánticos (mode/base/
   *  periodo) — espeja lo que la RPC real filtra en SQL. Solo corre en isMock. */
  demoFilter?: (rows: RawRow[], args: Record<string, unknown>) => RawRow[];
  /** smoke 2026-07-07 (links reales): enriquecimiento read-only POST-RPC con el
   *  cliente de SESIÓN (RLS) — p.ej. traer la URL de Drive de compliance_documents/
   *  contract_documents para las fichas devueltas. Errores → filas sin enriquecer. */
  enrich?: (
    rows: RawRow[],
    supabase: NonNullable<ReturnType<typeof import("@/lib/supabase/server").createClient>>
  ) => Promise<RawRow[]>;
  /** FIX Drive Docs Fase 2 (2026-07-08): re-ranking POST-fetch consciente de los
   *  args (p.ej. plancheta/habilitación → PDF visible antes que CAD .dwg/.dwf).
   *  Corre en demo y real; READ-ONLY (solo reordena, no muta ni consulta la DB). */
  rank?: (rows: RawRow[], args: Record<string, unknown>) => RawRow[];
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
      "Contratos comerciales (metadata, NO el texto del contrato) por mode: por_vencer | vencidos | vigentes | firmados_recientes | todos. Devuelve razón social, tipo, estado, fecha de firma y fecha de fin. El filtro `query` matchea razón social, tipo (p.ej. 'ANMAT') o id. Para '¿cuál fue el ÚLTIMO contrato firmado?' (singular) usá mode=firmados_recientes con limit=1 (ordena por firma descendente). Pasá periodo='ultimo_mes' SOLO si el usuario acotó explícitamente al último mes. USALA para toda pregunta de vencimiento, vigencia o firma de CONTRATOS (compliance_pending no cubre contratos).",
    schema: z.object({
      mode: z
        .enum(["por_vencer", "vencidos", "vigentes", "firmados_recientes", "todos"])
        .optional(),
      dias: z.number().int().min(1).max(365).optional(),
      query: z.string().max(120).optional(),
      // Hint de intención para el adaptador visual (NO viaja al RPC): el usuario
      // acotó explícitamente al último mes calendario (smoke 2026-07-07).
      periodo: z.enum(["ultimo_mes"]).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({
      p_mode: a.mode ?? "todos",
      p_dias: a.dias ?? 90,
      p_query: a.query ?? null,
      p_limit: a.limit ?? 30,
    }),
    // smoke 2026-07-07: link al CONTRATO REAL por fila. Escalera: archivo
    // (contract_documents.url, el más reciente) → carpeta Drive del contrato
    // (drive_folder_id) → módulo. Lectura con cliente de SESIÓN (RLS staff).
    enrich: async (rows, supabase) => {
      const pids = rows.map((r) => s(r.public_id)).filter(Boolean);
      if (pids.length === 0) return rows;
      const { data: contracts, error } = await supabase
        .from("contracts")
        .select("id, public_id, drive_folder_id")
        .in("public_id", pids);
      if (error || !contracts) return rows;
      const byPid = new Map(
        (contracts as Array<{ id: string; public_id: string; drive_folder_id: string | null }>).map(
          (c) => [String(c.public_id), c]
        )
      );
      const ids = [...byPid.values()].map((c) => c.id);
      const fileByContract = new Map<string, string>();
      if (ids.length > 0) {
        const { data: docs } = await supabase
          .from("contract_documents")
          .select("contract_id, url, drive_modified_at")
          .in("contract_id", ids)
          .not("url", "is", null)
          .order("drive_modified_at", { ascending: false });
        for (const d of (docs ?? []) as Array<{ contract_id: string; url: string | null }>) {
          const k = String(d.contract_id);
          if (!fileByContract.has(k) && d.url) fileByContract.set(k, d.url);
        }
      }
      return rows.map((r) => {
        const c = byPid.get(s(r.public_id));
        return {
          ...r,
          file_url: c ? (fileByContract.get(String(c.id)) ?? null) : null,
          folder_url: c?.drive_folder_id
            ? `https://drive.google.com/drive/folders/${c.drive_folder_id}`
            : null,
        };
      });
    },
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
      "USALA para LISTAR, BUSCAR o PEDIR archivos/documentos/fichas ya cargados (compliance o contratos) — 'buscame/dame/pasame el archivo de X': planchetas, habilitaciones, planos (de incendio / evacuación / ventilación mecánica), certificados, pólizas, residuos, impacto ambiental. Ej.: 'plancheta de habilitación de Luján', 'planos de Magaldi', 'plano de incendio de Magaldi', 'documentación habilitante de Pedro de Luján 3159', 'archivo de residuos ambiental de Magaldi'. tipo = compliance | contrato. query = 2 PALABRAS CLAVE: el TIPO de documento + la SEDE — p.ej. 'habilitacion lujan', 'plancheta magaldi', 'incendio magaldi', 'evacuacion lujan', 'ventilacion magaldi' (sedes: Magaldi 1765 y Pedro de Luján 3159). NO pases la frase completa; si no hay resultados, reintentá con otra palabra clave. Devuelve la FICHA con el LINK REAL de Drive del documento (aunque el PDF sea escaneado). NO devuelve el texto interno del PDF; para resumir/cláusulas/qué dice, NO la uses.",
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
    // smoke 2026-07-07: link REAL al documento. entity_id de la ficha = id de
    // compliance_documents/contract_documents (proyección 0176), que tienen
    // `url` (webViewLink de Drive). Lectura con el cliente de SESIÓN (RLS).
    enrich: async (rows, supabase) => {
      const compIds: string[] = [];
      const ctrIds: string[] = [];
      for (const r of rows) {
        const id = s(r.entity_id);
        if (!id) continue;
        (s(r.entity_type).startsWith("compliance") ? compIds : ctrIds).push(id);
      }
      const meta = new Map<string, { url: string | null; sede: string | null; tipo: string | null }>();
      // compliance_documents trae sede + tipo_doc → card documental completa
      // (título / sede / tipo / fecha / Abrir en Drive). FIX Drive Docs 2026-07-08.
      if (compIds.length > 0) {
        const { data } = await supabase
          .from("compliance_documents")
          .select("id, url, sede, tipo_doc")
          .in("id", compIds);
        for (const d of (data ?? []) as Array<{
          id: string;
          url: string | null;
          sede: string | null;
          tipo_doc: string | null;
        }>)
          meta.set(String(d.id), { url: d.url, sede: d.sede, tipo: d.tipo_doc });
      }
      if (ctrIds.length > 0) {
        const { data } = await supabase.from("contract_documents").select("id, url").in("id", ctrIds);
        for (const d of (data ?? []) as Array<{ id: string; url: string | null }>)
          meta.set(String(d.id), { url: d.url, sede: null, tipo: null });
      }
      return rows.map((r) => {
        const m = meta.get(s(r.entity_id));
        return {
          ...r,
          source_url: m?.url ?? null,
          source_sede: m?.sede ?? null,
          source_tipo: m?.tipo ?? null,
        };
      });
    },
    // FIX Drive Docs Fase 2 (2026-07-08): si el usuario pide PLANCHETA o
    // HABILITACIÓN, el PDF/plancheta visible le gana al CAD (.dwg/.dwf) — la RPC
    // ordena por ts_rank/fecha y devolvía primero un .dwg. NO toca planos técnicos
    // (incendio/evacuación/ventilación), donde el CAD sí puede ser el principal.
    // Read-only: reordena estable (empate = orden de la RPC).
    rank: (rows, args) => {
      const q = s(args.query).toLowerCase();
      if (!/planchet|habilitac/.test(q)) return rows;
      const isCad = (t: string) => /\.(dwg|dwf|dxf)$/i.test(t.trim());
      const isPdf = (t: string) => /\.pdf$/i.test(t.trim());
      const score = (r: RawRow): number => {
        const t = s(r.title);
        let sc = 0;
        if (/plancheta/i.test(t)) sc += 100; // "PLANCHETA DE HABILITACIÓN…" primero
        if (isPdf(t)) sc += 40; // PDF visible por el usuario
        if (/certificad/i.test(t) || s(r.source_tipo).toLowerCase() === "certificado") sc += 20;
        if (/habilitac/i.test(t)) sc += 10;
        if (isCad(t)) sc -= 50; // CAD técnico: recién después
        return sc;
      };
      return rows
        .map((r, i) => ({ r, i, sc: score(r) }))
        .sort((a, b) => b.sc - a.sc || a.i - b.i)
        .map((x) => x.r);
    },
    // FIX Drive Docs 2026-07-08: la cita abre el PDF REAL de Drive (source_url del
    // enrich); solo si no hay link, cae a la ficha del módulo (nunca /anmat a secas
    // cuando existe el documento).
    rowToChunk: (r) => ({
      entityType: s(r.entity_type),
      entityId: s(r.entity_id),
      publicId: sn(r.public_id),
      title: s(r.title) || s(r.entity_type),
      excerpt: s(r.excerpt),
      date: sn(r.entity_date),
      url: s(r.source_url) || entityUrl(s(r.entity_type), sn(r.public_id)),
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
    // Slice B: fixtures = [mes en curso parcial, meses cerrados…] desc; el
    // demoFilter espeja p_mode de la RPC: ultimo_mes = último mes CERRADO,
    // mes_actual = el mes calendario en curso, ultimos_meses = serie desc.
    demoFilter: (rows, a) => {
      const mode = String(a.mode ?? "ultimo_mes");
      if (mode === "ultimos_meses") return rows.slice(0, Number(a.meses ?? 3));
      const hoy = new Date();
      const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
      if (mode === "mes_actual") {
        const m = rows.filter((r) => r.periodo === mesActual);
        return m.slice(0, 1);
      }
      const cerrados = rows.filter((r) => r.periodo !== mesActual);
      return (cerrados.length > 0 ? cerrados : rows).slice(0, 1);
    },
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
      // Slice B · hint VISUAL (no viaja al RPC): la pregunta pide el peso del
      // top sobre el total → entidad principal + % del top listado.
      focoTop: z.boolean().optional(),
      limit,
    }),
    toRpcArgs: (a) => ({
      p_base: a.base ?? "gasto",
      p_periodo: a.periodo ?? "todo",
      p_limit: a.limit ?? 10,
    }),
    // Slice B: el demoFilter espeja p_base/p_periodo de la RPC (sin esto, demo
    // devolvía filas de compromiso para preguntas de gasto — mislabel real del
    // examen de aceptación). Match EXACTO: sin fixture para esa combinación →
    // vacío HONESTO (review adversarial: un fallback que mezcla períodos/bases
    // re-etiqueta datos de otro período — peor que un vacío declarado).
    demoFilter: (rows, a) =>
      rows.filter(
        (r) => r.base === String(a.base ?? "gasto") && r.periodo === String(a.periodo ?? "todo")
      ),
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
  // ── smoke humano 2026-07-06: facturación agrupada POR CLIENTE ───────────────
  customer_revenue_overview: {
    rpc: "ai_customer_revenue_overview",
    description:
      "FACTURACIÓN POR CLIENTE (agregado de facturas emitidas AUTORIZADAS, sin anuladas), ordenada de mayor a menor. periodo: todo | mes_actual | ultimo_mes. limit=1 para '¿cuál fue EL cliente que más facturó?' (singular = UNA entidad); limit>1 para rankings. USALA para 'cliente que más facturó', 'mayor facturación', 'ranking de clientes por facturación'. El total ya viene sumado: no lo calcules vos. NO uses search_knowledge para esto.",
    schema: z.object({
      periodo: z.enum(["todo", "mes_actual", "ultimo_mes"]).optional(),
      // Slice B · hint VISUAL (no viaja al RPC): peso del top sobre el total.
      focoTop: z.boolean().optional(),
      limit,
    }),
    toRpcArgs: (a) => ({ p_periodo: a.periodo ?? "todo", p_limit: a.limit ?? 10 }),
    rowToChunk: (r) => ({
      entityType: "customer_revenue",
      entityId: s(r.cliente),
      publicId: sn(r.cliente),
      title: `${s(r.cliente)} · facturación`,
      excerpt: s(r.detalle),
      date: null,
      url: entityUrl("customer_revenue", null),
    }),
  },
  // ── estándar gerencial 2026-07-07: ingresos por CATEGORÍA (caso testigo) ────
  // Una fila POR CATEGORÍA (ANMAT / Cargas Generales / Sin clasificar) con monto,
  // % del total y cantidad — chart-ready (pie/bar) por construcción. El criterio
  // de clasificación es determinístico y auditable (tags de cliente → keyword de
  // ítems → Sin clasificar); 'Sin clasificar' SIEMPRE visible, nunca se inventa.
  revenue_by_category_report: {
    rpc: "ai_revenue_by_category",
    description:
      "REPORTE de ingresos por CATEGORÍA / unidad de negocio (ANMAT, Cargas Generales, Sin clasificar): monto, PORCENTAJE del total, cantidad de facturas y total del período — todo ya calculado. periodo: ultimo_mes | mes_actual | todo. USALA para 'reporte de ingresos por categoría', '¿qué porcentaje fue ANMAT / cargas generales?', 'distribución/composición de ingresos', 'reporte ejecutivo de facturación'. Redactá el reporte (título, período, total, tabla por categoría, resumen) usando EXACTAMENTE estos números; si aparece 'Sin clasificar', mostralo con su monto y % y adverti la brecha.",
    schema: z.object({
      periodo: z.enum(["ultimo_mes", "mes_actual", "todo"]).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({ p_periodo: a.periodo ?? "ultimo_mes", p_limit: a.limit ?? 10 }),
    rowToChunk: (r) => ({
      entityType: "revenue_categoria",
      entityId: s(r.categoria),
      publicId: sn(r.categoria),
      title: `Ingresos ${s(r.categoria)} · ${s(r.periodo)}`,
      excerpt: s(r.detalle),
      date: null,
      url: entityUrl("revenue_categoria", null),
    }),
  },
  // ── smoke 2026-07-07: vacancia / capacidad / cubículos (FUENTE COMPARTIDA) ──
  // MISMA fuente que /comercial/dashboard-vacancia: motor puro corporate-capacity
  // (Twins Luján 3159 + Magaldi 1765) + CommittedSnapshot de crm_opportunities
  // (cliente de sesión → RLS). Sin RPC nueva, sin duplicar cálculo, sin números
  // hardcodeados: si el Twin o el CRM cambian, la UI y el Copilot cambian juntos.
  vacancy_overview: {
    fetchRows: async () => {
      const snapshot = await getCommittedSnapshot();
      const s = getCorporateVacancySummary(snapshot);
      const c = getCorporateCapacity(snapshot);
      const alquilados = c.cubiculos.total - c.cubiculos.available;
      const rows: Record<string, string | number>[] = [
        {
          alcance: "Corporativo",
          capacidad_m2: s.comercializableM2,
          ocupado_m2: s.ocupadoM2,
          disponible_m2: s.disponibleM2,
          vacancia_pct: s.vacanciaPct,
          cubiculos_total: c.cubiculos.total,
          cubiculos_disponibles: c.cubiculos.available,
          cubiculos_alquilados: alquilados,
          detalle:
            `Capacidad corporativa · comercializable ${s.comercializableM2} m² · ocupado ${s.ocupadoM2} m² · disponible ${s.disponibleM2} m² · vacancia ${s.vacanciaPct}%` +
            ` · cubículos ANMAT: ${alquilados} alquilados de ${c.cubiculos.total} (${c.cubiculos.available} disponibles)`,
        },
        ...CAPACITY_CATEGORIES.map((k) => {
          const cat = s.byCategory[k];
          return {
            alcance: CATEGORY_LABEL[k],
            capacidad_m2: cat.capacityM2,
            ocupado_m2: Math.round((cat.capacityM2 - cat.availableM2) * 10) / 10,
            disponible_m2: cat.availableM2,
            vacancia_pct: cat.vacanciaPct,
            detalle: `${CATEGORY_LABEL[k]} · capacidad ${cat.capacityM2} m² · disponible ${cat.availableM2} m² · vacancia ${cat.vacanciaPct}%`,
          };
        }),
      ];
      return rows;
    },
    description:
      "CAPACIDAD y VACANCIA corporativa (misma fuente que el dashboard de Vacancia): m² comercializables, ocupados y DISPONIBLES — total y por unidad de negocio (ANMAT / Cargas Generales / Oficinas) — más CUBÍCULOS ANMAT (alquilados/disponibles/total). USALA para '¿qué % de vacancia tenemos?', '¿cuántos m² disponibles hay (para cargas generales/ANMAT)?', '¿cuántos cubículos ANMAT están alquilados?', 'capacidad comercializable'. Los números ya vienen calculados del motor corporativo.",
    schema: z.object({
      focus: z.enum(["cubiculos", "vacancia", "disponible"]).optional(),
      categoria: z.enum(["anmat", "general", "oficina"]).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({ p_limit: a.limit ?? 10 }),
    rowToChunk: (r) => ({
      entityType: "vacancy_metric",
      entityId: s(r.alcance),
      publicId: sn(r.alcance),
      title: `Capacidad · ${s(r.alcance)}`,
      excerpt: s(r.detalle),
      date: null,
      url: entityUrl("vacancy_metric", null),
    }),
  },
  // ── Copiloto de gestión (2026-07-07): informe ejecutivo multi-dominio ───────
  // Tool ORQUESTADORA: ejecuta las tools de dominio existentes (facturación,
  // tesorería, compras, contratos, compliance, vacancia, operación), cruza los
  // resultados y deriva riesgos/oportunidades/recomendaciones/brechas de forma
  // determinística (management-brief.ts). El modelo narra; no calcula nada.
  management_brief: {
    orchestrate: async (a) =>
      (await import("./management-brief")).composeManagementBriefRows(a),
    description:
      "INFORME EJECUTIVO DE GESTIÓN multi-dominio de Nexus: KPIs por área (facturación, tesorería, compras/proveedores, contratos, compliance, vacancia, operación) + RIESGOS priorizados por impacto/urgencia + OPORTUNIDADES + recomendaciones accionables + brechas de cobertura — todo calculado desde las tools de lectura, nada inventado. USALA para 'resumen ejecutivo', 'reunión de dirección', 'informe de situación', 'cómo viene el negocio', 'qué riesgos hay', 'qué oportunidades tenemos', 'qué debería mirar primero', 'qué priorizar', 'tablero de gestión'. focus: resumen (default) | riesgos | prioridades | oportunidades. NO la uses para una métrica puntual de un solo dominio (para eso están las tools específicas).",
    schema: z.object({
      focus: z.enum(["resumen", "riesgos", "prioridades", "oportunidades"]).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({ focus: a.focus ?? "resumen", limit: a.limit ?? 20 }),
    rowToChunk: (r) => ({
      entityType: `brief_${s(r.kind)}`,
      entityId: `${s(r.kind)}:${s(r.seccion) || s(r.titulo)}`.slice(0, 80),
      publicId: null,
      title:
        s(r.kind) === "seccion"
          ? `${s(r.titulo)} · estado ${s(r.estado)}`
          : s(r.titulo),
      excerpt: s(r.detalle),
      date: null,
      // Cada fila del brief trae su ruta real de módulo (verificada anti-404
      // por construcción: reusa las mismas rutas que entityUrl).
      url: sn(r.url),
    }),
  },
  // ── Slice B (aceptación 2026-07-07): comparador de compras/liquidez ─────────
  // ORQUESTADORA sobre RPCs existentes (ai_supplier_spend_overview +
  // ai_bank_balances_overview): cruza y resta en código, nada se inventa.
  spend_comparison_report: {
    orchestrate: async (a) =>
      (await import("./spend-comparison")).composeSpendComparisonRows(a),
    description:
      "COMPARACIONES de compras y liquidez (los montos salen de las tools; acá solo se cruzan): mode=gasto_vs_compromiso (facturas de proveedor vs OC firmadas, por proveedor, con % ejecutado y pendiente) | periodo_anterior (variación del gasto por proveedor: mes en curso vs último mes cerrado, con subas/bajas/nuevos) | saldo_vs_compromisos (liquidez: saldo en bancos y caja vs compromisos de OC). USALA para 'comparame gasto real contra órdenes de compra', 'proveedores con aumento respecto del período anterior', 'saldo disponible contra compromisos de compras', 'tensión de liquidez por compromisos'. NO la uses para el ranking simple de gasto (supplier_spend_overview).",
    schema: z.object({
      mode: z
        .enum(["gasto_vs_compromiso", "periodo_anterior", "saldo_vs_compromisos"])
        .optional(),
      limit,
    }),
    toRpcArgs: (a) => ({ mode: a.mode ?? "gasto_vs_compromiso", limit: a.limit ?? 20 }),
    rowToChunk: (r) => ({
      entityType: "spend_comparacion",
      entityId: `${s(r.kind)}:${s(r.proveedor) || s(r.concepto)}`.slice(0, 80),
      publicId: null,
      title: s(r.proveedor)
        ? `${s(r.proveedor)} · comparación de gasto`
        : s(r.concepto) || "Comparación",
      excerpt: s(r.detalle),
      date: null,
      url: sn(r.url),
    }),
  },
  // ── Pirámide de conocimiento (2026-07-07): contexto GENERAL (tool LOCAL) ────
  // Fecha/hora del reloj del servidor + limitaciones HONESTAS de actualidad
  // (dólar/noticias/clima/inflación sin fuente externa conectada). Cero red,
  // cero DB, cero invención. Nunca "no encontré registros en Nexus" para
  // preguntas que no son de Nexus.
  general_context: {
    resolve: (a) => resolveGeneralContext(a),
    description:
      "CONTEXTO GENERAL fuera de Nexus: tema=fecha|hora responde la fecha/hora del SERVIDOR (con zona horaria declarada). tema=dolar|noticias|clima|inflacion devuelve la LIMITACIÓN honesta: esas consultas requieren una fuente externa en tiempo real que aún no está conectada (se indica qué integración la resolvería) — NUNCA inventes cotizaciones, titulares ni índices, y NUNCA respondas esas preguntas con datos de Nexus. USALA para '¿qué día es hoy?', '¿qué hora es?', '¿cuánto cotiza el dólar?', '¿qué noticias hay?', '¿cómo está el clima?', '¿cuál es la inflación?'.",
    schema: z.object({
      tema: z
        .enum(["fecha", "hora", "dolar", "noticias", "clima", "inflacion", "normativa"])
        .optional(),
      limit,
    }),
    toRpcArgs: (a) => ({ tema: a.tema ?? "fecha", limit: a.limit ?? 5 }),
    rowToChunk: (r) => ({
      entityType: "general_context",
      entityId: `${s(r.kind)}:${s(r.tema)}`,
      publicId: null,
      title:
        s(r.kind) === "fecha"
          ? "Fecha y hora del servidor"
          : `Actualidad externa · ${s(r.tema)} (fuente no conectada)`,
      excerpt: s(r.detalle),
      date: null,
      url: null,
    }),
  },
  // ── C1 · Capa 2 (2026-07-07): conocimiento institucional de Logística TOPS ──
  // Lee la Knowledge Base institucional (company_knowledge_documents, mig 0185,
  // SECURITY INVOKER → RLS). SOLO documentos VIGENTES e ingeribles (la RPC
  // excluye NO_INGESTAR/HISTORICO/BORRADOR/REEMPLAZADO). Si la migración 0185 no
  // está aplicada o no hay documentos, la RPC devuelve [] y el engine declara la
  // brecha específica (nunca inventa). Cita el documento/URL institucional real.
  company_knowledge_search: {
    rpc: "ai_company_knowledge_search",
    description:
      "CONOCIMIENTO INSTITUCIONAL de Logística TOPS (Capa 2): servicios ofrecidos, propuesta de valor, forma de trabajo como operador 3PL, unidades de negocio (ANMAT/productos regulados, Cargas Generales), sitio web oficial y landings, dossiers, argumentarios, código de ética e identidad corporativa — ingerido desde la Knowledge Base de Drive. `query` = tema/servicio buscado; `unidad` filtra por unidad de negocio. USALA para '¿qué servicios ofrece Logística TOPS?', '¿qué ofrece para ANMAT/regulados?', '¿cómo trabaja TOPS como 3PL?', '¿cuál es la propuesta de valor?', '¿qué dice la web sobre depósitos ANMAT?', '¿qué es TOPS Nexus/Connect?'. Devuelve SOLO documentos institucionales VIGENTES (nunca borradores, versiones históricas ni marcados NO_INGESTAR). Si no hay documentos ingestados, el sistema declara la brecha: NUNCA inventes servicios, sedes ni propuestas.",
    schema: z.object({
      query: z.string().max(200).optional(),
      unidad: z
        .enum(["anmat", "cargas_generales", "corporativo", "regulados", "nexus"])
        .optional(),
      capa: z.enum(["institucional", "research", "manual_nexus"]).optional(),
      limit,
    }),
    toRpcArgs: (a) => ({
      p_query: a.query ?? null,
      p_unidad: a.unidad ?? null,
      p_capa: a.capa ?? "institucional",
      p_limit: a.limit ?? 8,
    }),
    // Demo/tests: espeja el WHERE de la RPC (solo VIGENTE + ingestable + capa +
    // unidad + match de query). El estado se filtra acá igual que en SQL: así el
    // examen valida que NO_INGESTAR/HISTORICO nunca salen y VIGENTE tiene prioridad.
    demoFilter: (rows, a) => {
      const capa = String(a.capa ?? "institucional");
      const unidad = a.unidad ? String(a.unidad) : null;
      const q = s(a.query).toLowerCase().trim();
      const tokens = q.split(/[^a-z0-9áéíóúñ]+/i).filter((t) => t.length >= 3);
      return rows.filter((r) => {
        if (s(r.estado) !== "VIGENTE") return false; // excluye NO_INGESTAR/HISTORICO/BORRADOR/REEMPLAZADO
        if (r.ingestable === false) return false;
        if (s(r.capa) && s(r.capa) !== capa) return false;
        if (unidad && s(r.business_unit).toLowerCase() !== unidad) return false;
        if (tokens.length === 0) return true;
        const hay = `${s(r.title)} ${s(r.summary)} ${s(r.business_unit)} ${s(r.source_type)}`.toLowerCase();
        return tokens.some((t) => hay.includes(t));
      });
    },
    rowToChunk: (r) => ({
      entityType: "institucional",
      entityId: s(r.title),
      publicId: sn(r.source_type),
      title: s(r.title) || "Documento institucional",
      excerpt: `[institucional · ${s(r.business_unit) || "TOPS"}] ${s(r.summary) || s(r.detalle)}`,
      date: sn(r.fecha_captura),
      // Link REAL al documento (Drive) o URL institucional; nunca inventado.
      url: sn(r.url),
    }),
  },
  // ── Slice A (aceptación 2026-07-07): cobertura del propio Copilot ───────────
  // Tool LOCAL (datos del repo): qué módulos tienen fuente conectada, con qué
  // tool/RPC responde cada uno, y qué dominios son BRECHA declarada (WMS/stock,
  // caja chica, movimientos, comparaciones, cliente 360). Evita responder "otro
  // tema" cuando preguntan por un dominio sin fuente: la brecha es la respuesta.
  coverage_overview: {
    resolve: (a) => resolveCopilotCoverage(a),
    description:
      "MATRIZ DE COBERTURA del Copilot: qué módulos de Nexus tienen fuente conectada (y cuál es la fuente/tool), y qué dominios son BRECHA declarada (WMS/depósito/stock/posiciones, caja chica, movimientos de tesorería, comparaciones entre períodos, cliente 360). USALA para '¿qué módulos cubre el Copilot?', '¿qué fuentes usa?', '¿qué datos faltan?', y para TODA pregunta de un dominio SIN fuente (stock, posiciones, sectores del depósito, lotes, caja chica, movimientos financieros): la respuesta correcta es la brecha específica + dónde está la fuente parcial (p.ej. capacidad física → Vacancia), nunca datos de otro tema.",
    schema: z.object({ query: z.string().max(200).optional(), limit }),
    toRpcArgs: (a) => ({ query: a.query ?? null, limit: a.limit ?? 30 }),
    rowToChunk: (r) => ({
      entityType: "copilot_coverage",
      entityId: s(r.modulo),
      publicId: null,
      title: `${s(r.modulo)} · ${s(r.estado)}`,
      excerpt: `${s(r.detalle)}${r.fuente ? ` · Fuente: ${s(r.fuente)}` : ""}`,
      date: null,
      url: sn(r.ruta),
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
    periodo: {
      type: "string",
      enum: ["ultimo_mes"],
      description: "SOLO si el usuario acotó explícitamente al último mes calendario",
    },
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
    focoTop: { type: "boolean", description: "true si piden el peso/porcentaje del top sobre el total (pasá limit 10)" },
    limit: jsLimit,
  }),
  customer_revenue_overview: js({
    periodo: { type: "string", enum: ["todo", "mes_actual", "ultimo_mes"] },
    focoTop: { type: "boolean", description: "true si piden el peso/porcentaje del top sobre el total (pasá limit 10)" },
    limit: jsLimit,
  }),
  revenue_by_category_report: js({
    periodo: { type: "string", enum: ["ultimo_mes", "mes_actual", "todo"] },
    limit: jsLimit,
  }),
  vacancy_overview: js({
    focus: { type: "string", enum: ["cubiculos", "vacancia", "disponible"], description: "Qué número pidió el usuario (número primero)" },
    categoria: { type: "string", enum: ["anmat", "general", "oficina"] },
    limit: jsLimit,
  }),
  nexus_sections_overview: js({
    query: { type: "string", description: "Sección buscada (p.ej. 'órdenes de compra', 'compliance')" },
    limit: jsLimit,
  }),
  management_brief: js({
    focus: {
      type: "string",
      enum: ["resumen", "riesgos", "prioridades", "oportunidades"],
      description: "Qué pidió el usuario: resumen ejecutivo (default), riesgos, prioridades u oportunidades",
    },
    limit: jsLimit,
  }),
  coverage_overview: js({
    query: { type: "string", description: "Dominio consultado (p.ej. 'stock', 'caja chica', 'movimientos')" },
    limit: jsLimit,
  }),
  spend_comparison_report: js({
    mode: {
      type: "string",
      enum: ["gasto_vs_compromiso", "periodo_anterior", "saldo_vs_compromisos"],
      description: "Qué comparación pidió el usuario",
    },
    limit: jsLimit,
  }),
  general_context: js({
    tema: {
      type: "string",
      enum: ["fecha", "hora", "dolar", "noticias", "clima", "inflacion", "normativa"],
      description: "fecha/hora del servidor, o el tema de actualidad sin fuente conectada",
    },
    limit: jsLimit,
  }),
  company_knowledge_search: js({
    query: { type: "string", description: "Tema/servicio institucional buscado (español)" },
    unidad: {
      type: "string",
      enum: ["anmat", "cargas_generales", "corporativo", "regulados", "nexus"],
      description: "Unidad de negocio para acotar",
    },
    capa: { type: "string", enum: ["institucional", "research"] },
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
