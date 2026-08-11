import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * WMS UI/E2E · Pruebas DOM REALES sobre jsdom.
 *
 * Config propia, como `vitest.custody.config.ts` y `vitest.wms-ui.config.ts`:
 * la suite global no cambia de entorno por esto. `jsdom ^26.1.0` es compatible
 * con `engines.node >=18.18.0` del proyecto.
 */
export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/wms-dom/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["tests/wms-dom/setup.ts"],
  },
});
