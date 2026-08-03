/**
 * P3-N1A0 · Carga determinista del esquema WMS y BARRERA de objetos requeridos.
 *
 * Secuencia obligatoria (§10). Ninguna suite funcional corre si alguna etapa
 * previa falla, porque estaría midiendo un esquema incompleto:
 *
 *   1. validación del manifiesto  (§11)
 *   2. guarda de versión          (M-03)
 *   3. bootstrap exclusivo de tests
 *   4. migraciones productivas del manifiesto
 *   5. validación de REQUIRED_OBJECTS
 *   6. recién entonces: habilitación de las suites
 *
 * Ningún error se silencia: el primer fallo aborta identificando archivo,
 * etapa y causa concreta de PostgreSQL (código SQLSTATE incluido), para que
 * T-A0-05 pueda afirmar la causa y no conformarse con "algo falló".
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Client } from "pg";
import {
  REQUIRED_OBJECTS,
  WMS_MIGRATION_MANIFEST,
  MIGRATIONS_DIR,
  validateManifest,
} from "./manifest";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const BOOTSTRAP_DIR = join(REPO_ROOT, "tests", "db", "bootstrap");

export interface LoadResult {
  bootstrapFiles: string[];
  migrationsApplied: string[];
}

export class SchemaLoadError extends Error {
  constructor(
    readonly file: string,
    readonly kind: "bootstrap" | "migration",
    /** SQLSTATE de PostgreSQL, si lo hubo. */
    readonly pgCode: string | null,
    /** Mensaje original de PostgreSQL. */
    readonly pgMessage: string,
  ) {
    super(
      `[P3-N1A0] fallo al aplicar ${kind} "${file}".\n` +
        `El harness NO silencia errores de migración.\n` +
        `SQLSTATE: ${pgCode ?? "n/d"}\n` +
        `Detalle de PostgreSQL: ${pgMessage}`,
    );
    this.name = "SchemaLoadError";
  }
}

export class RequiredObjectsError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(
      `[P3-N1A0] el esquema cargado NO contiene objetos requeridos:\n` +
        missing.map((m) => `  · ${m}`).join("\n") +
        `\nSe aborta el global setup: ninguna prueba funcional debe correr ` +
        `sobre un esquema incompleto. Revisá el manifiesto: probablemente falte ` +
        `la migración que crea el objeto.`,
    );
    this.name = "RequiredObjectsError";
  }
}

function pgErrorParts(e: unknown): { code: string | null; message: string } {
  if (e && typeof e === "object") {
    const anyE = e as { code?: unknown; message?: unknown };
    return {
      code: typeof anyE.code === "string" ? anyE.code : null,
      message: typeof anyE.message === "string" ? anyE.message : String(e),
    };
  }
  return { code: null, message: String(e) };
}

function listBootstrapFiles(): string[] {
  return readdirSync(BOOTSTRAP_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Aplica bootstrap de tests + manifiesto productivo sobre una conexión ya
 * abierta, guardada y con la versión validada.
 *
 * @param manifest Parametrizable únicamente para que T-A0-05 pueda demostrar
 *                 que retirar una dependencia produce un fallo determinista.
 */
export async function loadSchema(
  client: Client,
  manifest: readonly string[] = WMS_MIGRATION_MANIFEST,
): Promise<LoadResult> {
  validateManifest(manifest);

  const bootstrapFiles = listBootstrapFiles();
  const migrationsApplied: string[] = [];

  // ── Fase 1: bootstrap EXCLUSIVO DE TESTS (no es esquema productivo) ──
  for (const file of bootstrapFiles) {
    const sql = readFileSync(join(BOOTSTRAP_DIR, file), "utf8");
    try {
      await client.query(sql);
    } catch (e) {
      const { code, message } = pgErrorParts(e);
      throw new SchemaLoadError(file, "bootstrap", code, message);
    }
  }

  // ── Fase 2: migraciones PRODUCTIVAS del repositorio, sin modificar ──
  for (const file of manifest) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await client.query(sql);
    } catch (e) {
      const { code, message } = pgErrorParts(e);
      throw new SchemaLoadError(file, "migration", code, message);
    }
    migrationsApplied.push(file);
  }

  return { bootstrapFiles, migrationsApplied };
}

/**
 * BARRERA §10: verifica contra el CATÁLOGO que todos los objetos requeridos
 * existen. Se ejecuta en el global setup, antes de habilitar las suites.
 */
export async function assertRequiredObjects(client: Client): Promise<void> {
  const missing: string[] = [];

  const { rows: tables } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1)`,
    [[...REQUIRED_OBJECTS.tables]],
  );
  const tableSet = new Set(tables.map((r) => r.table_name));
  for (const t of REQUIRED_OBJECTS.tables) {
    if (!tableSet.has(t)) missing.push(`tabla public.${t}`);
  }

  for (const [typname, labels] of Object.entries(REQUIRED_OBJECTS.enums)) {
    const { rows } = await client.query<{ enumlabel: string }>(
      `select e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid
        where t.typname = $1 order by e.enumsortorder`,
      [typname],
    );
    const got = rows.map((r) => r.enumlabel);
    if (got.length === 0) missing.push(`enum ${typname}`);
    else if (JSON.stringify(got) !== JSON.stringify([...labels])) {
      missing.push(`enum ${typname} con etiquetas [${got.join(",")}] ≠ [${labels.join(",")}]`);
    }
  }

  const { rows: fns } = await client.query<{ proname: string }>(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1)`,
    [[...REQUIRED_OBJECTS.functions]],
  );
  const fnSet = new Set(fns.map((r) => r.proname));
  for (const f of REQUIRED_OBJECTS.functions) {
    if (!fnSet.has(f)) missing.push(`función public.${f}`);
  }

  const { rows: tgs } = await client.query<{ tgname: string }>(
    `select tgname from pg_trigger where not tgisinternal and tgname = any($1)`,
    [[...REQUIRED_OBJECTS.triggers]],
  );
  const tgSet = new Set(tgs.map((r) => r.tgname));
  for (const t of REQUIRED_OBJECTS.triggers) {
    if (!tgSet.has(t)) missing.push(`trigger ${t}`);
  }

  const { rows: cons } = await client.query<{ conname: string }>(
    `select conname from pg_constraint where conname = any($1)`,
    [[...REQUIRED_OBJECTS.constraints]],
  );
  const conSet = new Set(cons.map((r) => r.conname));
  for (const c of REQUIRED_OBJECTS.constraints) {
    if (!conSet.has(c)) missing.push(`constraint ${c}`);
  }

  const { rows: idx } = await client.query<{ indexname: string }>(
    `select indexname from pg_indexes where schemaname = 'public' and indexname = any($1)`,
    [[...REQUIRED_OBJECTS.indexes]],
  );
  const idxSet = new Set(idx.map((r) => r.indexname));
  for (const i of REQUIRED_OBJECTS.indexes) {
    if (!idxSet.has(i)) missing.push(`índice ${i}`);
  }

  if (missing.length > 0) throw new RequiredObjectsError(missing);
}
