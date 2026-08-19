#!/usr/bin/env node
/**
 * APPENDER DETERMINISTA DEL CATÁLOGO DE LINAJE.
 *
 * `verify.mjs` falla cerrado ante una migración no catalogada, pero hasta acá
 * no existía la contraparte: el catálogo se venía completando a mano, que es
 * exactamente la vía por la que un sha256 o un `orden` quedan mal sin que nada
 * lo delate hasta la próxima corrida.
 *
 * Este generador toma el ARCHIVO EN DISCO como única fuente: calcula su sha256,
 * deriva `orden` y `ledger_version` del máximo vigente y escribe la entrada.
 * No acepta el hash por parámetro, así que no puede catalogar algo distinto de
 * lo que se va a ejecutar.
 *
 * Uso:
 *   node supabase/lineage/catalog-append.mjs \
 *     --file 0259_x.sql --estado active --provenance "repo (frente/x)" \
 *     --motivo "..." [--requires a.sql,b.sql]
 *
 * Es idempotente: si el filename ya está catalogado con el mismo sha256, no
 * escribe y sale 0. Si está catalogado con OTRO sha256, falla: reescribir una
 * migración ya catalogada es un cambio de identidad, no un append.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const CATALOGO = join(AQUI, "catalog.json");
const MIGRACIONES = join(RAIZ, "supabase", "migrations");

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

const filename = arg("--file");
const estado = arg("--estado");
const provenance = arg("--provenance");
const motivo = arg("--motivo");
const requires = (arg("--requires") || "").split(",").map((s) => s.trim()).filter(Boolean);

if (!filename || !estado || !provenance || !motivo) {
  console.error("faltan argumentos: --file --estado --provenance --motivo");
  process.exit(1);
}
if (!["active", "corrective", "superseded", "rollback"].includes(estado)) {
  console.error(`estado inválido: ${estado}`);
  process.exit(1);
}

const bytes = readFileSync(join(MIGRACIONES, filename));
const sha256 = createHash("sha256").update(bytes).digest("hex");

const catalogo = JSON.parse(readFileSync(CATALOGO, "utf8"));
const previa = catalogo.entries.find((e) => e.filename === filename);
if (previa) {
  if (previa.sha256 === sha256) {
    console.log(`ya catalogada e idéntica: ${filename}`);
    process.exit(0);
  }
  console.error(
    `${filename} ya está catalogada con otro sha256.\n` +
      `  catálogo: ${previa.sha256}\n  disco:    ${sha256}\n` +
      `Reescribir una migración catalogada es un cambio de identidad, no un append.`,
  );
  process.exit(1);
}

const maxOrden = Math.max(...catalogo.entries.map((e) => e.orden));
const maxLedger = Math.max(
  ...catalogo.entries.map((e) => Number(String(e.ledger_version).replace(/^L/, "")) || 0),
);
const orden = maxOrden + 1;
const ledger = `L${String(maxLedger + 1).padStart(5, "0")}`;

catalogo.entries.push({
  id: filename,
  filename,
  sha256,
  orden,
  requires,
  estado,
  ledger_version: ledger,
  ledger_name: filename.replace(/\.sql$/, ""),
  provenance,
  motivo,
});

const ejecutables = catalogo.entries.filter((e) => ["active", "corrective"].includes(e.estado)).length;
catalogo.ejecutables = ejecutables;
catalogo.no_ejecutables = catalogo.entries.length - ejecutables;

writeFileSync(CATALOGO, JSON.stringify(catalogo, null, 2) + "\n", "utf8");
console.log(`catalogada ${filename} · orden ${orden} · ${ledger} · sha256 ${sha256.slice(0, 16)}…`);
