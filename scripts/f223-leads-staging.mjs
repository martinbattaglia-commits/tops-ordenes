/**
 * f223-leads-staging.mjs — F2.2-3 · valida el soporte DB de la bandeja de leads.
 *
 * Uso (desde la raíz):  node scripts/f223-leads-staging.mjs
 *
 * Aplica 0049 (crm_list_commercial_users) y ejercita en BEGIN…ROLLBACK las MISMAS
 * operaciones de base que hacen las server actions (reassignLead / setLeadStatus),
 * bajo RLS (impersonando comercial), + el helper de usuarios + RLS por rol.
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

const U1 = "00000000-0000-0000-0000-0000000c0001"; // comercial
const U2 = "00000000-0000-0000-0000-0000000c0002"; // comercial
const U3 = "00000000-0000-0000-0000-0000000c0003"; // sin permiso
const LEAD = "00000000-0000-0000-0000-000000000f01";

const results = [];
const ok = (t, pass, detail = "") => results.push({ t, pass, detail });

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

async function asUser(uid, sql, params = []) {
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  try { return await client.query(sql, params); }
  finally { await client.query("set local role postgres"); }
}

try {
  console.log("\n── Aplicando 0049_crm_list_commercial_users.sql ─────────────────");
  await client.query(readFileSync("supabase/migrations/0049_crm_list_commercial_users.sql", "utf8"));
  console.log("   0049 aplicada ✅");

  await client.query("begin");

  const roleId = (await client.query("select id from public.roles where slug='comercial' limit 1")).rows[0]?.id;
  for (const [id, name, comercial] of [[U1, "Beatriz Comercial", true], [U2, "Aldo Comercial", true], [U3, "Sin Permiso", false]]) {
    await client.query(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,'',now(),now(),now())
       on conflict (id) do nothing`, [id, id.slice(-4) + "@f223.test"]);
    await client.query(`update public.profiles set full_name=$2, role='operaciones'::public.user_role_t, active=true where id=$1`, [id, name]);
    if (comercial) await client.query(`insert into public.user_roles(user_id, role_id) values ($1,$2) on conflict do nothing`, [id, roleId]);
  }
  await client.query(
    `insert into public.crm_leads (id, clientify_id, full_name, email, status, owner_id, tags)
     values ($1,'cl-f01','Lead Prueba','lead@f223.test','nuevo',$2,'{}') on conflict (id) do nothing`, [LEAD, U1]);

  // 1 · helper crm_list_commercial_users (PII-safe) impersonando comercial
  const lcu = await asUser(U1, "select * from public.crm_list_commercial_users()");
  const ids = lcu.rows.map((r) => r.id);
  ok("crm_list_commercial_users devuelve comerciales activos (U1,U2)", ids.includes(U1) && ids.includes(U2) && !ids.includes(U3), "ids=" + ids.length);
  ok("helper PII-safe (solo id + full_name, sin email)", lcu.fields.map((f) => f.name).sort().join(",") === "full_name,id", "cols=" + lcu.fields.map((f) => f.name).join(","));

  // 2 · reassignLead (UPDATE owner) bajo RLS comercial → U1→U2
  const re = await asUser(U1, "update public.crm_leads set owner_id=$2 where id=$1 and deleted_at is null", [LEAD, U2]);
  const owner = (await client.query("select owner_id from public.crm_leads where id=$1", [LEAD])).rows[0].owner_id;
  ok("reassignLead: UPDATE owner bajo RLS (comercial.edit)", re.rowCount === 1 && owner === U2, "rows=" + re.rowCount + " owner=" + owner);

  // 3 · setLeadStatus (calificación) nuevo→contactado→calificado
  await asUser(U1, "update public.crm_leads set status='contactado' where id=$1 and deleted_at is null and status<>'promovido'", [LEAD]);
  await asUser(U1, "update public.crm_leads set status='calificado' where id=$1 and deleted_at is null and status<>'promovido'", [LEAD]);
  const st = (await client.query("select status from public.crm_leads where id=$1", [LEAD])).rows[0].status;
  ok("setLeadStatus: nuevo→contactado→calificado", st === "calificado", "status=" + st);

  // 4 · guard: lead promovido no se re-toca (neq status promovido)
  await client.query("update public.crm_leads set status='promovido' where id=$1", [LEAD]);
  const g = await asUser(U1, "update public.crm_leads set status='nuevo' where id=$1 and deleted_at is null and status<>'promovido'", [LEAD]);
  const st2 = (await client.query("select status from public.crm_leads where id=$1", [LEAD])).rows[0].status;
  ok("guard: lead 'promovido' no se modifica (0 filas)", g.rowCount === 0 && st2 === "promovido", "rows=" + g.rowCount + " status=" + st2);

  // 5 · RLS: usuario sin comercial.edit no puede actualizar (0 filas)
  await client.query("update public.crm_leads set status='nuevo' where id=$1", [LEAD]); // reset
  const noperm = await asUser(U3, "update public.crm_leads set status='descartado' where id=$1 and deleted_at is null", [LEAD]);
  const st3 = (await client.query("select status from public.crm_leads where id=$1", [LEAD])).rows[0].status;
  ok("RLS: sin comercial.edit → UPDATE bloqueado (0 filas, sin fuga)", noperm.rowCount === 0 && st3 === "nuevo", "rows=" + noperm.rowCount + " status=" + st3);

  // 6 · profiles_public resuelve nombre de owner (PII-safe) bajo comercial
  const pn = await asUser(U1, "select full_name from public.profiles_public where id=$1", [U2]);
  ok("owner resolution vía profiles_public (sin email)", pn.rows[0]?.full_name === "Aldo Comercial", "name=" + pn.rows[0]?.full_name);

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
