export type InventoryErrorCode =
  | "invalid_input"
  | "unauthenticated"
  | "forbidden"
  | "rate_limited"
  | "nexus_unavailable"
  | "nexus_bad_response"
  | "nexus_data_integrity_error"
  | "audit_unavailable"
  | "internal_error";

export class InventoryApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 429 | 500 | 502 | 503,
    readonly code: InventoryErrorCode,
    readonly safeMessage: string,
  ) {
    super(code);
    this.name = "InventoryApiError";
  }
}

export const invalidInput = () =>
  new InventoryApiError(400, "invalid_input", "Invalid request");

export const unauthenticated = () =>
  new InventoryApiError(401, "unauthenticated", "Authentication required");

export const forbidden = () =>
  new InventoryApiError(403, "forbidden", "Access denied");

export const rateLimited = () =>
  new InventoryApiError(429, "rate_limited", "Request budget exhausted");

export const nexusUnavailable = () =>
  new InventoryApiError(503, "nexus_unavailable", "Inventory service unavailable");

export const nexusBadResponse = () =>
  new InventoryApiError(502, "nexus_bad_response", "Invalid inventory response");

export const nexusDataIntegrityError = () =>
  new InventoryApiError(502, "nexus_data_integrity_error", "Inventory integrity check failed");

export const auditUnavailable = () =>
  new InventoryApiError(503, "audit_unavailable", "Audit service unavailable");

export const internalError = () =>
  new InventoryApiError(500, "internal_error", "Internal error");
