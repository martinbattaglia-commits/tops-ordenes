/**
 * P3-N1A0 · Acepta la corrida sólo si está LIMPIA, es FRESCA y cubre el
 * UNIVERSO EXACTO (H-04).
 *
 * La revisión C4 mostró que la versión anterior aceptaba:
 *   · un subconjunto de archivos (sólo exigía total > 0), y
 *   · un reporte JSON obsoleto reutilizado de otra corrida.
 *
 * Correcciones:
 *   1. el reporte se BORRA antes de correr (prepare-run.mjs): si Vitest no
 *      ejecuta, no hay reporte y este script falla;
 *   2. el reporte debe ser POSTERIOR al stamp de arranque (frescura);
 *   3. deben estar EXACTAMENTE los archivos y el total esperados;
 *   4. cero casos no aprobados (fail/skip/todo/pending/desconocido).
 *
 * Corre DESPUÉS de Vitest y sólo si Vitest pasó (`&&`): el exit code de Vitest
 * manda primero. No hay grep de por medio; se lee el reporte JSON estructurado.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { REPORT_PATH, STAMP_PATH } from "./report-path.mjs";
import { EXPECTED_TEST_FILES, EXPECTED_TOTAL_TESTS } from "./expected-suite.mjs";

const NON_PASSING = new Set(["failed", "pending", "skipped", "todo", "disabled"]);
const fail = (msg) => {
  console.error(`[P3-N1A0] ${msg}`);
  process.exit(1);
};

// ── 1) el reporte existe (si Vitest no corrió, prepare-run lo borró) ────────
if (!existsSync(REPORT_PATH)) {
  fail(`no se encontró el reporte en ${REPORT_PATH}. ¿Corrió Vitest tras prepare-run?`);
}
if (!existsSync(STAMP_PATH)) {
  fail(`no se encontró el stamp de arranque en ${STAMP_PATH}. Ejecutá prepare-run primero.`);
}

let report;
let stamp;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
  stamp = JSON.parse(readFileSync(STAMP_PATH, "utf8"));
} catch (e) {
  fail(`reporte o stamp no son JSON válido: ${e.message}`);
}

// ── 2) frescura: el reporte debe ser POSTERIOR al stamp ─────────────────────
const reportMtime = statSync(REPORT_PATH).mtimeMs;
if (reportMtime < stamp.t0) {
  fail(
    `el reporte (mtime ${new Date(reportMtime).toISOString()}) es ANTERIOR al arranque ` +
      `de esta corrida (${new Date(stamp.t0).toISOString()}): reporte obsoleto, rechazado.`,
  );
}
if (typeof report.startTime === "number" && report.startTime < stamp.t0 - 1000) {
  fail(
    `el startTime del reporte es anterior al arranque de esta corrida: reporte obsoleto, rechazado.`,
  );
}

// ── 3) universo exacto: archivos y total ────────────────────────────────────
const results = Array.isArray(report.testResults) ? report.testResults : [];
const files = results
  .map((r) => basename(String(r.name ?? "")))
  .filter(Boolean)
  .sort();
const expected = [...EXPECTED_TEST_FILES].sort();

const missing = expected.filter((f) => !files.includes(f));
const extra = files.filter((f) => !expected.includes(f));
if (missing.length > 0 || extra.length > 0) {
  fail(
    `el universo de la corrida no es el esperado.\n` +
      (missing.length ? `  faltaron: ${missing.join(", ")}\n` : "") +
      (extra.length ? `  sobraron: ${extra.join(", ")}\n` : "") +
      `Se exige exactamente ${expected.length} archivos.`,
  );
}

// ── 4) cero casos no aprobados ──────────────────────────────────────────────
const problems = [];
let total = 0;
for (const file of results) {
  for (const a of file.assertionResults ?? []) {
    total += 1;
    const status = String(a.status ?? "unknown");
    if (status !== "passed") {
      problems.push(`${a.fullName ?? a.title ?? "<sin nombre>"} [${status}]`);
    }
  }
}

if (EXPECTED_TOTAL_TESTS > 0 && total !== EXPECTED_TOTAL_TESTS) {
  fail(`la corrida ejecutó ${total} casos; se esperan exactamente ${EXPECTED_TOTAL_TESTS}.`);
}
if (total === 0) fail("la corrida no ejecutó ningún caso.");
if (problems.length > 0) {
  console.error(`[P3-N1A0] la corrida NO está limpia (${problems.length} problema/s):`);
  for (const p of problems) console.error(`  · ${p}`);
  console.error("Un caso silenciado deja CI en verde sin haber probado nada: se rechaza.");
  process.exit(1);
}

console.log(
  `P3_N1A0_CLEAN_RUN (${total} casos en ${files.length} archivos, todos aprobados, reporte fresco)`,
);
