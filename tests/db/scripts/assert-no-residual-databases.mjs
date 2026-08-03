/**
 * P3-N1A0 · Verifica que la corrida no dejó bases de test residuales.
 *
 * Último paso del workflow, con `if: always()`. La revisión C4 (MEDIUM) señaló
 * que abría un Client con una guarda reducida y divergente de `connectGuarded`;
 * ahora usa exactamente la MISMA guarda que el resto del harness —vía la
 * implementación compartida `scripts/guard.mjs`, cuya paridad con `guard.ts`
 * está probada— y el mismo version gate.
 */

import { Client } from "pg";
import {
  assertLocalMaintenanceUrl,
  assertNoProductionEnv,
  parseAndCheckServerVersion,
} from "./guard.mjs";

const RAW = (process.env.P3N1A0_TEST_PG_URL ?? "").trim();
if (RAW === "") {
  console.error("[P3-N1A0] P3N1A0_TEST_PG_URL no está definida.");
  process.exit(1);
}

// La URL apunta a la base de mantenimiento `postgres`; se normaliza a ella y se
// valida con la guarda de mantenimiento compartida.
let maintenance;
try {
  const u = new URL(RAW);
  u.pathname = "/postgres";
  maintenance = u.toString();
} catch {
  console.error("[P3-N1A0] P3N1A0_TEST_PG_URL no es parseable.");
  process.exit(1);
}

try {
  assertNoProductionEnv();
  assertLocalMaintenanceUrl(maintenance);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const client = new Client({ connectionString: maintenance, connectionTimeoutMillis: 15_000 });
await client.connect();
try {
  // Mismo version gate que el harness: no se opera sobre un PostgreSQL ≠ 17.
  const ver = await client.query("show server_version_num");
  parseAndCheckServerVersion(ver.rows[0]?.server_version_num);

  const { rows } = await client.query(
    `select coalesce(string_agg(datname, ', ' order by datname), '') as leftovers,
            count(*)::int as n
       from pg_database
      where datname like 'p3n1a0\\_test\\_%'`,
  );
  const { n, leftovers } = rows[0];
  console.log(`bases de test residuales: ${n}`);
  if (n !== 0) {
    console.error(`[P3-N1A0] teardown incompleto. Sobrevivieron: ${leftovers}`);
    process.exit(1);
  }
  console.log("P3_N1A0_NO_RESIDUAL_DATABASES");
} catch (e) {
  console.error(e.message);
  process.exit(1);
} finally {
  await client.end();
}
