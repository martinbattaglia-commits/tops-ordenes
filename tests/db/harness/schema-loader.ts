/**
 * P3-N1A0 · Carga determinista del esquema WMS.
 *
 * Reglas (resolución §7.3):
 *  · el grafo se construye explícitamente desde el manifiesto versionado;
 *  · NO se consulta `supabase_migrations.schema_migrations` — está verificado
 *    como no fiel al catálogo (P3-N1 §4): no registra la serie WMS pese a
 *    estar aplicada;
 *  · los archivos productivos se aplican en orden determinista y sin modificar;
 *  · el bootstrap exclusivo de tests está separado y rotulado;
 *  · ningún error se silencia: el primer fallo aborta con archivo y detalle.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { assertLocalTestUrl } from "./guard";
import { WMS_MIGRATION_MANIFEST } from "./manifest";

/** Raíz del repositorio, derivada de la ubicación de este archivo. */
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const BOOTSTRAP_DIR = join(REPO_ROOT, "tests", "db", "bootstrap");

export interface LoadResult {
  bootstrapFiles: string[];
  migrationsApplied: string[];
}

export class SchemaLoadError extends Error {
  constructor(
    readonly file: string,
    readonly kind: "bootstrap" | "migration",
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `[P3-N1A0] fallo al aplicar ${kind} "${file}".\n` +
        `El harness NO silencia errores de migración.\n` +
        `Detalle de PostgreSQL: ${detail}`,
    );
    this.name = "SchemaLoadError";
  }
}

/** Archivos de bootstrap (sólo tests), en orden lexicográfico. */
function listBootstrapFiles(): string[] {
  return readdirSync(BOOTSTRAP_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Verifica que cada archivo del manifiesto exista antes de tocar la base.
 * Un manifiesto que referencia un archivo inexistente es un error de
 * configuración, no un fallo de SQL, y debe distinguirse como tal.
 */
export function verifyManifestIntegrity(
  manifest: readonly string[] = WMS_MIGRATION_MANIFEST,
): void {
  const onDisk = new Set(
    readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")),
  );
  const missing = manifest.filter((m) => !onDisk.has(m));
  if (missing.length > 0) {
    throw new Error(
      `[P3-N1A0] el manifiesto referencia archivos inexistentes en ` +
        `supabase/migrations/: ${missing.join(", ")}`,
    );
  }
}

/**
 * Aplica bootstrap de tests + manifiesto productivo sobre la base indicada.
 *
 * @param url        URL de la base de test (revalidada por la guarda).
 * @param manifest   Manifiesto a aplicar. Parametrizable únicamente para que
 *                   T-A0-05 pueda demostrar que retirar una dependencia
 *                   produce un fallo determinista y no una carga silenciosa.
 */
export async function loadSchema(
  url: string,
  manifest: readonly string[] = WMS_MIGRATION_MANIFEST,
): Promise<LoadResult> {
  // Segunda barrera: la guarda se reevalúa acá aunque cluster.ts ya la aplicó.
  assertLocalTestUrl(url);
  verifyManifestIntegrity(manifest);

  const client = new Client({ connectionString: url });
  await client.connect();

  const bootstrapFiles = listBootstrapFiles();
  const migrationsApplied: string[] = [];

  try {
    // ── Fase 1: bootstrap EXCLUSIVO DE TESTS (no es esquema productivo) ──
    for (const file of bootstrapFiles) {
      const sql = readFileSync(join(BOOTSTRAP_DIR, file), "utf8");
      try {
        await client.query(sql);
      } catch (e) {
        throw new SchemaLoadError(file, "bootstrap", e);
      }
    }

    // ── Fase 2: migraciones PRODUCTIVAS del repositorio, sin modificar ──
    for (const file of manifest) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      try {
        await client.query(sql);
      } catch (e) {
        throw new SchemaLoadError(file, "migration", e);
      }
      migrationsApplied.push(file);
    }
  } finally {
    await client.end();
  }

  return { bootstrapFiles, migrationsApplied };
}
