/**
 * P3-N1A0 · Inspección FAIL-CLOSED de residuos (H-03).
 *
 * La versión anterior degradaba a "cero coincidencias" cualquier error del
 * inspector: `catch { pids = [] }` trataba un `pgrep` ausente, un error de
 * permisos o una salida inesperada como "limpio". Eso es fail-OPEN.
 *
 * Regla: SÓLO "inspección completada con cero coincidencias" es limpio.
 * Cualquier otra cosa —inspector no disponible, permisos, error operativo,
 * estado inesperado— produce un veredicto de FALLO. Las excepciones nunca se
 * convierten en arrays vacíos.
 *
 * Este módulo es la lógica pura y testeable; los scripts que corren en CI/local
 * la invocan y traducen el veredicto a exit code.
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

/**
 * @typedef {{ status: "clean", matches: string[] }
 *          | { status: "dirty", matches: string[] }
 *          | { status: "error", reason: string }} InspectResult
 */

/**
 * Inspecciona procesos del harness con `pgrep`. Distingue explícitamente:
 *   · exit 0  → hubo coincidencias (dirty);
 *   · exit 1  → pgrep corrió y NO hubo coincidencias (clean);
 *   · ENOENT / spawn error → inspector no disponible (error);
 *   · exit >1 → error operativo de pgrep (error);
 *   · cualquier otro estado → error.
 *
 * @param {(cmd:string,args:string[])=>import("node:child_process").SpawnSyncReturns<string>} [runner]
 * @returns {InspectResult}
 */
export function inspectProcesses(runner) {
  const run = runner ?? ((cmd, args) => spawnSync(cmd, args, { encoding: "utf8" }));
  const r = run("pgrep", ["-f", "p3n1a0-.*pgdata"]);

  if (r.error) {
    const code = /** @type {NodeJS.ErrnoException} */ (r.error).code ?? "spawn-error";
    return { status: "error", reason: `inspector de procesos no disponible (${code})` };
  }
  if (typeof r.status !== "number") {
    return { status: "error", reason: `pgrep terminó sin exit code (signal ${String(r.signal)})` };
  }
  if (r.status === 0) {
    const matches = String(r.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    // exit 0 pero sin líneas sería un estado inesperado.
    if (matches.length === 0) {
      return { status: "error", reason: "pgrep devolvió exit 0 sin coincidencias (estado inesperado)" };
    }
    return { status: "dirty", matches };
  }
  if (r.status === 1) {
    return { status: "clean", matches: [] };
  }
  return {
    status: "error",
    reason: `pgrep terminó con exit ${r.status} (error operativo): ${String(r.stderr ?? "").trim().slice(0, 200)}`,
  };
}

/**
 * Inspecciona directorios temporales del harness. Mismo criterio fail-closed.
 * Un `ENOENT` del propio tmpdir se trata como error, no como ausencia: el
 * directorio temporal del sistema siempre debe existir.
 *
 * @param {string} tmp
 * @param {(dir:string)=>string[]} [readdir]
 * @returns {InspectResult}
 */
export function inspectDirectories(tmp, readdir) {
  const read = readdir ?? ((d) => readdirSync(d));
  let entries;
  try {
    entries = read(tmp);
  } catch (e) {
    const code = /** @type {NodeJS.ErrnoException} */ (e).code ?? "read-error";
    return { status: "error", reason: `no se pudo leer el tmpdir "${tmp}" (${code})` };
  }
  if (!Array.isArray(entries)) {
    return { status: "error", reason: "la lectura de directorios devolvió un valor inesperado" };
  }
  const matches = entries.filter((d) => typeof d === "string" && d.startsWith("p3n1a0-"));
  return matches.length > 0 ? { status: "dirty", matches } : { status: "clean", matches: [] };
}

/**
 * Combina ambas inspecciones en un veredicto único. Sólo es limpio si AMBAS
 * completaron con cero coincidencias.
 *
 * @param {InspectResult} procs
 * @param {InspectResult} dirs
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function residualVerdict(procs, dirs) {
  const problems = [];
  if (procs.status === "error") problems.push(`procesos: ${procs.reason}`);
  else if (procs.status === "dirty") problems.push(`procesos residuales: ${procs.matches.join(", ")}`);

  if (dirs.status === "error") problems.push(`directorios: ${dirs.reason}`);
  else if (dirs.status === "dirty") problems.push(`directorios residuales: ${dirs.matches.join(", ")}`);

  return { ok: problems.length === 0, problems };
}
