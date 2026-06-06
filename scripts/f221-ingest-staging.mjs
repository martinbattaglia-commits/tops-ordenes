/**
 * f221-ingest-staging.mjs — F2.2-1 · aplica 0048 y valida la ingesta de leads en STAGING.
 *
 * Uso (desde la raíz):  node scripts/f221-ingest-staging.mjs
 *
 * Aplica 0048_crm_ingest_lead.sql (persistente, idempotente) y ejercita
 * crm_ingest_lead en BEGIN…ROLLBACK (sin datos residuales): inserción, idempotencia,
 * dedup por email (enlazar vs conflicto→crear+marcar), ownership least-loaded,
 * clientify_sync_log y caso sin comerciales.
 *
 * GUARD: aborta si STAGING_DB_URL no es staging.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.STAGING_DB_URL ?? "";
const STAGING = "vrxosunxlhohmqymxots", PROD = "arsksytgdnzukbmfgkju";
if (!url || !url.includes(STAGING) || url.includes(PROD)) {
  console.error("❌ GUARD FAIL: STAGING_DB_URL no es staging. Abort."); process.exit(1);
}
console.log("GUARD ✅ staging:", (url.match(/@([^:/?]+)/) || [])[1]);

const U1 = "00000000-0000-0000-0000-0000000c0001";
const U2 = "00000000-0000-0000-0000-0000000c0002";

const results = [];
const ok = (t, pass, detail) => results.push({ t, pass, detail });
const ingest = async (client, lead, raw = null, event = "contact.created") =>
  (await client.query("select public.crm_ingest_lead($1::jsonb, $2::jsonb, $3) r",
    [JSON.stringify(lead), raw ? JSON.stringify(raw) : null, event])).rows[0].r;

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  console.log("\n── Aplicando 0048_crm_ingest_lead.sql ───────────────────────────");
  await client.query(readFileSync("supabase/migrations/0048_crm_ingest_lead.sql", "utf8"));
  console.log("   0048 aplicada ✅");

  await client.query("begin");

  // Preflight
  const pf = await client.query(
    `select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='crm_ingest_lead'`);
  ok("preflight: crm_ingest_lead existe y es SECURITY DEFINER", pf.rows[0]?.prosecdef === true, "prosecdef=" + pf.rows[0]?.prosecdef);

  // Fixtures: 2 comerciales activos; U1 cargado con 2 leads abiertos, U2 con 0.
  const roleId = (await client.query("select id from public.roles where slug='comercial' limit 1")).rows[0]?.id;
  for (const [id, name] of [[U1, "Com U1"], [U2, "Com U2"]]) {
    await client.query(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,'',now(),now(),now())
       on conflict (id) do nothing`, [id, name.replace(/\s/g, "").toLowerCase() + "@f221.test"]);
    await client.query(`update public.profiles set full_name=$2, role='operaciones'::public.user_role_t, active=true where id=$1`, [id, name]);
    await client.query(`insert into public.user_roles(user_id, role_id) values ($1,$2) on conflict do nothing`, [id, roleId]);
  }
  // Cargar U1 con 2 leads abiertos preexistentes.
  await client.query(
    `insert into public.crm_leads (full_name, email, status, owner_id) values
       ('Carga 1','carga1@f221.test','nuevo',$1),
       ('Carga 2','carga2@f221.test','contactado',$1)`, [U1]);

  // 1 · INSERT nuevo + ownership least-loaded (U2 con 0 < U1 con 2)
  const r1 = await ingest(client, { clientify_id: "c-1001", source: "google_ads", full_name: "Ana López", email: "Ana@Empresa.test", phone: "+54 11 4000-1001", cuit: "30-11111111-9", company_name: "Empresa SA", tags: ["anmat"] });
  ok("1·INSERT nuevo lead → action=inserted", r1.action === "inserted", JSON.stringify({ a: r1.action, pid: r1.public_id }));
  ok("1·public_id con formato LEAD-", /^LEAD-\d{4}-\d+$/.test(r1.public_id || ""), "public_id=" + r1.public_id);
  ok("1·ownership least-loaded → U2 (menos cargado)", r1.owner_id === U2, "owner=" + r1.owner_id);
  ok("1·status inicial nuevo", r1.status === "nuevo", "status=" + r1.status);

  // sync_log inbound escrito
  const slog = await client.query(
    `select direction, entity, status, nexus_id from public.clientify_sync_log where clientify_id='c-1001' order by id desc limit 1`);
  ok("1·clientify_sync_log inbound/lead/ok escrito", slog.rows[0]?.direction === "inbound" && slog.rows[0]?.entity === "lead" && slog.rows[0]?.status === "ok" && slog.rows[0]?.nexus_id === r1.lead_id, JSON.stringify(slog.rows[0]));

  // 2 · IDEMPOTENCIA mismo clientify_id → updated, mismo lead, email refrescado
  const r2 = await ingest(client, { clientify_id: "c-1001", email: "ana.nueva@empresa.test", full_name: "Ana López" });
  const cnt1001 = (await client.query("select count(*)::int n, max(email) email from public.crm_leads where clientify_id='c-1001'")).rows[0];
  ok("2·idempotencia mismo clientify_id → action=updated", r2.action === "updated" && r2.lead_id === r1.lead_id, "action=" + r2.action);
  ok("2·no duplica fila (1 sola con c-1001)", cnt1001.n === 1, "filas=" + cnt1001.n);
  ok("2·email refrescado (entrante gana)", cnt1001.email === "ana.nueva@empresa.test", "email=" + cnt1001.email);

  // 3 · DEDUP por email, mismo nombre, sin clientify_id → linked (enriquece, no crea)
  const before3 = (await client.query("select count(*)::int n from public.crm_leads")).rows[0].n;
  const r3 = await ingest(client, { email: "ana.nueva@empresa.test", full_name: "Ana López", phone: "+54 11 4000-1001" });
  const after3 = (await client.query("select count(*)::int n from public.crm_leads")).rows[0].n;
  ok("3·dedup email mismo nombre → action=linked", r3.action === "linked" && r3.dedup_kind === "email", "action=" + r3.action + " kind=" + r3.dedup_kind);
  ok("3·no crea fila nueva (enriquece existente)", after3 === before3 && r3.lead_id === r1.lead_id, `antes=${before3} despues=${after3}`);

  // 4 · CONFLICTO por email, nombre distinto → crear y marcar (D-4)
  const before4 = (await client.query("select count(*)::int n from public.crm_leads")).rows[0].n;
  const r4 = await ingest(client, { email: "ana.nueva@empresa.test", full_name: "Otra Persona", clientify_id: "c-2002" });
  const after4 = (await client.query("select count(*)::int n from public.crm_leads")).rows[0].n;
  const flagged = (await client.query("select tags from public.crm_leads where id=$1", [r4.lead_id])).rows[0];
  ok("4·conflicto email/nombre → action=duplicate_flagged", r4.action === "duplicate_flagged" && r4.flagged === true, "action=" + r4.action);
  ok("4·crea fila nueva (no se pierde el lead)", after4 === before4 + 1 && r4.lead_id !== r1.lead_id, `antes=${before4} despues=${after4}`);
  ok("4·marcado 'posible_duplicado' en tags", (flagged?.tags || []).includes("posible_duplicado"), "tags=" + JSON.stringify(flagged?.tags));

  // 5 · ownership balancea: tras asignar a U2, nuevo lead va al menos cargado
  // (U1=2, U2 ahora con c-1001 + c-2002 = 2) → empate → menor owner_id (U1)
  const r5 = await ingest(client, { clientify_id: "c-3003", full_name: "Tercero", email: "tercero@x.test" });
  ok("5·ownership empate → menor owner_id (U1)", r5.owner_id === U1, "owner=" + r5.owner_id + " (U1<U2)");

  // 6 · sin comerciales activos → owner null, pero el lead se crea igual
  await client.query("update public.profiles set active=false where id in ($1,$2)", [U1, U2]);
  const r6 = await ingest(client, { clientify_id: "c-4004", full_name: "Sin Owner", email: "sinowner@x.test" });
  ok("6·sin comerciales activos → owner null (lead NO se pierde)", r6.owner_id === null && r6.action === "inserted", "owner=" + r6.owner_id + " action=" + r6.action);

  await client.query("rollback");
} catch (e) {
  try { await client.query("rollback"); } catch { /* noop */ }
  ok("harness", false, "EXCEPTION: " + (e instanceof Error ? e.message : String(e)));
} finally {
  await client.end();
}

console.log("");
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.t}`);
  console.log(`      → ${r.detail}`);
}
const passed = results.filter((r) => r.pass).length;
console.log("\n──────────────────────────────────────────────────────────────────");
console.log(`TOTAL ${results.length} · PASS ${passed} · FAIL ${results.length - passed}`);
console.log(passed === results.length ? "RESULTADO: GO ✅" : "RESULTADO: NO-GO ❌");
console.log("ROLLBACK ejecutado — sin datos residuales.");
if (passed !== results.length) process.exitCode = 1;
