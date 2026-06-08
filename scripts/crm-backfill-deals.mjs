/**
 * CRM360 · E1 — Backfill de Deals de Clientify → crm_opportunities.
 *
 * Trae TODOS los deals de Clientify (paginado) y los upsertea vía la RPC idempotente
 * crm_ingest_deal (clave clientify_deal_id UNIQUE). Cero duplicados, reejecutable.
 *
 * ⚠️ ESCRIBE EN PRODUCCIÓN (crm_opportunities) sólo con --apply Y CRM_BACKFILL_CONFIRM=APLICAR.
 *    DRY-RUN por defecto: sólo lee Clientify y reporta el plan (no escribe).
 *    Requiere 0052 + 0053 aplicadas. Sin write-back a Clientify → sin loops.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLIENTIFY_API_KEY
 * Uso:
 *   node scripts/crm-backfill-deals.mjs                 # dry-run
 *   CRM_BACKFILL_CONFIRM=APLICAR node scripts/crm-backfill-deals.mjs --apply
 */
const APPLY = process.argv.includes("--apply") && process.env.CRM_BACKFILL_CONFIRM === "APLICAR";
const CLF = process.env.CLIENTIFY_API_KEY;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.CLIENTIFY_BASE_URL || "https://api.clientify.net/v1";

if (!CLF) { console.error("Falta CLIENTIFY_API_KEY."); process.exit(1); }
if (APPLY && (!SB_URL || !SK)) { console.error("Falta NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY para --apply."); process.exit(1); }

async function fetchAllDeals() {
  const out = [];
  let url = `${BASE}/deals/?page_size=100&ordering=-modified`;
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Token ${CLF}` } });
    if (!r.ok) throw new Error(`Clientify ${r.status}: ${await r.text()}`);
    const d = await r.json();
    out.push(...(d.results || []));
    url = d.next;
  }
  return out;
}

async function main() {
  console.log(`Modo: ${APPLY ? "APLICAR (escribe en prod)" : "DRY-RUN (no escribe)"}`);
  const deals = await fetchAllDeals();
  console.log(`Deals traídos de Clientify: ${deals.length}`);
  console.log("Muestra (id · estado · monto):");
  for (const d of deals.slice(0, 5)) {
    console.log(`  · ${d.id} · ${d.status_desc ?? d.status} · ${d.currency} ${d.amount} · pipeline="${d.pipeline_desc ?? "—"}"`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN: planeados=${deals.length} · escritos=0. Reejecutá con --apply + CRM_BACKFILL_CONFIRM=APLICAR.`);
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(SB_URL, SK, { auth: { persistSession: false } });
  let inserted = 0, updated = 0, errors = 0;
  for (const deal of deals) {
    const { data, error } = await sb.rpc("crm_ingest_deal", { p_deal: deal, p_event: "backfill" });
    if (error) { errors++; console.error(`  deal ${deal.id} ERROR: ${error.message}`); continue; }
    const action = data?.action;
    if (action === "inserted") inserted++;
    else if (action === "updated") updated++;
    else { errors++; console.error(`  deal ${deal.id}: ${JSON.stringify(data)}`); }
  }
  console.log(`\nResumen: total=${deals.length} · inserted=${inserted} · updated=${updated} · errors=${errors}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
