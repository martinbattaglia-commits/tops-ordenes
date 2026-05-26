/**
 * Lectura tipada y centralizada de variables de entorno.
 *
 * Reglas de modo:
 *  - PRODUCCIÓN (default): Supabase es obligatorio. Si falta, los data accessors
 *    lanzan un error claro en lugar de caer en mock.
 *  - DEMO MODE: solo se activa si `NEXT_PUBLIC_DEMO_MODE=1` está seteado de
 *    forma explícita. Útil para evaluación de UI sin DB.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

const explicitDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

export const env = {
  supabase: {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    configured: Boolean(supabaseUrl && supabaseAnonKey),
  },
  app: {
    url:
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.NODE_ENV === "production"
        ? "https://tops-ordenes.netlify.app"
        : "http://localhost:3030"),
    /** Solo true si fue forzado explícitamente. Sin keys → NO es demo, es error. */
    demoMode: explicitDemo,
    /** Para mensajes de error: la DB falta */
    needsSupabase: !supabaseUrl || !supabaseAnonKey,
  },
  email: {
    resendKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL ?? "TOPS Órdenes <ordenes@logisticatops.com>",
    admin: {
      ruth: process.env.EMAIL_ADMIN_RUTH ?? "ruth@logisticatops.com",
      joseluis: process.env.EMAIL_ADMIN_JOSELUIS ?? "joseluis@logisticatops.com",
    },
    depot: {
      magaldi: process.env.EMAIL_DEPOT_MAGALDI ?? "juancarlos@logisticatops.com",
      lujan: process.env.EMAIL_DEPOT_LUJAN ?? "despachos@logisticatops.com",
    },
  },
  clientify: {
    apiKey: process.env.CLIENTIFY_API_KEY?.trim() ?? "",
    baseUrl: process.env.CLIENTIFY_BASE_URL?.trim() || "https://api.clientify.net/v1",
    configured: Boolean(process.env.CLIENTIFY_API_KEY?.trim()),
  },
} as const;

/**
 * Garantiza que Supabase esté disponible. Llamar al inicio de cualquier
 * server action o route handler que requiera DB.
 */
export function requireSupabase(): void {
  if (env.app.demoMode) return; // demo explícito: caller decide
  if (env.app.needsSupabase) {
    throw new Error(
      "Supabase no está configurado. Setea NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY en el entorno. Para evaluación sin DB, podés forzar NEXT_PUBLIC_DEMO_MODE=1."
    );
  }
}

export type Env = typeof env;
