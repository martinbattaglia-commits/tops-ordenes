/**
 * Lectura tipada y centralizada de variables de entorno.
 * Si Supabase no está configurado, la app cae en modo demo automáticamente
 * (queda usable para evaluar la UI sin aprovisionar la DB).
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const env = {
  supabase: {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    configured: Boolean(supabaseUrl && supabaseAnonKey),
  },
  app: {
    url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    demoMode:
      process.env.NEXT_PUBLIC_DEMO_MODE === "1" ||
      !supabaseUrl ||
      !supabaseAnonKey,
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
} as const;

export type Env = typeof env;
