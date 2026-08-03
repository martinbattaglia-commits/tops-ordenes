/**
 * P3-N1A0 · Ciclo de vida del PostgreSQL 17 efímero.
 *
 * Dos sustratos, una sola guarda:
 *
 *  1. EFÍMERO (por defecto, uso local en macOS/Linux)
 *     `initdb` crea un cluster nuevo en un directorio temporal, `pg_ctl` lo
 *     arranca sobre loopback y un puerto libre, y el teardown lo destruye
 *     junto con su directorio. Nada persiste entre corridas.
 *
 *  2. SERVIDOR EXTERNO (CI)
 *     Si `P3N1A0_TEST_PG_URL` apunta a un PostgreSQL 17 ya levantado —el
 *     service container de GitHub Actions—, el harness no arranca cluster: crea
 *     una base con nombre único, la usa y la elimina al terminar.
 *
 * En ambos casos la URL final pasa por `assertLocalTestUrl` ANTES de abrir
 * ninguna conexión.
 */

import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import {
  assertLocalTestUrl,
  assertNoProductionEnv,
  makeTestDbName,
} from "./guard";

export interface EphemeralCluster {
  /** URL de conexión a la base de test. Ya validada por la guarda. */
  url: string;
  /** URL al `postgres` de mantenimiento del mismo servidor (uso interno). */
  adminUrl: string;
  dbName: string;
  /**
   * Directorio de datos del cluster efímero, o `null` cuando se reutiliza un
   * servidor externo (CI). Lo expone el harness en lugar de preguntárselo al
   * servidor: quien crea el directorio es quien sabe dónde está.
   */
  dataDir: string | null;
  /** Destruye base, cluster y directorio temporal. Idempotente. */
  teardown: () => void;
}

/**
 * PostgreSQL sobre macOS aborta con "postmaster became multithreaded during
 * startup" si el locale no es determinista. Se fija en todo el ciclo de vida.
 */
const PG_ENV: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C", LANG: "C" };

function run(cmd: string, args: string[], label: string): void {
  const r = spawnSync(cmd, args, { env: PG_ENV, encoding: "utf8" });
  if (r.error) {
    throw new Error(
      `[P3-N1A0] ${label}: no se pudo ejecutar "${cmd}". ` +
        `¿PostgreSQL 17 instalado y en PATH? (${r.error.message})`,
    );
  }
  if (r.status !== 0) {
    throw new Error(
      `[P3-N1A0] ${label} falló (exit ${r.status}).\n${r.stdout ?? ""}\n${r.stderr ?? ""}`,
    );
  }
}

/**
 * Puerto libre en loopback. El sistema operativo asigna el puerto al hacer
 * `listen(0)`; se lee recién en el callback y se libera antes de devolverlo.
 */
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

/** ¿El proceso sigue vivo? `kill(pid, 0)` no envía señal, sólo consulta. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Espera activa y acotada a que el proceso desaparezca (contexto síncrono). */
function waitUntilGone(pid: number, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return;
    // Sin equivalente síncrono de sleep en Node: se cede con un spawn trivial.
    spawnSync("sleep", ["0.1"]);
  }
}

/** Verifica que los binarios de PostgreSQL 17 estén disponibles. */
function assertPgBinaries(): void {
  const r = spawnSync("initdb", ["--version"], { env: PG_ENV, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(
      "[P3-N1A0] `initdb` no está disponible. Instalá PostgreSQL 17 " +
        "(macOS: `brew install postgresql@17`) o definí P3N1A0_TEST_PG_URL " +
        "apuntando a un PostgreSQL 17 local ya levantado.",
    );
  }
  const version = (r.stdout ?? "").trim();
  if (!/\b17\./.test(version)) {
    throw new Error(
      `[P3-N1A0] se requiere PostgreSQL 17; se encontró: ${version}. ` +
        "El esquema productivo corre sobre PostgreSQL 17.",
    );
  }
}

async function createDatabase(adminUrl: string, dbName: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // dbName lo genera makeTestDbName(): [a-z0-9_] únicamente, sin interpolación
    // de datos externos. Aun así se valida antes de construir el DDL.
    if (!/^p3n1a0_test_[a-z0-9_]+$/.test(dbName)) {
      throw new Error(`[P3-N1A0] nombre de base inseguro: ${dbName}`);
    }
    await client.query(`create database ${dbName}`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(adminUrl: string, dbName: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`,
      [dbName],
    );
    await client.query(`drop database if exists ${dbName}`);
  } finally {
    await client.end();
  }
}

/**
 * Levanta (o reutiliza) un PostgreSQL 17 y devuelve una base de test vacía.
 * El `teardown` devuelto es idempotente y seguro de llamar ante fallo.
 */
export async function startEphemeralCluster(): Promise<EphemeralCluster> {
  const external = (process.env.P3N1A0_TEST_PG_URL ?? "").trim();
  const dbName = makeTestDbName();

  // ── Sustrato 2: servidor externo (CI) ──────────────────────────────────
  if (external) {
    const base = new URL(external);
    base.pathname = "/postgres";
    const adminUrl = base.toString();
    // La guarda exige prefijo de test en el nombre de base; la URL de
    // mantenimiento apunta a `postgres`, así que se valida la URL FINAL.
    const target = new URL(external);
    target.pathname = `/${dbName}`;
    const url = target.toString();

    assertLocalTestUrl(url);
    await createDatabase(adminUrl, dbName);

    let done = false;
    return {
      url,
      adminUrl,
      dbName,
      dataDir: null,
      teardown: () => {
        if (done) return;
        done = true;
        void dropDatabase(adminUrl, dbName).catch(() => {
          /* el servidor externo no es nuestro: no escalamos el fallo */
        });
      },
    };
  }

  // ── Sustrato 1: cluster efímero propio (local) ─────────────────────────
  assertNoProductionEnv();
  assertPgBinaries();

  const baseDir = mkdtempSync(join(tmpdir(), "p3n1a0-"));
  const dataDir = join(baseDir, "pgdata");
  const port = await findFreePort();
  let started = false;

  /**
   * Detiene el postmaster y borra el directorio. NO confía en el código de
   * salida de `pg_ctl`: si el apagado ordenado falla, escala a SIGKILL sobre
   * el PID de `postmaster.pid` y verifica. Un `pg_ctl stop` cuyo resultado se
   * ignora deja procesos huérfanos con el directorio ya borrado, que es la
   * peor combinación posible.
   */
  const destroy = (): void => {
    if (started) {
      spawnSync("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"], {
        env: PG_ENV,
        encoding: "utf8",
      });
      started = false;
    }

    // Verificación independiente: ¿sigue vivo el postmaster?
    const pidFile = join(dataDir, "postmaster.pid");
    if (existsSync(pidFile)) {
      const pid = Number.parseInt(readFileSync(pidFile, "utf8").split("\n")[0] ?? "", 10);
      if (Number.isInteger(pid) && pid > 0) {
        for (const signal of ["SIGTERM", "SIGKILL"] as const) {
          if (!isAlive(pid)) break;
          try {
            process.kill(pid, signal);
          } catch {
            break; // ya no existe o no es nuestro
          }
          waitUntilGone(pid, 5000);
        }
        if (isAlive(pid)) {
          throw new Error(
            `[P3-N1A0] no se pudo eliminar el postmaster (pid ${pid}, ${dataDir}). ` +
              `Se conserva el directorio como evidencia; no se borra para no dejar ` +
              `un proceso huérfano sin sus archivos.`,
          );
        }
      }
    }

    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  };

  try {
    run(
      "initdb",
      ["-D", dataDir, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"],
      "initdb",
    );

    run(
      "pg_ctl",
      [
        "-D",
        dataDir,
        "-o",
        // Sólo loopback y sin socket Unix: el path del socket excede el límite
        // de 103 bytes de macOS cuando el directorio temporal es profundo.
        `-p ${port} -h 127.0.0.1 -c unix_socket_directories='' -c fsync=off -c full_page_writes=off`,
        "-l",
        join(baseDir, "postgres.log"),
        "-w",
        "start",
      ],
      "pg_ctl start",
    );
    started = true;

    const adminUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
    const url = `postgresql://postgres@127.0.0.1:${port}/${dbName}`;

    assertLocalTestUrl(url);
    await createDatabase(adminUrl, dbName);

    let done = false;
    return {
      url,
      adminUrl,
      dbName,
      dataDir: baseDir,
      teardown: () => {
        if (done) return;
        done = true;
        destroy();
      },
    };
  } catch (e) {
    // Teardown garantizado aunque el arranque falle a mitad de camino.
    destroy();
    throw e;
  }
}
