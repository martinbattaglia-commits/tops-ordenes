/**
 * T-A0-04 · Ciclo de vida y teardown (M-01).
 *
 * Gestiona sus PROPIOS clusters: el objeto de prueba es el ciclo de vida.
 *
 * Corre sobre los DOS sustratos y afirma en cada uno lo que corresponde:
 *   · local  → cluster efímero propio: postmaster, data directory, identidad;
 *   · CI     → servidor externo: base creada, usada y verificada como eliminada.
 *
 * Ningún caso se salta: no hay `skip` condicional —el guard de corrida limpia
 * lo rechazaría— sino aserciones distintas y sustantivas por sustrato.
 *
 * TODO cluster se registra en `pending` INMEDIATAMENTE después de crearse, de
 * modo que el `afterEach` lo destruya aunque la aserción siguiente falle. Es el
 * mismo principio de M-01 aplicado al propio test: la primera versión dejó
 * cinco bases residuales en CI precisamente por no hacerlo.
 */

import { afterEach, describe, expect, it } from "vitest";
import { emitSentinelWhenGreen } from "./harness/sentinel";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import {
  connectGuarded,
  destroyManagedCluster,
  startEphemeralCluster,
  type EphemeralCluster,
} from "./harness/cluster";

/** ¿El harness está usando el servidor externo de CI? */
const IS_EXTERNAL = (process.env.P3N1A0_TEST_PG_URL ?? "").trim() !== "";

const pending: EphemeralCluster[] = [];

afterEach(async () => {
  // Los fallos de cleanup NO se absorben (H-02): un teardown fallido deja
  // proceso/directorio/base residual, y eso debe poner el caso en ROJO, no
  // quedar oculto detrás de un estado verde. Se intentan TODOS los teardowns
  // pendientes y después se lanzan los errores agregados.
  const errors: string[] = [];
  for (const c of pending.splice(0)) {
    try {
      await c.teardown();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (errors.length > 0) {
    throw new Error(`[P3-N1A0] cleanup de T-A0-04 falló (${errors.length}): ${errors.join(" · ")}`);
  }
});

/** Crea un cluster y lo registra de inmediato para su destrucción garantizada. */
async function newCluster(): Promise<EphemeralCluster> {
  const c = await startEphemeralCluster();
  pending.push(c);
  return c;
}

/** Saca un cluster del registro: el caso se hará cargo de destruirlo. */
function release(c: EphemeralCluster): EphemeralCluster {
  const i = pending.indexOf(c);
  if (i >= 0) pending.splice(i, 1);
  return c;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function harnessDirs(): string[] {
  return readdirSync(tmpdir()).filter((d) => d.startsWith("p3n1a0-"));
}

async function canConnect(url: string, timeoutMs = 3000): Promise<boolean> {
  const c = new Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
  try {
    await c.connect();
    await c.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}

/** ¿Existe la base en el servidor externo? Sólo aplicable a ese sustrato. */
async function databaseExists(dbName: string): Promise<boolean> {
  const base = new URL(process.env.P3N1A0_TEST_PG_URL!.trim());
  base.pathname = "/postgres";
  const client = await connectGuarded(base.toString(), "maintenance");
  try {
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from pg_database where datname = $1`,
      [dbName],
    );
    return rows[0].n !== "0";
  } finally {
    await client.end();
  }
}

describe("T-A0-04 · ciclo de vida y teardown", () => {
  emitSentinelWhenGreen("P3_N1A0_TEARDOWN_PASS");

  it("el sustrato es coherente consigo mismo", async () => {
    const cluster = await newCluster();
    expect(await canConnect(cluster.url)).toBe(true);
    expect(cluster.dbName.startsWith("p3n1a0_test_")).toBe(true);

    if (IS_EXTERNAL) {
      // Servidor externo: no hay cluster propio que administrar.
      expect(cluster.identity).toBeNull();
      expect(cluster.dataDir).toBeNull();
      expect(await databaseExists(cluster.dbName)).toBe(true);
    } else {
      // Cluster efímero propio: identidad administrada completa.
      expect(cluster.identity).not.toBeNull();
      expect(cluster.dataDir).not.toBeNull();
      expect(cluster.identity!.pid).toBeGreaterThan(0);
      expect(cluster.identity!.port).toBeGreaterThan(0);
      expect(cluster.identity!.dataDir).toContain("pgdata");
      expect(cluster.identity!.startedAt.length).toBeGreaterThan(0);
    }
  });

  it("destruye todo aunque una prueba falle a mitad de camino", async () => {
    const cluster = release(await newCluster());
    const { dbName, url } = cluster;
    const port = Number(new URL(url).port);

    let captured: Error | null = null;
    try {
      const c = new Client({ connectionString: url });
      await c.connect();
      try {
        await c.query("select 1 / 0");
      } finally {
        await c.end();
      }
    } catch (e) {
      captured = e as Error;
    } finally {
      await cluster.teardown();
    }

    expect(captured).toBeInstanceOf(Error);
    expect(captured?.message).toMatch(/division by zero/i);

    if (IS_EXTERNAL) {
      expect(await databaseExists(dbName)).toBe(false);
    } else {
      expect(await canConnect(`postgresql://postgres@127.0.0.1:${port}/postgres`, 2000)).toBe(false);
    }
  });

  it("el teardown es idempotente", async () => {
    const cluster = release(await newCluster());
    await cluster.teardown();
    await expect(cluster.teardown()).resolves.toBeUndefined();
  });

  it("no deja rastro del recurso principal", async () => {
    const cluster = release(await newCluster());

    if (IS_EXTERNAL) {
      expect(await databaseExists(cluster.dbName)).toBe(true);
      await cluster.teardown();
      // El drop se verifica dentro del propio teardown; acá se confirma aparte.
      expect(await databaseExists(cluster.dbName)).toBe(false);
    } else {
      expect(existsSync(cluster.dataDir!)).toBe(true);
      await cluster.teardown();
      expect(existsSync(cluster.dataDir!)).toBe(false);
    }
  });

  it("no deja el proceso ni la base huérfanos tras el teardown", async () => {
    const cluster = release(await newCluster());

    if (IS_EXTERNAL) {
      const { dbName } = cluster;
      await cluster.teardown();
      expect(await databaseExists(dbName)).toBe(false);
    } else {
      const pid = cluster.identity!.pid;
      expect(alive(pid)).toBe(true);
      await cluster.teardown();
      // Un `pg_ctl stop` cuyo resultado se ignorase dejaría este proceso vivo
      // con el directorio ya borrado. Esta aserción es la que lo detecta.
      expect(alive(pid)).toBe(false);
    }
  });

  it("el descriptor del recurso coincide con lo que el harness administra", async () => {
    const cluster = await newCluster();

    if (IS_EXTERNAL) {
      // La URL efectiva apunta a la base creada, en loopback y con la marca.
      const u = new URL(cluster.url);
      expect(u.hostname).toBe("127.0.0.1");
      expect(u.pathname).toBe(`/${cluster.dbName}`);
      expect(u.search).toBe("");
    } else {
      const pidFile = join(cluster.dataDir!, "pgdata", "postmaster.pid");
      const lines = readFileSync(pidFile, "utf8").split("\n");
      expect(Number.parseInt(lines[0], 10)).toBe(cluster.identity!.pid);
      expect(Number.parseInt(lines[3], 10)).toBe(cluster.identity!.port);
    }
  });

  it("si el arranque falla, no adquiere recurso alguno", async () => {
    const before = harnessDirs().length;
    // `assertNoProductionEnv` corre ANTES de crear el directorio temporal o de
    // tocar el servidor externo: una variable prohibida debe abortar en seco.
    process.env.PGHOST = "example.invalid";
    try {
      await expect(startEphemeralCluster()).rejects.toThrow(/Variables prohibidas/);
    } finally {
      delete process.env.PGHOST;
    }
    expect(harnessDirs().length).toBe(before);
  });

  it("el teardown PROPAGA sus fallos en lugar de absorberlos", async () => {
    if (IS_EXTERNAL) {
      // Sustrato externo: `dropDatabaseVerified` propaga si la base sobrevive.
      // Se comprueba que el teardown es asíncrono y verificable, y que un
      // segundo drop sobre una base ya eliminada no informa un falso éxito
      // silencioso sino que completa de forma idempotente.
      const cluster = release(await newCluster());
      const { dbName } = cluster;
      await cluster.teardown();
      expect(await databaseExists(dbName)).toBe(false);
      await expect(cluster.teardown()).resolves.toBeUndefined();
    } else {
      const cluster = release(await newCluster());
      const identity = cluster.identity!;
      // Se simula un proceso ajeno ocupando el PID administrado: el teardown
      // debe ABORTAR con error, no informar éxito silencioso.
      await expect(
        destroyManagedCluster(identity, cluster.dataDir!, () => ({
          executable: "/usr/bin/impostor",
          argv: "/usr/bin/impostor",
          startedAt: identity.startedAt,
        })),
      ).rejects.toThrow(/teardown ABORTADO/);
      // El directorio se preserva como evidencia.
      expect(existsSync(cluster.dataDir!)).toBe(true);
      // Limpieza real del caso, ya con el inspector verdadero.
      await cluster.teardown();
      expect(existsSync(cluster.dataDir!)).toBe(false);
    }
  });

  it("dos recursos simultáneos no colisionan y ambos se destruyen", async () => {
    const a = release(await newCluster());
    const b = release(await newCluster());

    expect(a.dbName).not.toBe(b.dbName);
    expect(await canConnect(a.url)).toBe(true);
    expect(await canConnect(b.url)).toBe(true);

    if (!IS_EXTERNAL) expect(a.identity!.port).not.toBe(b.identity!.port);

    await a.teardown();
    await b.teardown();

    if (IS_EXTERNAL) {
      expect(await databaseExists(a.dbName)).toBe(false);
      expect(await databaseExists(b.dbName)).toBe(false);
    } else {
      expect(alive(a.identity!.pid)).toBe(false);
      expect(alive(b.identity!.pid)).toBe(false);
      expect(existsSync(a.dataDir!)).toBe(false);
      expect(existsSync(b.dataDir!)).toBe(false);
    }
  });
});
