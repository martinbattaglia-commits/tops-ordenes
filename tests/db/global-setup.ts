/**
 * P3-N1A0 · Setup global de la suite de integración SQL.
 *
 * Levanta UN cluster efímero por corrida, carga el cierre WMS y lo publica a
 * los tests vía `provide`. El teardown corre siempre: Vitest ejecuta la función
 * devuelta aunque algún test falle o la suite se interrumpa.
 *
 * Los casos T-A0-04 y T-A0-05 NO usan este cluster: gestionan el suyo, porque
 * su objeto de prueba es precisamente el ciclo de vida y la carga.
 */

import type { TestProject } from "vitest/node";
import { startEphemeralCluster, type EphemeralCluster } from "./harness/cluster";
import { loadSchema } from "./harness/schema-loader";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
    migrationsApplied: string[];
  }
}

let cluster: EphemeralCluster | null = null;

export default async function setup(project: TestProject): Promise<() => void> {
  cluster = await startEphemeralCluster();

  try {
    const { migrationsApplied } = await loadSchema(cluster.url);
    project.provide("dbUrl", cluster.url);
    project.provide("migrationsApplied", migrationsApplied);
  } catch (e) {
    // Si la carga falla, el cluster igual se destruye antes de propagar.
    cluster.teardown();
    cluster = null;
    throw e;
  }

  return () => {
    cluster?.teardown();
    cluster = null;
  };
}
