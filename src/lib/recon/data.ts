// src/lib/recon/data.ts
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type {
  ReconRecord,
  ReconStatus,
  POForRecon,
  InvoiceForRecon,
} from "./types";
import { computeRecon } from "./diff-engine";

// ──────────────────────────────────────────────────────────
// assertReconOwnership: lanza error si reconId no pertenece a la OC (poPublicId)
// Previene IDOR — llámalo al inicio de cada route handler de mutación.
// ──────────────────────────────────────────────────────────
export async function assertReconOwnership(
  reconId: string,
  poPublicId: string,
): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase client unavailable");

  const { data, error } = await supabase
    .from("po_reconciliations")
    .select("id, purchase_orders!inner(public_id)")
    .eq("id", reconId)
    .eq("purchase_orders.public_id", poPublicId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw Object.assign(new Error("Conciliación no encontrada para esta OC"), { status: 403 });
}

// ──────────────────────────────────────────────────────────
// assertDiffOwnership: lanza error si diffId no pertenece a la OC (poPublicId)
// Usa query en 2 pasos (evita join anidado 2 niveles no garantizado por SDK JS).
// ──────────────────────────────────────────────────────────
export async function assertDiffOwnership(
  diffId: string,
  poPublicId: string,
): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase client unavailable");

  // Paso 1: obtener el reconciliation_id del diff
  const { data: diff, error: diffErr } = await supabase
    .from("po_reconciliation_diffs")
    .select("reconciliation_id")
    .eq("id", diffId)
    .maybeSingle();

  if (diffErr) throw diffErr;
  if (!diff) throw Object.assign(new Error("Diferencia no encontrada para esta OC"), { status: 403 });

  // Paso 2: verificar que esa conciliación pertenece a la OC de la URL
  const { data: recon, error: reconErr } = await supabase
    .from("po_reconciliations")
    .select("id, purchase_orders!inner(public_id)")
    .eq("id", diff.reconciliation_id)
    .eq("purchase_orders.public_id", poPublicId)
    .maybeSingle();

  if (reconErr) throw reconErr;
  if (!recon) throw Object.assign(new Error("Diferencia no encontrada para esta OC"), { status: 403 });
}

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

// ──────────────────────────────────────────────────────────
// getRecon: carga conciliación completa de una OC
// ──────────────────────────────────────────────────────────
export async function getRecon(poId: string): Promise<ReconRecord | null> {
  if (isMock()) return null;
  const supabase = createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("po_reconciliations")
    .select(`
      *,
      diffs:po_reconciliation_diffs(*),
      events:recon_events(* ORDER BY ts ASC)
    `)
    .eq("purchase_order_id", poId)
    .maybeSingle();

  if (error) throw error;
  return data as ReconRecord | null;
}

// ──────────────────────────────────────────────────────────
// getReconById
// ──────────────────────────────────────────────────────────
export async function getReconById(reconId: string): Promise<ReconRecord | null> {
  if (isMock()) return null;
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("po_reconciliations")
    .select(`*, diffs:po_reconciliation_diffs(*), events:recon_events(* ORDER BY ts ASC)`)
    .eq("id", reconId)
    .maybeSingle();
  if (error) throw error;
  return data as ReconRecord | null;
}

// ──────────────────────────────────────────────────────────
// listRecons: para el dashboard
// ──────────────────────────────────────────────────────────
export interface ReconListResult {
  rows: Array<{
    id: string;
    po_public_id: string;
    invoice_public_id: string;
    status: ReconStatus;
    score: number;
    n_diffs: number;
    n_pending_diffs: number;
    listo_para_pago: boolean;
    initiated_at: string;
  }>;
  counts: Record<ReconStatus, number>;
  total: number;
}

export async function listRecons(opts: {
  status?: ReconStatus | "todas";
  pageSize?: number;
  page?: number;
} = {}): Promise<ReconListResult> {
  if (isMock()) return { rows: [], counts: {} as Record<ReconStatus, number>, total: 0 };
  const supabase = createClient();
  if (!supabase) return { rows: [], counts: {} as Record<ReconStatus, number>, total: 0 };
  const { pageSize = 50, page = 1, status } = opts;

  let q = supabase
    .from("v_recon_status")
    .select("*", { count: "exact" })
    .order("initiated_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (status && status !== "todas") q = q.eq("recon_status", status);

  const [{ data, count, error }, { data: countRows, error: countErr }] = await Promise.all([
    q,
    supabase.from("v_recon_status").select("recon_status"),
  ]);
  if (error) throw error;
  if (countErr) throw countErr;

  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    id:                  r.recon_id as string,
    po_public_id:        r.po_public_id as string,
    invoice_public_id:   r.invoice_public_id as string,
    status:              r.recon_status as ReconStatus,
    score:               r.score as number,
    n_diffs:             Number(r.n_diffs ?? 0),
    n_pending_diffs:     Number(r.n_pending_diffs ?? 0),
    listo_para_pago:     Boolean(r.listo_para_pago),
    initiated_at:        r.initiated_at as string,
  }));

  const counts: Record<string, number> = {};
  for (const row of countRows ?? []) {
    const s = (row as Record<string, unknown>).recon_status as string;
    counts[s] = (counts[s] ?? 0) + 1;
  }

  return { rows, counts: counts as Record<ReconStatus, number>, total: count ?? 0 };
}

// ──────────────────────────────────────────────────────────
// startRecon: carga OC + factura, corre diff engine, llama RPC
// ──────────────────────────────────────────────────────────
export async function startRecon(
  poId: string,
  invoiceId: string,
): Promise<{ reconId: string; score: number; nDiffs: number }> {
  const supabase = createClient();
  if (!supabase) throw new Error("startRecon: Supabase client unavailable");

  // Cargar OC
  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .select("*, items:po_items(*), vendor:vendors(*)")
    .eq("id", poId)
    .single();
  if (poErr) throw poErr;

  // Cargar factura
  const { data: inv, error: invErr } = await supabase
    .from("supplier_invoices")
    .select("*, vendor:vendors(*)")
    .eq("id", invoiceId)
    .single();
  if (invErr) throw invErr;

  // Diff engine
  const { score, diffs } = computeRecon(po as POForRecon, inv as InvoiceForRecon);

  // RPC recon_start
  const { data: reconId, error: rpcErr } = await supabase.rpc("recon_start", {
    p_po_id:      poId,
    p_invoice_id: invoiceId,
    p_score:      score,
    p_diffs:      diffs,
  });
  if (rpcErr) throw rpcErr;

  return { reconId: reconId as string, score, nDiffs: diffs.length };
}

// ──────────────────────────────────────────────────────────
// approveRecon
// ──────────────────────────────────────────────────────────
export async function approveRecon(reconId: string, note?: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("approveRecon: Supabase client unavailable");
  const { error } = await supabase.rpc("recon_approve", {
    p_recon_id: reconId,
    p_note:     note ?? null,
  });
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// rejectRecon
// ──────────────────────────────────────────────────────────
export async function rejectRecon(reconId: string, note: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("rejectRecon: Supabase client unavailable");
  const { error } = await supabase.rpc("recon_reject", {
    p_recon_id: reconId,
    p_note:     note,
  });
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// acceptDiff
// ──────────────────────────────────────────────────────────
export async function acceptDiff(diffId: string, note?: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("acceptDiff: Supabase client unavailable");
  const { error } = await supabase.rpc("recon_accept_diff", {
    p_diff_id: diffId,
    p_note:    note ?? null,
  });
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// addNote
// ──────────────────────────────────────────────────────────
export async function addNote(reconId: string, note: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("addNote: Supabase client unavailable");
  const { error } = await supabase.rpc("recon_add_note", {
    p_recon_id: reconId,
    p_note:     note,
  });
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// sendToReview
// ──────────────────────────────────────────────────────────
export async function sendToReview(reconId: string, note?: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("sendToReview: Supabase client unavailable");
  const { error } = await supabase.rpc("recon_send_to_review", {
    p_recon_id: reconId,
    p_note:     note ?? null,
  });
  if (error) throw error;
}
