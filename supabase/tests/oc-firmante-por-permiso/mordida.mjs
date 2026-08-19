#!/usr/bin/env node
/**
 * OC-FIRMANTE-POR-PERMISO · ¿MUERDEN LOS GUARDAS? contra PostgreSQL real.
 *
 * El par rojo→verde prueba que la migración hace lo que dice cuando todo está
 * bien. Esta prueba hace lo contrario: rompe a propósito, de a una, cada
 * condición que los guardas de 0259 dicen proteger, y exige que la transacción
 * ABORTE con el error correspondiente. Un guarda que nunca rechaza no protege
 * nada, y una post-condición que jamás se activa es decoración.
 *
 * Las mutaciones se aplican sobre el TEXTO REAL de la migración, extraído del
 * archivo en disco. No hay una copia del SQL acá.
 *
 * Uso:  node supabase/tests/oc-firmante-por-permiso/mordida.mjs --socket /tmp/ocfp --port 55432
 * Exit: 0 si los seis guardas muerden y el texto íntegro aplica limpio.
 */

import { join } from "node:path";
import { AQUI_TESTS, SEMILLA, psql, psqlFile, extraerDatos, CARGO_CYNTHIA } from "./comun.mjs";

const { sql: bloques } = extraerDatos();

/** Deja la base en el estado PREVIO de producción antes de cada mutación. */
function limpiar() {
  const r = psql("drop schema if exists auth cascade; drop schema if exists public cascade; create schema public;", { tuplesOnly: false });
  if (!r.ok) throw new Error(`no se pudo limpiar el esquema:\n${r.err}`);
  psqlFile(join(AQUI_TESTS, "fixture.sql"));
  const s = psql(SEMILLA, { tuplesOnly: false });
  if (!s.ok) throw new Error(`semilla falló:\n${s.err}`);
}

/** Sustituye un fragmento EXACTO y verifica que la mutación tuvo efecto. */
function mutar(sql, de, a) {
  if (!sql.includes(de)) throw new Error(`la mutación no encontró su ancla: «${de.slice(0, 60)}…»`);
  return sql.replace(de, a);
}

const CASOS = [
  {
    // Dirección tiene DOS cuentas y las dos firman: es el caso que más fácil se
    // pierde de vista, porque «una persona» y «una cuenta» se confunden.
    id: "M-1",
    que: "el padrón muerde si se pierde la segunda cuenta de Dirección",
    sql: () => mutar(bloques,
      "('1f39803f-d602-4a89-90b1-72ea5d3b69e1'::uuid, 'martin@logisticatops.com'),\n        ", ""),
    espera: "OC_FIRMANTE_PADRON_INESPERADO",
  },
  {
    id: "M-2",
    que: "el padrón muerde si falta una de las cuatro cuentas",
    sql: () => mutar(bloques,
      "('4aa1203d-a943-4ef0-b1c5-3127fde3adfb'::uuid, 'cynthia@logisticatops.com')",
      "('00000000-0000-4000-8000-000000000000'::uuid, 'nadie@logisticatops.com')"),
    espera: "OC_FIRMANTE_PADRON_INESPERADO",
  },
  {
    id: "M-3",
    que: "el padrón muerde si se cuela una cuenta de más",
    sql: () => mutar(bloques,
      "('4aa1203d-a943-4ef0-b1c5-3127fde3adfb'::uuid, 'cynthia@logisticatops.com')",
      "('4aa1203d-a943-4ef0-b1c5-3127fde3adfb'::uuid, 'cynthia@logisticatops.com'),\n        ('98acb5c2-5666-4539-991e-8a778cfecda2'::uuid, 'mariela@sullivancamejo.com.ar')"),
    espera: "OC_FIRMANTE_PADRON_INESPERADO",
  },
  {
    id: "M-4",
    que: "la revocación muerde si un rol conserva compras.sign",
    sql: () => mutar(bloques,
      "  and r.slug <> 'firmante_oc';",
      "  and r.slug not in ('firmante_oc','director_ops');"),
    espera: "OC_FIRMANTE_REVOCACION_INCOMPLETA",
  },
  {
    id: "M-5",
    que: "el cargo muerde si el UUID de destino no matchea nada (HIGH-2)",
    sql: () => mutar(bloques,
      "'7a9ecbdc-3ff0-459e-b340-8a07eed898fa'::uuid\n     and lower",
      "'ffffffff-0000-4000-8000-000000000000'::uuid\n     and lower"),
    espera: "OC_FIRMANTE_CARGO_SIN_DESTINO",
  },
  {
    id: "M-6",
    que: "la doble llave UUID+email rechaza un correo reasignado a otra persona",
    sql: () => mutar(bloques,
      "('3b1607c9-32c5-4ca0-91e1-19c82099b64d'::uuid, 'joseluis@logisticatops.com')",
      "('3b1607c9-32c5-4ca0-91e1-19c82099b64d'::uuid, 'otro@logisticatops.com')"),
    espera: "OC_FIRMANTE_PADRON_INESPERADO",
  },
  {
    // El cargo de cada firmante viene por escrito de Dirección y el certificado
    // lo imprime. Si el UPDATE no encuentra a quién aplicarlo, la migración no
    // puede reportar éxito dejando a una firmante autorizada sin cargo.
    id: "M-7",
    que: "el cargo de Cynthia muerde si no encuentra su fila (HIGH-2)",
    sql: () => mutar(bloques,
      "and r.slug = 'admin_sin_rrhh'\n     and u.id = '4aa1203d-a943-4ef0-b1c5-3127fde3adfb'::uuid",
      "and r.slug = 'gerencia_comercial'\n     and u.id = '4aa1203d-a943-4ef0-b1c5-3127fde3adfb'::uuid"),
    espera: "OC_FIRMANTE_CARGO_SIN_DESTINO",
  },
];

console.log("\n══ ¿MUERDEN LOS GUARDAS? · OC-FIRMANTE-POR-PERMISO ═══════════════════════\n");

const fallas = [];
for (const c of CASOS) {
  limpiar();
  const r = psql(c.sql(), { tuplesOnly: false });
  if (r.ok) {
    fallas.push(`${c.id}: NO abortó · ${c.que}`);
    console.log(`${c.id} ✗ no abortó · ${c.que}`);
  } else if (!r.err.includes(c.espera)) {
    fallas.push(`${c.id}: abortó con otro error → ${r.err.split("\n")[0]}`);
    console.log(`${c.id} ✗ abortó con otro error · ${c.que}`);
  } else {
    console.log(`${c.id} ✓ ${c.que}`);
  }
}

// El control: sin romper nada, los bloques aplican limpio. Sin esto, una
// mutación podría estar "mordiendo" por un error de sintaxis y no por el guarda.
limpiar();
const control = psql(bloques, { tuplesOnly: false });
if (!control.ok) {
  fallas.push(`M-0: el texto sin mutar NO aplica → ${control.err.split("\n")[0]}`);
  console.log("M-0 ✗ el texto sin mutar no aplica");
} else {
  console.log(`M-0 ✓ sin romper nada, los bloques aplican limpio (Cynthia con «${CARGO_CYNTHIA}»)`);
}

if (fallas.length) {
  console.error("\nMORDIDA: FAIL\n  - " + fallas.join("\n  - "));
  process.exit(1);
}
console.log(`\nMORDIDA: PASS · ${CASOS.length + 1}/${CASOS.length + 1} guardas`);
