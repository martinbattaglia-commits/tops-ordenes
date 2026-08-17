/**
 * COMPOSICIÓN DE LA EVALUACIÓN DE VISIÓN · el lado PESADO, y el único.
 *
 * ─── QUÉ ES ESTE ARCHIVO Y POR QUÉ ESTÁ SOLO ─────────────────────────────
 *
 * Es el ÚNICO lugar donde se instancia `OpenAICustodyVisionProvider` y donde se
 * corre la evaluación productiva. Existe para que la frontera sea **una sola
 * arista con nombre**, en vez de un import repartido por las server actions.
 *
 * `productive-vision-evaluation.ts` importa `CustodyVisionProviderError` como
 * VALOR —es una clase, se usa con `instanceof`— desde `openai-vision-provider`,
 * que a su vez abre con `import "server-only"`. Eso significa que **cualquier
 * módulo que importe la evaluación arrastra el cliente HTTP de OpenAI a su
 * grafo estático**. No es una opinión: es la arista que 2-A ya había pagado una
 * vez, cuando importar `wms/custody/actions.ts` desde recepciones metió el
 * proveedor en la clausura del maestro de clientes y el guard lo cazó.
 *
 * Por eso el disparo del análisis NO importa este módulo de forma estática: lo
 * resuelve `analysis-trigger.ts` con un `import()` dinámico. Ver el docblock de
 * ese archivo, que es donde vive la explicación del corte.
 */

import "server-only";

import { env } from "@/lib/env";
import { OpenAICustodyVisionProvider } from "@/lib/custody/openai-vision-provider";
import {
  runProductiveCustodyVisionEvaluation,
  type ProductiveVisionRunResult,
} from "@/lib/custody/productive-vision-evaluation";
import {
  createSupabaseProductiveVisionServerPort,
  type ProductiveVisionDataClient,
} from "@/lib/custody/integrity-supabase";

export interface PhysicalUnitVisionEvaluationInput {
  caseId: string;
  expectedVersion: number;
  /**
   * Apertura de la evaluación por el cliente de SESIÓN. Se recibe como función
   * y no como cliente para que el lease exclusivo y el cooldown de 0232 sigan
   * corriendo bajo la RLS del usuario: quien abre la evaluación es él, no el
   * `service_role`.
   */
  begin: (caseId: string, expectedVersion: number) => Promise<unknown>;
  /** Cliente administrativo para el puerto de servidor de la evaluación. */
  admin: ProductiveVisionDataClient;
}

/**
 * Corre la evaluación productiva de una unidad física.
 *
 * **EL TECHO DE LLAMADAS PAGAS NO SE TOCA ACÁ.** Quien lo aplica es
 * `begin_custody_integrity_evaluation_v2` con su lease exclusivo y su cooldown
 * (0232); esta función entra por esa misma puerta y acepta un `no` por
 * respuesta —`in_flight` o `cooldown` son resultados válidos, no errores—.
 */
export async function runPhysicalUnitVisionEvaluation(
  input: PhysicalUnitVisionEvaluationInput,
): Promise<ProductiveVisionRunResult> {
  return runProductiveCustodyVisionEvaluation(
    {
      session: { begin: (c, v) => input.begin(c, v) },
      server: createSupabaseProductiveVisionServerPort(input.admin),
      provider: new OpenAICustodyVisionProvider({ apiKey: env.openai.apiKey }),
    },
    { caseId: input.caseId, expectedVersion: input.expectedVersion },
  );
}
