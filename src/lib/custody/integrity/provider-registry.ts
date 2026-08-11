/**
 * Registro de identidad de proveedores. R3-2.
 *
 * `executionMode: "real"` ya NO se resuelve comparando un nombre que el propio
 * adaptador declara: se resuelve por **identidad de instancia**. La composición
 * server-side registra la instancia concreta que autoriza, y de ese registro
 * —no del adaptador— salen `provider`, `model`, `promptVersion` y
 * `executionMode`.
 *
 * Un adaptador no registrado que use el mismo `name` que uno permitido queda
 * como `mock`: no hay cadena de caracteres que suplante una referencia.
 */

import type { ExecutionMode } from "./types";

/** Identidad confiable, declarada por la composición del servidor. */
export interface TrustedProviderIdentity {
  provider: string;
  model: string;
  promptVersion: string;
  executionMode: ExecutionMode;
}

/**
 * Registro por instancia. `WeakMap` privado: no se enumera, no se serializa y
 * no admite claves por valor.
 */
export class ProviderRegistry {
  private readonly byInstance = new WeakMap<object, TrustedProviderIdentity>();

  /** Registra una instancia concreta como proveedor confiable. */
  register(instance: object, identity: TrustedProviderIdentity): void {
    this.byInstance.set(instance, { ...identity });
  }

  /** Identidad confiable de la instancia, o `null` si no está registrada. */
  identify(instance: object): TrustedProviderIdentity | null {
    return this.byInstance.get(instance) ?? null;
  }
}

/** Registro vacío por defecto: sin composición explícita, nada es real. */
export const EMPTY_PROVIDER_REGISTRY = new ProviderRegistry();

/**
 * Identidad efectiva de un proveedor.
 *
 * Si la instancia no está registrada, se degrada a `mock` y el nombre se toma
 * del descriptor **sólo como etiqueta informativa**, nunca como acreditación.
 */
export function resolveProviderIdentity(
  instance: object,
  fallbackLabel: { provider: string; model: string; promptVersion: string },
  registry: ProviderRegistry
): TrustedProviderIdentity {
  const trusted = registry.identify(instance);
  if (trusted) return trusted;
  return {
    provider: fallbackLabel.provider,
    model: fallbackLabel.model,
    promptVersion: fallbackLabel.promptVersion,
    executionMode: "mock",
  };
}
