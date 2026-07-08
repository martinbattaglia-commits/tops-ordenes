// F5.2-lite · Ejecución del catálogo de tools (capa data del módulo `ai`).
// REGLA CENTRAL (Master Plan §8): el retrieval corre con el CLIENTE DE LA
// SESIÓN DEL USUARIO (createClient → anon + cookies → RLS). El cliente
// administrativo con bypass de RLS está PROHIBIDO en este módulo —
// tools.test.ts vigila que ningún archivo de src/lib/ai lo importe.

import { createClient } from "@/lib/supabase/server";
import { isMock } from "./gate";
import { MOCK_TOOL_ROWS } from "./mock";
import { TOOLS } from "./tools";
import { TOOL_VISUALS } from "./visuals";
import type { CopilotVisual, SourceChunk, ToolCall, ToolName } from "./types";

const MAX_CHUNKS_PER_TOOL = 20;

export class ToolArgsError extends Error {}

/** Valida args contra el schema del catálogo. Args inválidos = error duro
 *  (el provider los generó mal); jamás se "arreglan" silenciosamente. */
export function validateToolCall(call: ToolCall): Record<string, unknown> {
  const spec = TOOLS[call.tool as ToolName];
  if (!spec) throw new ToolArgsError(`Tool desconocida: ${String(call.tool)}`);
  const parsed = spec.schema.safeParse(call.args ?? {});
  if (!parsed.success) {
    throw new ToolArgsError(
      `Args inválidos para ${call.tool}: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }
  return parsed.data as Record<string, unknown>;
}

export interface ToolExecution {
  chunks: Array<Omit<SourceChunk, "sourceId">>;
  /** Tablero determinístico del adaptador visual de la tool (null si no tiene). */
  visual: CopilotVisual | null;
}

/** Filas crudas de una tool (validando args), SIN mapear a chunks. Reutilizado
 *  por executeTool y por la capa de gestión (management-brief), que compone
 *  varios dominios: la paridad demo/real y el RLS viven acá, una sola vez. */
export async function fetchToolRows(call: ToolCall): Promise<Array<Record<string, unknown>>> {
  const args = validateToolCall(call);
  return fetchRowsValidated(call.tool, args);
}

/** Ejecuta una tool y devuelve chunks SIN sourceId (los asigna el engine) +
 *  el tablero visual determinístico si la tool tiene adaptador (visuals.ts). */
export async function executeTool(call: ToolCall): Promise<ToolExecution> {
  const args = validateToolCall(call);
  const spec = TOOLS[call.tool];
  const rows = await fetchRowsValidated(call.tool, args);

  const chunks = rows.slice(0, MAX_CHUNKS_PER_TOOL).map((row) => ({
    tool: call.tool,
    ...spec.rowToChunk(row),
  }));
  // Tablero visual determinístico (estándar 2026-07-07): mismo dataset que los
  // chunks, calculado en código — nunca por el modelo.
  const visual = TOOL_VISUALS[call.tool]?.(rows, args) ?? null;
  return { chunks, visual };
}

async function fetchRowsValidated(
  tool: ToolName,
  args: Record<string, unknown>
): Promise<Array<Record<string, unknown>>> {
  const spec = TOOLS[tool];

  let rows: Array<Record<string, unknown>>;
  if (spec.orchestrate) {
    // Copiloto de gestión (2026-07-07): tool ORQUESTADORA — compone otras tools
    // del catálogo (cada sub-tool resuelve su propio demo/real y RLS). Corre
    // ANTES del branch isMock: la paridad demo/real es de las sub-tools, no de
    // un fixture propio. Errores → [] (mismo contrato honesto que fetchRows).
    try {
      rows = await spec.orchestrate(args);
    } catch (err) {
      console.error(`[ai/data] orchestrate ${tool} error:`, err);
      rows = [];
    }
  } else if (spec.resolve) {
    // fix/f5-2: tool LOCAL (p.ej. organigrama) — datos estáticos del repo, sin DB
    // ni service_role. Idéntico en demo y real. Corre ANTES del branch isMock/RPC.
    rows = spec.resolve(args);
  } else if (isMock()) {
    rows = MOCK_TOOL_ROWS[tool] ?? [];
    // Slice B: paridad demo/real de ARGS SEMÁNTICOS — tools cuyo RPC filtra por
    // mode/base/periodo declaran un demoFilter para que los fixtures respondan
    // al argumento igual que la RPC (sin esto, demo devolvía las mismas filas
    // para cualquier período/base y las comparaciones eran imposibles de QA).
    if (spec.demoFilter) rows = spec.demoFilter(rows, args);
    // Paridad demo/real (smoke humano): las RPC reales respetan p_limit; los
    // fixtures también deben respetarlo para que "singular → top 1" sea real
    // en demo y en tests (limit=1 ⇒ UNA fila, no el set completo).
    if (typeof args.limit === "number") rows = rows.slice(0, args.limit);
  } else if (spec.fetchRows) {
    // smoke 2026-07-07: tool de FUENTE COMPARTIDA — misma lib server-side que la
    // UI (cliente de sesión/RLS dentro de la lib). Errores → [] (P1a vacío honesto).
    try {
      rows = await spec.fetchRows(args);
    } catch (err) {
      console.error(`[ai/data] fetchRows ${tool} error:`, err);
      rows = [];
    }
  } else {
    const supabase = createClient();
    if (!supabase) return [];
    const { data, error } = await supabase.rpc(spec.rpc!, spec.toRpcArgs(args));
    if (error) {
      console.error(`[ai/data] rpc ${spec.rpc} error:`, error.message);
      return [];
    }
    rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    // smoke 2026-07-07: enriquecimiento read-only post-RPC (p.ej. URL real de
    // Drive para fichas). Cliente de SESIÓN (RLS); fallas → filas sin enriquecer.
    if (spec.enrich && rows.length > 0) {
      try {
        rows = await spec.enrich(rows, supabase);
      } catch (err) {
        console.error(`[ai/data] enrich ${tool} error:`, err);
      }
    }
  }
  // FIX Drive Docs Fase 2 (2026-07-08): re-ranking consciente de la intención
  // (p.ej. plancheta/habilitación → PDF antes que CAD). Corre en demo y real,
  // sobre las filas ya resueltas/enriquecidas. READ-ONLY (reordena, no muta).
  if (spec.rank) {
    try {
      rows = spec.rank(rows, args);
    } catch (err) {
      console.error(`[ai/data] rank ${tool} error:`, err);
    }
  }
  return rows;
}
