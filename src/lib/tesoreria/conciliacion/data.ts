/**
 * Data layer de Conciliación Bancaria (S4). READ-ONLY (lectura).
 *
 * Cliente de sesión → RLS aplica (sólo `tesoreria.conciliacion.view`). Mapea
 * `treasury_movements` → candidatos del motor y rehidrata el resultado para el
 * dashboard. La escritura vive en las RPC (`actions.ts`), nunca acá.
 *
 * NOTA de linaje (E0 · TREAS-RECON-001): el esquema bank_* fue aplicado a
 * mano en prod (≤2026-07-13) y quedó documentado en la migración as-built
 * `0211_bank_recon_baseline_asbuilt.sql`; las exclusiones y RPC de cierre
 * llegan con `0212_bank_recon_exclusions_close_rpcs.sql`.
 */
import { createClient } from "@/lib/supabase/server";
import { excluirMovimientos, listActiveExclusionIds } from "./exclusions";
import type { MovimientoNexus } from "./matching";
import { reconstruirResultado, type LineRow, type MatchRow } from "./ingest";
import { dashboard, type DashboardConciliacion } from "./dashboard";
import type { MatchLinea } from "./matching";

const cents = (n: number) => Math.round((Number(n) || 0) * 100);

export interface BankStatementMeta {
  id: string;
  banco: string;
  source_kind: string;
  period_from: string | null;
  period_to: string | null;
  closing_balance: number;
  created_at: string;
}

/** Candidatos a conciliar: movimientos confirmados y NO conciliados de la
 *  cuenta/período, MENOS las exclusiones gobernadas (0212). El filtro va en
 *  el ORIGEN: ninguna capa del motor (exacto/aprox/IA/N:M) ve un excluido. */
export async function listCandidateMovements(
  bankAccountId: string,
  from: string,
  to: string
): Promise<MovimientoNexus[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const [candidatos, excluidos] = await Promise.all([
    supabase
      .from("treasury_movements")
      .select("id,date,direction,amount,description")
      .eq("bank_account_id", bankAccountId)
      .eq("status", "confirmado")
      .is("reconciled_at", null)
      .gte("date", from)
      .lte("date", to),
    listActiveExclusionIds(),
  ]);
  if (candidatos.error) throw candidatos.error;
  const filas = (candidatos.data ?? []) as { id: string; date: string; direction: string; amount: number; description: string | null }[];
  return excluirMovimientos(filas, excluidos).map((m: { id: string; date: string; direction: string; amount: number; description: string | null }) => ({
    id: m.id,
    fecha: m.date,
    importe: cents(m.amount),
    tipo: m.direction === "ingreso" ? "credito" : "debito",
    descripcion: m.description ?? "",
    contraparte: null, // best-effort (sin IA en piloto): el match usa importe+fecha+tipo
    cuit: null,
  }));
}

export async function listStatements(bankAccountId?: string): Promise<BankStatementMeta[]> {
  const supabase = createClient();
  if (!supabase) return [];
  let qb = supabase.from("bank_statements").select("id,banco,source_kind,period_from,period_to,closing_balance,created_at");
  if (bankAccountId) qb = qb.eq("bank_account_id", bankAccountId);
  const { data, error } = await qb.order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as BankStatementMeta[];
}

export interface PendingMatch {
  matchId: string;
  descripcion: string;
  importe: number; // pesos
  score: number;
  metodo: string;
  motivo: string;
}

/** Matches en estado 'sugerido' (pendientes de aprobación humana) de un statement. */
export async function listPendingMatches(statementId: string): Promise<PendingMatch[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("bank_reconciliation_matches")
    .select("id,score,method,motivo,status,bank_statement_lines!inner(statement_id,descripcion,importe)")
    .eq("status", "sugerido")
    .eq("bank_statement_lines.statement_id", statementId);
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    id: string; score: number; method: string; motivo: string;
    bank_statement_lines: { descripcion: string | null; importe: number | null } | null;
  }[];
  return rows.map((m) => ({
    matchId: m.id,
    descripcion: m.bank_statement_lines?.descripcion ?? "",
    importe: m.bank_statement_lines?.importe ?? 0,
    score: m.score,
    metodo: m.method,
    motivo: m.motivo,
  }));
}

/** Rehidrata el resultado de un statement (líneas + matches + movimientos) para el dashboard. */
export async function getStatementResult(statementId: string): Promise<{
  matches: MatchLinea[];
  movimientos: MovimientoNexus[];
  metrics: DashboardConciliacion;
} | null> {
  const supabase = createClient();
  if (!supabase) return null;

  const { data: lineRows } = await supabase
    .from("bank_statement_lines")
    .select("id,line_no,fecha,descripcion,importe,direction,saldo,referencia,contraparte,categoria,subtipo,codigo_concepto,match_status")
    .eq("statement_id", statementId)
    .order("line_no", { ascending: true });
  const lineIds = (lineRows ?? []).map((l: { id: string }) => l.id);

  const { data: matchRows } = await supabase
    .from("bank_reconciliation_matches")
    .select("id,statement_line_id,score,method,status,motivo")
    .in("statement_line_id", lineIds.length ? lineIds : ["00000000-0000-0000-0000-000000000000"]);
  const matchIds = (matchRows ?? []).map((m: { id: string }) => m.id);

  const { data: bridge } = await supabase
    .from("bank_reconciliation_match_movements")
    .select("match_id,movement_id")
    .in("match_id", matchIds.length ? matchIds : ["00000000-0000-0000-0000-000000000000"]);
  const movIds = Array.from(new Set((bridge ?? []).map((b: { movement_id: string }) => b.movement_id)));

  const { data: movs } = await supabase
    .from("treasury_movements")
    .select("id,date,direction,amount,description")
    .in("id", movIds.length ? movIds : ["00000000-0000-0000-0000-000000000000"]);
  const movById = new Map<string, MovimientoNexus>(
    (movs ?? []).map((m: { id: string; date: string; direction: string; amount: number; description: string | null }) => [
      m.id,
      { id: m.id, fecha: m.date, importe: cents(m.amount), tipo: m.direction === "ingreso" ? "credito" : "debito", descripcion: m.description ?? "", contraparte: null, cuit: null },
    ])
  );

  // Reagrupar matches → MatchRow (con movement_ids del puente) por line_no.
  const lineNoByMatchId = new Map((matchRows ?? []).map((m: { id: string; statement_line_id: string }) => [m.id, m.statement_line_id]));
  const lineNoOfLineId = new Map((lineRows ?? []).map((l: { id: string; line_no: number }) => [l.id, l.line_no]));
  const movsByMatch = new Map<string, string[]>();
  for (const b of bridge ?? []) {
    const arr = movsByMatch.get((b as { match_id: string }).match_id) ?? [];
    arr.push((b as { movement_id: string }).movement_id);
    movsByMatch.set((b as { match_id: string }).match_id, arr);
  }
  const matches: (MatchRow & { accepted?: boolean })[] = (matchRows ?? []).map((m: { id: string; statement_line_id: string; score: number; method: string; status: string; motivo: string }) => ({
    line_no: lineNoOfLineId.get(lineNoByMatchId.get(m.id) as string) ?? -1,
    score: m.score,
    method: m.method,
    status: m.status as MatchRow["status"],
    motivo: m.motivo,
    movement_ids: movsByMatch.get(m.id) ?? [],
    accepted: m.status === "aceptado",
  }));

  const rec = reconstruirResultado((lineRows ?? []) as (LineRow & { id?: string })[], matches, movById);
  const resumen = {
    total: rec.matches.length,
    sistemico: rec.matches.filter((x) => x.estado === "sistemico").length,
    conciliado: rec.matches.filter((x) => x.estado === "conciliado").length,
    posible: rec.matches.filter((x) => x.estado === "posible").length,
    noConciliado: rec.matches.filter((x) => x.estado === "no_conciliado").length,
    usoIa: 0,
    movimientosUsados: movById.size,
  };
  return { matches: rec.matches, movimientos: rec.movimientos, metrics: dashboard({ matches: rec.matches, resumen }, 0) };
}

// ── Cierre del extracto (E2 · TREAS-RECON-001) ────────────────────────────

export interface LineaAbierta {
  id: string;
  fecha: string;
  descripcion: string;
  importe: number; // pesos
  direction: "ingreso" | "egreso";
}

export interface ClosureTargets {
  bankAccountId: string;
  /** Líneas sistémicas pendientes de registrar por lote (D7). */
  sistemicos: number;
  /** ¿El batch sistémico ya fue registrado? (idempotencia visible en UI). */
  batchRegistrado: boolean;
  /** Líneas sin contraparte que admiten ajuste por diferencia. */
  lineasAbiertas: LineaAbierta[];
}

/** Objetivos de cierre de un statement: sistémicos por lote + líneas abiertas. */
export async function getClosureTargets(statementId: string): Promise<ClosureTargets | null> {
  const supabase = createClient();
  if (!supabase) return null;

  const { data: stmts, error: e1 } = await supabase
    .from("bank_statements")
    .select("id,bank_account_id")
    .eq("id", statementId)
    .limit(1);
  if (e1) throw e1;
  const stmt = (stmts ?? [])[0];
  if (!stmt) return null;

  const { data: lines, error: e2 } = await supabase
    .from("bank_statement_lines")
    .select("id,fecha,descripcion,importe,direction,match_status")
    .eq("statement_id", statementId)
    .order("line_no", { ascending: true });
  if (e2) throw e2;

  const filas = (lines ?? []) as (LineaAbierta & { match_status: string })[];

  // Idempotencia visible: el batch se detecta por su movimiento de referencia.
  const { data: batch, error: e3 } = await supabase
    .from("treasury_movements")
    .select("id")
    .eq("reference_type", "recon_systemic_batch")
    .eq("reference_id", statementId)
    .eq("status", "confirmado")
    .limit(1);
  if (e3) throw e3;

  return {
    bankAccountId: (stmt as { bank_account_id: string }).bank_account_id,
    sistemicos: filas.filter((l) => l.match_status === "sistemico").length,
    batchRegistrado: (batch ?? []).length > 0,
    lineasAbiertas: filas
      .filter((l) => l.match_status === "no_conciliado")
      .map(({ id, fecha, descripcion, importe, direction }) => ({ id, fecha, descripcion, importe, direction })),
  };
}
