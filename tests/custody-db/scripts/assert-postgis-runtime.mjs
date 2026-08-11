/**
 * W22-TER-A · M6 — SONDA DE RUNTIME: PostgreSQL 17 + PostGIS REAL.
 *
 * Corre ANTES de la suite de Custodia, contra EXACTAMENTE el mismo servidor que
 * el harness va a usar (`P3N1A0_TEST_PG_URL`). Su razón de ser es que el
 * DB-C4 no acepta —y con razón— que un service container «de PostGIS» pruebe
 * algo por su nombre: lo único que prueba que la extensión existe de verdad es
 * CREARLA y ejecutar `postgis_lib_version()`, que sólo devuelve un valor si la
 * biblioteca compartida se cargó en ese servidor.
 *
 * Por eso:
 *   · NO se consulta `pg_available_extensions` y se da por bueno el nombre;
 *   · NO hay shim, mock ni sustituto de la extensión;
 *   · todo ocurre dentro de una transacción que termina en ROLLBACK, de modo
 *     que la sonda no deja ni la extensión ni un esquema propio detrás.
 *
 * Reutiliza la MISMA guarda del harness (`tests/db/scripts/guard.mjs`), sin
 * modificarla: una guarda propia y divergente fue justamente uno de los
 * hallazgos que el C4 del harness vanilla ya había castigado.
 */

import { Client } from "pg";
import {
  assertLocalMaintenanceUrl,
  assertNoProductionEnv,
  parseAndCheckServerVersion,
} from "../../db/scripts/guard.mjs";

const RAW = (process.env.P3N1A0_TEST_PG_URL ?? "").trim();
if (RAW === "") {
  console.error(
    "[M6] P3N1A0_TEST_PG_URL no está definida. Sin ella el harness levantaría un " +
      "cluster efímero con los binarios del runner y el servicio PostGIS no probaría nada.",
  );
  process.exit(1);
}

let maintenance;
try {
  const u = new URL(RAW);
  u.pathname = "/postgres";
  maintenance = u.toString();
} catch {
  console.error("[M6] P3N1A0_TEST_PG_URL no es parseable.");
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

let failed = false;
try {
  // 1) PostgreSQL 17, con el mismo version gate que el harness.
  const ver = await client.query("show server_version_num");
  parseAndCheckServerVersion(ver.rows[0]?.server_version_num);

  // 2) PostGIS REAL, dentro de una transacción que se deshace.
  await client.query("begin");

  const { rows: installed } = await client.query(
    `select n.nspname as ns
       from pg_extension e
       join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'postgis'`,
  );

  let schema;
  if (installed.length > 0) {
    schema = installed[0].ns;
  } else {
    // Esquema propio y efímero: no se contamina `public` ni siquiera dentro de
    // la transacción, y el ROLLBACK lo borra junto con la extensión.
    schema = "m6_postgis_probe";
    await client.query(`create schema ${schema}`);
    await client.query(`create extension postgis with schema ${schema}`);
  }

  // ESTA es la prueba: la función sólo responde si la biblioteca se cargó.
  const { rows: lib } = await client.query(
    `select ${schema}.postgis_lib_version() as v, ${schema}.postgis_version() as full`,
  );
  const version = lib[0]?.v ?? "";
  if (!/^3\./.test(version)) {
    throw new Error(`[M6] postgis_lib_version() devolvió un valor inesperado: "${version}"`);
  }

  console.log(`postgis_lib_version=${version}`);
  console.log(`postgis_version=${lib[0]?.full ?? ""}`);
  console.log(`server_version_num=${ver.rows[0]?.server_version_num}`);
  console.log("CUSTODY_POSTGIS_RUNTIME_OK");
} catch (e) {
  failed = true;
  console.error(e.message);
  console.error("STOP — M6_REAL_POSTGIS_CI_RUNTIME_UNPROVEN");
} finally {
  // La sonda no deja residuo: deshace todo lo que hizo, haya fallado o no.
  await client.query("rollback").catch(() => {});
  await client.end();
}

process.exit(failed ? 1 : 0);
