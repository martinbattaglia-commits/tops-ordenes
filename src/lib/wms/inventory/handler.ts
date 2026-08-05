import { createHash, randomUUID } from "node:crypto";
import { INVENTORY_API_VERSION, INVENTORY_PERMISSION } from "./contract";
import {
  InventoryApiError,
  auditUnavailable,
  forbidden,
  internalError,
  nexusUnavailable,
  rateLimited,
  unauthenticated,
  type InventoryErrorCode,
} from "./errors";
import { parseInventoryQuery } from "./query";
import { executeInventoryQuery } from "./service";
import type {
  InventoryAuditEvent,
  InventoryAuditPort,
  InventoryM2mAuthenticator,
  InventoryObserver,
  InventoryRateLimitPort,
  InventoryRepository,
  InventoryScopeResolver,
  M2mPrincipal,
} from "./ports";

export interface InventoryHandlerDependencies {
  authenticator: InventoryM2mAuthenticator;
  scopeResolver: InventoryScopeResolver;
  repository: InventoryRepository;
  rateLimit: InventoryRateLimitPort;
  audit: InventoryAuditPort;
  observer: InventoryObserver;
  now?: () => Date;
  createCorrelationId?: () => string;
}

interface Outcome {
  status: number;
  code: InventoryErrorCode | "success";
  body: unknown;
  rowsEvaluated: number;
  rowsReturned: number;
  integrityResult: InventoryAuditEvent["integrityResult"];
  retryAfterMs?: number;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fingerprint = (namespace: string, value: string): string =>
  createHash("sha256").update(`${namespace}\u0000${value}`).digest("hex").slice(0, 24);

const scopeFingerprint = (clientId: string, businessUnits: readonly string[]): string =>
  fingerprint("scope", `${clientId}\u0000${[...businessUnits].sort().join(",")}`);

const safeError = (error: unknown): InventoryApiError => {
  if (error instanceof InventoryApiError) return error;
  return internalError();
};

const errorOutcome = (error: InventoryApiError): Outcome => ({
  status: error.status,
  code: error.code,
  body: { error: { code: error.code, message: error.safeMessage } },
  rowsEvaluated: 0,
  rowsReturned: 0,
  integrityResult:
    error.code === "nexus_data_integrity_error" || error.code === "nexus_bad_response"
      ? "failed"
      : "not_evaluated",
});

const auditEvent = (input: {
  correlationId: string;
  actorFingerprint: string;
  scopeFingerprint?: string;
  outcome: Outcome;
  occurredAt: string;
}): InventoryAuditEvent => ({
  correlationId: input.correlationId,
  actorFingerprint: input.actorFingerprint,
  ...(input.scopeFingerprint ? { scopeFingerprint: input.scopeFingerprint } : {}),
  outcome: input.outcome.code,
  status: input.outcome.status,
  rowsEvaluated: input.outcome.rowsEvaluated,
  rowsReturned: input.outcome.rowsReturned,
  integrityResult: input.outcome.integrityResult,
  occurredAt: input.occurredAt,
});

const jsonResponse = (outcome: Outcome, correlationId: string): Response => {
  const body =
    outcome.code === "success"
      ? outcome.body
      : {
          ...(outcome.body as Record<string, unknown>),
          meta: { correlationId, apiVersion: INVENTORY_API_VERSION },
        };
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Correlation-Id": correlationId,
  });
  if (outcome.retryAfterMs !== undefined) {
    headers.set("Retry-After", String(Math.max(1, Math.ceil(outcome.retryAfterMs / 1_000))));
  }
  return new Response(JSON.stringify(body), { status: outcome.status, headers });
};

export function createInventoryHandler(deps: InventoryHandlerDependencies) {
  return async function handleInventory(request: Request): Promise<Response> {
    const startedAt = Date.now();
    const now = deps.now ?? (() => new Date());
    const suppliedCorrelationId = request.headers.get("x-correlation-id");
    const correlationId = suppliedCorrelationId ?? (deps.createCorrelationId ?? randomUUID)();

    let outcome: Outcome;
    let principal: M2mPrincipal | undefined;
    let actorFingerprint = fingerprint("actor", "unauthenticated");
    let resolvedScopeFingerprint: string | undefined;
    let authoritativeAudit = false;

    try {
      if (!UUID_V4.test(correlationId)) {
        throw new InventoryApiError(400, "invalid_input", "Invalid request");
      }
      const url = new URL(request.url);
      const query = parseInventoryQuery(url.searchParams);
      const authentication = await deps.authenticator.authenticate(
        request.headers.get("authorization"),
      );
      if (authentication.kind === "configuration_error") throw nexusUnavailable();
      if (authentication.kind !== "authenticated") throw unauthenticated();
      principal = authentication.principal;
      actorFingerprint = fingerprint("actor", principal.id);
      if (!principal.permissions.includes(INVENTORY_PERMISSION)) throw forbidden();

      const scope = await deps.scopeResolver.resolve({
        principal,
        headers: request.headers,
        query,
      });
      if (!scope) throw forbidden();
      resolvedScopeFingerprint = scopeFingerprint(scope.clientId, scope.businessUnits);
      authoritativeAudit = true;

      let limit;
      try {
        limit = await deps.rateLimit.consume({
          actorFingerprint,
          scopeFingerprint: resolvedScopeFingerprint,
        });
      } catch {
        throw nexusUnavailable();
      }
      if (!limit.allowed) {
        outcome = { ...errorOutcome(rateLimited()), retryAfterMs: limit.retryAfterMs };
      } else {
        const result = await executeInventoryQuery({ repository: deps.repository, scope, query });
        outcome = {
          status: 200,
          code: "success",
          body: {
            data: result.data,
            meta: { correlationId, apiVersion: INVENTORY_API_VERSION },
          },
          rowsEvaluated: result.rowsEvaluated,
          rowsReturned: result.rowsReturned,
          integrityResult: "complete",
        };
      }
    } catch (error) {
      outcome = errorOutcome(safeError(error));
    }

    try {
      await deps.audit.record(
        auditEvent({
          correlationId,
          actorFingerprint,
          ...(resolvedScopeFingerprint ? { scopeFingerprint: resolvedScopeFingerprint } : {}),
          outcome,
          occurredAt: now().toISOString(),
        }),
      );
    } catch {
      if (authoritativeAudit) outcome = errorOutcome(auditUnavailable());
    }

    try {
      await deps.observer.emit({
        event: "inventory_request_completed",
        correlationId,
        outcome: outcome.code,
        status: outcome.status,
        durationMs: Math.max(0, Date.now() - startedAt),
        rowsEvaluated: outcome.rowsEvaluated,
        rowsReturned: outcome.rowsReturned,
      });
    } catch {
      // La observabilidad auxiliar nunca sustituye al journal de auditoría autoritativo.
    }

    return jsonResponse(outcome, correlationId);
  };
}
