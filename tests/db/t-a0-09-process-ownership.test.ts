/**
 * T-A0-09 · Ownership seguro del proceso PostgreSQL (H-01).
 *
 * Demuestra que el harness NUNCA señaliza por el PID a secas. Los casos
 * peligrosos —PID obsoleto, PID reutilizado, PID de un proceso ajeno,
 * ejecutable distinto, argv sin data directory, start-time distinto— se
 * ejercitan inyectando un inspector de procesos, y el caso del proceso ajeno
 * se prueba además contra un `sleep` REAL, verificando que sobrevive intacto.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonical,
  verifyOwnership,
  type ManagedClusterIdentity,
  type ProcessSnapshot,
} from "./harness/process-identity";
import { destroyManagedCluster } from "./harness/cluster";

const created: string[] = [];
const spawned: ChildProcess[] = [];

afterEach(() => {
  for (const p of spawned.splice(0)) {
    if (p.pid && !p.killed) {
      try {
        process.kill(p.pid, "SIGKILL");
      } catch {
        /* ya terminó */
      }
    }
  }
  for (const d of created.splice(0)) {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

/** Crea un data directory sintético con su `postmaster.pid`. */
function fakeDataDir(pid: number, port: number): string {
  const base = mkdtempSync(join(tmpdir(), "p3n1a0-own-"));
  created.push(base);
  // El directorio debe existir ANTES de canonicalizar: en macOS /var es un
  // symlink a /private/var y realpathSync sólo lo resuelve si la ruta existe.
  mkdirSync(join(base, "pgdata"));
  const dataDir = canonical(join(base, "pgdata"));
  writeFileSync(
    join(dataDir, "postmaster.pid"),
    [String(pid), dataDir, "1700000000", String(port), "", "", "", "ready"].join("\n"),
  );
  return dataDir;
}

function identityFor(pid: number, dataDir: string, port: number): ManagedClusterIdentity {
  return {
    clusterId: "test-cluster",
    pid,
    dataDir,
    dataDirArg: dataDir,
    executable: "/opt/pg/bin/postgres",
    argv: `/opt/pg/bin/postgres -D ${dataDir} -p ${port}`,
    port,
    startedAt: "Sun Aug  3 15:00:00 2026",
    postmasterPid: "",
    postmasterOpts: "",
  };
}

const snapshotFor = (id: ManagedClusterIdentity): ProcessSnapshot => ({
  executable: id.executable,
  argv: id.argv,
  startedAt: id.startedAt,
});

describe("T-A0-09 · ownership del postmaster", () => {
  it("acepta el proceso administrado íntegro", () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityFor(4242, dataDir, 5599);
    expect(verifyOwnership(id, () => snapshotFor(id))).toEqual({ owned: true });
  });

  it("PID obsoleto: el proceso ya no existe ⇒ nada que señalizar", () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityFor(4242, dataDir, 5599);
    const v = verifyOwnership(id, () => null);
    expect(v.owned).toBe(false);
    expect(v.owned === false && v.processGone).toBe(true);
  });

  it("PID REUTILIZADO: start-time distinto ⇒ NO se señaliza", () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityFor(4242, dataDir, 5599);
    const v = verifyOwnership(id, () => ({
      ...snapshotFor(id),
      startedAt: "Mon Aug  4 09:00:00 2026",
    }));
    expect(v.owned).toBe(false);
    expect(v.owned === false && v.processGone).toBe(false);
    expect(v.owned === false && v.reason).toMatch(/REUTILIZADO/);
  });

  it("el proceso ya no es PostgreSQL ⇒ NO se señaliza", () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityFor(4242, dataDir, 5599);
    const v = verifyOwnership(id, () => ({ ...snapshotFor(id), executable: "/bin/sleep" }));
    expect(v.owned).toBe(false);
    expect(v.owned === false && v.reason).toMatch(/no es PostgreSQL/);
  });

  it("ejecutable PostgreSQL distinto del registrado ⇒ NO se señaliza", () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityFor(4242, dataDir, 5599);
    const v = verifyOwnership(id, () => ({ ...snapshotFor(id), executable: "/otro/bin/postgres" }));
    expect(v.owned).toBe(false);
    expect(v.owned === false && v.reason).toMatch(/ejecutable observado no coincide/);
  });

  it("argv sin el data directory ⇒ NO se señaliza", () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityFor(4242, dataDir, 5599);
    const v = verifyOwnership(id, () => ({
      ...snapshotFor(id),
      argv: "/opt/pg/bin/postgres -D /otro/lado -p 5599",
    }));
    expect(v.owned).toBe(false);
    expect(v.owned === false && v.reason).toMatch(/no referencia el data directory/);
  });

  it("argv sin el puerto administrado ⇒ NO se señaliza", () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityFor(4242, dataDir, 5599);
    const v = verifyOwnership(id, () => ({
      ...snapshotFor(id),
      argv: `/opt/pg/bin/postgres -D ${dataDir} -p 1234`,
    }));
    expect(v.owned).toBe(false);
    expect(v.owned === false && v.reason).toMatch(/no referencia el puerto/);
  });

  it("postmaster.pid describe otro PID ⇒ NO se señaliza", () => {
    const dataDir = fakeDataDir(9999, 5599);
    const id = identityFor(4242, dataDir, 5599);
    const v = verifyOwnership(id, () => snapshotFor(id));
    expect(v.owned).toBe(false);
    expect(v.owned === false && v.reason).toMatch(/postmaster.pid apunta al PID/);
  });

  it("postmaster.pid declara otro puerto ⇒ NO se señaliza", () => {
    const dataDir = fakeDataDir(4242, 7777);
    const id = identityFor(4242, dataDir, 5599);
    const v = verifyOwnership(id, () => snapshotFor(id));
    expect(v.owned).toBe(false);
    expect(v.owned === false && v.reason).toMatch(/declara el puerto/);
  });

  it("postmaster.pid desaparecido ⇒ identidad no demostrable, NO se señaliza", () => {
    const dataDir = fakeDataDir(4242, 5599);
    rmSync(join(dataDir, "postmaster.pid"));
    const id = identityFor(4242, dataDir, 5599);
    const v = verifyOwnership(id, () => snapshotFor(id));
    expect(v.owned).toBe(false);
    expect(v.owned === false && v.reason).toMatch(/postmaster.pid desapareció/);
  });

  it("PROCESO AJENO REAL: un `sleep` con el PID registrado NO recibe señal alguna", async () => {
    // Escenario de H-01: el cluster murió y el sistema recicló su PID para un
    // proceso del usuario. El harness debe abortar el teardown, no matarlo.
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    spawned.push(child);
    await new Promise((r) => setTimeout(r, 200));
    const pid = child.pid!;
    expect(pid).toBeGreaterThan(0);

    const dataDir = fakeDataDir(pid, 5599);
    const baseDir = join(dataDir, "..");
    const id = identityFor(pid, dataDir, 5599);
    // El inspector real observará un `sleep`, no un postgres.
    await expect(destroyManagedCluster(id, baseDir)).rejects.toThrow(/teardown ABORTADO/);

    // El proceso ajeno sigue vivo: no recibió ninguna señal del harness.
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(true);
    expect(child.killed).toBe(false);

    // El directorio se preserva como evidencia.
    expect(existsSync(dataDir)).toBe(true);
  });

  it("ante identidad ambigua el directorio se PRESERVA y el teardown NO informa éxito", async () => {
    const dataDir = fakeDataDir(4242, 5599);
    const baseDir = join(dataDir, "..");
    const id = identityFor(4242, dataDir, 5599);
    // Inspector que devuelve un proceso ajeno vivo con ese PID.
    const inspect = () => ({
      executable: "/usr/bin/otra-cosa",
      argv: "/usr/bin/otra-cosa",
      startedAt: id.startedAt,
    });
    await expect(destroyManagedCluster(id, baseDir, inspect)).rejects.toThrow(/teardown ABORTADO/);
    expect(existsSync(dataDir)).toBe(true);
  });

  it("PID inválido registrado ⇒ tratado como inexistente, sin señal", () => {
    const dataDir = fakeDataDir(1, 5599);
    const id = { ...identityFor(0, dataDir, 5599), pid: 0 };
    const v = verifyOwnership(id, () => {
      throw new Error("el inspector no debería invocarse");
    });
    expect(v.owned).toBe(false);
    expect(v.owned === false && v.processGone).toBe(true);
  });
});
