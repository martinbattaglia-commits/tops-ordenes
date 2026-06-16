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

/**
 * Decodifica un PEM entregado por env. Acepta PEM crudo (contiene "BEGIN") o
 * base64 del PEM (recomendado en Netlify para evitar problemas de newlines).
 * Vacío si no está seteado o no decodifica.
 */
const decodePem = (raw?: string): string => {
  const v = raw?.trim();
  if (!v) return "";
  if (v.includes("BEGIN")) return v;
  try {
    return Buffer.from(v, "base64").toString("utf8");
  } catch {
    return "";
  }
};

const arcaCertPem = decodePem(process.env.ARCA_CERT_PEM);
const arcaKeyPem = decodePem(process.env.ARCA_KEY_PEM);
const arcaCertPath = process.env.ARCA_CERT_PATH?.trim() ?? "";
const arcaKeyPath = process.env.ARCA_KEY_PATH?.trim() ?? "";

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
  rbac: {
    /**
     * H1 — fail-open de bootstrap: cuando `user_roles` está GLOBALMENTE vacía,
     * checkPermission permite (RBAC dormido) para no bloquear antes de seedear.
     * Con `RBAC_ENFORCE=1` ese caso pasa a **fail-closed** (403). Activar SOLO
     * después de seedear `user_roles` en producción (si no, lockout total).
     */
    enforce: process.env.RBAC_ENFORCE === "1",
  },
  email: {
    resendKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL ?? "TOPS Órdenes <ordenes@logisticatops.com>",
    admin: {
      ruth: process.env.EMAIL_ADMIN_RUTH ?? "ruth@logisticatops.com",
      joseluis: process.env.EMAIL_ADMIN_JOSELUIS ?? "joseluis@logisticatops.com",
    },
    depot: {
      magaldi: process.env.EMAIL_DEPOT_MAGALDI ?? "despachos-magaldi@logisticatops.com",
      lujan: process.env.EMAIL_DEPOT_LUJAN ?? "despachos-lujan@logisticatops.com",
    },
  },
  clientify: {
    apiKey: process.env.CLIENTIFY_API_KEY?.trim() ?? "",
    baseUrl: process.env.CLIENTIFY_BASE_URL?.trim() || "https://api.clientify.net/v1",
    configured: Boolean(process.env.CLIENTIFY_API_KEY?.trim()),
    // F2.2-2 · token secreto de la URL del webhook (Clientify NO firma → no es clave HMAC).
    webhookSecret: process.env.CLIENTIFY_WEBHOOK_SECRET?.trim() ?? "",
    webhookConfigured: Boolean(process.env.CLIENTIFY_WEBHOOK_SECRET?.trim()),
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
  tracking: {
    /** Token compartido que el dispositivo Traccar envía en /api/tracking/ingest. */
    ingestToken: process.env.TRACKING_INGEST_TOKEN?.trim() ?? "",
    /**
     * Access token público de Mapbox GL JS (cliente). El mapa en vivo lo lee
     * desde acá; si está vacío, la UI cae al fallback AmbaMap sin romper.
     * Se configura en .env.local / Netlify — NUNCA hardcodeado en repo.
     */
    mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() ?? "",
    /** True si el mapa Mapbox puede renderizar (token presente). */
    mapEnabled: Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim()),
    /** True si la ingesta está habilitada (token presente). */
    configured: Boolean(process.env.TRACKING_INGEST_TOKEN?.trim()),
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
    /** CUIT del emisor (sin guiones). Fuente real: fiscal_config.cuit. */
    cuit: process.env.ARCA_CUIT?.replace(/\D/g, "") ?? "",
    /** Alias/ruta del certificado X.509 en el host (la key jamás en repo/DB). */
    certPath: arcaCertPath,
    keyPath: arcaKeyPath,
    /**
     * Contenido PEM del cert/clave entregado por env (base64 o PEM crudo). Vía
     * recomendada en runtimes serverless (Netlify Functions) donde NO hay
     * filesystem persistente en certPath/keyPath. La clave privada vive SOLO en
     * memoria durante la firma; jamás se loguea ni se persiste en repo/DB.
     */
    certPem: arcaCertPem,
    keyPem: arcaKeyPem,
    /**
     * Firmador CMS/PKCS#7 del TRA. `forge` = puro-JS (node-forge), portable a
     * runtime serverless sin binario externo (default, recomendado por GATE 3).
     * `openssl` = binario del host (requiere `openssl` disponible en runtime).
     */
    cmsSigner: (process.env.ARCA_CMS_SIGNER?.trim().toLowerCase() === "openssl"
      ? "openssl"
      : "forge") as "forge" | "openssl",
    /** True si ARCA_WSAA_URL fue seteada explícitamente (override de ambiente). */
    wsaaUrlExplicit: Boolean(process.env.ARCA_WSAA_URL?.trim()),
    wsfev1UrlExplicit: Boolean(process.env.ARCA_WSFEV1_URL?.trim()),
    /** URLs oficiales de WSAA/WSFEv1 (host afip.gov.ar — no cambiar). */
    wsaaUrl:
      process.env.ARCA_WSAA_URL?.trim() ||
      "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfev1Url:
      process.env.ARCA_WSFEV1_URL?.trim() ||
      "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
    /**
     * Margen de seguridad (segundos) para renovar el TA de WSAA antes de su
     * expiración real. Default 600 s (10 min).
     */
    taMarginSeconds:
      parseInt(process.env.ARCA_TA_MARGIN_SECONDS ?? "600", 10) || 600,
    /**
     * Permite el fallback a Mock cuando faltan credenciales en ambientes NO
     * productivos (útil en dev/preview). NUNCA aplica a PRODUCCION: si el
     * ambiente es PRODUCCION y faltan credenciales, debe fallar con ConfigError
     * (jamás simular un CAE real). Default: false.
     */
    allowMockFallback: process.env.ARCA_ALLOW_MOCK_FALLBACK === "1",
    /**
     * Credenciales presentes → listo para producción real. Acepta cualquiera de
     * las dos vías: archivos en disco (path) o contenido PEM en env (serverless).
     */
    configured: Boolean(
      (arcaCertPath && arcaKeyPath) || (arcaCertPem && arcaKeyPem)
    ),
  },
  openai: {
    /** API key para OCR/extracción de documentos (facturas proveedor, etc.). */
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
    /** Modelo por defecto. gpt-4o-mini = barato y suficiente para facturas. */
    ocrModel: process.env.OPENAI_OCR_MODEL?.trim() || "gpt-4o-mini",
    configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
  },
  google: {
    /** JSON de la Service Account de Drive (línea única). Compartida como lector. */
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ?? "",
    /** Carpeta raíz a la que está acotada la SA (scope). */
    driveRootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim() ?? "",
    /** True si la integración Drive corporativa está disponible. */
    configured: Boolean(
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() &&
        process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim(),
    ),
  },
  contratos: {
    /**
     * Carpeta «Comercial → Cynthia → Clientes» (fuente de verdad operativa).
     * Preferido: ID directo de la carpeta. Si está vacío, el motor resuelve por
     * nombre con `driveSubpath` partiendo del root de la SA.
     */
    driveFolderId: process.env.CONTRATOS_DRIVE_FOLDER_ID?.trim() ?? "",
    /** Ruta por nombre desde el root (fallback si no hay id directo). */
    driveSubpath: process.env.CONTRATOS_DRIVE_PATH?.trim() || "Comercial/Cynthia/Clientes",
    /** ¿Extraer texto (texto nativo → Docs → Sheets → PDF → OCR) en el sync? */
    extractText: process.env.CONTRATOS_SYNC_EXTRACT_TEXT !== "0",
  },
  compliance: {
    /**
     * Carpeta regulatoria en Drive («AGENCIA GUBERNAMENTAL DE CONTROL» —
     * habilitaciones, certificados, ANMAT, ambiental, seguros). Fuente documental
     * de verdad del Compliance Cockpit (/anmat).
     * Preferido: ID directo. Si está vacío, el motor resuelve por nombre con
     * `driveSubpath` partiendo del root de la SA.
     */
    driveFolderId: process.env.COMPLIANCE_DRIVE_FOLDER_ID?.trim() ?? "",
    /** Ruta por nombre desde el root (fallback si no hay id directo). */
    driveSubpath:
      process.env.COMPLIANCE_DRIVE_PATH?.trim() || "AGENCIA GUBERNAMENTAL DE CONTROL",
    /**
     * ¿Intentar extraer fechas del contenido del PDF (además del nombre)? Off por
     * defecto: la extracción por nombre/metadata es robusta; el parseo de PDF es
     * opcional y costoso. Activar con COMPLIANCE_SYNC_EXTRACT_TEXT=1.
     */
    extractText: process.env.COMPLIANCE_SYNC_EXTRACT_TEXT === "1",
  },
  cron: {
    /** Secreto Bearer que exigen los endpoints de jobs (sync diario, etc.). */
    secret: process.env.CRON_SECRET?.trim() ?? "",
    configured: Boolean(process.env.CRON_SECRET?.trim()),
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
