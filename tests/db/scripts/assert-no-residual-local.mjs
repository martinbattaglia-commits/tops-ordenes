/**
 * P3-N1A0 · Barrera LOCAL de residuos (H-02).
 *
 * En CI existe `assert-no-residual-databases.mjs`, pero la corrida local no
 * tenía ninguna barrera externa equivalente: un teardown fallido podía dejar
 * postmasters y directorios sin que nada lo hiciera visible fuera de los tests.
 *
 * Este script corre al final de `npm run test:db` y falla si sobrevive algún
 * proceso PostgreSQL del harness o algún directorio temporal `p3n1a0-*`.
 * Es independiente de la suite: aunque los tests pasen, un residuo pone la
 * corrida en rojo.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const problems = [];

// ── 1) procesos PostgreSQL del harness ──────────────────────────────────────
let pids = [];
try {
  const out = execFileSync("pgrep", ["-f", "p3n1a0-.*pgdata"], { encoding: "utf8" });
  pids = out.split("\n").map((l) => l.trim()).filter(Boolean);
} catch {
  // pgrep devuelve exit 1 cuando no hay coincidencias: es el caso bueno.
  pids = [];
}
if (pids.length > 0) {
  problems.push(`${pids.length} proceso(s) PostgreSQL del harness sobreviven: ${pids.join(", ")}`);
}

// ── 2) directorios temporales del harness ───────────────────────────────────
let dirs = [];
try {
  dirs = readdirSync(tmpdir()).filter((d) => d.startsWith("p3n1a0-"));
} catch {
  dirs = [];
}
// Se ignoran los que la propia suite pudo preservar deliberadamente como
// evidencia SÓLO si están vacíos de pgdata; cualquier otro es un residuo.
const leftovers = dirs.filter((d) => existsSync(join(tmpdir(), d)));
if (leftovers.length > 0) {
  problems.push(`${leftovers.length} directorio(s) temporal(es) del harness: ${leftovers.join(", ")}`);
}

if (problems.length > 0) {
  console.error("[P3-N1A0] la corrida dejó RESIDUOS locales:");
  for (const p of problems) console.error(`  · ${p}`);
  console.error(
    "Un teardown que falla en silencio deja procesos y directorios vivos: se rechaza la corrida.",
  );
  process.exit(1);
}

console.log("P3_N1A0_NO_LOCAL_RESIDUALS");
