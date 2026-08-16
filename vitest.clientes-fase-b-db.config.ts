import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Gate SQL dedicado de CLIENTES FASE B (R-4).
 *
 * Existe porque `tests/db/harness/manifest.ts` excluye 0246–0249 del replay
 * vanilla: esas cuatro migraciones reescriben el núcleo del propio replay
 * —policies de WMS, funciones de rol, RPC de fulfillment— de modo que
 * ejecutarlas dentro de la suite vanilla mediría otro sistema. Excluirlas sin
 * un harness propio dejaba a las cuatro sin ninguna verificación: es lo que
 * permitió que la polaridad invertida de 0249 llegara hasta el gate.
 *
 * Cada archivo levanta su propio PostgreSQL 17 efímero, aplica la cadena
 * productiva real y lo destruye. No comparte estado con las otras suites.
 */
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    include: ["tests/clientes-fase-b-db/**/*.test.ts"],
    environment: "node",
    hookTimeout: 300_000,
    testTimeout: 180_000,
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
  },
});
