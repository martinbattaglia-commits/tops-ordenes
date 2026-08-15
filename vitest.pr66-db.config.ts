import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Gate SQL aislado de PR #66.
 *
 * No usa el manifiesto WMS compartido: el propio test levanta PostgreSQL 17,
 * aplica las migraciones productivas reales de Clientes, OC y Servicios, y
 * destruye el cluster. Tambien puede correr dentro
 * del gate DB completo sin compartir estado con otras suites.
 */
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    include: [
      "tests/db/t-pr66-01-order-pricing.test.ts",
      "tests/db/t-pr66-a1-purchase-order-integrity.test.ts",
    ],
    environment: "node",
    hookTimeout: 300_000,
    testTimeout: 180_000,
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
  },
});
