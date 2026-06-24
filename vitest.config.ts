import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Acotado SOLO a Caja Chica: no introduce un framework de testing global.
export default defineConfig({
  resolve: {
    alias: { "@": resolve(process.cwd(), "src") },
  },
  test: {
    include: [
      "src/lib/tesoreria/caja-chica/**/*.test.ts",
      "src/app/api/tesoreria/caja-chica/**/*.test.ts",
    ],
    environment: "node",
  },
});
