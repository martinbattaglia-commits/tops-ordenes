import { getStore } from "@netlify/blobs";
import type { CredentialProvider, CredentialRecord } from "../types";
import { CredentialIntegrityError } from "../types";
import { sha256Hex, CHECKSUM_ALGO, checksumsEqual } from "../checksum";

/**
 * Provider de credenciales desde Netlify Blobs.
 *
 * La credencial se almacena como un ENVELOPE JSON con checksum:
 *   { value: "<payload>", sha256: "<hex>", algo: "SHA-256", createdAt: "<iso>" }
 *
 * En cada lectura se recomputa el SHA-256 de `value` y se valida contra el
 * almacenado → discrepancia ⇒ `CredentialIntegrityError` (no se usa el dato).
 *
 * Contexto de ejecución:
 *  - En runtime de Netlify Functions: `getStore(name)` toma el contexto inyectado.
 *  - Fuera de Netlify (script local): se pasa `{ siteID, token }` explícito.
 *  - Sin contexto ni credenciales de acceso → `load` devuelve `null` (la cadena
 *    continúa); NO rompe (p. ej. en dev local sin Blobs se usa el EnvironmentProvider).
 */
export interface BlobEnvelope {
  value: string;
  sha256: string;
  algo: string;
  createdAt?: string;
}

/** Construye el envelope con checksum a partir del valor crudo (usado por el uploader). */
export function buildEnvelope(value: string, now: string): BlobEnvelope {
  return { value, sha256: sha256Hex(value), algo: CHECKSUM_ALGO, createdAt: now };
}

export interface BlobProviderOptions {
  /** Nombre del store de Blobs. Default: "secrets". */
  storeName?: string;
  /** Para ejecución fuera del runtime de Netlify (scripts). */
  siteID?: string;
  token?: string;
}

export class BlobProvider implements CredentialProvider {
  readonly name = "netlify-blob";
  private readonly storeName: string;

  constructor(private readonly opts: BlobProviderOptions = {}) {
    this.storeName = opts.storeName ?? "secrets";
  }

  async load(key: string): Promise<CredentialRecord | null> {
    let raw: string | null = null;
    try {
      const store =
        this.opts.siteID && this.opts.token
          ? getStore({ name: this.storeName, siteID: this.opts.siteID, token: this.opts.token })
          : getStore(this.storeName);
      raw = await store.get(key, { type: "text" });
    } catch {
      // Sin contexto de Netlify / Blobs no disponible → este provider no aplica.
      return null;
    }
    if (!raw) return null;

    let env: BlobEnvelope;
    try {
      env = JSON.parse(raw) as BlobEnvelope;
    } catch {
      return null;
    }
    if (typeof env.value !== "string") return null;

    const actual = sha256Hex(env.value);
    // Comparación en tiempo CONSTANTE (anti timing-attack): nunca `!==` sobre el hash.
    if (env.sha256 && !checksumsEqual(env.sha256, actual)) {
      throw new CredentialIntegrityError(key, env.sha256, actual, this.name);
    }
    return { value: env.value, sha256: actual, source: this.name };
  }
}
