#!/usr/bin/env node
// Blueprint CI Pipeline — BB-6.
// Ejecuta los pasos DETERMINÍSTICOS del pipeline (1-4) y reporta el estado para los
// pasos SEMÁNTICOS (5-6, ejecutados por el panel ARB / workflow de validación).
//
// Uso: node tools/blueprint-ci.mjs
//   (no escribe el consolidado; sólo verifica. Para regenerar: node tools/build.mjs)

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const run = (script, args = []) =>
  spawnSync(process.execPath, [join(__dirname, script), ...args], { encoding: 'utf8' });

const steps = [
  { n: 1, name: 'Build Verification (BB-4)', script: 'build.mjs', args: ['--check'] },
  { n: 2, name: 'Blueprint Linter + Cross-Reference (BB-5)', script: 'blueprint-lint.mjs', args: [] },
];

console.log('═══ Blueprint CI Pipeline (BB-6) — pasos determinísticos ═══\n');
let allOk = true;
for (const s of steps) {
  const r = run(s.script, s.args);
  const ok = r.status === 0;
  allOk = allOk && ok;
  console.log(`[${s.n}] ${s.name}: ${ok ? '✓ PASS' : '✗ FAIL'}`);
  if (r.stdout) console.log(r.stdout.split('\n').map((l) => '    ' + l).join('\n'));
  if (!ok && r.stderr) console.log(r.stderr.split('\n').map((l) => '    ' + l).join('\n'));
}

console.log('\n═══ Pasos semánticos (panel ARB / workflow) ═══');
console.log('[3] Consistency Matrix (18 relaciones) ........ ver BLUEPRINT-CONSISTENCY-REPORT-*.md');
console.log('[4] Cross-Reference Validation ................ cubierto determinísticamente por [2] (linter)');
console.log('[5] Architecture Consistency Index (≥95/100) .. ver BLUEPRINT-CONSISTENCY-REPORT-*.md');

console.log(`\n${allOk ? '✓ CI determinístico OK' : '✗ CI determinístico FALLA'} — una versión oficial requiere además Matrix + Index ≥95 (pasos 5-6).`);
process.exit(allOk ? 0 : 1);
