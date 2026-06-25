// Dominio · errores tipados (AP-12). PROHIBIDO `throw` de strings sueltos: el dominio
// devuelve Result<T, DomainError> (clientify/client.ts:19 / arca/soap.ts:11 elevados a regla).

export type DomainErrorCode =
  | "INVALID_EMAIL"
  | "INVALID_CUIT"
  | "INVALID_PHONE"
  | "INVALID_WEBSITE"
  | "INVALID_SOURCE"
  | "INVALID_STATUS"
  | "INVALID_PROSPECT_ID"
  | "MISSING_IDENTITY"
  | "ILLEGAL_TRANSITION"
  | "INGEST_FAILED"; // falla de infraestructura al persistir (adapter) — superficie uniforme en Result

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function domainError(
  code: DomainErrorCode,
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return details === undefined ? { code, message } : { code, message, details };
}
