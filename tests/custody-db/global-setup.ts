/**
 * DB-1 · Setup global del harness DEDICADO de custodia.
 *
 * Reutiliza el ciclo de vida del cluster vanilla (`startEphemeralCluster`,
 * `connectGuarded`) y su cargador (`loadSchema(client, manifest)`) SIN
 * modificarlos: `loadSchema` ya acepta un manifiesto por parámetro, que es
 * exactamente el punto de extensión que D4 necesitaba.
 *
 * Diferencias respecto del vanilla:
 *   · manifiesto de CUSTODIA (39 archivos, con PostGIS real);
 *   · barrera de PostGIS antes de cargar nada: 0016 y 0036 fallarían de todos
 *     modos, pero con un error de PostgreSQL difícil de leer; conviene decir
 *     "falta PostGIS" y no "no existe el tipo geography";
 *   · bootstrap adicional propio (auth.sessions);
 *   · barrera de objetos requeridos propia.
 */

import type { TestProject } from "vitest/node";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import {
  connectGuarded,
  startEphemeralCluster,
  type EphemeralCluster,
} from "../db/harness/cluster";
import { loadSchema } from "../db/harness/schema-loader";
import {
  CUSTODY_BOOTSTRAP_DIR,
  CUSTODY_MIGRATION_MANIFEST,
  CUSTODY_REQUIRED_OBJECTS,
  validateCustodyManifest,
} from "./harness/manifest";

declare module "vitest" {
  export interface ProvidedContext {
    custodyDbUrl: string;
    custodyMigrationsApplied: string[];
    postgisVersion: string;
  }
}

let cluster: EphemeralCluster | null = null;

/** Barrera: PostGIS REAL disponible para ESTE servidor. */
async function assertPostgisAvailable(client: Client): Promise<void> {
  const { rows } = await client.query<{ name: string; default_version: string }>(
    "select name, default_version from pg_available_extensions where name = 'postgis'",
  );
  if (rows.length === 0) {
    throw new Error(
      "[DB-1] PostGIS NO está disponible para este PostgreSQL. El cierre de " +
        "custodia lo exige (0016 y 0036 crean la extensión). " +
        "macOS: `brew install postgis`. Sin PostGIS este harness no puede correr: " +
        "STOP — LOCAL_POSTGIS_RUNTIME_UNAVAILABLE.",
    );
  }
}

/** Bootstrap propio de custodia, aplicado tras el vanilla + migraciones. */
async function loadCustodyBootstrap(client: Client): Promise<string[]> {
  const files = readdirSync(CUSTODY_BOOTSTRAP_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = readFileSync(join(CUSTODY_BOOTSTRAP_DIR, f), "utf8");
    try {
      await client.query(sql);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`[DB-1] fallo al aplicar bootstrap de custodia "${f}": ${msg}`);
    }
  }
  return files;
}

/** Barrera §10 propia: si falta un objeto, ninguna prueba funcional corre. */
async function assertCustodyObjects(client: Client): Promise<void> {
  const missing: string[] = [];

  const { rows: tables } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1)`,
    [[...CUSTODY_REQUIRED_OBJECTS.tables]],
  );
  const tableSet = new Set(tables.map((r: Record<string, unknown>) => r.table_name));
  for (const t of CUSTODY_REQUIRED_OBJECTS.tables) {
    if (!tableSet.has(t)) missing.push(`tabla public.${t}`);
  }

  const { rows: fns } = await client.query<{ proname: string }>(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1)`,
    [[...CUSTODY_REQUIRED_OBJECTS.functions]],
  );
  const fnSet = new Set(fns.map((r: Record<string, unknown>) => r.proname));
  for (const f of CUSTODY_REQUIRED_OBJECTS.functions) {
    if (!fnSet.has(f)) missing.push(`función public.${f}`);
  }

  // §2 · Barrera NEGATIVA: la RPC declarativa de evaluación debe haber
  // DESAPARECIDO. Si sigue ahí, existe una vía de escritura sin intento previo
  // y ninguna prueba de procedencia significaría nada.
  const { rows: ghosts } = await client.query<{ proname: string }>(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1)`,
    [[...CUSTODY_REQUIRED_OBJECTS.absentFunctions]],
  );
  for (const g of ghosts) {
    missing.push(`función public.${g.proname} SIGUE EXISTIENDO y debía eliminarse`);
  }

  const { rows: tgs } = await client.query<{ tgname: string }>(
    `select tgname from pg_trigger where tgname = any($1)`,
    [[...CUSTODY_REQUIRED_OBJECTS.triggers]],
  );
  const tgSet = new Set(tgs.map((r: Record<string, unknown>) => r.tgname));
  for (const t of CUSTODY_REQUIRED_OBJECTS.triggers) {
    if (!tgSet.has(t)) missing.push(`trigger ${t}`);
  }

  for (const [typname, label] of Object.entries(CUSTODY_REQUIRED_OBJECTS.enumValues)) {
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from pg_type t join pg_enum e on e.enumtypid = t.oid
        where t.typname = $1 and e.enumlabel = $2`,
      [typname, label],
    );
    if (rows[0]?.n !== "1") missing.push(`valor '${label}' en enum ${typname}`);
  }

  // PostGIS efectivamente INSTALADO (no sólo disponible).
  const { rows: ext } = await client.query<{ n: string }>(
    "select count(*)::text as n from pg_extension where extname = 'postgis'",
  );
  if (ext[0]?.n !== "1") missing.push("extensión postgis instalada");

  if (missing.length > 0) {
    throw new Error(
      `[DB-1] el esquema de custodia NO contiene objetos requeridos:\n` +
        missing.map((m) => `  · ${m}`).join("\n"),
    );
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  validateCustodyManifest();

  cluster = await startEphemeralCluster();

  try {
    const client = await connectGuarded(cluster.url);
    try {
      await assertPostgisAvailable(client);

      const { migrationsApplied } = await loadSchema(client, CUSTODY_MIGRATION_MANIFEST);
      await loadCustodyBootstrap(client);
      await assertCustodyObjects(client);

      const { rows } = await client.query<{ v: string }>(
        "select extensions.postgis_lib_version() as v",
      );

      project.provide("custodyDbUrl", cluster.url);
      project.provide("custodyMigrationsApplied", migrationsApplied);
      project.provide("postgisVersion", rows[0]?.v ?? "desconocida");
    } finally {
      await client.end();
    }
  } catch (e) {
    try {
      await cluster.teardown();
    } catch (teardownError) {
      const detail =
        teardownError instanceof Error ? teardownError.message : String(teardownError);
      (e as Error).message += `\n[DB-1] además falló el teardown: ${detail}`;
    } finally {
      cluster = null;
    }
    throw e;
  }

  return async () => {
    const c = cluster;
    cluster = null;
    await c?.teardown(); // propaga: una limpieza fallida pone la corrida en rojo
  };
}
