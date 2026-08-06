import { createHash, randomUUID } from "node:crypto";
import {
  INVENTORY_API_VERSION,
  INVENTORY_MAX_RESPONSE_BYTES,
  INVENTORY_PERMISSION,
} from "./contract";
import {
  InventoryApiError,
  auditUnavailable,
  forbidden,
  internalError,
  nexusBadResponse,
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

const publicBodyFor = (outcome: Outcome, correlationId: string): unknown =>
  outcome.code === "success"
    ? outcome.body
    : {
        ...(outcome.body as Record<string, unknown>),
        meta: { correlationId, apiVersion: INVENTORY_API_VERSION },
      };

const serializeOutcome = (
  outcome: Outcome,
  correlationId: string,
): { body: string; byteLength: number } => {
  const body = JSON.stringify(publicBodyFor(outcome, correlationId));
  return { body, byteLength: new TextEncoder().encode(body).byteLength };
};

/**
 * Último recurso ACOTADO POR CONSTRUCCIÓN.
 *
 * 🔴 Es una constante de módulo, no una plantilla: si se compusiera con datos
 * de la petición volvería a depender de una longitud que no controlamos, que
 * es exactamente el defecto que esta barrera existe para cerrar.
 */
const MINIMAL_ERROR_BODY = JSON.stringify({
  error: { code: "internal_error", message: "Internal error" },
  meta: { correlationId: "00000000-0000-4000-8000-000000000000", apiVersion: INVENTORY_API_VERSION },
});

/**
 * 🔴 Techo GLOBAL: se aplica a TODA respuesta, exitosa o de error.
 *
 * Limitarlo al éxito dejaba una vía real de desborde: el sobre de error refleja
 * `meta.correlationId`, y ese valor podía venir de una cabecera del llamante sin
 * cota de longitud. Una petición con `x-correlation-id` de dos megabytes
 * producía una respuesta de dos megabytes que el conector de P3-N2 —que corta
 * en 1 MiB— habría descartado, convirtiendo un abuso trivial en indisponibilidad.
 *
 * 🔴 Nunca se trunca: truncar produciría una página válida en apariencia pero
 * incompleta, y el cliente no tendría forma de notarlo. Se SUSTITUYE la
 * respuesta entera.
 *
 * 🔴 Sin recursión: como mucho dos serializaciones y, si ambas desbordaran, una
 * constante. Reintentar sustituyendo sería un bucle sobre el mismo defecto.
 */
const enforceResponseSize = (
  outcome: Outcome,
  correlationId: string,
): { outcome: Outcome; serializedBody: string } => {
  const serialized = serializeOutcome(outcome, correlationId);
  if (serialized.byteLength <= INVENTORY_MAX_RESPONSE_BYTES) {
    return { outcome, serializedBody: serialized.body };
  }

  // Un éxito desbordado es una respuesta inválida de la fuente; un error
  // desbordado sólo puede ser un defecto interno. Familias distintas.
  const replacement = errorOutcome(
    outcome.code === "success" ? nexusBadResponse() : internalError(),
  );
  const fallback = serializeOutcome(replacement, correlationId);
  if (fallback.byteLength <= INVENTORY_MAX_RESPONSE_BYTES) {
    return { outcome: replacement, serializedBody: fallback.body };
  }
  return { outcome: replacement, serializedBody: MINIMAL_ERROR_BODY };
};

const jsonResponse = (
  outcome: Outcome,
  correlationId: string,
  serializedBody: string,
): Response => {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Correlation-Id": correlationId,
  });
  if (outcome.retryAfterMs !== undefined) {
    headers.set("Retry-After", String(Math.max(1, Math.ceil(outcome.retryAfterMs / 1_000))));
  }
  return new Response(serializedBody, { status: outcome.status, headers });
};

export function createInventoryHandler(deps: InventoryHandlerDependencies) {
  return async function handleInventory(request: Request): Promise<Response> {
    const startedAt = Date.now();
    const now = deps.now ?? (() => new Date());
    const suppliedCorrelationId = request.headers.get("x-correlation-id");
    // 🔴 La longitud se comprueba ANTES que el patrón: correr una expresión
    // regular sobre una cabecera de megabytes es trabajo que el llamante elige
    // por nosotros. El identificador canónico mide exactamente 36 caracteres.
    const suppliedIsValid =
      suppliedCorrelationId !== null
      && suppliedCorrelationId.length === 36
      && UUID_V4.test(suppliedCorrelationId);
    // 🔴 El sobre NUNCA refleja un identificador que no haya pasado la
    // validación. Reflejarlo era la vía por la que una cabecera sin cota
    // inflaba el cuerpo de la respuesta de error.
    const correlationId = suppliedIsValid
      ? suppliedCorrelationId
      : (deps.createCorrelationId ?? randomUUID)();

    let outcome: Outcome;
    let principal: M2mPrincipal | undefined;
    let actorFingerprint = fingerprint("actor", "unauthenticated");
    let resolvedScopeFingerprint: string | undefined;
    let authoritativeAudit = false;

    try {
      if ((suppliedCorrelationId !== null && !suppliedIsValid) || !UUID_V4.test(correlationId)) {
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

    let serialized = enforceResponseSize(outcome, correlationId);
    outcome = serialized.outcome;

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
      if (authoritativeAudit) {
        outcome = errorOutcome(auditUnavailable());
        serialized = enforceResponseSize(outcome, correlationId);
      }
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

    return jsonResponse(outcome, correlationId, serialized.serializedBody);
  };
}
