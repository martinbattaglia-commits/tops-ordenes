/**
 * Stub de `@/lib/supabase/server`. Permite inyectar el cliente de sesión que ven
 * las Server Actions sin tocar red, cookies ni Supabase.
 */
let sessionClient = null;
let adminClient = null;
export function __setSessionClient(c) { sessionClient = c; }
export function __setAdminClient(c) { adminClient = c; }
export function createClient() { return sessionClient; }
export function createAdminClient() { return adminClient; }
export function createCustodyMutationClient() { return sessionClient; }
export function createCustodyAdminMutationClient() { return adminClient; }
export function noRetryTransport() {
  return { fetch: globalThis.fetch, attempts: () => 0, rpcAttempts: () => 0, total: () => 0 };
}
export class NonIdempotentRetryBlockedError extends Error {}
