/**
 * WMS UI-1 · Guardia de envío único. Módulo PURO.
 *
 * El doble clic tiene dos defensas y las dos importan:
 *
 *  1. **Servidor (autoritativa).** `decide_custody_integrity` recibe
 *     `p_expected_version` y hace CAS: la segunda llamada choca con conflicto
 *     de versión y no produce una segunda decisión. Aunque la UI fallara, la
 *     base no se deja duplicar.
 *
 *  2. **Cliente (esta guardia).** Evita disparar la segunda llamada, que sólo
 *     serviría para mostrarle al inspector un error de carrera provocado por su
 *     propio doble clic.
 *
 * Vive fuera del componente a propósito: así se prueba de verdad —contando
 * ejecuciones— sin necesitar DOM, que es exactamente lo que hoy no tenemos.
 */

export type SingleFlight = <T>(key: string, task: () => Promise<T>) => Promise<T | undefined>;

export interface SingleFlightGuard {
  run: SingleFlight;
  /** `true` si hay una ejecución en vuelo para esa clave. */
  isPending(key: string): boolean;
  pendingCount(): number;
}

/**
 * Devuelve `undefined` cuando la llamada se descarta por ya haber una en vuelo.
 * No encola ni reintenta: una acción destructiva descartada es mejor que una
 * repetida, y el llamador distingue el caso porque no recibe resultado.
 */
export function createSingleFlightGuard(): SingleFlightGuard {
  const inFlight = new Set<string>();
  return {
    async run<T>(key: string, task: () => Promise<T>): Promise<T | undefined> {
      if (inFlight.has(key)) return undefined;
      inFlight.add(key);
      try {
        return await task();
      } finally {
        // Se libera SIEMPRE, incluso si la tarea lanzó: si no, un fallo dejaría
        // el botón muerto para siempre.
        inFlight.delete(key);
      }
    },
    isPending: (key) => inFlight.has(key),
    pendingCount: () => inFlight.size,
  };
}
