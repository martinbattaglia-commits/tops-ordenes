/**
 * P3-N1A0 · Identidad administrada de un proceso PostgreSQL.
 *
 * Corrige H-01: la versión anterior leía el PID de `postmaster.pid` y le
 * enviaba señales sin más. Si el cluster ya había muerto y el sistema había
 * reciclado ese PID, el harness podía matar un proceso ajeno del usuario.
 *
 * Regla: PROHIBIDO señalizar sólo por el PID. Antes de cada señal se revalida
 * la pertenencia completa contra la identidad registrada al arrancar. Ante
 * cualquier discrepancia, ambigüedad o dato no disponible: NO se señaliza, se
 * preserva el directorio como evidencia y se devuelve error explícito.
 *
 * El módulo es puro respecto del sistema salvo por `inspectProcess`, que se
 * inyecta para poder ejercitar PID obsoletos, reutilizados y ajenos en tests.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { realpathSync } from "node:fs";
import { join } from "node:path";

/** Instantánea observable de un proceso del sistema. */
export interface ProcessSnapshot {
  /** Ruta del ejecutable (`ps -o comm=`). */
  executable: string;
  /** Línea de comando completa (`ps -o args=`). */
  argv: string;
  /** Momento de inicio (`ps -o lstart=`). Distingue PIDs reutilizados. */
  startedAt: string;
}

/** Identidad registrada al arrancar el cluster. Es la única autoridad. */
export interface ManagedClusterIdentity {
  /** Identificador aleatorio del cluster administrado por esta corrida. */
  clusterId: string;
  pid: number;
  /** Data directory canónico (realpath), para comparar postmaster.pid. */
  dataDir: string;
  /** Valor EXACTO pasado como `-D` a postgres, tal como aparece en argv. */
  dataDirArg: string;
  /** Ejecutable canónico de PostgreSQL. */
  executable: string;
  argv: string;
  port: number;
  startedAt: string;
  /** Contenido de `postmaster.pid` al arrancar. */
  postmasterPid: string;
  /** Contenido de `postmaster.opts` al arrancar. */
  postmasterOpts: string;
}

export type OwnershipVerdict =
  | { owned: true }
  | {
      owned: false;
      /** `true` cuando el proceso ya no existe: no hay nada que señalizar. */
      processGone: boolean;
      reason: string;
    };

/** Inspector real del sistema. Devuelve `null` si el PID no existe. */
export function inspectProcess(pid: number): ProcessSnapshot | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;

  const field = (fmt: string): string | null => {
    const r = spawnSync("ps", ["-p", String(pid), "-o", fmt], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (r.status !== 0 || r.error) return null;
    const out = (r.stdout ?? "").trim();
    return out === "" ? null : out;
  };

  const executable = field("comm=");
  const argv = field("args=");
  const startedAt = field("lstart=");
  if (executable === null || argv === null || startedAt === null) return null;

  return { executable, argv, startedAt };
}

export type ProcessInspector = (pid: number) => ProcessSnapshot | null;

/**
 * Revalida que el proceso siga siendo EXACTAMENTE el cluster administrado.
 *
 * Devuelve `owned:false` con `processGone:true` cuando el proceso desapareció
 * —caso benigno, no hay que señalizar— y `processGone:false` cuando existe
 * pero NO es nuestro, que es el caso peligroso.
 */
export function verifyOwnership(
  identity: ManagedClusterIdentity,
  inspect: ProcessInspector = inspectProcess,
): OwnershipVerdict {
  if (!Number.isInteger(identity.pid) || identity.pid <= 0) {
    return { owned: false, processGone: true, reason: "PID registrado inválido." };
  }

  const snap = inspect(identity.pid);
  if (snap === null) {
    return {
      owned: false,
      processGone: true,
      reason: `el proceso ${identity.pid} ya no existe.`,
    };
  }

  // 1) start-time: descarta reutilización de PID.
  if (snap.startedAt !== identity.startedAt) {
    return {
      owned: false,
      processGone: false,
      reason:
        `el PID ${identity.pid} fue REUTILIZADO: start-time observado ` +
        `"${snap.startedAt}" ≠ registrado "${identity.startedAt}".`,
    };
  }

  // 2) el proceso sigue siendo PostgreSQL.
  if (!/(^|\/)postgres$/.test(snap.executable.trim())) {
    return {
      owned: false,
      processGone: false,
      reason: `el proceso ${identity.pid} no es PostgreSQL (comm="${snap.executable}").`,
    };
  }

  // 3) el ejecutable es el mismo que arrancamos.
  if (snap.executable.trim() !== identity.executable.trim()) {
    return {
      owned: false,
      processGone: false,
      reason:
        `el ejecutable observado no coincide con el registrado ` +
        `("${snap.executable}" ≠ "${identity.executable}").`,
    };
  }

  // 4) argv referencia EXACTAMENTE el data directory tal como se pasó a
  //    postgres. Se compara contra el valor `-D` crudo (dataDirArg): en macOS
  //    la forma canónica (/private/var/…) difiere de la que ve argv (/var/…).
  if (
    !snap.argv.includes(identity.dataDirArg) &&
    !snap.argv.includes(identity.dataDir)
  ) {
    return {
      owned: false,
      processGone: false,
      reason: `argv del PID ${identity.pid} no referencia el data directory administrado.`,
    };
  }

  // 5) argv referencia nuestro puerto.
  if (!new RegExp(`-p\\s*${identity.port}(\\s|$)`).test(snap.argv)) {
    return {
      owned: false,
      processGone: false,
      reason: `argv del PID ${identity.pid} no referencia el puerto ${identity.port}.`,
    };
  }

  // 6) `postmaster.pid` sigue describiendo el mismo cluster.
  const pidFile = join(identity.dataDir, "postmaster.pid");
  if (!existsSync(pidFile)) {
    return {
      owned: false,
      processGone: false,
      reason: "postmaster.pid desapareció: la pertenencia no puede demostrarse.",
    };
  }
  let lines: string[];
  try {
    lines = readFileSync(pidFile, "utf8").split("\n");
  } catch {
    return {
      owned: false,
      processGone: false,
      reason: "postmaster.pid no se puede leer: la pertenencia no puede demostrarse.",
    };
  }
  const filePid = Number.parseInt((lines[0] ?? "").trim(), 10);
  const fileDataDir = (lines[1] ?? "").trim();
  const fileStartEpoch = (lines[2] ?? "").trim();
  const filePort = Number.parseInt((lines[3] ?? "").trim(), 10);

  if (filePid !== identity.pid) {
    return {
      owned: false,
      processGone: false,
      reason: `postmaster.pid apunta al PID ${filePid}, no al administrado ${identity.pid}.`,
    };
  }
  if (canonical(fileDataDir) !== identity.dataDir) {
    return {
      owned: false,
      processGone: false,
      reason: "postmaster.pid describe otro data directory.",
    };
  }
  if (filePort !== identity.port) {
    return {
      owned: false,
      processGone: false,
      reason: `postmaster.pid declara el puerto ${filePort}, no el administrado ${identity.port}.`,
    };
  }

  // 7) los SNAPSHOTS registrados al arrancar siguen describiendo este cluster.
  //    La revisión C4 señaló que se guardaban sin compararse jamás. Se comparan
  //    las líneas estables de postmaster.pid (pid, datadir, start-epoch, port —
  //    la línea de estado "ready" puede cambiar legítimamente) y postmaster.opts
  //    completo, que es inmutable durante la vida del proceso.
  if (identity.postmasterPid !== "") {
    const snapLines = identity.postmasterPid.split("\n");
    const snapStable = [snapLines[0], snapLines[1], snapLines[2], snapLines[3]]
      .map((l) => (l ?? "").trim())
      .join("|");
    const fileStable = [String(filePid), fileDataDir, fileStartEpoch, String(filePort)].join("|");
    if (snapStable !== fileStable) {
      return {
        owned: false,
        processGone: false,
        reason:
          "postmaster.pid difiere del snapshot registrado al arrancar " +
          "(pid/datadir/start-epoch/port): el archivo fue reescrito por otro cluster.",
      };
    }
  }
  const optsFile = join(identity.dataDir, "postmaster.opts");
  if (identity.postmasterOpts !== "") {
    let currentOpts = "";
    try {
      currentOpts = existsSync(optsFile) ? readFileSync(optsFile, "utf8") : "";
    } catch {
      currentOpts = "";
    }
    if (currentOpts !== identity.postmasterOpts) {
      return {
        owned: false,
        processGone: false,
        reason: "postmaster.opts difiere del snapshot registrado: otro arranque reescribió el cluster.",
      };
    }
  }

  return { owned: true };
}

/** realpath tolerante: devuelve la ruta original si aún no existe. */
export function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
