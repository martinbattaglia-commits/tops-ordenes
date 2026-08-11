import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Cliente Supabase para Server Components / Server Actions / Route Handlers.
 * Maneja cookies vía la API de Next 14.
 *
 * En demo mode (sin env vars) devolvemos null — todo el data layer chequea
 * esto antes de query.
 */
export function createClient() {
  if (!env.supabase.configured) {
    return null;
  }
  const cookieStore = cookies();
  return createServerClient(env.supabase.url!, env.supabase.anonKey!, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // En Server Components no podemos set cookies — esto se llama
          // luego desde middleware/actions y el error es esperable.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // ver comentario arriba
        }
      },
    },
  });
}

/**
 * Cliente con SERVICE ROLE (sin RLS). Usar SOLO en server actions
 * para operaciones administrativas — jamás exponer al cliente.
 */
export function createAdminClient() {
  if (!env.supabase.url || !env.supabase.serviceRoleKey) return null;
  return createServerClient(env.supabase.url, env.supabase.serviceRoleKey, {
    cookies: {
      get: () => undefined,
      set: () => undefined,
      remove: () => undefined,
    },
  });
}

/**
 * W22-TER-C2 · TRANSPORTE SIN REINTENTOS PARA RPC MUTANTES DE CUSTODIA
 *
 * ─── QUÉ HACE ESTA VERSIÓN DE SUPABASE, VERIFICADO ────────────────────────
 *
 * `postgrest-js` 2.106.2 sólo reintenta métodos IDEMPOTENTES:
 *
 *     shouldRetry(method, status, attempt, enabled)
 *       → RETRYABLE_METHODS = ["GET", "HEAD", "OPTIONS"]
 *       → RETRYABLE_STATUS_CODES = [520, 503]
 *
 * `.rpc()` viaja como POST, así que hoy NO se reintenta. Y `supabase-js`
 * construye el `PostgrestClient` con `{ headers, schema, fetch, timeout,
 * urlLengthLimit }`: no propaga ninguna opción `retry`, que ni siquiera existe
 * en sus tipos. Pasar `db: { retry: false }` sería un no-op silencioso.
 *
 * ─── POR QUÉ IGUAL SE PONE UN GUARD ───────────────────────────────────────
 *
 * La garantía de "exactamente una invocación" no puede depender de que una
 * lista interna de la librería siga sin incluir POST. Si una versión futura
 * ampliara `RETRYABLE_METHODS`, `attach_custody_evidence` —que NO es
 * idempotente— podría ejecutarse dos veces y la segunda devolver `23505`
 * mientras la primera ya confirmó. Este transporte lo vuelve imposible por
 * construcción: cuenta los intentos y ABORTA el segundo de un método mutante.
 *
 * Es un cliente ACOTADO a Custodia. `createClient()` y `createAdminClient()`
 * quedan intactos: el resto de Nexus no cambia de comportamiento.
 */

const NON_IDEMPOTENT_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export class NonIdempotentRetryBlockedError extends Error {
  constructor() {
    super("reintento bloqueado sobre una operación no idempotente");
    this.name = "NonIdempotentRetryBlockedError";
  }
}

export interface NoRetryTransport {
  /** `fetch` a inyectar en el cliente. */
  fetch: typeof globalThis.fetch;
  /** Intentos observados por (método + URL). */
  attempts(method: string, url: string): number;
  /**
   * Intentos observados SOBRE LA RPC indicada.
   *
   * W22-TER-C4 · O-3 · Es lo único que puede alimentar la clasificación
   * determinista/ambigua. `total()` cuenta cualquier tráfico del transporte
   * —un refresh de token, una precarga, un `GET` colateral—, y usarlo hacía que
   * una llamada ajena degradara silenciosamente un rechazo inequívoco a
   * ambiguo. La clasificación tiene que mirar el intento RELEVANTE y sólo ése.
   */
  rpcAttempts(fnName: string): number;
  /** Total de invocaciones del transporte. Diagnóstico, NO clasificación. */
  total(): number;
}

/**
 * Envoltorio de `fetch` que cuenta intentos y bloquea el SEGUNDO de un método
 * mutante contra la misma URL. El cliente se crea por operación, así que un
 * segundo POST a la misma URL sólo puede ser un reintento automático.
 */
export function noRetryTransport(base?: typeof globalThis.fetch): NoRetryTransport {
  const counts = new Map<string, number>();
  const impl = base ?? globalThis.fetch;
  let total = 0;
  const wrapped: typeof globalThis.fetch = async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const key = `${method} ${url}`;
    const seen = (counts.get(key) ?? 0) + 1;
    counts.set(key, seen);
    total += 1;
    if (seen > 1 && NON_IDEMPOTENT_METHODS.has(method)) {
      // Un reintento sobre una mutación no idempotente no se deja pasar: la
      // primera ejecución pudo haber confirmado.
      throw new NonIdempotentRetryBlockedError();
    }
    return impl(input, init);
  };
  return {
    fetch: wrapped,
    attempts: (method, url) => counts.get(`${method.toUpperCase()} ${url}`) ?? 0,
    rpcAttempts: (fnName) => {
      // La URL de PostgREST para una RPC es `<base>/rest/v1/rpc/<fn>` y puede
      // traer query string. Se compara el segmento exacto para que
      // `attach_custody_evidence` no cuente los intentos de
      // `attach_custody_evidence_v2` ni al revés.
      const needle = `/rpc/${fnName}`;
      let seen = 0;
      for (const [key, n] of counts) {
        const [method, url] = [key.slice(0, key.indexOf(" ")), key.slice(key.indexOf(" ") + 1)];
        if (!NON_IDEMPOTENT_METHODS.has(method)) continue;
        const path = url.split("?")[0];
        if (path.endsWith(needle)) seen = Math.max(seen, n);
      }
      return seen;
    },
    total: () => total,
  };
}

/** Cliente de SESIÓN para RPC mutantes de Custodia. Cookies preservadas. */
export function createCustodyMutationClient(transport: NoRetryTransport = noRetryTransport()) {
  if (!env.supabase.configured) return null;
  const cookieStore = cookies();
  return createServerClient(env.supabase.url!, env.supabase.anonKey!, {
    global: { fetch: transport.fetch },
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // ver createClient()
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // ver createClient()
        }
      },
    },
  });
}

/** Cliente SERVICE-ROLE para RPC mutantes internas de Custodia. Sin cookies. */
export function createCustodyAdminMutationClient(
  transport: NoRetryTransport = noRetryTransport(),
) {
  if (!env.supabase.url || !env.supabase.serviceRoleKey) return null;
  return createServerClient(env.supabase.url, env.supabase.serviceRoleKey, {
    global: { fetch: transport.fetch },
    cookies: { get: () => undefined, set: () => undefined, remove: () => undefined },
  });
}
