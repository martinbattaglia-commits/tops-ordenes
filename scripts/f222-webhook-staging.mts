/**
 * f222-webhook-staging.mts — F2.2-2 · QA del handler de webhook.
 *
 * Uso (desde la raíz):  npx tsx scripts/f222-webhook-staging.mts
 *
 * Dos capas:
 *  (A) UNIT puro: verifyWebhookToken + normalizeLead (los módulos reales de la app).
 *  (B) INTEGRACIÓN: payloads Clientify → normalizeLead (real) → crm_ingest_lead via
 *      pg contra STAGING, en BEGIN…ROLLBACK. Prueba el contrato normalizador↔RPC.
 *
 * Limitación honesta: la capa HTTP del route (token-en-URL + cliente service-role)
 * no se ejercita acá (el runtime local apunta a PROD y no hay claves supabase-js de
 * staging). Se cubre con tsc/lint/build + estos tests de las piezas puras + RPC.
 *
 * GUARD: aborta si STAGING_DB_URL no es staging.
 */
import pg from "pg";
import { config } from "dotenv";
import { verifyWebhookToken, normalizeLead } from "../src/lib/clientify/webhook";

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

// ── (A) UNIT — token ───────────────────────────────────────────────────────
ok("token: correcto → true", verifyWebhookToken("s3cr3t-token", "s3cr3t-token") === true);
ok("token: incorrecto → false", verifyWebhookToken("malo", "s3cr3t-token") === false);
ok("token: largo distinto → false", verifyWebhookToken("s3cr3t-token-x", "s3cr3t-token") === false);
ok("token: provisto vacío → false", verifyWebhookToken("", "s3cr3t-token") === false);
ok("token: secret vacío → false (fail-closed)", verifyWebhookToken("algo", "") === false);

// ── (A) UNIT — normalizeLead ────────────────────────────────────────────────
const flat = normalizeLead({
  id: 9001, first_name: "Ana", last_name: "López",
  emails: [{ id: 1, type: 1, email: "Ana@Empresa.test" }],
  phones: [{ id: 1, type: 1, phone: "+54 11 4000-1001", unsubscribed: false }],
  taxpayer_identification_number: "30-11111111-9", contact_source: "google_ads", tags: ["anmat"],
});
ok("normalize flat: clientify_id", flat?.lead.clientify_id === "9001", String(flat?.lead.clientify_id));
ok("normalize flat: full_name unido", flat?.lead.full_name === "Ana López", String(flat?.lead.full_name));
ok("normalize flat: email del array", flat?.lead.email === "Ana@Empresa.test", String(flat?.lead.email));
ok("normalize flat: phone del array", flat?.lead.phone === "+54 11 4000-1001", String(flat?.lead.phone));
ok("normalize flat: cuit (taxpayer id)", flat?.lead.cuit === "30-11111111-9", String(flat?.lead.cuit));
ok("normalize flat: source", flat?.lead.source === "google_ads", String(flat?.lead.source));

const enveloped = normalizeLead({
  event: "contact.created", object_type: "contact", object_id: 9002,
  data: { id: 9002, email: "flat@x.test", first_name: "Bruno" },
});
ok("normalize envelope: usa data.id", enveloped?.lead.clientify_id === "9002", String(enveloped?.lead.clientify_id));
ok("normalize envelope: event", enveloped?.event === "contact.created", String(enveloped?.event));

ok("normalize sin identidad → null", normalizeLead({ first_name: "SoloNombre" }) === null);
ok("normalize no-objeto → null", normalizeLead("nope") === null);

// ── (B) INTEGRACIÓN — normalizador → crm_ingest_lead (staging, tx+rollback) ──
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const ingest = async (payload: unknown) => {
  const norm = normalizeLead(payload);
  if (!norm) throw new Error("normalize devolvió null inesperado");
  const r = await client.query("select public.crm_ingest_lead($1::jsonb, $2::jsonb, $3) r",
    [JSON.stringify(norm.lead), JSON.stringify(payload), norm.event]);
  return r.rows[0].r;
};

try {
  await client.query("begin");
  const roleId = (await client.query("select id from public.roles where slug='comercial' limit 1")).rows[0]?.id;
  await client.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated','f222@test','',now(),now(),now())
     on conflict (id) do nothing`, [U1]);
  await client.query(`update public.profiles set full_name='F222 Com', role='operaciones'::public.user_role_t, active=true where id=$1`, [U1]);
  await client.query(`insert into public.user_roles(user_id, role_id) values ($1,$2) on conflict do nothing`, [U1, roleId]);

  const realisticContact = {
    id: 778899, first_name: "María", last_name: "Pérez", status: "Lead",
    taxpayer_identification_number: "30-50001234-9", contact_source: "Google Ads",
    emails: [{ id: 1, type: 1, email: "maria@cliente.test" }],
    phones: [{ id: 1, type: 1, phone: "+54 11 5555-7788", unsubscribed: false }],
    tags: ["anmat", "buenos-aires"], modified: "2026-06-06T12:00:00Z",
  };

  const r1 = await ingest(realisticContact);
  ok("INT·payload realista → inserted + owner asignado", r1.action === "inserted" && r1.owner_id === U1,
    `action=${r1.action} owner=${r1.owner_id}`);

  const r2 = await ingest(realisticContact); // reentrega (Clientify reintenta)
  ok("INT·idempotencia end-to-end (mismo contacto → updated)", r2.action === "updated" && r2.lead_id === r1.lead_id,
    `action=${r2.action}`);

  const r3 = await ingest({ event: "contact.created", object_type: "contact", data: { id: 991122, email: "otro@cliente.test", first_name: "Pedro" } });
  ok("INT·payload enveloped → inserted", r3.action === "inserted", `action=${r3.action}`);

  const sl = await client.query("select count(*)::int n from public.clientify_sync_log where clientify_id in ('778899','991122') and direction='inbound'");
  ok("INT·clientify_sync_log inbound escrito", sl.rows[0].n >= 2, "filas=" + sl.rows[0].n);

  await client.query("rollback");
} catch (e) {
  try { await client.query("rollback"); } catch { /* noop */ }
  ok("harness", false, "EXCEPTION: " + (e instanceof Error ? e.message : String(e)));
} finally {
  await client.end();
}

console.log("");
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.t}${r.detail ? "  → " + r.detail : ""}`);
}
const passed = results.filter((r) => r.pass).length;
console.log("\n──────────────────────────────────────────────────────────────────");
console.log(`TOTAL ${results.length} · PASS ${passed} · FAIL ${results.length - passed}`);
console.log(passed === results.length ? "RESULTADO: GO ✅" : "RESULTADO: NO-GO ❌");
console.log("ROLLBACK ejecutado — sin datos residuales.");
if (passed !== results.length) process.exitCode = 1;
