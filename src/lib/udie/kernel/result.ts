export interface DomainError { code: string; message: string; meta?: Record<string, unknown> }
export const domainError = (code: string, message: string, meta?: Record<string, unknown>): DomainError => ({ code, message, meta });
export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(error: DomainError): Result<T> => ({ ok: false, error });
