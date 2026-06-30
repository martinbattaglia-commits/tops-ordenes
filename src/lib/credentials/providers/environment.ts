import type { CredentialProvider, CredentialRecord } from "../types";
import { CredentialIntegrityError } from "../types";
import { sha256Hex, checksumsEqual } from "../checksum";

/**
 * Provider de credenciales desde variables de entorno.
 *
 * Mapea una `key` lógica a un nombre de env var (p. ej.
 * `"google-service-account"` → `GOOGLE_SERVICE_ACCOUNT_JSON`).
 *
 * Integridad: el env var es la fuente autoritativa, por lo que el checksum se
 * computa al leer. Si además existe `<ENV>_SHA256`, se valida contra él (permite
 * detectar corrupción/override accidental). Sin checksum esperado, se devuelve el
 * computado (no hay con qué comparar: el env ES la verdad).
 *
 * Uso típico: desarrollo local (`.env.local`) y como primer eslabón de la cadena.
 */
export class EnvironmentProvider implements CredentialProvider {
  readonly name = "environment";

  constructor(private readonly keyToEnv: Readonly<Record<string, string>>) {}

  async load(key: string): Promise<CredentialRecord | null> {
    const envName = this.keyToEnv[key];
    if (!envName) return null;

    const raw = process.env[envName]?.trim();
    if (!raw) return null;

    const sha256 = sha256Hex(raw);
    const expected = process.env[`${envName}_SHA256`]?.trim();
    // Comparación en tiempo CONSTANTE (anti timing-attack).
    if (expected && !checksumsEqual(expected, sha256)) {
      throw new CredentialIntegrityError(key, expected, sha256, this.name);
    }
    return { value: raw, sha256, source: this.name };
  }
}
