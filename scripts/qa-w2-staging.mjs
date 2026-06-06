/**
 * qa-w2-staging.mjs — W-2 · QA de contrato Server Action ↔ RPC en STAGING.
 *
 * Uso (desde la raíz):  node scripts/qa-w2-staging.mjs
 *
 * Las server actions de stage-actions.ts no se pueden invocar fuera del runtime
 * de Next (usan cookies()/revalidatePath()). Este harness ejercita, vía `pg`,
 * EXACTAMENTE las operaciones de base que cada action ejecuta — usando los mismos
 * NOMBRES DE PARÁMETRO (p_opp, p_to, p_site, p_units, p_available_m2, p_note) —
 * para bloquear el contrato action↔función. Corre en BEGIN…ROLLBACK (no persiste)
 * e impersona al usuario comercial (RLS + auth.uid()).
 *
 * GUARD: aborta si STAGING_DB_URL no es staging.
 */
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.STAGING_DB_URL ?? "";
const STAGING = "vrxosunxlhohmqymxots", PROD = "arsksytgdnzukbmfgkju";
if (!url || !url.includes(STAGING) || url.includes(PROD)) {
  console.error("❌ GUARD FAIL: STAGING_DB_URL no es staging. Abort."); process.exit(1);
}
console.log("GUARD ✅ staging:", (url.match(/@([^:/?]+)/) || [])[1]);

const C0001 = "00000000-0000-0000-0000-0000000c0001"; // comercial
const A = "00000000-0000-0000-0000-000000000a01";       // lifecycle
const B = "00000000-0000-0000-0000-000000000a04";       // update fields

const results = [];
const ok = (t, pass, detail) => results.push({ t, pass, detail });

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

async function asComercial(sql, params) {
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: C0001, role: "authenticated" })]);
  try { return await client.query(sql, params); }
  finally { await client.query("set local role postgres"); }
}

try {
  await client.query("begin");

  // ── Fixtures (como postgres) ────────────────────────────────────────────
  const roleId = (await client.query("select id from public.roles where slug='comercial' limit 1")).rows[0]?.id;
  await client.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated','qa.w2@crmval.test','',now(),now(),now())
     on conflict (id) do nothing`, [C0001]);
  await client.query(
    `update public.profiles set full_name='QA W2', role='operaciones'::public.user_role_t, active=true where id=$1`, [C0001]);
  await client.query(`insert into public.user_roles(user_id, role_id) values ($1,$2) on conflict do nothing`, [C0001, roleId]);
  await client.query(
    `insert into public.crm_opportunities (id, service_type, estado, m2, assigned_site, committed_state) values
       ($1,'anmat','calificado',100,null,'none'),
       ($2,'general','propuesta',150,'PEDRO_LUJAN_3159','reservado')
     on conflict (id) do nothing`, [A, B]);
  await client.query(
    `insert into public.crm_onboarding (id, opportunity_id, status, progress_pct)
     values ('00000000-0000-0000-0000-00000000b0a2',$1,'pendiente',0) on conflict (id) do nothing`, [A]);
  ok("fixtures", true, "ok");

  // ── reserveCapacity: read + named-arg RPC (p_available_m2 desde el motor) ──
  const rd = await asComercial(
    "select service_type, m2 from public.crm_opportunities where id=$1 and deleted_at is null", [A]);
  ok("reserve: read service_type+m2 (RLS)", rd.rows[0]?.service_type === "anmat", "service=" + rd.rows[0]?.service_type);

  const rc = await asComercial(
    "select * from public.crm_reserve_capacity(p_opp => $1, p_site => $2, p_units => $3::jsonb, p_available_m2 => $4)",
    [A, "PEDRO_LUJAN_3159", JSON.stringify(["Cubículo PA4"]), 401]);
  ok("reserve: named-arg RPC → committed=reservado", rc.rows[0]?.committed_state === "reservado",
    "committed=" + rc.rows[0]?.committed_state + " site=" + rc.rows[0]?.assigned_site);

  // ── advanceStage: named-arg RPC a lo largo del ciclo ─────────────────────
  const a1 = await asComercial(
    "select * from public.crm_advance_stage(p_opp => $1, p_to => $2::public.crm_stage_t, p_note => $3)",
    [A, "propuesta", "cotización enviada"]);
  ok("advance: named-arg RPC calificado→propuesta", a1.rows[0]?.estado === "propuesta", "estado=" + a1.rows[0]?.estado);
  await asComercial("select public.crm_advance_stage($1, 'negociacion', null)", [A]);
  const a3 = await asComercial("select * from public.crm_advance_stage($1, 'ganado', null)", [A]);
  ok("advance: negociacion→ganado (con capacidad) → comprometido", a3.rows[0]?.committed_state === "comprometido",
    "estado=" + a3.rows[0]?.estado + " committed=" + a3.rows[0]?.committed_state);

  // ── completeOnboarding: named-arg RPC → ocupado ──────────────────────────
  const co = await asComercial(
    "select * from public.crm_complete_onboarding(p_opp => $1, p_note => $2)", [A, null]);
  ok("completeOnboarding: named-arg RPC → ocupado", co.rows[0]?.committed_state === "ocupado",
    "committed=" + co.rows[0]?.committed_state);

  // ── updateOpportunityFields: whitelist UPDATE (no toca estado/committed) ──
  const before = await client.query("select estado, committed_state from public.crm_opportunities where id=$1", [B]);
  const up = await asComercial(
    `update public.crm_opportunities
        set contacto=$2, monto=$3, probabilidad=$4, expected_close=$5
      where id=$1 and deleted_at is null
      returning contacto, monto, probabilidad, estado, committed_state`,
    [B, "Nuevo Contacto", 9000000, 75, "2026-09-01"]);
  const r = up.rows[0];
  ok("update: campos de lista blanca aplicados",
    r?.contacto === "Nuevo Contacto" && Number(r?.monto) === 9000000 && r?.probabilidad === 75,
    `contacto=${r?.contacto} monto=${r?.monto} prob=${r?.probabilidad}`);
  ok("update: estado/committed_state INTACTOS (whitelist no los toca)",
    r?.estado === before.rows[0].estado && r?.committed_state === before.rows[0].committed_state,
    `estado=${r?.estado} committed=${r?.committed_state}`);

  // ── Exposición PostgREST: grants execute a authenticated en las 3 RPC ─────
  const gr = await client.query(
    `select routine_name, count(*) n from information_schema.role_routine_grants
      where specific_schema='public' and grantee='authenticated'
        and routine_name in ('crm_advance_stage','crm_reserve_capacity','crm_complete_onboarding')
      group by routine_name`);
  ok("grants: execute a authenticated en las 3 RPC (exposición PostgREST)", gr.rows.length === 3,
    "con grant=" + gr.rows.map((x) => x.routine_name).sort().join(","));

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
