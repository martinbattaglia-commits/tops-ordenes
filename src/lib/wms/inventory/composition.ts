import { createApiKeyM2mAuthenticator, type InventoryM2mCredential } from "./auth";
import { BUSINESS_UNITS, type BusinessUnit } from "./contract";
import { createInventoryHandler } from "./handler";
import type {
  InventoryAuditPort,
  InventoryM2mAuthenticator,
  InventoryObserver,
  InventoryRateLimitPort,
  InventoryRepository,
  InventoryScopeResolver,
} from "./ports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_RATE_LIMIT = 60;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_MAX_SOURCE_ROWS = 5_000;

export interface InventoryM2mBinding extends InventoryM2mCredential {
  clientId: string;
  businessUnits: readonly BusinessUnit[];
}

export interface InventoryRuntimeConfiguration {
  bindings: readonly InventoryM2mBinding[];
  timeoutMs: number;
  rateLimit: number;
  rateWindowMs: number;
  maxSourceRows: number;
}

export interface InventoryOperationalPorts {
  repository: InventoryRepository;
  rateLimit: InventoryRateLimitPort;
  audit: InventoryAuditPort;
  observer?: InventoryObserver;
}

export interface InventoryCompositionDependencies {
  loadConfiguration?: () => InventoryRuntimeConfiguration | null;
  createPorts?: (
    configuration: InventoryRuntimeConfiguration,
  ) => Promise<InventoryOperationalPorts | null>;
  now?: () => Date;
  createCorrelationId?: () => string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (record: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(record).every((key) => allowed.includes(key));

const parseInteger = (
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null => {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
};

const isIsoInstant = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const parseBinding = (value: unknown): InventoryM2mBinding | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["id", "secret", "permissions", "expiresAt", "clientId", "businessUnits"]) ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.secret !== "string" ||
    value.secret.trim().length === 0 ||
    typeof value.clientId !== "string" ||
    !UUID.test(value.clientId) ||
    !Array.isArray(value.permissions) ||
    value.permissions.some((permission) => typeof permission !== "string" || permission.length === 0) ||
    new Set(value.permissions).size !== value.permissions.length ||
    !Array.isArray(value.businessUnits) ||
    value.businessUnits.length === 0 ||
    value.businessUnits.some(
      (unit) => typeof unit !== "string" || !BUSINESS_UNITS.includes(unit as BusinessUnit),
    ) ||
    new Set(value.businessUnits).size !== value.businessUnits.length ||
    !(
      value.expiresAt === undefined ||
      (typeof value.expiresAt === "string" && isIsoInstant(value.expiresAt))
    )
  ) {
    return null;
  }

  return {
    id: value.id,
    secret: value.secret,
    permissions: [...value.permissions] as string[],
    ...(typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {}),
    clientId: value.clientId,
    businessUnits: [...value.businessUnits] as BusinessUnit[],
  };
};

/**
 * Lee la activación local sin conectarse a infraestructura. El JSON une cada
 * credencial M2M con una única identidad canónica; no existe un campo
 * client_name/tenant/company que pueda convertirse en autoridad.
 */
export function readInventoryRuntimeConfiguration(
  source: NodeJS.ProcessEnv = process.env,
): InventoryRuntimeConfiguration | null {
  if (source.WMS_INVENTORY_OPERATIONAL_ENABLED !== "1") return null;

  let rawBindings: unknown;
  try {
    rawBindings = JSON.parse(source.WMS_INVENTORY_M2M_BINDINGS_JSON ?? "");
  } catch {
    return null;
  }
  if (!Array.isArray(rawBindings) || rawBindings.length === 0) return null;

  const bindings = rawBindings.map(parseBinding);
  if (bindings.some((binding) => binding === null)) return null;
  const resolvedBindings = bindings as InventoryM2mBinding[];
  if (
    new Set(resolvedBindings.map(({ id }) => id)).size !== resolvedBindings.length ||
    new Set(resolvedBindings.map(({ secret }) => secret)).size !== resolvedBindings.length
  ) {
    return null;
  }

  const timeoutMs = parseInteger(
    source.WMS_INVENTORY_PORT_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    100,
    30_000,
  );
  const rateLimit = parseInteger(
    source.WMS_INVENTORY_RATE_LIMIT,
    DEFAULT_RATE_LIMIT,
    1,
    10_000,
  );
  const rateWindowMs = parseInteger(
    source.WMS_INVENTORY_RATE_WINDOW_MS,
    DEFAULT_RATE_WINDOW_MS,
    1_000,
    3_600_000,
  );
  const maxSourceRows = parseInteger(
    source.WMS_INVENTORY_MAX_SOURCE_ROWS,
    DEFAULT_MAX_SOURCE_ROWS,
    1,
    10_000,
  );
  if (timeoutMs === null || rateLimit === null || rateWindowMs === null || maxSourceRows === null) {
    return null;
  }

  return {
    bindings: resolvedBindings,
    timeoutMs,
    rateLimit,
    rateWindowMs,
    maxSourceRows,
  };
}

const unconfiguredAuthenticator: InventoryM2mAuthenticator = {
  async authenticate() {
    return { kind: "configuration_error" };
  },
};

const unconfiguredScopeResolver: InventoryScopeResolver = {
  async resolve() {
    throw new Error("P3-N2B scope resolver is not configured");
  },
};

const unconfiguredRepository: InventoryRepository = {
  async query() {
    throw new Error("P3-N2B repository adapter is not configured");
  },
};

const unconfiguredRateLimit: InventoryRateLimitPort = {
  async consume() {
    return { allowed: true, retryAfterMs: 0 };
  },
};

const unavailableAudit: InventoryAuditPort = {
  async record() {
    throw new Error("P3-N2B audit adapter is not configured");
  },
};

const noOpObserver: InventoryObserver = { emit() {} };

const createBoundScopeResolver = (
  bindings: readonly InventoryM2mBinding[],
): InventoryScopeResolver => {
  const scopes = new Map(
    bindings.map(({ id, clientId, businessUnits }) => [
      id,
      { clientId, businessUnits: [...businessUnits] },
    ]),
  );
  return {
    async resolve({ principal }) {
      const scope = scopes.get(principal.id);
      return scope ? { clientId: scope.clientId, businessUnits: [...scope.businessUnits] } : null;
    },
  };
};

const hasOperationalPorts = (value: unknown): value is InventoryOperationalPorts =>
  isRecord(value) &&
  isRecord(value.repository) &&
  typeof value.repository.query === "function" &&
  isRecord(value.rateLimit) &&
  typeof value.rateLimit.consume === "function" &&
  isRecord(value.audit) &&
  typeof value.audit.record === "function" &&
  (value.observer === undefined ||
    (isRecord(value.observer) && typeof value.observer.emit === "function"));

const createDefaultPorts = async (
  configuration: InventoryRuntimeConfiguration,
): Promise<InventoryOperationalPorts | null> => {
  const [{ createAdminClient }, { createSupabaseInventoryPorts }] = await Promise.all([
    import("@/lib/supabase/server"),
    import("./supabase-ports"),
  ]);
  const client = createAdminClient();
  return client ? createSupabaseInventoryPorts(client, configuration) : null;
};

/**
 * Fallback técnico deliberadamente fail-closed. La composición operativa nunca
 * lo sustituye silenciosamente: lo usa sólo si falta o es inválida una
 * dependencia/configuración completa.
 */
export const handleUnconfiguredInventory = createInventoryHandler({
  authenticator: unconfiguredAuthenticator,
  scopeResolver: unconfiguredScopeResolver,
  repository: unconfiguredRepository,
  rateLimit: unconfiguredRateLimit,
  audit: unavailableAudit,
  observer: noOpObserver,
});

/** Construye todas las dependencias por request; no conserva estado mutable entre llamadas. */
export function createInventoryRequestHandler(
  dependencies: InventoryCompositionDependencies = {},
) {
  const loadConfiguration =
    dependencies.loadConfiguration ?? (() => readInventoryRuntimeConfiguration());
  const createPorts = dependencies.createPorts ?? createDefaultPorts;

  return async function handleInventoryRequest(request: Request): Promise<Response> {
    let configuration: InventoryRuntimeConfiguration | null;
    let ports: InventoryOperationalPorts | null;
    try {
      configuration = loadConfiguration();
      if (!configuration) return handleUnconfiguredInventory(request);
      ports = await createPorts(configuration);
      if (!hasOperationalPorts(ports)) return handleUnconfiguredInventory(request);
    } catch {
      return handleUnconfiguredInventory(request);
    }

    const handler = createInventoryHandler({
      authenticator: createApiKeyM2mAuthenticator(configuration.bindings, dependencies.now),
      scopeResolver: createBoundScopeResolver(configuration.bindings),
      repository: ports.repository,
      rateLimit: ports.rateLimit,
      audit: ports.audit,
      observer: ports.observer ?? noOpObserver,
      ...(dependencies.now ? { now: dependencies.now } : {}),
      ...(dependencies.createCorrelationId
        ? { createCorrelationId: dependencies.createCorrelationId }
        : {}),
    });
    return handler(request);
  };
}

export async function handleInventoryRequest(request: Request): Promise<Response> {
  return createInventoryRequestHandler()(request);
}
