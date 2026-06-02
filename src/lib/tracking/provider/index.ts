import type { ProviderId, TrackingProvider } from "./types";
import { traccarProvider } from "./traccar";

/**
 * Registro de proveedores de tracking.
 *
 * Hoy: Traccar (fuente inicial). Para sumar Teltonika/Queclink/Ruptela, crear
 * el archivo del provider (implementa TrackingProvider) y registrarlo acá.
 * Ningún otro punto del sistema cambia.
 */

const REGISTRY: Partial<Record<ProviderId, TrackingProvider>> = {
  traccar: traccarProvider,
};

export const DEFAULT_PROVIDER_ID: ProviderId = "traccar";

/** Devuelve el provider por id, o null si no está registrado. */
export function getProvider(id: ProviderId): TrackingProvider | null {
  return REGISTRY[id] ?? null;
}

export type { TrackingProvider, ProviderId } from "./types";
export type {
  NormalizedPosition,
  ParamGetter,
  ProviderParseResult,
} from "./types";
