/**
 * Punto de entrada de la capa de credenciales.
 *
 * Resuelve una `key` lógica recorriendo una CADENA de providers en orden y
 * devolviendo el primer record disponible. La cadena por defecto es:
 *
 *     EnvironmentProvider  →  BlobProvider
 *
 * (env primero ⇒ dev local intacto; Blobs en producción una vez que la env var
 *  se quita del scope de Functions). `SecretManagerProvider` queda disponible como
 *  punto de extensión, sin cablear.
 *
 * Caché: el resultado se memoiza por key (promise cacheada) para evitar lecturas
 * repetidas a Blobs en una misma instancia de función. Los errores no se cachean.
 */
import type { CredentialProvider, CredentialRecord } from "./types";
import { CredentialNotFoundError } from "./types";
import { EnvironmentProvider } from "./providers/environment";
import { BlobProvider } from "./providers/blob";

export type { CredentialProvider, CredentialRecord } from "./types";
export { CredentialNotFoundError, CredentialIntegrityError } from "./types";
export { buildEnvelope } from "./providers/blob";
export type { BlobEnvelope } from "./providers/blob";

/** Mapa de keys lógicas → env var (para el EnvironmentProvider). Fuente única. */
const ENV_MAP: Readonly<Record<string, string>> = {
  "google-service-account": "GOOGLE_SERVICE_ACCOUNT_JSON",
};

/** Store de Blobs donde viven las credenciales relocalizadas. */
const BLOB_STORE = "secrets";

let chain: CredentialProvider[] | null = null;

function defaultChain(): CredentialProvider[] {
  if (!chain) {
    chain = [new EnvironmentProvider(ENV_MAP), new BlobProvider({ storeName: BLOB_STORE })];
  }
  return chain;
}

/** Override de la cadena (sólo para tests). Pasar `null` restaura la cadena por defecto. */
export function __setCredentialChain(c: CredentialProvider[] | null): void {
  chain = c;
}

const cache = new Map<string, Promise<CredentialRecord>>();

/**
 * Obtiene una credencial por su key lógica. Recorre la cadena; devuelve el primer
 * hit. Lanza `CredentialNotFoundError` si ningún provider la tiene, o
 * `CredentialIntegrityError` si el checksum almacenado no valida.
 */
export function getCredential(key: string): Promise<CredentialRecord> {
  const cached = cache.get(key);
  if (cached) return cached;

  const p = (async (): Promise<CredentialRecord> => {
    for (const provider of defaultChain()) {
      const rec = await provider.load(key);
      if (rec) return rec;
    }
    throw new CredentialNotFoundError(key);
  })().catch((e) => {
    cache.delete(key); // no cachear errores: reintentable
    throw e;
  });

  cache.set(key, p);
  return p;
}

/** Limpia la caché de una key (o toda). Útil tras rotar credenciales. */
export function resetCredentialCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}
