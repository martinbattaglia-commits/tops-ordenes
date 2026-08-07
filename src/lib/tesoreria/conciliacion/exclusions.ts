/**
 * Exclusiones gobernadas de conciliación (TREAS-RECON-001 · E2).
 *
 * Fuente: tabla `treasury_reconciliation_exclusions` (0212). Un movimiento
 * excluido NO participa del universo de candidatos en NINGUNA capa del motor
 * (exacto, aproximado, IA, N:M): se filtra en el ORIGEN de los candidatos,
 * antes de entrar al pipeline puro. La aceptación individual tiene además su
 * guard en la RPC (`tesoreria_recon_accept`, defensa en profundidad).
 */
import { createClient } from "@/lib/supabase/server";

/** Filtro PURO (testeable sin red): quita los movimientos excluidos. */
export function excluirMovimientos<T extends { id: string }>(
  movimientos: T[],
  excluidos: ReadonlySet<string>
): T[] {
  if (excluidos.size === 0) return movimientos;
  return movimientos.filter((m) => !excluidos.has(m.id));
}

/** IDs de movimientos con exclusión ACTIVA. Falla cerrado: ante error, lanza
 *  (mejor detener la ingesta que conciliar contra un universo sin filtrar). */
export async function listActiveExclusionIds(): Promise<Set<string>> {
  const supabase = createClient();
  if (!supabase) return new Set();
  const { data, error } = await supabase
    .from("treasury_reconciliation_exclusions")
    .select("treasury_movement_id")
    .eq("active", true);
  if (error) {
    // La tabla llega con 0212. Si aún no existe (42P01), el universo no tiene
    // exclusiones que aplicar; cualquier otro error debe frenar (fail-closed).
    if (/does not exist|42P01/i.test(error.message)) return new Set();
    throw error;
  }
  return new Set((data ?? []).map((r: { treasury_movement_id: string }) => r.treasury_movement_id));
}
