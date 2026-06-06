/**
 * run-w1-staging.mjs — W-1 · aplica 0047 y corre la validación del Write-Path en STAGING.
 *
 * Uso (desde la raíz del repo):  node scripts/run-w1-staging.mjs
 *
 * GUARD DURO: STAGING_DB_URL debe contener el ref de staging (vrxosunxlhohmqymxots)
 * y NUNCA el de PROD (arsksytgdnzukbmfgkju). Si no, aborta sin conectar.
 *
 * - 0047 (funciones) se aplica de forma persistente (DDL idempotente).
 * - La validación corre en BEGIN…ROLLBACK (no deja datos). El runner controla la
 *   transacción para poder capturar la tabla de resultados antes del rollback.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.STAGING_DB_URL ?? "";
const STAGING = "vrxosunxlhohmqymxots";
const PROD = "arsksytgdnzukbmfgkju";

if (!url) { console.error("❌ STAGING_DB_URL ausente en .env.local — abort."); process.exit(1); }
if (!url.includes(STAGING) || url.includes(PROD)) {
  console.error(`❌ GUARD FAIL: STAGING_DB_URL no es staging (debe contener ${STAGING} y NO ${PROD}). Abort.`);
  process.exit(1);
}
console.log("GUARD ✅ staging confirmado:", (url.match(/@([^:/?]+)/) || [])[1]);

const migration = readFileSync("supabase/migrations/0047_crm_write_path_fns.sql", "utf8");
const valFull = readFileSync("supabase/tests/CRM_WRITE_PATH_VALIDATION.sql", "utf8");

const marker = "\n-- RESULTADOS";
const idx = valFull.indexOf(marker);
if (idx < 0) { console.error("❌ No se encontró el marcador -- RESULTADOS en la validación."); process.exit(1); }
const valBody = valFull.slice(0, idx); // 'begin;' + temp table + secciones 0..9

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  console.log("\n── Aplicando 0047_crm_write_path_fns.sql (persistente) ───────────");
  await client.query(migration);
  console.log("   0047 aplicada ✅ (3 funciones RPC creadas/reemplazadas)");

  console.log("\n── Validación Write-Path (BEGIN…ROLLBACK) ────────────────────────");
  await client.query(valBody);
  const detail = await client.query(
    `select section, test, case when pass then 'PASS' else 'FAIL' end as resultado, detail
       from _wp_val order by section, test`,
  );
  const summary = await client.query(
    `select count(*)::int total, count(*) filter (where pass)::int passed,
            count(*) filter (where not pass)::int failed from _wp_val`,
  );
  await client.query("rollback");

  console.log("");
  for (const r of detail.rows) {
    console.log(`${r.resultado === "PASS" ? "✅" : "❌"} [${r.section}] ${r.test}`);
    console.log(`      → ${r.detail}`);
  }
  const s = summary.rows[0];
  console.log("\n──────────────────────────────────────────────────────────────────");
  console.log(`TOTAL ${s.total} · PASS ${s.passed} · FAIL ${s.failed}`);
  console.log(s.failed === 0 ? "RESULTADO: GO ✅" : "RESULTADO: NO-GO ❌ (revisar FAIL)");
  console.log("ROLLBACK ejecutado — sin datos residuales.");
  if (s.failed !== 0) process.exitCode = 1;
} catch (e) {
  try { await client.query("rollback"); } catch { /* noop */ }
  console.error("\n❌ ERROR:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await client.end();
}
