/**
 * Capa de abstracción de credenciales.
 *
 * El consumidor (p. ej. el módulo Drive) depende ÚNICAMENTE de `CredentialProvider`
 * y nunca del origen físico (env var, Netlify Blobs, Secret Manager…). Cambiar el
 * backend de almacenamiento NO requiere tocar al consumidor: solo se reconfigura la
 * cadena de providers en `credentials/index.ts`.
 *
 * Integridad: cada credencial almacenada lleva un checksum SHA-256 que se valida en
 * cada lectura (ver `checksum.ts` y `providers/blob.ts`). Una discrepancia es un
 * evento de seguridad → se lanza `CredentialIntegrityError` (NO se degrada en silencio).
 */

export interface CredentialRecord {
  /** Payload crudo de la credencial (p. ej. el JSON de la Service Account). */
  value: string;
  /** SHA-256 (hex) de `value`, recomputado y validado al momento de la lectura. */
  sha256: string;
  /** Nombre del provider que la resolvió (telemetría/logging). */
  source: string;
}

export interface CredentialProvider {
  /** Identificador del provider (para logging). */
  readonly name: string;
  /**
   * Devuelve el record para `key`, o `null` si ESTE provider no lo tiene
   * (la cadena continúa con el siguiente provider).
   * Lanza `CredentialIntegrityError` si el checksum almacenado no coincide.
   */
  load(key: string): Promise<CredentialRecord | null>;
}

/** La credencial no existe en ningún provider de la cadena. Falla "suave" (404/503). */
export class CredentialNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Credencial no encontrada en ningún provider: "${key}"`);
    this.name = "CredentialNotFoundError";
  }
}

/** El checksum SHA-256 almacenado no coincide con el recomputado. Evento de seguridad. */
export class CredentialIntegrityError extends Error {
  constructor(
    public readonly key: string,
    public readonly expected: string,
    public readonly actual: string,
    public readonly source: string,
  ) {
    super(
      `Integridad de credencial "${key}" comprometida en "${source}": ` +
        `checksum esperado ${expected.slice(0, 12)}… ≠ actual ${actual.slice(0, 12)}…`,
    );
    this.name = "CredentialIntegrityError";
  }
}
