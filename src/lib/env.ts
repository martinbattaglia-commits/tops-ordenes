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
        ? "https://nexus.logisticatops.com"
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
  whatsapp: {
    provider: (process.env.WHATSAPP_PROVIDER ?? "meta") as "meta" | "twilio" | "none",
    metaToken: process.env.META_WA_TOKEN?.trim() ?? "",
    phoneNumberId: process.env.META_WA_PHONE_NUMBER_ID?.trim() ?? "",
    businessAccountId: process.env.META_WA_BUSINESS_ACCOUNT_ID?.trim() ?? "",
    notifyDefault: process.env.WHATSAPP_NOTIFY_DEFAULT?.trim() ?? "",
    configured: Boolean(
      process.env.META_WA_TOKEN?.trim() && process.env.META_WA_PHONE_NUMBER_ID?.trim()
    ),
  },
  arca: {
    /**
     * Ambiente por defecto si la DB no responde. La fuente de verdad real
     * es `fiscal_config.ambiente` (administrable). SANDBOX = Mock local.
     */
    ambiente: (process.env.ARCA_AMBIENTE?.trim().toUpperCase() ?? "SANDBOX") as
      | "SANDBOX"
      | "HOMOLOGACION"
      | "PRODUCCION",
    /** Alias/ruta del certificado X.509 en el host (la key jamás en repo/DB). */
    certPath: process.env.ARCA_CERT_PATH?.trim() ?? "",
    keyPath: process.env.ARCA_KEY_PATH?.trim() ?? "",
    /** URLs oficiales de WSAA/WSFEv1 (host afip.gov.ar — no cambiar). */
    wsaaUrl:
      process.env.ARCA_WSAA_URL?.trim() ||
      "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfev1Url:
      process.env.ARCA_WSFEV1_URL?.trim() ||
      "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
    /** Credenciales presentes → listo para producción real. */
    configured: Boolean(
      process.env.ARCA_CERT_PATH?.trim() && process.env.ARCA_KEY_PATH?.trim()
    ),
  },
  hikvision: {
    host: process.env.HIKVISION_HOST?.trim() ?? "",
    httpPort: parseInt(process.env.HIKVISION_HTTP_PORT ?? "80", 10) || 80,
    httpsPort: parseInt(process.env.HIKVISION_HTTPS_PORT ?? "443", 10) || 443,
    rtspPort: parseInt(process.env.HIKVISION_RTSP_PORT ?? "554", 10) || 554,
    useHttps: process.env.HIKVISION_USE_HTTPS === "1",
    user: process.env.HIKVISION_USER?.trim() ?? "",
    password: process.env.HIKVISION_PASSWORD ?? "",
    channels: parseInt(process.env.HIKVISION_CHANNELS ?? "16", 10) || 16,
    configured: Boolean(
      process.env.HIKVISION_HOST &&
        process.env.HIKVISION_USER &&
        process.env.HIKVISION_PASSWORD
    ),
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
