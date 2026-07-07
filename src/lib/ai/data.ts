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

/** Ejecuta una tool y devuelve chunks SIN sourceId (los asigna el engine) +
 *  el tablero visual determinístico si la tool tiene adaptador (visuals.ts). */
export async function executeTool(call: ToolCall): Promise<ToolExecution> {
  const args = validateToolCall(call);
  const spec = TOOLS[call.tool];

  let rows: Array<Record<string, unknown>>;
  if (spec.resolve) {
    // fix/f5-2: tool LOCAL (p.ej. organigrama) — datos estáticos del repo, sin DB
    // ni service_role. Idéntico en demo y real. Corre ANTES del branch isMock/RPC.
    rows = spec.resolve(args);
  } else if (isMock()) {
    rows = MOCK_TOOL_ROWS[call.tool] ?? [];
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
      console.error(`[ai/data] fetchRows ${call.tool} error:`, err);
      rows = [];
    }
  } else {
    const supabase = createClient();
    if (!supabase) return { chunks: [], visual: null };
    const { data, error } = await supabase.rpc(spec.rpc!, spec.toRpcArgs(args));
    if (error) {
      console.error(`[ai/data] rpc ${spec.rpc} error:`, error.message);
      return { chunks: [], visual: null };
    }
    rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    // smoke 2026-07-07: enriquecimiento read-only post-RPC (p.ej. URL real de
    // Drive para fichas). Cliente de SESIÓN (RLS); fallas → filas sin enriquecer.
    if (spec.enrich && rows.length > 0) {
      try {
        rows = await spec.enrich(rows, supabase);
      } catch (err) {
        console.error(`[ai/data] enrich ${call.tool} error:`, err);
      }
    }
  }

  const chunks = rows.slice(0, MAX_CHUNKS_PER_TOOL).map((row) => ({
    tool: call.tool,
    ...spec.rowToChunk(row),
  }));
  // Tablero visual determinístico (estándar 2026-07-07): mismo dataset que los
  // chunks, calculado en código — nunca por el modelo.
  const visual = TOOL_VISUALS[call.tool]?.(rows, args) ?? null;
  return { chunks, visual };
}
