import { rateLimit } from "@/lib/rate-limit";
import { createInventoryHandler } from "./handler";
import type {
  InventoryAuditPort,
  InventoryM2mAuthenticator,
  InventoryObserver,
  InventoryRateLimitPort,
  InventoryRepository,
  InventoryScopeResolver,
} from "./ports";

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

const localRateLimit: InventoryRateLimitPort = {
  async consume({ actorFingerprint, scopeFingerprint }) {
    const result = rateLimit(`p3-n2a:${actorFingerprint}:${scopeFingerprint}`, {
      limit: 60,
      windowMs: 60_000,
    });
    return { allowed: result.ok, retryAfterMs: result.retryAfterMs };
  },
};

const unavailableAudit: InventoryAuditPort = {
  async record() {
    throw new Error("P3-N2B audit adapter is not configured");
  },
};

const noOpObserver: InventoryObserver = { emit() {} };

/**
 * Composición deliberadamente fail-closed. P3-N2B debe inyectar credenciales,
 * alcance, repositorio y auditoría reales antes de habilitar operativamente la ruta.
 */
export const handleUnconfiguredInventory = createInventoryHandler({
  authenticator: unconfiguredAuthenticator,
  scopeResolver: unconfiguredScopeResolver,
  repository: unconfiguredRepository,
  rateLimit: localRateLimit,
  audit: unavailableAudit,
  observer: noOpObserver,
});
