#!/usr/bin/env node
/**
 * WA-8R9 CLOSEOUT · HIGH-1 · corredor de los gates de la suite DB.
 *
 * ─── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *
 * El script anterior encadenaba con `&&`:
 *
 *   prepare-run && vitest && assert-clean-run && assert-no-residual-local
 *
 * Con esa forma, cualquier fallo previo SALTEA el guard de residuos. Y ése es
 * justo el momento en que más importa: una corrida que falló es la que tiene
 * más probabilidad de haber dejado un cluster vivo, una base colgada o un
 * proceso huérfano. El encadenamiento hacía que el gate de limpieza sólo se
 * ejecutara cuando ya no hacía falta.
 *
 * Acá la limpieza es INCONDICIONAL. Se ejecuta pase lo que pase, se reporta su
 * resultado por separado, y el exit code preserva el PRIMER fallo —el que
 * explica la causa— sin que el guard de residuos lo pise ni lo enmascare.
 */

import { spawnSync } from "node:child_process";

/** Una etapa del pipeline. `siempre` la vuelve incondicional. */
const ETAPAS = [
  { nombre: "prepare-run", cmd: ["node", ["tests/db/scripts/prepare-run.mjs"]] },
  { nombre: "vitest", cmd: ["npx", ["vitest", "run", "--config", "vitest.db.config.ts"]] },
  { nombre: "assert-clean-run", cmd: ["node", ["tests/db/scripts/assert-clean-run.mjs"]] },
  {
    nombre: "assert-no-residual-local",
    cmd: ["node", ["tests/db/scripts/assert-no-residual-local.mjs"]],
    // INCONDICIONAL: corre aunque una etapa anterior haya fallado.
    siempre: true,
  },
];

function correr(etapa) {
  const [bin, args] = etapa.cmd;
  const r = spawnSync(bin, args, { stdio: "inherit", shell: false });
  if (r.error) return { code: 1, motivo: r.error.message };
  return { code: r.status ?? 1, motivo: null };
}

let primerFallo = null; // { etapa, code } — se preserva y es el exit final.
const resumen = [];

for (const etapa of ETAPAS) {
  const saltear = primerFallo !== null && !etapa.siempre;
  if (saltear) {
    resumen.push(`  ${etapa.nombre}: SALTEADA (fallo previo en ${primerFallo.etapa})`);
    continue;
  }

  const { code, motivo } = correr(etapa);
  if (code === 0) {
    resumen.push(`  ${etapa.nombre}: OK`);
    continue;
  }

  resumen.push(`  ${etapa.nombre}: FALLO (exit ${code}${motivo ? ` · ${motivo}` : ""})`);
  // Sólo el PRIMER fallo define el exit code: es el que explica la causa.
  // Un guard de limpieza que falle después se reporta, pero no la reemplaza.
  if (primerFallo === null) primerFallo = { etapa: etapa.nombre, code };
}

console.log("\n[P3-N1A0 GATES] resumen de la corrida:");
for (const linea of resumen) console.log(linea);

if (primerFallo) {
  console.error(
    `\n[P3-N1A0 GATES] FALLO. Causa: ${primerFallo.etapa} (exit ${primerFallo.code}). ` +
      `El guard de residuos se ejecutó igual y su resultado figura arriba.`,
  );
  process.exit(primerFallo.code);
}

console.log("\n[P3-N1A0 GATES] PASS — suite y guard de residuos, ambos verdes.");
