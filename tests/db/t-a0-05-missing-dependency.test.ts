/**
 * T-A0-05 · Detección de dependencia faltante.
 *
 * Es la condición que §7.3 impone para autorizar un manifiesto en lugar de la
 * historia completa: debe existir una prueba que demuestre que retirar una
 * dependencia produce un FALLO DETERMINISTA y no una carga silenciosa que
 * dejaría un esquema incompleto pasando por bueno.
 *
 * Gestiona su propio cluster: carga manifiestos deliberadamente rotos.
 */

import { describe, expect, it } from "vitest";
import { startEphemeralCluster } from "./harness/cluster";
import { loadSchema, verifyManifestIntegrity, SchemaLoadError } from "./harness/schema-loader";
import { WMS_MIGRATION_MANIFEST } from "./harness/manifest";

/** Manifiesto sin una migración concreta. */
function without(file: string): string[] {
  const next = WMS_MIGRATION_MANIFEST.filter((m) => m !== file);
  if (next.length === WMS_MIGRATION_MANIFEST.length) {
    throw new Error(`"${file}" no está en el manifiesto: la prueba no probaría nada.`);
  }
  return next;
}

describe("T-A0-05 · dependencia faltante", () => {
  it("retirar 0024 (inventory_items) hace fallar 0025 de forma determinista", async () => {
    const cluster = await startEphemeralCluster();
    try {
      const err = await loadSchema(cluster.url, without("0024_wms_inventory.sql")).then(
        () => null,
        (e: unknown) => e as Error,
      );

      expect(err).toBeInstanceOf(SchemaLoadError);
      expect((err as SchemaLoadError).kind).toBe("migration");
      // 0025 referencia inventory_items en la FK de reception_items.
      expect((err as SchemaLoadError).file).toBe("0025_wms_receptions.sql");
      expect(err?.message).toMatch(/inventory_items/);
      expect(err?.message).toMatch(/NO silencia errores/);
    } finally {
      cluster.teardown();
    }
  });

  it("retirar 0009 (RBAC) hace fallar la serie de permisos WMS", async () => {
    const cluster = await startEphemeralCluster();
    try {
      const err = await loadSchema(cluster.url, without("0009_rbac.sql")).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err).toBeInstanceOf(SchemaLoadError);
      expect((err as SchemaLoadError).kind).toBe("migration");
    } finally {
      cluster.teardown();
    }
  });

  it("un manifiesto que referencia un archivo inexistente falla ANTES de tocar la base", () => {
    expect(() =>
      verifyManifestIntegrity(["0001_init.sql", "9999_no_existe.sql"]),
    ).toThrow(/archivos inexistentes/);
  });

  it("el manifiesto vigente es íntegro", () => {
    expect(() => verifyManifestIntegrity()).not.toThrow();
  });
});
