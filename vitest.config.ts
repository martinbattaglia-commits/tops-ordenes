import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Acotado a módulos con tests unitarios (puras, sin IO).
export default defineConfig({
  resolve: {
    alias: { "@": resolve(process.cwd(), "src") },
  },
  esbuild: { jsx: "automatic" },
  test: {
    include: [
      "src/lib/*.test.ts",
      "src/lib/supabase/**/*.test.ts",
      "src/lib/tesoreria/**/*.test.ts",
      "src/lib/tesoreria/caja-chica/**/*.test.ts",
      "src/app/api/tesoreria/caja-chica/**/*.test.ts",
      "src/lib/comercial/**/*.test.ts",
      "src/lib/prospeccion/**/*.test.ts",
      "src/lib/clientify/**/*.test.ts",
      "src/lib/compliance/**/*.test.ts",
      "src/lib/credentials/**/*.test.ts",
      "src/lib/erp/**/*.test.ts",
      "src/lib/knowledge/**/*.test.ts",
      "src/lib/connect/**/*.test.ts",
      "src/lib/whatsapp/**/*.test.ts",
      "src/lib/notifications/**/*.test.ts",
      "src/lib/profile/**/*.test.ts",
      "src/lib/udie/**/*.test.ts",
      "src/lib/fiscal/**/*.test.ts",
      "src/lib/compras/**/*.test.ts",
      "src/lib/doc-system/**/*.test.{ts,tsx}",
      "src/lib/ai/**/*.test.ts",
      "src/lib/voice/**/*.test.ts",
      // P3-N1B · puente de identidad canónica de cliente (lógica pura, sin IO).
      "src/lib/wms/**/*.test.ts",
      // M-3 · pruebas de RENDER real de la UI del hilo. Declaran su propio
      // entorno jsdom por docblock; el resto de la suite sigue en "node".
      // Los paréntesis de `(app)` son sintaxis de grupo en glob: se usa `**`
      // para no depender de escaparlos.
      "src/app/**/connect/_components/*.test.tsx",
      // FASE A · NEXUS-LINK-NOTIFICATIONS-MEDIA-001: render real de la
      // campanita de tres colores (jsdom por docblock, igual que ThreadView).
      "src/components/shell/*.test.tsx",
    ],
    environment: "node",
  },
});
