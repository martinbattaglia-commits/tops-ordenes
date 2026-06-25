#!/usr/bin/env node
// Blueprint Build System — BB-3 / BB-4
// Genera el documento consolidado por concatenación de los _parts en el ORDEN CANÓNICO.
// Esta es la ÚNICA fuente del orden de ensamblado (BB-3). El consolidado es un artefacto
// generado (BB-2): NUNCA se edita a mano.
//
// Uso:
//   node tools/build.mjs           → regenera el consolidado (build)
//   node tools/build.mjs --check   → Blueprint Build Verification (BB-4): falla si el
//                                    consolidado en disco != cat(_parts) (no escribe)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');          // docs/prospeccion
const PARTS_DIR = join(ROOT, '_parts');
const OUTPUT = join(ROOT, 'PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md');

// ── Orden canónico de ensamblado (BB-3). Fuente única. ──────────────────────
export const PARTS_ORDER = [
  '00-front-matter.md',
  '05-convenciones-canonicas.md',
  '07-blueprint-build-system.md',
  '10-parte-I-estrategico.md',
  '15-event-storming.md',
  '20-parte-II-dominio.md',
  '25-hexagonal-estratificada.md',
  '30-parte-III-tecnica.md',
  '32-event-bus-operational.md',
  '33-ai-provider-manager.md',
  '34-crm-sync-engine.md',
  '35-persistencia-ddl.md',
  '36-data-governance.md',
  '40-parte-VII-enterprise.md',
  '45-security-rules.md',
  '50-parte-VI-governance.md',
  '55-adr-ledger.md',
  '60-partes-IV-V-quality-roadmap.md',
];

export function assemble() {
  const missing = PARTS_ORDER.filter((f) => !existsSync(join(PARTS_DIR, f)));
  if (missing.length) {
    throw new Error(`Faltan _parts del orden canónico: ${missing.join(', ')}`);
  }
  // Concatenación exacta (sin separadores artificiales): el consolidado es byte-equivalente
  // a unir los parts. Cada part ya empieza con su encabezado y termina con newline.
  return PARTS_ORDER.map((f) => readFileSync(join(PARTS_DIR, f), 'utf8')).join('');
}

// Solo ejecuta build/verify si se invoca directamente (no al importarse desde el linter).
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;

if (isMain) runCli();

function runCli() {
  const check = process.argv.includes('--check');

  try {
    const assembled = assemble();
  if (check) {
    if (!existsSync(OUTPUT)) {
      console.error('✗ BUILD VERIFICATION (BB-4): el consolidado no existe. Corré `node tools/build.mjs`.');
      process.exit(1);
    }
    const current = readFileSync(OUTPUT, 'utf8');
    if (current === assembled) {
      console.log(`✓ BUILD VERIFICATION (BB-4): el consolidado es EXACTAMENTE cat(_parts) (${assembled.split('\n').length} líneas, ${PARTS_ORDER.length} parts).`);
      process.exit(0);
    } else {
      // Diagnóstico: primera línea divergente
      const a = current.split('\n');
      const b = assembled.split('\n');
      let i = 0;
      while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
      console.error('✗ BUILD VERIFICATION (BB-4) FALLA: el consolidado difiere de cat(_parts).');
      console.error(`  Esto significa: el consolidado fue editado a mano (viola BB-2) o está desactualizado.`);
      console.error(`  Primera divergencia ~línea ${i + 1}:`);
      console.error(`    consolidado: ${JSON.stringify((a[i] || '(EOF)').slice(0, 120))}`);
      console.error(`    cat(_parts): ${JSON.stringify((b[i] || '(EOF)').slice(0, 120))}`);
      console.error(`  Fix: node tools/build.mjs  (regenerar desde los _parts)`);
      process.exit(1);
    }
  } else {
    writeFileSync(OUTPUT, assembled, 'utf8');
    console.log(`✓ BUILD: consolidado regenerado desde ${PARTS_ORDER.length} _parts → ${OUTPUT} (${assembled.split('\n').length} líneas).`);
    process.exit(0);
  }
  } catch (e) {
    console.error('✗ BUILD error:', e.message);
    process.exit(1);
  }
}
