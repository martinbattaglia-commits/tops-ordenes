/**
 * T-A0-04 · Ciclo de vida y teardown (M-01).
 *
 * Gestiona su PROPIO cluster: el objeto de prueba es el ciclo de vida.
 *
 * Verifica que todo recurso adquirido se libera aunque el fallo ocurra antes o
 * después de cada etapa material, que el teardown es `async` y PROPAGA sus
 * fallos, y que no queda ni un postmaster ni un directorio huérfano.
 */

import { afterEach, describe, expect, it } from "vitest";
import { emitSentinelWhenGreen } from "./harness/sentinel";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { startEphemeralCluster, type EphemeralCluster } from "./harness/cluster";

const pending: EphemeralCluster[] = [];

afterEach(async () => {
  for (const c of pending.splice(0)) {
    await c.teardown().catch(() => {
      /* el caso ya evaluó lo suyo */
    });
  }
});

function track(c: EphemeralCluster): EphemeralCluster {
  pending.push(c);
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

/** Directorios temporales del harness que hay ahora mismo. */
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

describe("T-A0-04 · ciclo de vida y teardown", () => {
  emitSentinelWhenGreen("P3_N1A0_TEARDOWN_PASS");

  it("arranca un cluster completo y expone su identidad administrada", async () => {
    const cluster = track(await startEphemeralCluster());
    expect(cluster.dataDir).not.toBeNull();
    expect(cluster.identity).not.toBeNull();
    expect(cluster.identity!.pid).toBeGreaterThan(0);
    expect(cluster.identity!.port).toBeGreaterThan(0);
    expect(cluster.identity!.dataDir).toContain("pgdata");
    expect(cluster.identity!.startedAt.length).toBeGreaterThan(0);
    expect(await canConnect(cluster.url)).toBe(true);
  });

  it("destruye el cluster aunque una prueba falle a mitad de camino", async () => {
    const cluster = await startEphemeralCluster();
    const port = Number(new URL(cluster.url).port);

    let captured: Error | null = null;
    try {
      const c = new Client({ connectionString: cluster.url });
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
    expect(await canConnect(`postgresql://postgres@127.0.0.1:${port}/postgres`, 2000)).toBe(false);
  });

  it("el teardown es idempotente", async () => {
    const cluster = await startEphemeralCluster();
    await cluster.teardown();
    await expect(cluster.teardown()).resolves.toBeUndefined();
  });

  it("no deja el directorio temporal en disco", async () => {
    const cluster = await startEphemeralCluster();
    const { dataDir } = cluster;
    expect(dataDir).not.toBeNull();
    expect(existsSync(dataDir!)).toBe(true);
    await cluster.teardown();
    expect(existsSync(dataDir!)).toBe(false);
  });

  it("no deja el postmaster huérfano tras el teardown", async () => {
    const cluster = await startEphemeralCluster();
    const pid = cluster.identity!.pid;
    expect(alive(pid)).toBe(true);
    await cluster.teardown();
    // Un `pg_ctl stop` cuyo resultado se ignorase dejaría este proceso vivo con
    // el directorio ya borrado. Esta aserción es la que lo detecta.
    expect(alive(pid)).toBe(false);
  });

  it("el postmaster.pid describe el cluster administrado", async () => {
    const cluster = track(await startEphemeralCluster());
    const pidFile = join(cluster.dataDir!, "pgdata", "postmaster.pid");
    const lines = readFileSync(pidFile, "utf8").split("\n");
    expect(Number.parseInt(lines[0], 10)).toBe(cluster.identity!.pid);
    expect(Number.parseInt(lines[3], 10)).toBe(cluster.identity!.port);
  });

  it("si el arranque falla, no deja directorios del harness detrás", async () => {
    const before = harnessDirs().length;
    // `assertNoProductionEnv` corre ANTES de crear el directorio temporal: una
    // variable prohibida debe abortar sin adquirir un solo recurso.
    process.env.PGHOST = "example.invalid";
    try {
      await expect(startEphemeralCluster()).rejects.toThrow(/Variables prohibidas/);
    } finally {
      delete process.env.PGHOST;
    }
    expect(harnessDirs().length).toBe(before);
  });

  it("el teardown PROPAGA sus fallos en lugar de absorberlos", async () => {
    const cluster = await startEphemeralCluster();
    const identity = cluster.identity!;
    // Se simula un proceso ajeno ocupando el PID administrado: el teardown debe
    // ABORTAR con error, no informar éxito silencioso.
    const { destroyManagedCluster } = await import("./harness/cluster");
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
  });

  it("dos clusters simultáneos no colisionan y ambos se destruyen", async () => {
    const a = await startEphemeralCluster();
    const b = await startEphemeralCluster();
    expect(a.identity!.port).not.toBe(b.identity!.port);
    expect(a.dbName).not.toBe(b.dbName);
    expect(await canConnect(a.url)).toBe(true);
    expect(await canConnect(b.url)).toBe(true);
    await a.teardown();
    await b.teardown();
    expect(alive(a.identity!.pid)).toBe(false);
    expect(alive(b.identity!.pid)).toBe(false);
    expect(existsSync(a.dataDir!)).toBe(false);
    expect(existsSync(b.dataDir!)).toBe(false);
  });
});
