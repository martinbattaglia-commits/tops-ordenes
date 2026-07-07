// F5.2-lite · Ejecución del catálogo de tools (capa data del módulo `ai`).
// REGLA CENTRAL (Master Plan §8): el retrieval corre con el CLIENTE DE LA
// SESIÓN DEL USUARIO (createClient → anon + cookies → RLS). El cliente
// administrativo con bypass de RLS está PROHIBIDO en este módulo —
// tools.test.ts vigila que ningún archivo de src/lib/ai lo importe.

import { createClient } from "@/lib/supabase/server";
import { isMock } from "./gate";
import { MOCK_TOOL_ROWS } from "./mock";
import { TOOLS } from "./tools";
import type { SourceChunk, ToolCall, ToolName } from "./types";

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

/** Ejecuta una tool y devuelve chunks SIN sourceId (los asigna el engine). */
export async function executeTool(
  call: ToolCall
): Promise<Array<Omit<SourceChunk, "sourceId">>> {
  const args = validateToolCall(call);
  const spec = TOOLS[call.tool];

  let rows: Array<Record<string, unknown>>;
  if (spec.resolve) {
    // fix/f5-2: tool LOCAL (p.ej. organigrama) — datos estáticos del repo, sin DB
    // ni service_role. Idéntico en demo y real. Corre ANTES del branch isMock/RPC.
    rows = spec.resolve(args);
  } else if (isMock()) {
    rows = MOCK_TOOL_ROWS[call.tool] ?? [];
  } else {
    const supabase = createClient();
    if (!supabase) return [];
    const { data, error } = await supabase.rpc(spec.rpc!, spec.toRpcArgs(args));
    if (error) {
      console.error(`[ai/data] rpc ${spec.rpc} error:`, error.message);
      return [];
    }
    rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  }

  return rows.slice(0, MAX_CHUNKS_PER_TOOL).map((row) => ({
    tool: call.tool,
    ...spec.rowToChunk(row),
  }));
}
