#!/usr/bin/env node
/**
 * P3-MIG-LINEAGE-R2 · validador del archivo histórico 0205–0218.
 *
 * Autónomo y FAIL-CLOSED: no se conecta a producción, no lee red, no usa la
 * CLI de Supabase y no depende de dependencias del proyecto. Cualquier control
 * que no pueda evaluarse cuenta como fallo, nunca como aprobado.
 *
 *   node docs/migrations/applied-history/0205-0218/validate.mjs
 *
 * Sale 0 sólo si los doce controles pasan.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..", "..");
const MIGRATIONS_DIR = join(REPO, "supabase", "migrations");
const EXPECTED_COUNT = 14;
const FIRST_ORDINAL = 205;
const LAST_ORDINAL = 218;

/** Rutas que este archivo declara. Cualquier otra es una ruta no declarada. */
const DECLARED_NON_SQL = new Set(["MANIFEST.json", "README.md", "validate.mjs"]);

const failures = [];
const fail = (control, detalle) => failures.push(`[${control}] ${detalle}`);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// ---------------------------------------------------------------------------
// Carga del manifiesto. Sin manifiesto no hay validación posible: fail-closed.
// ---------------------------------------------------------------------------
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(HERE, "MANIFEST.json"), "utf8"));
} catch (error) {
  console.error(`FAIL · MANIFEST.json ilegible: ${error.message}`);
  process.exit(1);
}
const entries = Array.isArray(manifest?.entries) ? manifest.entries : null;
if (!entries) {
  console.error("FAIL · MANIFEST.json no declara `entries`");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1 · Exactamente catorce SQL
// ---------------------------------------------------------------------------
const onDisk = readdirSync(HERE);
const sqlFiles = onDisk.filter((f) => f.endsWith(".sql")).sort();
if (sqlFiles.length !== EXPECTED_COUNT) {
  fail("1", `se esperaban ${EXPECTED_COUNT} archivos .sql y hay ${sqlFiles.length}`);
}

// ---------------------------------------------------------------------------
// 12 · Cero rutas no declaradas
// ---------------------------------------------------------------------------
for (const name of onDisk) {
  if (name.endsWith(".sql")) continue;
  if (!DECLARED_NON_SQL.has(name)) fail("12", `ruta no declarada en el archivo histórico: ${name}`);
}

// ---------------------------------------------------------------------------
// 2 · Ordinales 0205–0218 sin huecos ni duplicados
// ---------------------------------------------------------------------------
const ordinals = entries.map((e) => e.historical_ordinal);
const ordinalSet = new Set(ordinals);
if (ordinalSet.size !== ordinals.length) fail("2", "hay ordinales duplicados");
for (let n = FIRST_ORDINAL; n <= LAST_ORDINAL; n += 1) {
  const key = String(n).padStart(4, "0");
  if (!ordinalSet.has(key)) fail("2", `falta el ordinal ${key}`);
}
for (const key of ordinalSet) {
  const n = Number(key);
  if (!Number.isInteger(n) || n < FIRST_ORDINAL || n > LAST_ORDINAL) {
    fail("2", `ordinal fuera de rango: ${key}`);
  }
}

// ---------------------------------------------------------------------------
// 3 · Catorce marcas de tiempo únicas y válidas
// ---------------------------------------------------------------------------
const stamps = entries.map((e) => e.remote_version_timestamp);
if (new Set(stamps).size !== stamps.length) fail("3", "hay marcas de tiempo duplicadas");
for (const s of stamps) {
  if (!/^\d{14}$/.test(String(s ?? ""))) { fail("3", `marca de tiempo malformada: ${s}`); continue; }
  const [y, mo, d, h, mi, sec] = [
    +s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14),
  ];
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
    && dt.getUTCHours() === h && dt.getUTCMinutes() === mi && dt.getUTCSeconds() === sec;
  if (!ok) fail("3", `marca de tiempo inexistente en el calendario: ${s}`);
}

// ---------------------------------------------------------------------------
// 8 · Cobertura 14/14 entre manifiesto y disco
// ---------------------------------------------------------------------------
const declared = new Set(entries.map((e) => e.file));
for (const f of sqlFiles) if (!declared.has(f)) fail("8", `archivo sin entrada en el manifiesto: ${f}`);
for (const f of declared) if (!sqlFiles.includes(f)) fail("8", `entrada sin archivo en disco: ${f}`);
if (entries.length !== EXPECTED_COUNT) {
  fail("8", `el manifiesto declara ${entries.length} entradas y se esperaban ${EXPECTED_COUNT}`);
}

// ---------------------------------------------------------------------------
// 4·5·6·7·10 · por entrada: hash, LF final único, cero CR, cadena de
// procedencia y ausencia de marca ejecutable
// ---------------------------------------------------------------------------
for (const e of entries) {
  const p = join(HERE, String(e.file ?? ""));
  if (!existsSync(p)) { fail("4", `no existe el archivo declarado: ${e.file}`); continue; }
  const data = readFileSync(p);

  // 4 · hash del archivo archivado
  const hFile = sha256(data);
  if (hFile !== e.archived_file_sha256) {
    fail("4", `${e.file}: sha256 del archivo ${hFile} ≠ manifiesto ${e.archived_file_sha256}`);
  }

  // 6 · cero CR
  if (data.includes(0x0d)) fail("6", `${e.file}: contiene CR`);

  // 5 · exactamente un LF final
  if (data.length === 0 || data[data.length - 1] !== 0x0a) {
    fail("5", `${e.file}: no termina en LF`);
  } else if (data.length >= 2 && data[data.length - 2] === 0x0a) {
    fail("5", `${e.file}: termina en más de un LF`);
  }

  // 7 · retirar SÓLO ese LF reproduce el sha de la sentencia aplicada
  if (data.length >= 1 && data[data.length - 1] === 0x0a) {
    const hApplied = sha256(data.subarray(0, data.length - 1));
    if (hApplied !== e.applied_statement_sha256) {
      fail("7", `${e.file}: sin el LF final da ${hApplied} ≠ aplicado ${e.applied_statement_sha256}`);
    }
    if (data.length - 1 !== e.remote_statement_bytes) {
      fail("7", `${e.file}: ${data.length - 1} bytes ≠ remoto ${e.remote_statement_bytes}`);
    }
  }
  if (data.length !== e.archived_file_bytes) {
    fail("4", `${e.file}: ${data.length} bytes ≠ manifiesto ${e.archived_file_bytes}`);
  }

  // 10 · ninguna entrada marcada como ejecutable
  if (e.executable !== false) fail("10", `${e.file}: executable no es false`);
  if (e.status !== "APPLIED_REMOTE_ARCHIVE") fail("10", `${e.file}: estado inesperado ${e.status}`);
}
if (manifest.executable !== false) fail("10", "el manifiesto no declara executable:false a nivel documento");

// ---------------------------------------------------------------------------
// 9·11 · ninguno de los catorce vive bajo supabase/migrations/, ni su marca de
// tiempo se usa allí como migración local nueva
// ---------------------------------------------------------------------------
if (existsSync(MIGRATIONS_DIR)) {
  const local = readdirSync(MIGRATIONS_DIR);
  const localSql = new Set(local.filter((f) => f.endsWith(".sql")));
  for (const e of entries) {
    if (localSql.has(e.file)) fail("9", `${e.file} reapareció bajo supabase/migrations/`);
    for (const f of localSql) {
      if (f.startsWith(String(e.remote_version_timestamp))) {
        fail("11", `la marca ${e.remote_version_timestamp} se usa como migración local: ${f}`);
      }
      if (f.startsWith(`${e.historical_ordinal}_`) && f !== e.file) {
        fail("9", `el ordinal ${e.historical_ordinal} reaparece bajo supabase/migrations/: ${f}`);
      }
    }
  }
} else {
  fail("9", "no se encontró supabase/migrations/: el control no pudo evaluarse");
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`FAIL · ${failures.length} control(es) incumplido(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(
  `PASS · 12/12 controles · ${sqlFiles.length} SQL archivados · ordinales ${
    String(FIRST_ORDINAL).padStart(4, "0")}–${String(LAST_ORDINAL).padStart(4, "0")
  } · no ejecutable · fuera de supabase/migrations/`,
);
