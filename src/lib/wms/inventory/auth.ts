import { timingSafeStringEqual } from "@/lib/cron-auth";
import type {
  InventoryM2mAuthenticator,
  M2mAuthenticationResult,
  M2mPrincipal,
} from "./ports";

export interface InventoryM2mCredential {
  id: string;
  secret: string;
  permissions: readonly string[];
  expiresAt?: string;
}

const isIsoInstant = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

export function createApiKeyM2mAuthenticator(
  credentials: readonly InventoryM2mCredential[],
  now: () => Date = () => new Date(),
): InventoryM2mAuthenticator {
  const configurationValid =
    credentials.length > 0 &&
    credentials.every(
      (credential) =>
        credential.id.trim().length > 0 &&
        credential.secret.trim().length > 0 &&
        new Set(credentials.map(({ id }) => id)).size === credentials.length &&
        (credential.expiresAt === undefined || isIsoInstant(credential.expiresAt)),
    );

  return {
    async authenticate(authorization): Promise<M2mAuthenticationResult> {
      if (!configurationValid) return { kind: "configuration_error" };

      let matched: InventoryM2mCredential | undefined;
      for (const credential of credentials) {
        if (timingSafeStringEqual(authorization ?? "", `Bearer ${credential.secret}`)) {
          matched = credential;
        }
      }

      if (!matched) return { kind: "unauthenticated" };
      if (matched.expiresAt && Date.parse(matched.expiresAt) <= now().getTime()) {
        return { kind: "unauthenticated" };
      }

      const principal: M2mPrincipal = {
        id: matched.id,
        permissions: [...matched.permissions],
      };
      return { kind: "authenticated", principal };
    },
  };
}
