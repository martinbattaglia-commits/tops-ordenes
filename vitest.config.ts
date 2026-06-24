import { defineConfig } from "vitest/config";

// Acotado SOLO a Caja Chica: no introduce un framework de testing global.
export default defineConfig({
  test: {
    include: ["src/lib/tesoreria/caja-chica/**/*.test.ts"],
    environment: "node",
  },
});
