// Guardas anti-borrado y diff de cambios para el snapshot-replace.

import type { ParsedSheet, ParsedRow, CashBoxDirection } from "./types";

export interface GuardOpts {
  maxDropPct?: number; // default 0.40 (caída de filas que bloquea)
  maxCorruptPct?: number; // default 0.05 (% de importes no parseables que bloquea)
}
export interface GuardResult {
  ok: boolean;
  reason?: string;
}

/**
 * Decide si es seguro reemplazar el período. Bloquea (ok=false) si:
 *  - 0 filas parseadas;
 *  - % de importes corruptos por encima del umbral;
 *  - caída de filas por encima del umbral respecto del set actual.
 * (La "solapa inexistente" la maneja el engine antes de llamar acá.)
 */
export function evaluateGuards(parsed: ParsedSheet, currentCount: number, opts: GuardOpts = {}): GuardResult {
  const maxDrop = opts.maxDropPct ?? 0.4;
  const maxCorrupt = opts.maxCorruptPct ?? 0.05;
  const n = parsed.rows.length;
  if (n === 0) return { ok: false, reason: "0 filas parseadas" };
  const denom = n + parsed.corruptCount;
  if (denom > 0 && parsed.corruptCount / denom > maxCorrupt) {
    return { ok: false, reason: `importes corruptos ${parsed.corruptCount}/${denom} > ${Math.round(maxCorrupt * 100)}%` };
  }
  if (currentCount > 0 && n < currentCount * (1 - maxDrop)) {
    return { ok: false, reason: `caída de filas ${currentCount}→${n} > ${Math.round(maxDrop * 100)}%` };
  }
  return { ok: true };
}

export interface PrevRow {
  direction: CashBoxDirection;
  source_row: number;
  row_hash: string;
}
export interface DiffResult {
  inserted: number;
  changed: number;
  removed: number;
}

/**
 * Diff por POSICIÓN (direction + source_row) contra el set previo:
 *  - inserted: posición nueva;
 *  - changed: misma posición, hash distinto (editada en la planilla);
 *  - removed: posición que ya no está.
 */
export function computeDiff(prev: PrevRow[], next: ParsedRow[]): DiffResult {
  const key = (r: { direction: CashBoxDirection; source_row: number }) => `${r.direction}:${r.source_row}`;
  const prevMap = new Map(prev.map((p) => [key(p), p.row_hash]));
  const nextMap = new Map(next.map((n) => [key(n), n.row_hash]));
  let inserted = 0, changed = 0, removed = 0;
  for (const [k, hash] of nextMap) {
    if (!prevMap.has(k)) inserted++;
    else if (prevMap.get(k) !== hash) changed++;
  }
  for (const k of prevMap.keys()) if (!nextMap.has(k)) removed++;
  return { inserted, changed, removed };
}
