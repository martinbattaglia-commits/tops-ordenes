import { NextResponse } from "next/server";
import { listContacts, ClientifyError } from "@/lib/clientify/client";
import { createAdminClient } from "@/lib/supabase/server";
import { reconcileContacts, type IngestFn } from "@/lib/clientify/reconcile";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/clientify/sync-contacts
 *
 * Reconciliación por pull (F2.2-5) — backbone de resiliencia del inbound de leads.
 * Trae contactos recientes de Clientify (READ-ONLY) y los re-ingesta vía
 * crm_ingest_lead (idempotente). Recupera leads ante webhooks perdidos:
 * cada 'inserted' = un webhook que se había perdido.
 *
 * Inbound-only: NO escribe en Clientify. Cron-friendly: si CRON_SECRET está
 * seteado, requiere `Authorization: Bearer <secret>`.
 *
 * Códigos: 401 cron · 503 no configurado · 200 reporte · 502 error de pull.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!env.clientify.configured) {
    return NextResponse.json({ ok: false, error: "CLIENTIFY_API_KEY no configurada" }, { status: 503 });
  }
  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase service-role no configurado" }, { status: 503 });
  }

  // Ventana de reconciliación: contactos más recientemente modificados.
  const url = new URL(req.url);
  const pageSize = Math.min(Number(url.searchParams.get("page_size") || 200) || 200, 500);

  const started = Date.now();
  try {
    const res = await listContacts({ page_size: pageSize, ordering: "-modified" });

    const ingest: IngestFn = async (lead, raw, event) => {
      const { data, error } = await supabase.rpc("crm_ingest_lead", { p_lead: lead, p_raw: raw, p_event: event });
      if (error) throw new Error(error.message);
      return (data ?? {}) as { action?: string; lead_id?: string };
    };

    const report = await reconcileContacts(res.results, ingest);

    return NextResponse.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      pulled: res.results.length,
      totalInClientify: res.count,
      report,
    });
  } catch (e) {
    if (e instanceof ClientifyError) {
      return NextResponse.json({ ok: false, error: e.message, status: e.status }, { status: 502 });
    }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
