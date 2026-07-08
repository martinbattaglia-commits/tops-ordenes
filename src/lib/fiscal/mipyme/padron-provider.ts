/**
 * Puerto de consulta del estado MiPyME (Registro PyME) de un CUIT.
 *
 * Permite "consultar automáticamente ARCA" (req. 3) detrás de una interfaz,
 * de modo que la activación de la consulta en vivo no requiera tocar la
 * lógica de decisión ni de emisión.
 *
 * Implementaciones:
 *  - ManualFlagPadronProvider: usa el flag cargado en el legajo (clients.es_mipyme). ACTIVO hoy.
 *  - ArcaPadronProvider: consulta el WS de padrón/constancia de ARCA. PREPARADO
 *    (lanza MiPyMENoDisponibleError hasta tener WS + credenciales ARCA).
 */

export class MiPyMENoDisponibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MiPyMENoDisponibleError";
  }
}

export interface MiPyMEPadronStatus {
  esMiPyme: boolean;
  categoria: string | null;
  fuente: "manual" | "arca_padron";
}

export interface MiPyMEPadronProvider {
  consultar(cuit: string): Promise<MiPyMEPadronStatus>;
}

/** Usa el estado MiPyME cargado manualmente en el legajo del cliente. */
export class ManualFlagPadronProvider implements MiPyMEPadronProvider {
  constructor(private readonly status: { esMiPyme: boolean; categoria: string | null }) {}
  async consultar(): Promise<MiPyMEPadronStatus> {
    return { esMiPyme: this.status.esMiPyme, categoria: this.status.categoria, fuente: "manual" };
  }
}

/**
 * Consulta el padrón MiPyME en ARCA. Preparado para activación: requiere el
 * web service de padrón/constancia (segundo ticket WSAA) y las credenciales
 * de producción (clave privada), hoy ausentes.
 */
export class ArcaPadronProvider implements MiPyMEPadronProvider {
  async consultar(_cuit: string): Promise<MiPyMEPadronStatus> {
    throw new MiPyMENoDisponibleError(
      "Consulta de padrón MiPyME en ARCA no disponible: requiere el WS de padrón/constancia y credenciales ARCA (preparado para activación)."
    );
  }
}
