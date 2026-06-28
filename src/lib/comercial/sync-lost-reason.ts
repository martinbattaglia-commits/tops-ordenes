/**
 * sync-lost-reason.ts
 *
 * Funciones puras extraídas del sincronizador para facilitar testing y razonamiento.
 *
 * CONTEXTO DEL BUG (2026-06-27):
 *   La RPC `clientify_replace_deals_cache` hace DELETE+INSERT completo en cada sync.
 *   La optimización de "skip" evitaba re-fetchear deals ya enriquecidos, pero no
 *   reinyectaba los valores almacenados → el INSERT los pisaba con NULL.
 *   Fix: leer `storedReasons` del cache y reinyectar antes de llamar a la RPC.
 */

import type { UiDeal } from "@/lib/clientify/mappers";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoredReason {
  deal_id: number;
  lost_reason: string | null;
}

export interface HealthCheckResult {
  ok: boolean;
  previousEnriched: number;
  currentEnriched: number;
  dropped: number;
  warning: string | null;
}

// ─── Reinjección ─────────────────────────────────────────────────────────────

/**
 * Reinyecta `lost_reason` del cache en los deals "omitidos" antes del REPLACE.
 *
 * Sin esta función, el DELETE+INSERT de la RPC borra todos los lost_reason
 * de deals que no fueron re-fetched en esta corrida.
 *
 * @param deals   Lista completa de deals del sync (mutados in-place).
 * @param stored  Mapa deal_id → lost_reason leído del cache antes del REPLACE.
 * @returns Número de deals a los que se reinyectó un valor.
 */
export function reinjectedStoredReasons(
  deals: UiDeal[],
  stored: Map<number, string>
): number {
  let count = 0;
  for (const d of deals) {
    if (d.status === "lost" && d.lossReason === null && stored.has(d.id)) {
      d.lossReason = stored.get(d.id)!;
      count++;
    }
  }
  return count;
}

/**
 * Convierte el array de StoredReason (resultado de la query) en el Map
 * que usa `reinjectedStoredReasons`.
 */
export function buildStoredReasonsMap(rows: StoredReason[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const r of rows) {
    if (r.lost_reason) map.set(r.deal_id, r.lost_reason);
  }
  return map;
}

// ─── Health check ─────────────────────────────────────────────────────────────

/**
 * Valida que el sync no haya borrado lost_reason de registros existentes.
 *
 * Compara cuántos deals tenían lost_reason ANTES del sync (previo) vs DESPUÉS.
 * Si la cantidad disminuye sin que el total de deals también disminuya en
 * la misma proporción, se emite un warning.
 *
 * @param previousEnriched  Deals con lost_reason ≠ null antes del sync.
 * @param currentDeals      Deals tal como quedaron tras el sync.
 * @returns HealthCheckResult con indicador ok y mensaje de warning si aplica.
 */
export function checkLostReasonIntegrity(
  previousEnriched: number,
  currentDeals: UiDeal[]
): HealthCheckResult {
  const lostDeals = currentDeals.filter((d) => d.status === "lost");
  const currentEnriched = lostDeals.filter((d) => d.lossReason !== null).length;
  const dropped = previousEnriched - currentEnriched;

  // Un drop es esperado solo si hay menos deals perdidos totales (deals marcados como
  // won/open nuevamente en Clientify). Si los deals perdidos no disminuyeron pero
  // el enriquecimiento sí, es una regresión.
  const ok = dropped <= 0;
  const warning = ok
    ? null
    : `[WARN] lost_reason integrity: ${dropped} registro(s) perdieron su valor. ` +
      `Antes: ${previousEnriched} enriquecidos. Ahora: ${currentEnriched} de ${lostDeals.length} deals perdidos.`;

  return { ok, previousEnriched, currentEnriched, dropped, warning };
}
