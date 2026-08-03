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
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

/** Identidad sintética CON snapshots capturados del postmaster.pid del dir. */
function identityWithSnapshots(pid: number, dataDir: string, port: number): ManagedClusterIdentity {
  const id = identityFor(pid, dataDir, port);
  id.postmasterPid = readFileSync(join(dataDir, "postmaster.pid"), "utf8");
  writeFileSync(join(dataDir, "postmaster.opts"), "/opt/pg/bin/postgres\n-D\n" + dataDir + "\n");
  id.postmasterOpts = readFileSync(join(dataDir, "postmaster.opts"), "utf8");
  return id;
}

describe("T-A0-09 · ownership del postmaster", () => {
  it("acepta el proceso administrado íntegro", () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityFor(4242, dataDir, 5599);
    expect(verifyOwnership(id, () => snapshotFor(id))).toEqual({ owned: true });
  });

  // ── H-01.2 · integridad de snapshots (obligatoria en AMBOS) ─────────────

  it("acepta cuando los snapshots capturados coinciden con el archivo", () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityWithSnapshots(4242, dataDir, 5599);
    expect(verifyOwnership(id, () => snapshotFor(id))).toEqual({ owned: true });
  });

  it("snapshot de postmaster.pid ALTERADO tras la captura ⇒ rechazo", () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityWithSnapshots(4242, dataDir, 5599);
    // Se reescribe el ARCHIVO conservando pid/datadir/port (checks 1-6 pasan)
    // pero cambiando el start-epoch: sólo la comparación de snapshot (check 7)
    // puede rechazarlo. Si esa comparación se elimina, el test se pondría rojo.
    writeFileSync(
      join(dataDir, "postmaster.pid"),
      ["4242", dataDir, "9999999999", "5599", "", "", "", "ready"].join("\n"),
    );
    const v = verifyOwnership(id, () => snapshotFor(id));
    expect(v.owned).toBe(false);
    expect(v.owned === false && v.reason).toMatch(/snapshot registrado/);
  });

  it("snapshot de postmaster.opts ALTERADO tras la captura ⇒ rechazo", () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityWithSnapshots(4242, dataDir, 5599);
    // Se reescribe postmaster.opts; postmaster.pid queda intacto (checks 1-7 de
    // pid pasan). Sólo la comparación de opts puede rechazarlo.
    writeFileSync(join(dataDir, "postmaster.opts"), "/opt/pg/bin/postgres\n-D\n/otro/lugar\n");
    const v = verifyOwnership(id, () => snapshotFor(id));
    expect(v.owned).toBe(false);
    expect(v.owned === false && v.reason).toMatch(/postmaster.opts/);
  });

  it("AMBAS comparaciones son obligatorias: alterar sólo una alcanza para rechazar", () => {
    // Dos escenarios independientes, cada uno alterando UN snapshot. Que ambos
    // rechacen prueba que ninguna de las dos comparaciones es prescindible.
    const d1 = fakeDataDir(4242, 5599);
    const i1 = identityWithSnapshots(4242, d1, 5599);
    writeFileSync(join(d1, "postmaster.pid"), ["4242", d1, "1", "5599", "", "", "", "x"].join("\n"));
    expect(verifyOwnership(i1, () => snapshotFor(i1)).owned).toBe(false);

    const d2 = fakeDataDir(4242, 5599);
    const i2 = identityWithSnapshots(4242, d2, 5599);
    writeFileSync(join(d2, "postmaster.opts"), "distinto\n");
    expect(verifyOwnership(i2, () => snapshotFor(i2)).owned).toBe(false);
  });

  // ── H-01.1 · orden: ownership ANTES de pg_ctl ───────────────────────────
  //
  // Se observa el ORDEN REAL DE LLAMADAS con un spy inyectado del ejecutor de
  // pg_ctl (una de las dos opciones que la revisión admite: "observar el orden
  // real de llamadas o efectos"). No depende de un data directory sintético
  // incapaz de diferenciar los órdenes: el spy registra si pg_ctl fue invocado.
  // Corre igual en local y en CI, sin necesitar `initdb` ni un postmaster real.

  it("ownership FALLIDO ⇒ pg_ctl NUNCA se invoca (orden verificado por spy)", async () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityFor(4242, dataDir, 5599);
    // Inspector que reporta un proceso AJENO vivo con ese PID: ownership falla.
    const ajeno = () => ({ executable: "/usr/bin/impostor", argv: "/usr/bin/impostor", startedAt: id.startedAt });

    let pgCtlCalls = 0;
    const spy = () => {
      pgCtlCalls += 1;
    };

    await expect(destroyManagedCluster(id, join(dataDir, ".."), ajeno, spy)).rejects.toThrow(
      /ABORTADO antes de pg_ctl/,
    );
    // Prueba DECISIVA del orden: si el código regresara a "pg_ctl primero", el
    // spy habría contado ≥1 y esta aserción se pondría roja.
    expect(pgCtlCalls).toBe(0);
  });

  it("ownership VÁLIDO ⇒ pg_ctl se invoca exactamente una vez", async () => {
    const dataDir = fakeDataDir(4242, 5599);
    const id = identityWithSnapshots(4242, dataDir, 5599);
    // El proceso desaparece tras el pg_ctl simulado: primer verifyOwnership
    // owned=true (arranca el apagado), y las revalidaciones siguientes lo ven ido.
    let stopped = false;
    const inspect = () => (stopped ? null : snapshotFor(id));
    let pgCtlCalls = 0;
    const spy = () => {
      pgCtlCalls += 1;
      stopped = true;
    };
    await destroyManagedCluster(id, join(dataDir, ".."), inspect, spy);
    expect(pgCtlCalls).toBe(1);
    // El directorio se borró tras confirmar que el proceso se fue.
    expect(existsSync(dataDir)).toBe(false);
  });

  it("INVARIANTE DE FUENTE: destroyManagedCluster invoca pg_ctl SÓLO vía el ejecutor inyectable, y DESPUÉS del gate de ownership", () => {
    // El spy observa la vía inyectada; esta invariante cierra el hueco de una
    // regresión que llamara a pg_ctl por la vía cruda `run("pg_ctl"...)` o
    // `spawnSync(... pg_ctl ...)`, que el spy no vería. Se afirma sobre el
    // CUERPO de la función, no sobre todo el archivo.
    const src = readFileSync(resolve(__dirname, "harness", "cluster.ts"), "utf8");
    const start = src.indexOf("export async function destroyManagedCluster");
    expect(start).toBeGreaterThan(-1);
    // El cuerpo termina en la próxima declaración `export ` de nivel superior.
    const rest = src.slice(start + 40);
    const end = rest.indexOf("\nexport ");
    const body = rest.slice(0, end === -1 ? undefined : end);

    // (a) ninguna invocación directa de pg_ctl dentro del cuerpo.
    expect(body).not.toMatch(/\brun\s*\(\s*["']pg_ctl["']/);
    expect(body).not.toMatch(/spawnSync\s*\([^)]*pg_ctl/);
    // (b) la única invocación es el ejecutor inyectable.
    expect(body).toMatch(/runPgCtlStop\s*\(/);
    // (c) el gate de ownership (el throw "ABORTADO antes de pg_ctl") aparece
    //     ANTES de la invocación de pg_ctl en el texto del cuerpo.
    const gateIdx = body.indexOf("ABORTADO antes de pg_ctl");
    const pgctlIdx = body.indexOf("runPgCtlStop(");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(pgctlIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(pgctlIdx);
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
