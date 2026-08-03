/**
 * P3-N1A0 · Setup global de la suite de integración SQL.
 *
 * Secuencia obligatoria (§10). Cada etapa es barrera de la siguiente: si
 * alguna falla, NINGUNA prueba funcional corre, porque estaría midiendo un
 * esquema incompleto o un servidor equivocado.
 *
 *   1. guardas de entorno y de URL      (B-01, dentro de startEphemeralCluster)
 *   2. guarda de versión PostgreSQL 17  (M-03, dentro de connectGuarded)
 *   3. validación del manifiesto        (§11, dentro de loadSchema)
 *   4. bootstrap exclusivo de tests
 *   5. migraciones productivas
 *   6. validación de REQUIRED_OBJECTS   (§10)
 *   7. habilitación de las suites
 *
 * El teardown es `async` y propaga sus fallos: una limpieza fallida debe poner
 * la corrida en rojo, no pasar inadvertida (M-01).
 *
 * Los casos T-A0-04 y T-A0-05 NO usan este cluster: gestionan el suyo, porque
 * su objeto de prueba es precisamente el ciclo de vida y la carga.
 */

import type { TestProject } from "vitest/node";
import {
  connectGuarded,
  startEphemeralCluster,
  type EphemeralCluster,
} from "./harness/cluster";
import { assertRequiredObjects, loadSchema } from "./harness/schema-loader";
import { validateCanonicalManifest } from "./harness/manifest";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
    migrationsApplied: string[];
    serverVersionNum: number;
  }
}

let cluster: EphemeralCluster | null = null;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Barrera §11 antes de adquirir recurso alguno: cobertura del manifiesto.
  validateCanonicalManifest();

  cluster = await startEphemeralCluster();

  try {
    // connectGuarded reaplica assertNoProductionEnv + assertLocalTestUrl y
    // valida PostgreSQL 17 ANTES de que se ejecute una sola sentencia.
    const client = await connectGuarded(cluster.url);
    try {
      const { rows } = await client.query<{ server_version_num: string }>(
        "show server_version_num",
      );
      const serverVersionNum = Number.parseInt(rows[0].server_version_num, 10);

      const { migrationsApplied } = await loadSchema(client);
      await assertRequiredObjects(client);

      project.provide("dbUrl", cluster.url);
      project.provide("migrationsApplied", migrationsApplied);
      project.provide("serverVersionNum", serverVersionNum);
    } finally {
      await client.end();
    }
  } catch (e) {
    // El cluster se destruye antes de propagar. Si además falla el teardown,
    // se informan ambos: el original manda, el de limpieza se anexa.
    try {
      await cluster.teardown();
    } catch (teardownError) {
      const detail =
        teardownError instanceof Error ? teardownError.message : String(teardownError);
      (e as Error).message += `\n[P3-N1A0] además falló el teardown: ${detail}`;
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
