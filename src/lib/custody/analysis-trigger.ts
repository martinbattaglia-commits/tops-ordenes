/**
 * DISPARO AUTOMÁTICO DEL ANÁLISIS · 2-C-2 · el lado LIVIANO.
 *
 * ─── QUÉ PROBLEMA CIERRA ─────────────────────────────────────────────────
 *
 * La foto de egreso tomada desde `/wms/despachos` no arrancaba nada. El camino
 * del caso sí disparaba —`triggerAnalysisIfPairComplete`, dentro de
 * `wms/custody/actions.ts`— pero importar ese módulo desde despachos arrastra
 * `OpenAICustodyVisionProvider` al grafo de despachos.
 *
 * El motivo por el que hay que dispararlo igual, textual de Dirección:
 *
 *   «"Saqué la foto y no pasó nada visible" garantiza reintentos y circuitos a
 *    medias. El operario captura, el sistema evalúa, y el inspector decide sobre
 *    un caso ya analizado — cada rol recibe el trabajo listo para su parte.»
 *
 * ─── CÓMO SE CORTA LA ARISTA, Y QUÉ SIGNIFICA EXACTAMENTE ────────────────
 *
 * Este módulo importa de forma ESTÁTICA sólo cosas livianas: el cliente de
 * Supabase y el parser de UUID canónico. La composición pesada —proveedor de
 * visión, evaluación productiva— entra por un `import()` DINÁMICO a
 * `vision-evaluation-composition.ts`, y sólo cuando efectivamente hay que
 * evaluar.
 *
 * Lo que eso da, con precisión, para no prometer de más:
 *
 *   · **Sí**: el grafo ESTÁTICO de `/wms/despachos` no contiene
 *     `openai-vision-provider` ni `productive-vision-evaluation`. Es la
 *     propiedad que 2-A perdió y que el guard mide.
 *   · **No**: no vuelve inalcanzable el proveedor en tiempo de ejecución. No
 *     puede, ni debe: el objetivo del bloque es justamente que el análisis
 *     corra. Lo que se separa es el acoplamiento de módulos, no la capacidad.
 *
 * La diferencia importa porque la propiedad que protege el guard —y la que
 * rompió a 2-A— es la del grafo, no la de la reachability. Un test mide ese
 * grafo desde las entradas de despachos: ver `custody-analysis-boundary.test.ts`.
 *
 * ─── ES BEST-EFFORT, IGUAL QUE EL DEL CASO ───────────────────────────────
 *
 * La foto ya quedó registrada y verificada. Si el análisis no arranca —lease
 * tomado, cooldown, proveedor caído— eso NO puede convertir una captura exitosa
 * en un error para el operario. El estado del caso lo dice igual y el panel de
 * análisis ofrece reintentar.
 */

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { parseCanonicalUuid } from "@/lib/custody/canonical-contract";

/** Qué pasó con el disparo. Se devuelve para poder PROBARLO, no para mostrarlo. */
export type AnalysisTriggerOutcome =
  | "sin_unidad"
  | "sin_sesion"
  | "sin_caso"
  | "ya_decidido"
  | "par_incompleto"
  | "estado_terminal"
  | "disparado"
  | "no_disparado";

interface CaseRow {
  id: string;
  version: number;
  state: string | null;
  decision_id: string | null;
  ingress_evidence_id: string | null;
  egress_evidence_id: string | null;
}

/**
 * Dispara el análisis si el par de fotos quedó completo y el caso sigue abierto.
 *
 * Las condiciones son las MISMAS que las del camino del caso, copiadas y no
 * reinterpretadas: par completo, sin decisión registrada y estado no terminal.
 * Dos criterios distintos para el mismo disparo divergen, y entonces la foto
 * sacada desde despachos evaluaría en casos donde la sacada desde el caso no.
 */
export async function triggerAnalysisIfPairComplete(
  physicalUnitId: string | null | undefined,
): Promise<AnalysisTriggerOutcome> {
  try {
    const unitId = parseCanonicalUuid(physicalUnitId ?? null);
    if (!unitId) return "sin_unidad";

    const session = createClient();
    const admin = createAdminClient();
    if (!session || !admin) return "sin_sesion";

    const { data, error } = await session
      .from("custody_integrity_cases")
      .select("id, version, state, decision_id, ingress_evidence_id, egress_evidence_id")
      .eq("physical_unit_id", unitId)
      .maybeSingle();
    if (error || !data) return "sin_caso";

    const row = data as CaseRow;
    if (row.decision_id !== null) return "ya_decidido";
    if (!row.ingress_evidence_id || !row.egress_evidence_id) return "par_incompleto";
    if (row.state === "RELEASED" || row.state === "QUARANTINED") return "estado_terminal";

    // ── LA FRONTERA ────────────────────────────────────────────────────────
    // `import()` dinámico: el proveedor de visión no entra al grafo estático de
    // quien llame a esta función. Ver el docblock del módulo.
    const { runPhysicalUnitVisionEvaluation } = await import(
      "@/lib/custody/vision-evaluation-composition"
    );
    const { createSupabaseCustodyQueryPort } = await import("@/lib/custody/integrity-supabase");

    const query = createSupabaseCustodyQueryPort(session as never);
    if (!query.beginProductiveEvaluation) return "no_disparado";

    await runPhysicalUnitVisionEvaluation({
      caseId: row.id,
      expectedVersion: row.version,
      begin: (c, v) => query.beginProductiveEvaluation!(c, v),
      admin: admin as never,
    });
    return "disparado";
  } catch {
    // Silencio deliberado: la captura ya salió bien. Ver el docblock.
    return "no_disparado";
  }
}
