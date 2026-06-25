#!/usr/bin/env node
// DoD-11 · Import Boundaries (Regla de Dependencia) para el bounded context `prospeccion`.
// Enforcement DETERMINÍSTICO sin dependencias externas. Un import violatorio = error (exit 1).
//
// Equivalente funcional de eslint-plugin-boundaries (CS-BOUNDARY-1). Cuando se pueda `npm i`,
// se migra a eslint-plugin-boundaries con las mismas zonas; este script queda como red de
// seguridad zero-dep en CI. Uso: `node scripts/prospeccion-boundaries.mjs` (npm run lint:boundaries).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/lib/prospeccion";

// Por capa (según el path del archivo), patrones de import PROHIBIDOS (regex sobre el specifier).
const RULES = {
  domain: [/(^|\/)adapters\//, /(^|\/)application\//, /(^|\/)ports\//, /(^|\/)read\//, /@supabase/, /^next(\/|$)/, /@\/lib\/supabase/, /@\/lib\//],
  ports: [/(^|\/)adapters\//, /(^|\/)application\//, /(^|\/)read\//, /@supabase/, /^next(\/|$)/, /@\/lib\/supabase/],
  application: [/(^|\/)adapters\//, /(^|\/)read\//, /@supabase/, /^next(\/|$)/, /@\/lib\/supabase/],
};
// adapters/** y read/** son la capa de infraestructura/edge: sin restricción.

function layerOf(path) {
  if (path.includes(`${ROOT}/domain/`)) return "domain";
  if (path.includes(`${ROOT}/ports/`)) return "ports";
  if (path.includes(`${ROOT}/application/`)) return "application";
  return null; // adapters/read/otros: sin restricción
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const importRe = /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const violations = [];
let scanned = 0;

for (const file of walk(ROOT)) {
  const layer = layerOf(file);
  if (!layer) continue;
  scanned++;
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(importRe)) {
    const spec = m[1];
    for (const re of RULES[layer]) {
      // Excepción: domain puede importar OTROS módulos de su propio dominio vía rutas relativas
      // (./ ../) que NO crucen a adapters/ports/read; el patrón @/lib/ sólo aplica a imports absolutos.
      if (re.test(spec)) {
        // permitir imports relativos internos del propio dominio (no marcados por los patrones de capa)
        violations.push({ file, layer, spec, rule: re.toString() });
        break;
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`✓ Import Boundaries (DoD-11): ${scanned} archivos de domain/ports/application sin violaciones de la Regla de Dependencia.`);
  process.exit(0);
} else {
  console.error(`✗ Import Boundaries (DoD-11): ${violations.length} violación(es) de la Regla de Dependencia:`);
  for (const v of violations) console.error(`  [${v.layer}] ${v.file}\n      importa "${v.spec}"  (prohibido: ${v.rule})`);
  process.exit(1);
}
