/**
 * f0_2-onboarding-staging.mjs — P0.2 · valida auto-creación de onboarding al Ganar.
 *
 * Uso: node scripts/f0_2-onboarding-staging.mjs
 * Aplica 0051 y valida en BEGIN…ROLLBACK la cadena Ganado → onboarding (auto) →
 * complete_onboarding → ocupado, sin sembrar onboarding a mano. Idempotencia +
 * negativo (no se crea en transiciones que no son a 'ganado').
 *
 * GUARD: aborta si STAGING_DB_URL no es staging.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.STAGING_DB_URL ?? "";
const STAGING = "vrxosunxlhohmqymxots", PROD = "arsksytgdnzukbmfgkju";
if (!url || !url.includes(STAGING) || url.includes(PROD)) { console.error("❌ GUARD FAIL"); process.exit(1); }
console.log("GUARD ✅ staging:", (url.match(/@([^:/?]+)/) || [])[1]);

const U1 = "00000000-0000-0000-0000-0000000c0001";
const OPP = "00000000-0000-0000-0000-0000000d2001";   // negociacion con sitio → se gana
const OPP2 = "00000000-0000-0000-0000-0000000d2002";  // calificado → avanza a propuesta (negativo)
const results = [];
const ok = (t, pass, detail = "") => results.push({ t, pass, detail });

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
async function asUser(uid, sql, params = []) {
  await client.query("savepoint sp");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    const r = await client.query(sql, params);
    await client.query("set local role postgres");
    await client.query("release savepoint sp");
    return r;
  } catch (e) { await client.query("rollback to savepoint sp"); await client.query("release savepoint sp"); throw e; }
}

try {
  console.log("\n── Aplicando 0051_crm_onboarding_autocreate.sql ─────────────────");
  await client.query(readFileSync("supabase/migrations/0051_crm_onboarding_autocreate.sql", "utf8"));
  console.log("   0051 aplicada ✅");
  await client.query("begin");

  // preflight: trigger existe
  const tg = await client.query(`select 1 from pg_trigger where tgname='trg_crm_create_onboarding_on_won'`);
  ok("preflight: trigger trg_crm_create_onboarding_on_won existe", tg.rowCount === 1, "rows=" + tg.rowCount);

  // fixtures: comercial + opp en negociacion con sitio + opp2 en calificado
  const roleId = (await client.query("select id from public.roles where slug='comercial' limit 1")).rows[0]?.id;
  await client.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated','p02@test','',now(),now(),now()) on conflict (id) do nothing`, [U1]);
  await client.query(`update public.profiles set full_name='P02', role='operaciones'::public.user_role_t, active=true where id=$1`, [U1]);
  await client.query(`insert into public.user_roles(user_id, role_id) values ($1,$2) on conflict do nothing`, [U1, roleId]);
  await client.query(
    `insert into public.crm_opportunities (id, service_type, estado, m2, assigned_site, committed_state, owner_id) values
       ($1,'anmat','negociacion',200,'PEDRO_LUJAN_3159','reservado',$3),
       ($2,'general','calificado',300,null,'none',$3)
     on conflict (id) do nothing`, [OPP, OPP2, U1]);

  // estado inicial: sin onboarding
  const before = (await client.query("select count(*)::int n from public.crm_onboarding where opportunity_id=$1", [OPP])).rows[0].n;
  ok("antes de ganar: 0 onboarding para la opp", before === 0, "onboarding=" + before);

  // 1 · GANAR → trigger crea onboarding + tasks
  await asUser(U1, "select public.crm_advance_stage($1,'ganado',null)", [OPP]);
  const onb = (await client.query("select status, progress_pct from public.crm_onboarding where opportunity_id=$1", [OPP])).rows;
  const tasks = (await client.query("select count(*)::int n from public.crm_onboarding_tasks t join public.crm_onboarding o on o.id=t.onboarding_id where o.opportunity_id=$1", [OPP])).rows[0].n;
  ok("AL GANAR: onboarding auto-creado (status pendiente, 0%)", onb.length === 1 && onb[0].status === "pendiente" && onb[0].progress_pct === 0, JSON.stringify(onb[0]));
  ok("AL GANAR: checklist estándar de 5 tareas creado", tasks === 5, "tasks=" + tasks);

  // 2 · idempotencia: re-UPDATE estado='ganado' (old=ganado → WHEN false → no dispara)
  await client.query("update public.crm_opportunities set estado='ganado' where id=$1", [OPP]);
  const dup = (await client.query("select count(*)::int n from public.crm_onboarding where opportunity_id=$1", [OPP])).rows[0].n;
  ok("idempotencia: no se duplica onboarding (sigue 1)", dup === 1, "onboarding=" + dup);

  // 3 · CHAIN CLOSED: complete_onboarding ahora funciona SIN sembrar a mano → ocupado
  let err = null;
  try { await asUser(U1, "select public.crm_complete_onboarding($1,null)", [OPP]); } catch (e) { err = e.message; }
  const fin = (await client.query("select committed_state from public.crm_opportunities where id=$1", [OPP])).rows[0];
  const onbFin = (await client.query("select status, progress_pct from public.crm_onboarding where opportunity_id=$1", [OPP])).rows[0];
  ok("CADENA CERRADA: complete_onboarding OK (sin ONBOARDING_NOT_FOUND)", err === null, err ? err.split("\n")[0] : "ok");
  ok("→ committed_state = ocupado", fin.committed_state === "ocupado", "committed=" + fin.committed_state);
  ok("→ onboarding completado/100%", onbFin.status === "completado" && onbFin.progress_pct === 100, JSON.stringify(onbFin));

  // 4 · negativo: avanzar a etapa NO-ganado no crea onboarding
  await asUser(U1, "select public.crm_advance_stage($1,'propuesta',null)", [OPP2]);
  const neg = (await client.query("select count(*)::int n from public.crm_onboarding where opportunity_id=$1", [OPP2])).rows[0].n;
  ok("negativo: transición a 'propuesta' NO crea onboarding", neg === 0, "onboarding=" + neg);

  await client.query("rollback");
} catch (e) {
  try { await client.query("rollback"); } catch { /* noop */ }
  ok("harness", false, "EXCEPTION: " + (e instanceof Error ? e.message : String(e)));
} finally { await client.end(); }

console.log("");
for (const r of results) console.log(`${r.pass ? "✅" : "❌"} ${r.t}${r.detail ? "  → " + r.detail : ""}`);
const passed = results.filter((r) => r.pass).length;
console.log("\n──────────────────────────────────────────────────────────────────");
console.log(`TOTAL ${results.length} · PASS ${passed} · FAIL ${results.length - passed}`);
console.log(passed === results.length ? "RESULTADO: GO ✅ — cadena Ganado→onboarding→ocupado cerrada" : "RESULTADO: NO-GO ❌");
console.log("ROLLBACK ejecutado — sin datos residuales.");
if (passed !== results.length) process.exitCode = 1;
