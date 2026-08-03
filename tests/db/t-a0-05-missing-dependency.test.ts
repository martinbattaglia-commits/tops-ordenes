/**
 * T-A0-05 · Detección de dependencia faltante (§10).
 *
 * Es la condición que autoriza usar un manifiesto en lugar de la historia
 * completa: retirar una dependencia debe producir un fallo DETERMINISTA y con
 * CAUSA CONCRETA, no una carga silenciosa ni un error genérico.
 *
 * No basta con `rejects.toThrow(SchemaLoadError)`: cada caso afirma el archivo
 * exacto que falla, el SQLSTATE y el objeto que faltaba.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { connectGuarded, startEphemeralCluster, type EphemeralCluster } from "./harness/cluster";
import {
  RequiredObjectsError,
  SchemaLoadError,
  assertRequiredObjects,
  loadSchema,
} from "./harness/schema-loader";
import { WMS_MIGRATION_MANIFEST } from "./harness/manifest";
import { runPendingTeardowns } from "./harness/cleanup";

const pending: EphemeralCluster[] = [];

afterEach(async () => {
  await runPendingTeardowns("T-A0-05", pending);
});

/** Manifiesto sin una migración concreta. */
function without(file: string): string[] {
  const next = WMS_MIGRATION_MANIFEST.filter((m) => m !== file);
  if (next.length === WMS_MIGRATION_MANIFEST.length) {
    throw new Error(`"${file}" no está en el manifiesto: la prueba no probaría nada.`);
  }
  return next;
}

/** Levanta un cluster y devuelve una conexión guardada, ambos registrados. */
async function freshClient(): Promise<Client> {
  const cluster = await startEphemeralCluster();
  pending.push(cluster);
  return connectGuarded(cluster.url);
}

describe("T-A0-05 · dependencia faltante", () => {
  it("retirar 0024 hace fallar 0025 con causa concreta: falta inventory_items", async () => {
    const client = await freshClient();
    try {
      const err = await loadSchema(client, without("0024_wms_inventory.sql")).then(
        () => null,
        (e: unknown) => e as SchemaLoadError,
      );

      expect(err).toBeInstanceOf(SchemaLoadError);
      expect(err!.kind).toBe("migration");
      expect(err!.file).toBe("0025_wms_receptions.sql");
      // Causa concreta, no genérica: relación inexistente (SQLSTATE 42P01).
      expect(err!.pgCode).toBe("42P01");
      expect(err!.pgMessage).toMatch(/inventory_items/);
      expect(err!.message).toMatch(/NO silencia errores/);
    } finally {
      await client.end();
    }
  });

  it("retirar 0009 hace fallar 0010 con causa concreta: falta el RBAC", async () => {
    const client = await freshClient();
    try {
      const err = await loadSchema(client, without("0009_rbac.sql")).then(
        () => null,
        (e: unknown) => e as SchemaLoadError,
      );
      expect(err).toBeInstanceOf(SchemaLoadError);
      expect(err!.kind).toBe("migration");
      // El primer consumidor del RBAC en el manifiesto.
      expect(err!.file).toBe("0010_documents.sql");
      expect(err!.pgCode).not.toBeNull();
    } finally {
      await client.end();
    }
  });

  it("retirar 0026 hace fallar 0027: falta el tipo del ledger", async () => {
    const client = await freshClient();
    try {
      const err = await loadSchema(client, without("0026_inventory_movements.sql")).then(
        () => null,
        (e: unknown) => e as SchemaLoadError,
      );
      expect(err).toBeInstanceOf(SchemaLoadError);
      expect(err!.file).toBe("0027_wms_functions.sql");
      // Causa concreta: 0026 define `movement_type_t`, y 0027 lo usa en la
      // firma de confirm_movement. El primer objeto ausente es el TIPO, no la
      // tabla — la aserción nombra exactamente lo que PostgreSQL reporta.
      expect(err!.pgCode).toBe("42704"); // undefined_object
      expect(err!.pgMessage).toMatch(/movement_type_t/);
    } finally {
      await client.end();
    }
  });

  it("BARRERA §10: un esquema sin objetos requeridos aborta antes de las pruebas", async () => {
    const client = await freshClient();
    try {
      // Se carga sólo la base del ERP: quedan fuera todas las tablas del WMS.
      const parcial = WMS_MIGRATION_MANIFEST.filter((m) => /^000[1-9]|^001[01]/.test(m));
      await loadSchema(client, parcial);
      const err = await assertRequiredObjects(client).then(
        () => null,
        (e: unknown) => e as RequiredObjectsError,
      );
      expect(err).toBeInstanceOf(RequiredObjectsError);
      // Identifica los objetos concretos que faltan.
      expect(err!.missing.join(" ")).toMatch(/inventory_items/);
      expect(err!.missing.join(" ")).toMatch(/business_unit_t/);
      expect(err!.missing.join(" ")).toMatch(/confirm_reception/);
      expect(err!.message).toMatch(/ninguna prueba funcional debe correr/);
    } finally {
      await client.end();
    }
  });

  it("el manifiesto completo carga y satisface la barrera de objetos", async () => {
    const client = await freshClient();
    try {
      const { migrationsApplied } = await loadSchema(client);
      expect(migrationsApplied).toEqual([...WMS_MIGRATION_MANIFEST]);
      await expect(assertRequiredObjects(client)).resolves.toBeUndefined();
    } finally {
      await client.end();
    }
  });
});
