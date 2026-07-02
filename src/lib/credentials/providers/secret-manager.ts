import type { CredentialProvider, CredentialRecord } from "../types";

/**
 * Provider de credenciales desde un Secret Manager externo (GCP Secret Manager,
 * AWS Secrets Manager, HashiCorp Vault…).
 *
 * PLACEHOLDER / punto de extensión: hoy NO está cableado en la cadena por defecto
 * (`credentials/index.ts`). Existe para que, cuando se decida migrar el origen
 * físico, alcance con implementar `load()` y agregar la instancia a la cadena —
 * sin tocar el módulo Drive ni ningún otro consumidor.
 *
 * Mientras no esté configurado, `load()` devuelve `null` (la cadena continúa).
 */
export interface SecretManagerOptions {
  /** Proyecto/cuenta del secret manager (futuro). */
  project?: string;
  /** Mapa key lógica → recurso del secret manager (futuro). */
  keyToResource?: Readonly<Record<string, string>>;
}

export class SecretManagerProvider implements CredentialProvider {
  readonly name = "secret-manager";

  constructor(private readonly opts: SecretManagerOptions = {}) {}

  async load(_key: string): Promise<CredentialRecord | null> {
    // No implementado: punto de extensión. Devuelve null para no interrumpir la cadena.
    // Cuando se implemente, validar integridad con sha256Hex como en BlobProvider.
    void this.opts;
    return null;
  }
}
