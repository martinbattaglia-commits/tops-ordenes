import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Gate SQL dedicado de CLIENTES FASE B (R-4).
 *
 * Existe porque `tests/db/harness/manifest.ts` excluye las migraciones de
 * FASE B del replay vanilla: reescriben el núcleo del propio replay —funciones
 * de rol, policies de Nexus Link, ciclo de precios de órdenes de servicio— de
 * modo que ejecutarlas dentro de la suite vanilla mediría otro sistema.
 * Excluirlas sin un harness propio las dejaba sin ninguna verificación: es lo
 * que permitió que la polaridad invertida de 0249 llegara hasta el gate.
 *
 * Cada archivo levanta su propio PostgreSQL 17 efímero, aplica la cadena
 * productiva real y lo destruye. No comparte estado con las otras suites.
 *
 * H-2 · CONSTANCIA DE CAUSALIDAD. Los NUEVE fallos del harness de Custodia
 * (`npm run test:custody:db`) son de ESTE candidato, no ajenos: ocho casos de
 * `t-c4-01` que dependen de un catálogo sano, y uno de `t-c1-05` por el
 * invariante de paths, porque 0246 reescribe las policies de Nexus Link y
 * toca diez archivos de Connect.
 *
 * Retirado el aislamiento por sede, los PATHS no catalogados bajaron de ocho a
 * CUATRO —0246, 0249 y sus dos ROLLBACK—, porque 0247, 0248 y sus inversas
 * dejaron de existir. El conteo de FALLOS no los sigue: sigue en nueve, porque
 * `t-c4-01` agrega todas las violaciones del catálogo dentro de los mismos
 * casos. Se deja escrito para que nadie lea "nueve" como "no cambió nada".
 *
 * Son estructuralmente inevitables mientras el lease mantenga congelados
 * `supabase/lineage/**` y `tests/custody-db/**`: catalogar exige escribir en
 * el primero, y el invariante vive en el segundo.
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
