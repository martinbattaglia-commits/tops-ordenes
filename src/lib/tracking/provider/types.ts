/**
 * Contratos del Provider Layer del tracking.
 *
 * Un TrackingProvider traduce el payload CRUDO de una fuente de datos
 * (Traccar, Teltonika, Queclink, Ruptela, API externa) a una NormalizedPosition
 * uniforme. El resto del sistema (Engine, Persistence, UI) NUNCA toca el
 * formato del proveedor. Sumar un proveedor = un archivo nuevo que implementa
 * TrackingProvider; cero refactor aguas abajo.
 */

export type ProviderId = "traccar" | "teltonika" | "queclink" | "ruptela";

/**
 * Acceso transport-agnostic a los parámetros entrantes (query string, body
 * form-urlencoded, JSON aplanado, etc.). El provider no sabe cómo llegaron.
 */
export type ParamGetter = (key: string) => string | null;

/** Posición normalizada — la única forma que cruza hacia el Engine. */
export interface NormalizedPosition {
  /** Identificador del dispositivo en la fuente (mapea a fleet_vehicles.device_identifier). */
  device: string;
  latitude: number;
  longitude: number;
  /** Velocidad en km/h ya normalizada por el provider, o null si no reportada. */
  speedKmh: number | null;
  /** Batería 0..100 entero, o null. */
  battery: number | null;
  /** Rumbo en grados 0..360, o null. */
  heading: number | null;
  /** Precisión horizontal en metros, o null. */
  accuracy: number | null;
  /** Timestamp del dispositivo en ISO-8601. */
  recordedAt: string;
}

export type ProviderParseResult =
  | { ok: true; position: NormalizedPosition }
  | { ok: false; reason: "missing-fields"; detail: string };

export interface TrackingProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** Traduce parámetros crudos → NormalizedPosition (o un fallo tipado). */
  parse(get: ParamGetter): ProviderParseResult;
}
