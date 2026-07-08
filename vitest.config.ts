import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Acotado a módulos con tests unitarios (puras, sin IO).
export default defineConfig({
  resolve: {
    alias: { "@": resolve(process.cwd(), "src") },
  },
  test: {
    include: [
      "src/lib/*.test.ts",
      "src/lib/tesoreria/**/*.test.ts",
      "src/lib/tesoreria/caja-chica/**/*.test.ts",
      "src/app/api/tesoreria/caja-chica/**/*.test.ts",
      "src/lib/comercial/**/*.test.ts",
      "src/lib/prospeccion/**/*.test.ts",
      "src/lib/clientify/**/*.test.ts",
      "src/lib/erp/**/*.test.ts",
      "src/lib/udie/**/*.test.ts",
      "src/lib/fiscal/**/*.test.ts",
      "src/lib/compras/**/*.test.ts",
      "src/lib/fx/**/*.test.ts",
    ],
    environment: "node",
  },
});
