import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * P3-N1A0 · Configuración de las pruebas de INTEGRACIÓN SQL.
 *
 * Deliberadamente separada de `vitest.config.ts`:
 *
 *  · `npm test` conserva su semántica exacta — pruebas puras, sin IO, sin
 *    PostgreSQL. No se tocó ese archivo ni su allowlist.
 *  · estas pruebas necesitan un PostgreSQL 17 efímero, tardan más y se
 *    ejecutan con `npm run test:db`.
 *
 * Se ejecutan en un único hilo: comparten un cluster levantado por
 * `globalSetup`, y el aislamiento entre casos se resuelve por transacción o
 * por datos, no por concurrencia de procesos.
 */
export default defineConfig({
  resolve: {
    alias: { "@": resolve(process.cwd(), "src") },
  },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/db/global-setup.ts"],
    // initdb + 29 migraciones sobre un cluster nuevo tarda bastante más que
    // el default de 5 s de Vitest.
    hookTimeout: 180_000,
    testTimeout: 120_000,
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
  },
});
