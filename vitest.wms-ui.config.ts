import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * WMS UI-1 · Configuración FOCALIZADA de la interfaz de Custodia Digital.
 *
 * Archivo propio, igual que `vitest.custody.config.ts`: la suite global es de
 * WA-8R9 en esta ventana y no se toca. Entorno `node` porque el proyecto no
 * tiene jsdom/happy-dom instalados; por eso acá no hay pruebas de render y las
 * de DOM/E2E quedan explícitamente diferidas.
 */
export default defineConfig({
  resolve: {
    alias: {
      // ⚠️ El orden importa: Vite evalúa los alias en orden de declaración y
      // `"@"` capturaría `@/lib/supabase/server` si fuera primero.
      "@/lib/supabase/server": resolve(process.cwd(), "tests/wms-ui/_stubs/supabase-server.mjs"),
      "@": resolve(process.cwd(), "src"),
      "next/cache": resolve(process.cwd(), "tests/wms-ui/_stubs/next-cache.mjs"),
      // Marcador del bundler de Next: fuera de Next no resuelve y no hace falta.
      "server-only": resolve(process.cwd(), "tests/wms-ui/_stubs/server-only.mjs"),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    // `.tsx` además de `.ts`: el config ya declara `jsx: "automatic"`, así que
    // excluir la extensión que lo necesita era una incoherencia. La usa el
    // render de muestra del §7, que renderiza los componentes reales.
    include: ["tests/wms-ui/**/*.test.{ts,tsx}", "src/lib/custody/**/*.test.ts"],
    environment: "node",
  },
});
