/**
 * P3-N1A0 · Ciclo de vida del PostgreSQL 17 efímero.
 *
 * Endurecido tras C4:
 *  · H-01 — ninguna señal se envía sin revalidar la identidad administrada;
 *  · M-01 — todo recurso se adquiere DENTRO del bloque protegido y se registra
 *           en un rollback stack que corre en `finally`; el teardown es `async`,
 *           se espera siempre y propaga sus fallos;
 *  · M-03 — la versión de PostgreSQL se valida contra la conexión real, antes
 *           de cualquier bootstrap, tanto en local como en CI;
 *  · B-01 — la URL efectiva pasa por la guarda antes de construir `Client`.
 *
 * Dos sustratos, las MISMAS barreras:
 *  1. EFÍMERO (local): initdb + pg_ctl sobre 127.0.0.1 y puerto libre.
 *  2. SERVIDOR EXTERNO (CI): `P3N1A0_TEST_PG_URL`; se crea una base con nombre
 *     único, se usa y se elimina verificando su desaparición.
 */

import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import {
  assertLocalMaintenanceUrl,
  assertLocalTestUrl,
  assertNoProductionEnv,
  makeTestDbName,
  TEST_DB_PREFIX,
} from "./guard";
import {
  canonical,
  inspectProcess,
  verifyOwnership,
  type ManagedClusterIdentity,
} from "./process-identity";
import { assertPostgres17 } from "./version-gate";

export interface EphemeralCluster {
  /** URL de la base de test. Validada por la guarda antes de existir. */
  url: string;
  dbName: string;
  /** Directorio del cluster efímero; `null` con servidor externo. */
  dataDir: string | null;
  /** Identidad administrada; `null` con servidor externo. */
  identity: ManagedClusterIdentity | null;
  /** Destruye todo. `async`: propaga fallos, no los absorbe. */
  teardown: () => Promise<void>;
}

/**
 * PostgreSQL sobre macOS aborta con "postmaster became multithreaded during
 * startup" si el locale no es determinista. Se fija en todo el ciclo de vida.
 *
 * `PG_ENV` se construye SIN las variables libpq: `assertNoProductionEnv` ya
 * aborta si alguna está presente, y esto evita heredarlas por accidente.
 */
const PG_ENV: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C", LANG: "C" };

const PG_CTL_TIMEOUT_MS = 30_000;
const INITDB_TIMEOUT_MS = 60_000;

/** Recorta la salida de un subproceso para mensajes de error. */
function sanitize(s: string | null | undefined, max = 500): string {
  return (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

interface RunResult {
  ok: boolean;
  status: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], timeoutMs: number): RunResult {
  const r = spawnSync(cmd, args, { env: PG_ENV, encoding: "utf8", timeout: timeoutMs });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  return {
    ok: !r.error && r.status === 0,
    status: r.status,
    signal: r.signal ?? null,
    timedOut,
    stdout: sanitize(r.stdout),
    stderr: sanitize(r.stderr),
  };
}

function runOrThrow(cmd: string, args: string[], timeoutMs: number, label: string): void {
  const r = run(cmd, args, timeoutMs);
  if (r.ok) return;
  throw new Error(
    `[P3-N1A0] ${label} falló ` +
      `(exit=${r.status} signal=${r.signal} timeout=${r.timedOut}).\n` +
      `stdout: ${r.stdout}\nstderr: ${r.stderr}`,
  );
}

/** Puerto libre en loopback, asignado por el sistema operativo. */
function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("[P3-N1A0] no se pudo reservar un puerto libre.")));
        return;
      }
      const { port } = addr;
      srv.close(() => resolvePort(port));
    });
  });
}

function assertPgBinaries(): void {
  const r = run("initdb", ["--version"], 10_000);
  if (!r.ok) {
    throw new Error(
      "[P3-N1A0] `initdb` no está disponible. Instalá PostgreSQL 17 " +
        "(macOS: `brew install postgresql@17`) o definí P3N1A0_TEST_PG_URL " +
        "apuntando a un PostgreSQL 17 local ya levantado.",
    );
  }
  if (!/\b17\./.test(r.stdout)) {
    throw new Error(
      `[P3-N1A0] se requiere PostgreSQL 17; initdb informa: ${r.stdout}`,
    );
  }
}

/** Ruta canónica del binario `postgres` que acompaña a `pg_ctl`. */
function resolvePostgresExecutable(): string {
  const r = run("pg_config", ["--bindir"], 10_000);
  const bindir = r.ok ? r.stdout : "";
  return canonical(bindir ? join(bindir, "postgres") : "postgres");
}

/** Nombre de base validado antes de interpolarse en DDL. */
function assertSafeDbName(dbName: string): void {
  if (!new RegExp(`^${TEST_DB_PREFIX}[a-z0-9_]+$`).test(dbName)) {
    throw new Error(`[P3-N1A0] nombre de base inseguro: ${dbName}`);
  }
}

/**
 * Abre una conexión validando primero la guarda y la versión del servidor.
 * Es el ÚNICO punto del harness que construye un `Client`.
 */
export async function connectGuarded(
  url: string,
  kind: "test" | "maintenance" = "test",
): Promise<Client> {
  assertNoProductionEnv();
  if (kind === "maintenance") assertLocalMaintenanceUrl(url);
  else assertLocalTestUrl(url);
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    await assertPostgres17(client);
  } catch (e) {
    await client.end().catch(() => {});
    throw e;
  }
  return client;
}

async function createDatabase(adminUrl: string, dbName: string): Promise<void> {
  assertSafeDbName(dbName);
  const client = await connectGuarded(adminUrl, "maintenance");
  try {
    await client.query(`create database ${dbName}`);
  } finally {
    await client.end();
  }
}

/**
 * Elimina la base y VERIFICA que desapareció. Propaga cualquier fallo: un
 * teardown que absorbe errores informa éxito sin haberlo logrado (M-01).
 */
async function dropDatabaseVerified(adminUrl: string, dbName: string): Promise<void> {
  assertSafeDbName(dbName);
  const client = await connectGuarded(adminUrl, "maintenance");
  try {
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`,
      [dbName],
    );
    await client.query(`drop database if exists ${dbName}`);
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from pg_database where datname = $1`,
      [dbName],
    );
    if (rows[0]?.n !== "0") {
      throw new Error(
        `[P3-N1A0] la base de test "${dbName}" sigue existiendo tras el DROP. Teardown fallido.`,
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * Detiene el postmaster administrado y borra su directorio.
 *
 * Nunca borra el directorio mientras exista un proceso administrado vivo, y
 * nunca envía una señal sin revalidar la pertenencia (H-01).
 */
export async function destroyManagedCluster(
  identity: ManagedClusterIdentity,
  baseDir: string,
  inspect = inspectProcess,
): Promise<void> {
  // 1) Apagado ordenado, con timeout propio y resultado verificado.
  const stop = run(
    "pg_ctl",
    ["-D", join(baseDir, "pgdata"), "-m", "immediate", "-w", "-t", "20", "stop"],
    PG_CTL_TIMEOUT_MS,
  );

  // 2) ¿Sigue vivo y sigue siendo NUESTRO?
  let verdict = verifyOwnership(identity, inspect);

  if (!verdict.owned && !verdict.processGone) {
    throw new Error(
      `[P3-N1A0] teardown ABORTADO: ${verdict.reason} ` +
        `No se envía ninguna señal y se preserva ${baseDir} como evidencia. ` +
        `(pg_ctl: exit=${stop.status} signal=${stop.signal} timeout=${stop.timedOut}; ` +
        `stderr: ${stop.stderr})`,
    );
  }

  // 3) Escalada sólo mientras la pertenencia siga demostrada, revalidando
  //    antes de CADA señal.
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    verdict = verifyOwnership(identity, inspect);
    if (!verdict.owned) break;
    try {
      process.kill(identity.pid, signal);
    } catch {
      break;
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (!verifyOwnership(identity, inspect).owned) break;
      spawnSync("sleep", ["0.1"]);
    }
  }

  // 4) Última revalidación: no se borra el directorio con un proceso vivo.
  verdict = verifyOwnership(identity, inspect);
  if (verdict.owned) {
    throw new Error(
      `[P3-N1A0] el postmaster administrado (pid ${identity.pid}) sigue vivo tras ` +
        `SIGTERM y SIGKILL. Se preserva ${baseDir} como evidencia; no se borra ` +
        `el directorio de un proceso vivo.`,
    );
  }
  if (!verdict.owned && !verdict.processGone) {
    throw new Error(
      `[P3-N1A0] identidad ambigua tras la escalada: ${verdict.reason} ` +
        `Se preserva ${baseDir} como evidencia.`,
    );
  }

  if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
}

/**
 * Levanta (o reutiliza) un PostgreSQL 17 y devuelve una base de test vacía.
 *
 * M-01: TODO recurso se adquiere dentro del bloque protegido y se apila en
 * `rollback`, que se ejecuta si cualquier etapa posterior falla.
 */
export async function startEphemeralCluster(): Promise<EphemeralCluster> {
  // Barrera 1, antes de tocar nada: el entorno no debe poder desviar el destino.
  assertNoProductionEnv();

  const external = (process.env.P3N1A0_TEST_PG_URL ?? "").trim();
  const dbName = makeTestDbName();
  const rollback: Array<() => Promise<void>> = [];

  const unwind = async (): Promise<void> => {
    for (const step of rollback.reverse()) {
      await step().catch(() => {
        /* rollback best-effort: el error original manda */
      });
    }
  };

  try {
    // ── Sustrato 2: servidor externo (CI) ────────────────────────────────
    if (external) {
      const base = new URL(external);
      if (base.search !== "") {
        throw new Error(
          "[P3-N1A0] P3N1A0_TEST_PG_URL incluye query parameters. No se admite ninguno.",
        );
      }
      base.pathname = "/postgres";
      const adminUrl = base.toString();

      const target = new URL(external);
      target.pathname = `/${dbName}`;
      const url = target.toString();

      // Barrera 2 y 3: la URL efectiva y la de mantenimiento, ambas validadas.
      assertLocalTestUrl(url);

      await createDatabase(adminUrl, dbName);
      rollback.push(() => dropDatabaseVerified(adminUrl, dbName));

      let done = false;
      return {
        url,
        dbName,
        dataDir: null,
        identity: null,
        teardown: async () => {
          if (done) return;
          done = true;
          await dropDatabaseVerified(adminUrl, dbName); // propaga fallos
        },
      };
    }

    // ── Sustrato 1: cluster efímero propio (local) ────────────────────────
    assertPgBinaries();

    const baseDir = mkdtempSync(join(tmpdir(), "p3n1a0-"));
    rollback.push(async () => {
      if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
    });

    const dataDir = join(baseDir, "pgdata");
    const port = await findFreePort();

    runOrThrow(
      "initdb",
      ["-D", dataDir, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"],
      INITDB_TIMEOUT_MS,
      "initdb",
    );

    const pgOptions =
      `-p ${port} -h 127.0.0.1 -c unix_socket_directories='' ` +
      `-c fsync=off -c full_page_writes=off`;

    runOrThrow(
      "pg_ctl",
      ["-D", dataDir, "-o", pgOptions, "-l", join(baseDir, "postgres.log"), "-w", "-t", "30", "start"],
      PG_CTL_TIMEOUT_MS,
      "pg_ctl start",
    );

    // Identidad administrada, capturada inmediatamente tras el arranque.
    const canonicalDataDir = canonical(dataDir);
    const pidFile = join(dataDir, "postmaster.pid");
    if (!existsSync(pidFile)) {
      throw new Error("[P3-N1A0] el cluster arrancó pero no escribió postmaster.pid.");
    }
    const postmasterPid = readFileSync(pidFile, "utf8");
    const pid = Number.parseInt(postmasterPid.split("\n")[0]?.trim() ?? "", 10);
    const snap = inspectProcess(pid);
    if (!Number.isInteger(pid) || pid <= 0 || snap === null) {
      throw new Error(
        `[P3-N1A0] no se pudo observar el postmaster recién arrancado (pid=${pid}).`,
      );
    }
    const optsFile = join(dataDir, "postmaster.opts");
    const identity: ManagedClusterIdentity = {
      clusterId: `${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
      pid,
      dataDir: canonicalDataDir,
      executable: resolvePostgresExecutable(),
      argv: snap.argv,
      port,
      startedAt: snap.startedAt,
      postmasterPid,
      postmasterOpts: existsSync(optsFile) ? readFileSync(optsFile, "utf8") : "",
    };

    // Si el binario resuelto no coincide con el observado, la identidad sería
    // ambigua desde el arranque: preferimos el observado y lo dejamos asentado.
    if (snap.executable.trim() !== identity.executable) {
      identity.executable = snap.executable.trim();
    }

    rollback.push(() => destroyManagedCluster(identity, baseDir));

    const adminUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
    const url = `postgresql://postgres@127.0.0.1:${port}/${dbName}`;
    assertLocalMaintenanceUrl(adminUrl);
    assertLocalTestUrl(url);

    await createDatabase(adminUrl, dbName);

    let done = false;
    return {
      url,
      dbName,
      dataDir: baseDir,
      identity,
      teardown: async () => {
        if (done) return;
        done = true;
        await destroyManagedCluster(identity, baseDir); // propaga fallos
      },
    };
  } catch (e) {
    await unwind();
    throw e;
  }
}
