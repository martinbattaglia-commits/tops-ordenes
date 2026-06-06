/**
 * w4-loop-staging.mts — W-4 · Validación del lazo completo + impacto en vacancia.
 *
 * Uso (desde la raíz):  npx tsx scripts/w4-loop-staging.mts
 *
 * Demuestra, contra STAGING y en BEGIN…ROLLBACK, el circuito:
 *   Opportunity → Reserve → Committed(reservado) → Won(comprometido)
 *               → Onboarding → Occupied(ocupado)
 * y mide en cada paso el impacto en el Motor Corporativo de Capacidad
 * (vacancia física / comercial / proyectada) usando el MISMO motor que el
 * Dashboard (getCorporateCapacity) alimentado por el MISMO snapshot que
 * committed-capacity.ts arma desde crm_opportunities.
 *
 * Observabilidad: la construcción del snapshot replica EXACTAMENTE la query de
 * src/lib/comercial/committed-capacity.ts (no hay claves supabase-js de staging).
 * No se modifica código de la app. Las RPC ya están validadas (W-1/W-2).
 *
 * GUARD: aborta si STAGING_DB_URL no es staging.
 */
import pg from "pg";
import { config } from "dotenv";
import { getCorporateCapacity, type CommittedSnapshot, type CapacityCategory } from "../src/lib/wms/corporate-capacity";

config({ path: ".env.local" });

const url = process.env.STAGING_DB_URL ?? "";
const STAGING = "vrxosunxlhohmqymxots", PROD = "arsksytgdnzukbmfgkju";
if (!url || !url.includes(STAGING) || url.includes(PROD)) {
  console.error("❌ GUARD FAIL: STAGING_DB_URL no es staging. Abort."); process.exit(1);
}
console.log("GUARD ✅ staging:", (url.match(/@([^:/?]+)/) || [])[1]);

const C0001 = "00000000-0000-0000-0000-0000000c0001";
const OPP = "00000000-0000-0000-0000-000000000d01";
const ONB = "00000000-0000-0000-0000-000000000e01";
const SITE = "PEDRO_LUJAN_3159";
const CAT: CapacityCategory = "anmat";
const M2 = 200;

const SERVICE_TO_CATEGORY: Record<string, CapacityCategory> = { anmat: "anmat", general: "general", oficinas: "oficina" };

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

async function asComercial(sql: string, params: unknown[] = []) {
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: C0001, role: "authenticated" })]);
  try { return await client.query(sql, params); }
  finally { await client.query("set local role postgres"); }
}

/** Replica la query de committed-capacity.ts y arma el CommittedSnapshot. */
async function buildSnapshot(): Promise<CommittedSnapshot> {
  const { rows } = await client.query(
    `select service_type, m2, committed_state, assigned_site
       from public.crm_opportunities
      where deleted_at is null
        and committed_state in ('reservado','comprometido')
        and assigned_site is not null
        and m2 is not null
        and estado <> 'perdido'`);
  const snap: CommittedSnapshot = {};
  for (const r of rows) {
    const cat = SERVICE_TO_CATEGORY[r.service_type as string];
    const site = r.assigned_site as string;
    const m2 = Number(r.m2 ?? 0);
    if (!cat || !site || !(m2 > 0)) continue;
    const bySite = (snap[site] ??= {});
    const bucket = (bySite[cat] ??= { reservedM2: 0, committedM2: 0 });
    if (r.committed_state === "reservado") bucket.reservedM2 += m2;
    else if (r.committed_state === "comprometido") bucket.committedM2 += m2;
  }
  return snap;
}

/** Bandas de vacancia para ANMAT@Luján y corporativo ANMAT, desde el motor real. */
async function bands(label: string) {
  const snap = await buildSnapshot();
  const cap = getCorporateCapacity(snap);
  const site = cap.sites.find((s) => s.siteCode === SITE)!;
  const c = site.categories[CAT];
  const corp = cap.byCategory[CAT];
  const view = (cc: { availableM2: number; committedM2: number; reservedM2: number }) => ({
    fisica: cc.availableM2,
    comercial: cc.availableM2 - cc.committedM2,
    proyectada: cc.availableM2 - cc.committedM2 - cc.reservedM2,
    reserved: cc.reservedM2,
    committed: cc.committedM2,
  });
  return { label, lujan: view(c), corp: view(corp) };
}

const log: Array<Awaited<ReturnType<typeof bands>> & { committed_state?: string }> = [];
const checks: Array<{ t: string; pass: boolean; detail: string }> = [];
const ok = (t: string, pass: boolean, detail: string) => checks.push({ t, pass, detail });
const oppState = async () => (await client.query("select committed_state, estado from public.crm_opportunities where id=$1", [OPP])).rows[0];

try {
  await client.query("begin");

  // Fixtures
  const roleId = (await client.query("select id from public.roles where slug='comercial' limit 1")).rows[0]?.id;
  await client.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated','w4@crmval.test','',now(),now(),now())
     on conflict (id) do nothing`, [C0001]);
  await client.query(`update public.profiles set full_name='W4', role='operaciones'::public.user_role_t, active=true where id=$1`, [C0001]);
  await client.query(`insert into public.user_roles(user_id, role_id) values ($1,$2) on conflict do nothing`, [C0001, roleId]);
  await client.query(
    `insert into public.crm_opportunities (id, service_type, estado, m2, assigned_site, committed_state)
     values ($1,'anmat','calificado',$2,null,'none') on conflict (id) do nothing`, [OPP, M2]);
  await client.query(
    `insert into public.crm_onboarding (id, opportunity_id, status, progress_pct)
     values ($1,$2,'pendiente',0) on conflict (id) do nothing`, [ONB, OPP]);

  // STEP 0 — baseline (opp aún sin compromiso)
  log.push({ ...(await bands("0·baseline")), committed_state: (await oppState()).committed_state });
  const base = log[0];

  // p_available_m2 desde el motor (proyectada @ sitio) — lo que calcula reserveCapacity.
  const pAvail = base.lujan.proyectada;

  // STEP 1 — RESERVE → reservado
  await asComercial("select public.crm_reserve_capacity(p_opp=>$1, p_site=>$2, p_units=>$3::jsonb, p_available_m2=>$4)",
    [OPP, SITE, JSON.stringify(["Cubículo ANMAT (2º piso)"]), pAvail]);
  log.push({ ...(await bands("1·reservado")), committed_state: (await oppState()).committed_state });

  // STEP 2 — WIN (calificado→propuesta→negociacion→ganado) → comprometido
  await asComercial("select public.crm_advance_stage($1,'propuesta',null)", [OPP]);
  await asComercial("select public.crm_advance_stage($1,'negociacion',null)", [OPP]);
  await asComercial("select public.crm_advance_stage($1,'ganado',null)", [OPP]);
  log.push({ ...(await bands("2·comprometido")), committed_state: (await oppState()).committed_state });

  // STEP 3 — ONBOARDING COMPLETE → ocupado
  await asComercial("select public.crm_complete_onboarding($1,null)", [OPP]);
  log.push({ ...(await bands("3·ocupado")), committed_state: (await oppState()).committed_state });

  // ── Aserciones del lazo ───────────────────────────────────────────────
  const [s0, s1, s2, s3] = log;
  ok("STEP1 reservado: committed_state correcto", s1.committed_state === "reservado", s1.committed_state);
  ok("STEP1 vacancia PROYECTADA baja en " + M2 + " m² (Luján)", s1.lujan.proyectada === s0.lujan.proyectada - M2,
    `${s0.lujan.proyectada} → ${s1.lujan.proyectada}`);
  ok("STEP1 vacancia COMERCIAL sin cambio (reserva no compromete)", s1.lujan.comercial === s0.lujan.comercial,
    `${s0.lujan.comercial} → ${s1.lujan.comercial}`);
  ok("STEP1 vacancia FÍSICA sin cambio", s1.lujan.fisica === s0.lujan.fisica, `${s0.lujan.fisica} → ${s1.lujan.fisica}`);

  ok("STEP2 comprometido: committed_state correcto", s2.committed_state === "comprometido", s2.committed_state);
  ok("STEP2 vacancia COMERCIAL baja en " + M2 + " m² (Luján)", s2.lujan.comercial === s0.lujan.comercial - M2,
    `${s0.lujan.comercial} → ${s2.lujan.comercial}`);
  ok("STEP2 vacancia PROYECTADA = comercial (sin reservas residuales)", s2.lujan.proyectada === s2.lujan.comercial,
    `proy=${s2.lujan.proyectada} com=${s2.lujan.comercial}`);

  ok("STEP3 ocupado: committed_state correcto", s3.committed_state === "ocupado", s3.committed_state);
  ok("STEP3 anti-doble-conteo: comercial vuelve al baseline", s3.lujan.comercial === s0.lujan.comercial,
    `${s2.lujan.comercial} → ${s3.lujan.comercial} (base ${s0.lujan.comercial})`);
  ok("STEP3 anti-doble-conteo: proyectada vuelve al baseline", s3.lujan.proyectada === s0.lujan.proyectada,
    `${s2.lujan.proyectada} → ${s3.lujan.proyectada} (base ${s0.lujan.proyectada})`);
  ok("FÍSICA constante en todo el lazo", new Set(log.map((l) => l.lujan.fisica)).size === 1, "fisica=" + s0.lujan.fisica);
  ok("Corporativo ANMAT: comercial baja en " + M2 + " al ganar", s2.corp.comercial === s0.corp.comercial - M2,
    `${s0.corp.comercial} → ${s2.corp.comercial}`);

  await client.query("rollback");
} catch (e) {
  try { await client.query("rollback"); } catch { /* noop */ }
  ok("harness", false, "EXCEPTION: " + (e instanceof Error ? e.message : String(e)));
} finally {
  await client.end();
}

// ── Reporte ──────────────────────────────────────────────────────────────
console.log("\n=== BANDAS DE VACANCIA · ANMAT @ Pedro Luján 3159 (m²) ===");
console.log("paso            committed_state   física  comercial  proyectada  (reserved/committed)");
for (const l of log) {
  console.log(
    `${l.label.padEnd(15)} ${String(l.committed_state).padEnd(15)}  ${String(l.lujan.fisica).padStart(5)}  ${String(l.lujan.comercial).padStart(8)}  ${String(l.lujan.proyectada).padStart(9)}   (${l.lujan.reserved}/${l.lujan.committed})`);
}
console.log("\n=== Corporativo ANMAT (consolidado Luján+Magaldi, m²) ===");
console.log("paso            física  comercial  proyectada");
for (const l of log) {
  console.log(`${l.label.padEnd(15)} ${String(l.corp.fisica).padStart(6)}  ${String(l.corp.comercial).padStart(8)}  ${String(l.corp.proyectada).padStart(9)}`);
}

console.log("\n=== ASERCIONES DEL LAZO ===");
for (const c of checks) {
  console.log(`${c.pass ? "✅" : "❌"} ${c.t}`);
  console.log(`      → ${c.detail}`);
}
const passed = checks.filter((c) => c.pass).length;
console.log("\n──────────────────────────────────────────────────────────────────");
console.log(`TOTAL ${checks.length} · PASS ${passed} · FAIL ${checks.length - passed}`);
console.log(passed === checks.length ? "RESULTADO: GO ✅ — circuito completo verificado" : "RESULTADO: NO-GO ❌");
console.log("ROLLBACK ejecutado — sin datos residuales.");
if (passed !== checks.length) process.exitCode = 1;
