import type {
  InventoryQuery,
  InventoryRepositoryPage,
  InventoryRepositoryQuery,
  InventoryScope,
} from "./contract";
import type { InventoryErrorCode } from "./errors";

export interface M2mPrincipal {
  id: string;
  permissions: readonly string[];
}

export type M2mAuthenticationResult =
  | { kind: "authenticated"; principal: M2mPrincipal }
  | { kind: "unauthenticated" }
  | { kind: "configuration_error" };

export interface InventoryM2mAuthenticator {
  authenticate(authorization: string | null): Promise<M2mAuthenticationResult>;
}

export interface InventoryScopeResolver {
  resolve(input: {
    principal: M2mPrincipal;
    headers: Headers;
    query: InventoryQuery;
  }): Promise<InventoryScope | null>;
}

export interface InventoryRepository {
  query(input: InventoryRepositoryQuery): Promise<InventoryRepositoryPage>;
}

export interface InventoryRateLimitPort {
  consume(input: {
    actorFingerprint: string;
    scopeFingerprint: string;
  }): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

export interface InventoryAuditEvent {
  correlationId: string;
  actorFingerprint: string;
  scopeFingerprint?: string;
  outcome: InventoryErrorCode | "success";
  status: number;
  rowsEvaluated: number;
  rowsReturned: number;
  integrityResult: "complete" | "failed" | "not_evaluated";
  occurredAt: string;
}

export interface InventoryAuditPort {
  record(event: InventoryAuditEvent): Promise<void>;
}

export interface InventoryObservation {
  event: "inventory_request_completed";
  correlationId: string;
  outcome: InventoryErrorCode | "success";
  status: number;
  durationMs: number;
  rowsEvaluated: number;
  rowsReturned: number;
}

export interface InventoryObserver {
  emit(event: InventoryObservation): void | Promise<void>;
}
