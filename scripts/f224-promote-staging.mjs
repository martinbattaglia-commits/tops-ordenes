/**
 * f224-promote-staging.mjs — F2.2-4 · valida crm_promote_lead en STAGING.
 *
 * Uso (desde la raíz):  node scripts/f224-promote-staging.mjs
 *
 * Aplica 0050 y ejercita la promoción Lead→Opportunity en BEGIN…ROLLBACK,
 * impersonando comercial: creación de opp, herencia de owner/contacto, enlace
 * lead↔opp, status='promovido', stage_history inicial, guards e idempotencia.
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

const U1 = "00000000-0000-0000-0000-0000000c0001"; // comercial (profiles.role=operaciones)
const U3 = "00000000-0000-0000-0000-0000000c0003"; // sin permiso (profiles.role=cliente)
const L1 = "00000000-0000-0000-0000-0000000a1001"; // calificado con cuit
const L2 = "00000000-0000-0000-0000-0000000a1002"; // sin cuit
const L3 = "00000000-0000-0000-0000-0000000a1003"; // descartado
const L4 = "00000000-0000-0000-0000-0000000a1004"; // para invalid service
const CLIENT = "00000000-0000-0000-0000-0000000c1001";
const CUIT = "30-50001234-9";

const results = [];
const ok = (t, pass, detail = "") => results.push({ t, pass, detail });

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

// Savepoint-aware: un raise dentro de la función aborta la tx; rollback to
// savepoint la recupera Y revierte el `set local role` (vuelve a postgres).
async function asUser(uid, sql, params = []) {
  await client.query("savepoint sp");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    const r = await client.query(sql, params);
    await client.query("set local role postgres");
    await client.query("release savepoint sp");
    return r;
  } catch (e) {
    await client.query("rollback to savepoint sp");
    await client.query("release savepoint sp");
    throw e;
  }
}
const promote = (uid, leadId, fields) => asUser(uid, "select public.crm_promote_lead($1,$2::jsonb) r", [leadId, JSON.stringify(fields)]).then((r) => r.rows[0].r);

try {
  console.log("\n── Aplicando 0050_crm_promote_lead.sql ──────────────────────────");
  await client.query(readFileSync("supabase/migrations/0050_crm_promote_lead.sql", "utf8"));
  console.log("   0050 aplicada ✅");

  await client.query("begin");

  // preflight
  const pf = await client.query(`select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='crm_promote_lead'`);
  ok("preflight: crm_promote_lead existe y es SECURITY INVOKER", pf.rows[0]?.prosecdef === false, "prosecdef=" + pf.rows[0]?.prosecdef);

  // fixtures
  const roleId = (await client.query("select id from public.roles where slug='comercial' limit 1")).rows[0]?.id;
  for (const [id, role] of [[U1, "operaciones"], [U3, "cliente"]]) {
    await client.query(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,'',now(),now(),now()) on conflict (id) do nothing`,
      [id, id.slice(-4) + "@f224.test"]);
    await client.query(`update public.profiles set full_name=$2, role=$3::public.user_role_t, active=true where id=$1`, [id, "U " + id.slice(-4), role]);
  }
  await client.query(`insert into public.user_roles(user_id, role_id) values ($1,$2) on conflict do nothing`, [U1, roleId]);
  await client.query(`insert into public.clients (id, razon, cuit) values ($1,'Andrómaco SA',$2) on conflict (id) do nothing`, [CLIENT, CUIT]);
  await client.query(
    `insert into public.crm_leads (id, full_name, email, phone, cuit, status, owner_id) values
       ($1,'María Pérez','maria@andromaco.test','+54 11 4000-1','${CUIT}','calificado',$5),
       ($2,'Sin Cuit','sincuit@x.test','+54 11 4000-2',null,'calificado',$5),
       ($3,'Descartado','desc@x.test',null,'${CUIT}','descartado',$5),
       ($4,'Para Invalido','inv@x.test',null,'${CUIT}','calificado',$5)
     on conflict (id) do nothing`, [L1, L2, L3, L4, U1]);

  // 1 · promoción feliz
  const r1 = await promote(U1, L1, { service_type: "anmat", m2: 200 });
  ok("1·promote → action=promoted + OPP creado", r1.action === "promoted" && !!r1.opportunity_id, JSON.stringify({ a: r1.action, pid: r1.opportunity_public_id }));
  const opp = (await client.query("select estado, owner_id, contacto, email, telefono, client_id, service_type, public_id, lead_id from public.crm_opportunities where id=$1", [r1.opportunity_id])).rows[0];
  ok("1·opp estado=calificado + public_id OPP-", opp.estado === "calificado" && /^OPP-\d{4}-\d+$/.test(opp.public_id || ""), "estado=" + opp.estado + " pid=" + opp.public_id);
  ok("1·herencia owner", opp.owner_id === U1, "owner=" + opp.owner_id);
  ok("1·herencia contacto/email/telefono", opp.contacto === "María Pérez" && opp.email === "maria@andromaco.test" && opp.telefono === "+54 11 4000-1", `contacto=${opp.contacto}`);
  ok("1·enlace clients por CUIT", opp.client_id === CLIENT, "client_id=" + opp.client_id);
  ok("1·opp.lead_id = lead", opp.lead_id === L1, "lead_id=" + opp.lead_id);

  const lead1 = (await client.query("select status, opportunity_id from public.crm_leads where id=$1", [L1])).rows[0];
  ok("1·lead status=promovido + opportunity_id enlazado", lead1.status === "promovido" && lead1.opportunity_id === r1.opportunity_id, JSON.stringify(lead1));

  const sh = (await client.query("select from_stage, to_stage, changed_by from public.crm_stage_history where opportunity_id=$1", [r1.opportunity_id])).rows;
  ok("1·stage_history inicial (null→calificado, changed_by=comercial)", sh.length === 1 && sh[0].from_stage === null && sh[0].to_stage === "calificado" && sh[0].changed_by === U1, JSON.stringify(sh[0]));

  // 2 · idempotencia
  const r2 = await promote(U1, L1, { service_type: "anmat" });
  const oppCount = (await client.query("select count(*)::int n from public.crm_opportunities where lead_id=$1", [L1])).rows[0].n;
  ok("2·idempotencia → already_promoted, sin opp nueva", r2.action === "already_promoted" && oppCount === 1, "action=" + r2.action + " opps=" + oppCount);

  // 3 · missing business data (sin cuit, sin client)
  let e3 = null;
  try { await promote(U1, L2, { service_type: "general" }); } catch (e) { e3 = e.message; }
  const l2 = (await client.query("select status, opportunity_id from public.crm_leads where id=$1", [L2])).rows[0];
  ok("3·sin CUIT/cliente → MISSING_BUSINESS_DATA + lead intacto", !!e3 && /MISSING_BUSINESS_DATA/.test(e3) && l2.status === "calificado" && l2.opportunity_id === null, e3 ? e3.split("\n")[0] : "no raise");

  // 4 · descartado
  let e4 = null;
  try { await promote(U1, L3, { service_type: "anmat" }); } catch (e) { e4 = e.message; }
  ok("4·lead descartado → LEAD_DISCARDED", !!e4 && /LEAD_DISCARDED/.test(e4), e4 ? e4.split("\n")[0] : "no raise");

  // 5 · invalid service
  let e5 = null;
  try { await promote(U1, L4, { service_type: "xxx" }); } catch (e) { e5 = e.message; }
  ok("5·service_type inválido → INVALID_SERVICE", !!e5 && /INVALID_SERVICE/.test(e5), e5 ? e5.split("\n")[0] : "no raise");

  // 6 · RLS sin permiso
  let e6 = null;
  try { await promote(U3, L4, { service_type: "anmat" }); } catch (e) { e6 = e.message; }
  ok("6·sin comercial → LEAD_NOT_FOUND (RLS de lectura)", !!e6 && /LEAD_NOT_FOUND/.test(e6), e6 ? e6.split("\n")[0] : "no raise");

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
