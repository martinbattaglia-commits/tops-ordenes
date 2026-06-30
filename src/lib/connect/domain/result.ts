// Nexus Link · dominio — Result<T,E> (mismo patrón que prospeccion/domain/result).
// Sin throw en el núcleo: los casos de uso devuelven Result; el borde (server action) traduce a union.

export type Result<T, E = DomainError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface DomainError {
  readonly code: string;
  readonly message: string;
}

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E = DomainError>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

export function domainError(code: string, message: string): DomainError {
  return { code, message };
}
