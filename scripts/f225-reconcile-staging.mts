/**
 * f225-reconcile-staging.mts — F2.2-5 · valida la reconciliación por pull en STAGING.
 *
 * Uso (desde la raíz):  npx tsx scripts/f225-reconcile-staging.mts
 *
 * Ejercita reconcileContacts (lógica real) con un `ingest` basado en `pg` que llama
 * crm_ingest_lead contra STAGING, en BEGIN…ROLLBACK: persistencia, recuperación de
 * webhook perdido (inserted), refresco (updated), skip sin identidad, idempotencia
 * (re-correr no duplica), divergencia (recoveredIds) y log event='pull'.
 *
 * GUARD: aborta si STAGING_DB_URL no es staging.
 */
import pg from "pg";
import { config } from "dotenv";
import { reconcileContacts, type IngestFn } from "../src/lib/clientify/reconcile";

config({ path: ".env.local" });

const url = process.env.STAGING_DB_URL ?? "";
const STAGING = "vrxosunxlhohmqymxots", PROD = "arsksytgdnzukbmfgkju";
if (!url || !url.includes(STAGING) || url.includes(PROD)) {
  console.error("❌ GUARD FAIL: STAGING_DB_URL no es staging. Abort."); process.exit(1);
}
console.log("GUARD ✅ staging:", (url.match(/@([^:/?]+)/) || [])[1]);

const U1 = "00000000-0000-0000-0000-0000000c0001";
const results: Array<{ t: string; pass: boolean; detail: string }> = [];
const ok = (t: string, pass: boolean, detail = "") => results.push({ t, pass, detail });

// Contactos de prueba (forma ClientifyContact). A ya "llegó por webhook"; B se perdió; C sin identidad.
const CONTACT_A = { id: 5001, first_name: "Ana", last_name: "A", emails: [{ email: "ana@x.test" }], contact_source: "google_ads", tags: ["anmat"] };
const CONTACT_B = { id: 5002, first_name: "Beto", last_name: "B", emails: [{ email: "beto@x.test" }], contact_source: "web", tags: [] };
const CONTACT_C = { first_name: "SinId" }; // sin clientify_id/email/phone → skipped

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const ingest: IngestFn = async (lead, raw, event) => {
  const r = await client.query("select public.crm_ingest_lead($1::jsonb,$2::jsonb,$3) r",
    [JSON.stringify(lead), JSON.stringify(raw), event]);
  return r.rows[0].r;
};

try {
  await client.query("begin");

  // comercial activo (para asignación)
  const roleId = (await client.query("select id from public.roles where slug='comercial' limit 1")).rows[0]?.id;
  await client.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated','f225@test','',now(),now(),now()) on conflict (id) do nothing`, [U1]);
  await client.query(`update public.profiles set full_name='F225', role='operaciones'::public.user_role_t, active=true where id=$1`, [U1]);
  await client.query(`insert into public.user_roles(user_id, role_id) values ($1,$2) on conflict do nothing`, [U1, roleId]);

  // Simular que A YA llegó por webhook (pre-ingesta).
  await ingest({ clientify_id: "5001", full_name: "Ana A", email: "ana@x.test", source: "google_ads", tags: ["anmat"] }, CONTACT_A, "contact.created");
  const leadsBefore = (await client.query("select count(*)::int n from public.crm_leads")).rows[0].n;

  // ── PULL #1: reconciliar [A (presente), B (perdido), C (sin id)] ──
  const r1 = await reconcileContacts([CONTACT_A, CONTACT_B, CONTACT_C], ingest);
  ok("pull#1: scanned=3", r1.scanned === 3, JSON.stringify(r1).slice(0, 120));
  ok("pull#1: recovered=1 (B, webhook perdido)", r1.recovered === 1 && r1.recoveredIds.includes("5002"), "recovered=" + r1.recovered + " ids=" + r1.recoveredIds.join(","));
  ok("pull#1: refreshed=1 (A ya presente)", r1.refreshed === 1, "refreshed=" + r1.refreshed);
  ok("pull#1: skipped=1 (C sin identidad)", r1.skipped === 1, "skipped=" + r1.skipped);
  ok("pull#1: 0 errores", r1.errors === 0, "errors=" + r1.errors);

  const leadsAfter1 = (await client.query("select count(*)::int n from public.crm_leads")).rows[0].n;
  ok("pull#1: persistencia — exactamente +1 lead (B recuperado)", leadsAfter1 === leadsBefore + 1, `antes=${leadsBefore} despues=${leadsAfter1}`);

  // ── PULL #2: idempotencia (mismo lote) ──
  const r2 = await reconcileContacts([CONTACT_A, CONTACT_B, CONTACT_C], ingest);
  const leadsAfter2 = (await client.query("select count(*)::int n from public.crm_leads")).rows[0].n;
  ok("pull#2: idempotente — recovered=0, refreshed=2", r2.recovered === 0 && r2.refreshed === 2, "recovered=" + r2.recovered + " refreshed=" + r2.refreshed);
  ok("pull#2: sin filas nuevas (no duplica)", leadsAfter2 === leadsAfter1, `despues=${leadsAfter2}`);

  // ── Auditoría: eventos 'pull' en clientify_sync_log ──
  const pulls = (await client.query("select count(*)::int n from public.clientify_sync_log where event='pull' and direction='inbound'")).rows[0].n;
  ok("clientify_sync_log: eventos 'pull' registrados", pulls >= 3, "filas pull=" + pulls);

  // ── Divergencia: B existe en Nexus tras la recuperación ──
  const bExists = (await client.query("select count(*)::int n from public.crm_leads where clientify_id='5002'")).rows[0].n;
  ok("divergencia recuperada: B (5002) ahora en crm_leads", bExists === 1, "B=" + bExists);

  await client.query("rollback");
} catch (e) {
  try { await client.query("rollback"); } catch { /* noop */ }
  ok("harness", false, "EXCEPTION: " + (e instanceof Error ? e.message : String(e)));
} finally {
  await client.end();
}

console.log("");
for (const r of results) console.log(`${r.pass ? "✅" : "❌"} ${r.t}${r.detail ? "  → " + r.detail : ""}`);
const passed = results.filter((r) => r.pass).length;
console.log("\n──────────────────────────────────────────────────────────────────");
console.log(`TOTAL ${results.length} · PASS ${passed} · FAIL ${results.length - passed}`);
console.log(passed === results.length ? "RESULTADO: GO ✅" : "RESULTADO: NO-GO ❌");
console.log("ROLLBACK ejecutado — sin datos residuales.");
if (passed !== results.length) process.exitCode = 1;
