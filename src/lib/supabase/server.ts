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
