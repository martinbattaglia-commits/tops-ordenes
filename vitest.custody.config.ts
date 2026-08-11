import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * DB-1 · Configuración EXCLUSIVA del harness de custodia (PG17 + PostGIS real).
 *
 * Separada de `vitest.config.ts` y de `vitest.db.config.ts`, que NO se tocan:
 *
 *  · `vitest.config.ts` usa una allowlist explícita bajo `src/`, así que este
 *    árbol le es invisible;
 *  · `vitest.db.config.ts` incluye `tests/db/**\/*.test.ts`. Por eso las pruebas
 *    de custodia viven en `tests/custody-db/`: dentro de `tests/db/` se
 *    ejecutarían también en la corrida vanilla, sobre un esquema SIN las tablas
 *    de custodia, y la romperían. La separación de directorio es lo que hace
 *    que la invariancia del vanilla sea real y no sólo declarada.
 *
 * Un solo hilo: todas las pruebas comparten el cluster de `globalSetup` y se
 * aíslan por datos/transacción, no por concurrencia de procesos.
 */
export default defineConfig({
  resolve: {
    alias: { "@": resolve(process.cwd(), "src") },
  },
  test: {
    include: ["tests/custody-db/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/custody-db/global-setup.ts"],
    // initdb + 39 migraciones (incluida PostGIS) sobre un cluster nuevo tarda
    // bastante más que el default de 5 s de Vitest.
    hookTimeout: 300_000,
    testTimeout: 180_000,
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
  },
});
