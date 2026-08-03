/**
 * T-A0-04 · Teardown garantizado.
 *
 * Gestiona su PROPIO cluster (no el compartido de global-setup) porque el
 * objeto de prueba es justamente el ciclo de vida: se fuerza un error
 * controlado y se verifica que base, conexiones, procesos y directorio
 * temporal desaparecen igual.
 */

import { describe, expect, it } from "vitest";
import { emitSentinelWhenGreen } from "./harness/sentinel";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { startEphemeralCluster } from "./harness/cluster";

/** Directorio de datos del cluster, derivado de la URL de mantenimiento. */
function portOf(url: string): number {
  return Number(new URL(url).port);
}

async function canConnect(url: string, timeoutMs = 3000): Promise<boolean> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

describe("T-A0-04 · teardown", () => {
  emitSentinelWhenGreen("P3_N1A0_TEARDOWN_PASS");

  it("destruye el cluster aunque una prueba falle a mitad de camino", async () => {
    const cluster = await startEphemeralCluster();
    const port = portOf(cluster.url);

    expect(await canConnect(cluster.url)).toBe(true);

    // ── error controlado, con teardown en `finally` ──
    let captured: Error | null = null;
    try {
      const client = new Client({ connectionString: cluster.url });
      await client.connect();
      try {
        await client.query("select 1 / 0");
      } finally {
        await client.end();
      }
    } catch (e) {
      captured = e as Error;
    } finally {
      cluster.teardown();
    }

    expect(captured).toBeInstanceOf(Error);
    expect(captured?.message).toMatch(/division by zero/i);

    // El servidor ya no acepta conexiones en ese puerto.
    expect(
      await canConnect(`postgresql://postgres@127.0.0.1:${port}/postgres`, 2000),
    ).toBe(false);
  });

  it("es idempotente: llamarlo dos veces no lanza", async () => {
    const cluster = await startEphemeralCluster();
    cluster.teardown();
    expect(() => cluster.teardown()).not.toThrow();
  });

  it("no deja el directorio temporal en disco", async () => {
    const cluster = await startEphemeralCluster();
    const { dataDir } = cluster;

    // Con servidor externo (CI) no hay directorio propio que limpiar; la
    // limpieza allí es el DROP DATABASE, verificado en el propio workflow.
    if (dataDir === null) {
      cluster.teardown();
      return;
    }

    expect(existsSync(dataDir)).toBe(true);
    cluster.teardown();
    expect(existsSync(dataDir)).toBe(false);
  });

  it("no deja el postmaster huérfano tras el teardown", async () => {
    const cluster = await startEphemeralCluster();
    const { dataDir } = cluster;
    if (dataDir === null) {
      cluster.teardown();
      return;
    }

    // PID del postmaster, leído antes de destruir.
    const pidFile = join(dataDir, "pgdata", "postmaster.pid");
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number.parseInt(readFileSync(pidFile, "utf8").split("\n")[0], 10);
    expect(Number.isInteger(pid)).toBe(true);

    const alive = (p: number): boolean => {
      try {
        process.kill(p, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(alive(pid)).toBe(true);

    cluster.teardown();

    // Un `pg_ctl stop` cuyo resultado se ignora dejaría este proceso vivo con
    // su directorio ya borrado. Esta aserción es la que lo detecta.
    expect(alive(pid)).toBe(false);
  });

});
