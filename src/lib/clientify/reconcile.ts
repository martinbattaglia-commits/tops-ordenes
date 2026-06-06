/**
 * reconcile.ts — F2.2-5 · reconciliación por pull (backbone de resiliencia inbound).
 *
 * Recupera leads ante webhooks perdidos: re-ingesta los contactos traídos de
 * Clientify vía `crm_ingest_lead` (idempotente por clientify_id). Cada 'inserted'
 * durante un pull = un webhook que se había perdido (divergencia recuperada);
 * 'updated'/'linked' = ya estaba presente (refresco). Es agnóstico del transporte:
 * recibe los contactos y una `ingest` inyectable (route → supabase.rpc; test → pg).
 *
 * Inbound-only: NO escribe en Clientify. Reusa el normalizador real (webhook.ts)
 * y la RPC 0048; sin migraciones nuevas.
 */

import { normalizeLead } from "./webhook";

export interface IngestOutcome {
  action?: "inserted" | "updated" | "linked" | "duplicate_flagged" | string;
  lead_id?: string;
}
/** Ingesta inyectable: el route pasa supabase.rpc('crm_ingest_lead'); el test, pg. */
export type IngestFn = (
  lead: Record<string, unknown>,
  raw: unknown,
  event: string,
) => Promise<IngestOutcome>;

export interface ReconcileReport {
  scanned: number;     // contactos procesados
  recovered: number;   // inserted → webhook perdido recuperado (divergencia)
  refreshed: number;   // updated + linked → ya presente
  flagged: number;     // duplicate_flagged
  skipped: number;     // sin identidad (no procesable)
  errors: number;
  recoveredIds: string[];                       // clientify_id de los recuperados
  errorDetails: Array<{ clientifyId: string | null; error: string }>;
}

/**
 * Reconcilia un lote de contactos de Clientify contra crm_leads (vía ingest).
 * Idempotente: re-correr el mismo lote no duplica (lo garantiza crm_ingest_lead).
 */
export async function reconcileContacts(contacts: unknown[], ingest: IngestFn): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    scanned: 0, recovered: 0, refreshed: 0, flagged: 0, skipped: 0, errors: 0,
    recoveredIds: [], errorDetails: [],
  };

  for (const c of contacts) {
    report.scanned++;
    const norm = normalizeLead(c);
    if (!norm) { report.skipped++; continue; }
    try {
      const r = await ingest(norm.lead as unknown as Record<string, unknown>, c, "pull");
      switch (r.action) {
        case "inserted":
          report.recovered++;
          if (norm.lead.clientify_id) report.recoveredIds.push(norm.lead.clientify_id);
          break;
        case "updated":
        case "linked":
          report.refreshed++;
          break;
        case "duplicate_flagged":
          report.flagged++;
          break;
        default:
          break;
      }
    } catch (e) {
      report.errors++;
      report.errorDetails.push({ clientifyId: norm.lead.clientify_id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return report;
}
