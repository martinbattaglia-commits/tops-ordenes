import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * P3-N1A0 · Configuración para las PROBES aisladas (H-01.3).
 *
 * Las probes viven en `tests/db/fixtures/**​/*.probe.ts` y NO son recogidas por
 * la suite oficial (`vitest.db.config.ts` sólo incluye `*.test.ts`). Se ejecutan
 * como subproceso desde T-A0-16 para observar su exit code: son fallas
 * deliberadas cuya propagación es el objeto de prueba.
 *
 * No usa globalSetup: las probes no necesitan PostgreSQL.
 */
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    include: ["tests/db/fixtures/**/*.probe.ts"],
    environment: "node",
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
  },
});
