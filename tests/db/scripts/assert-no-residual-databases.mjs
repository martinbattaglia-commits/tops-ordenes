/**
 * P3-N1A0 · Verifica que la corrida no dejó bases de test residuales.
 *
 * Se ejecuta como último paso del workflow. Usa EXCLUSIVAMENTE la conexión de
 * test aprobada (`P3N1A0_TEST_PG_URL`) y revalida por su cuenta que apunte a
 * 127.0.0.1 sin query parameters: el paso corre con `if: always()`, incluso
 * cuando la suite falló, así que no puede apoyarse en que las guardas del
 * harness ya se hayan ejecutado.
 *
 * Es un script y no un `run:` con `psql` para que el auditor de T-A0-06 pueda
 * comparar el comando contra una forma exacta y corta, y para que la lógica de
 * conexión quede sujeta a las mismas reglas que el resto del harness.
 */

import { Client } from "pg";

const RAW = (process.env.P3N1A0_TEST_PG_URL ?? "").trim();

if (RAW === "") {
  console.error("[P3-N1A0] P3N1A0_TEST_PG_URL no está definida.");
  process.exit(1);
}

let url;
try {
  url = new URL(RAW);
} catch {
  console.error("[P3-N1A0] P3N1A0_TEST_PG_URL no es parseable.");
  process.exit(1);
}

if (url.hostname !== "127.0.0.1") {
  console.error(`[P3-N1A0] destino no permitido: "${url.hostname}". Sólo 127.0.0.1.`);
  process.exit(1);
}
if (url.search !== "") {
  console.error("[P3-N1A0] la URL incluye query parameters. No se admite ninguno.");
  process.exit(1);
}
if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
  console.error(`[P3-N1A0] protocolo no admitido: ${url.protocol}`);
  process.exit(1);
}

const client = new Client({ connectionString: RAW, connectionTimeoutMillis: 15_000 });
await client.connect();
try {
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
} finally {
  await client.end();
}
