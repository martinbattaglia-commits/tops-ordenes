/**
 * P3-N1A0 · Cleanup propagante compartido (H-01.3).
 *
 * La lógica de `afterEach` que destruye los clusters pendientes vive acá, en un
 * único punto, para que:
 *   · T-A0-04 y T-A0-05 la usen idénticamente;
 *   · una probe aislada la ejercite en un subproceso Vitest;
 *   · un mutante que la haga absorber errores rompa la probe (exit ≠ 0), que es
 *     el discriminante permanente de "cleanup absorbido".
 *
 * Regla: se intentan TODOS los teardowns pendientes; los fallos se AGREGAN y se
 * LANZAN. Nunca se absorben.
 */

export interface Teardownable {
  teardown: () => Promise<void>;
}

/**
 * Destruye todos los pendientes (vaciando el array), agrega los errores y los
 * lanza. La limpieza secundaria continúa incluso si un teardown falla: se
 * intentan todos antes de propagar.
 *
 * @param label Etiqueta para el mensaje de error agregado.
 * @param pending Array de recursos con teardown; se vacía in situ.
 */
export async function runPendingTeardowns(
  label: string,
  pending: Teardownable[],
): Promise<void> {
  const errors: string[] = [];
  for (const c of pending.splice(0)) {
    try {
      await c.teardown();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (errors.length > 0) {
    throw new Error(`[P3-N1A0] cleanup de ${label} falló (${errors.length}): ${errors.join(" · ")}`);
  }
}
