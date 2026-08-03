/**
 * P3-N1A0 · Guarda FAIL-CLOSED contra conexiones a producción.
 *
 * Es estructuralmente imposible que la suite abra una conexión a un proyecto
 * Supabase, a un host remoto o a una base cuyo nombre no lleve la marca de
 * test. La guarda corre ANTES de abrir el socket, no después.
 *
 * Sigue el patrón institucional de `src/lib/cron-auth.ts`: sin configuración
 * válida no se degrada a permisivo — se lanza. La lección ya está codificada
 * en el repositorio: "nunca fail-open".
 */

/** Marca obligatoria en el nombre de la base de datos de test. */
export const TEST_DB_PREFIX = "p3n1a0_test_";

/** Hosts aceptados. Cualquier otro valor es rechazado. */
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Fragmentos que delatan un destino remoto o gestionado. La comparación es
 * sobre la URL completa en minúsculas, de modo que también atrapa el caso en
 * que un project ref viaje en el usuario o en la contraseña.
 */
const FORBIDDEN_FRAGMENTS = [
  "supabase.co",
  "supabase.in",
  "supabase.com",
  "pooler.supabase",
  "amazonaws.com",
  "neon.tech",
  "render.com",
  "railway.app",
  "rds.",
];

/**
 * Project refs conocidos del ecosistema. Se rechazan de forma explícita además
 * de por host, para que un túnel o un alias de /etc/hosts tampoco sirva.
 *   arsksytgdnzukbmfgkju → Nexus OS producción (ERP)
 *   bmrtlojmqmkuirhuzhyt → Tops Connect B2B producción
 *   nwuxkwmtpbdiuvmvmwow → Nexus Creative producción
 */
const KNOWN_PROJECT_REFS = [
  "arsksytgdnzukbmfgkju",
  "bmrtlojmqmkuirhuzhyt",
  "nwuxkwmtpbdiuvmvmwow",
];

/** Variables de entorno productivas que jamás deben influir en la suite. */
const FORBIDDEN_ENV_VARS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
];

export class ProductionGuardError extends Error {
  constructor(message: string) {
    super(`[P3-N1A0 GUARD] ${message}`);
    this.name = "ProductionGuardError";
  }
}

/**
 * Valida una URL de conexión. Lanza `ProductionGuardError` si no es
 * inequívocamente local y de test. No devuelve booleano a propósito: un
 * booleano ignorado es un fail-open silencioso.
 */
export function assertLocalTestUrl(rawUrl: string): void {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new ProductionGuardError("URL de conexión vacía o inválida.");
  }

  const lowered = rawUrl.toLowerCase();

  for (const fragment of FORBIDDEN_FRAGMENTS) {
    if (lowered.includes(fragment)) {
      throw new ProductionGuardError(
        `URL contiene el fragmento remoto prohibido "${fragment}". Conexión abortada.`,
      );
    }
  }

  for (const ref of KNOWN_PROJECT_REFS) {
    if (lowered.includes(ref)) {
      throw new ProductionGuardError(
        `URL contiene un project ref conocido de producción. Conexión abortada.`,
      );
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ProductionGuardError(`URL de conexión no parseable.`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new ProductionGuardError(
      `Protocolo "${parsed.protocol}" no admitido; se espera postgres(ql).`,
    );
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new ProductionGuardError(
      `Host "${parsed.hostname}" no es loopback. Sólo se admite ${[...ALLOWED_HOSTS].join(", ")}.`,
    );
  }

  const dbName = parsed.pathname.replace(/^\//, "");
  if (!dbName) {
    throw new ProductionGuardError("La URL no especifica nombre de base de datos.");
  }
  if (!dbName.startsWith(TEST_DB_PREFIX)) {
    throw new ProductionGuardError(
      `La base "${dbName}" no lleva el prefijo obligatorio "${TEST_DB_PREFIX}". Conexión abortada.`,
    );
  }
}

/**
 * Verifica que el proceso no esté contaminado con credenciales productivas.
 * Correr la suite no debe requerir ninguna clave real; si alguna está
 * presente, es señal de que se cargó un `.env` productivo por error.
 */
export function assertNoProductionEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const present = FORBIDDEN_ENV_VARS.filter((k) => (env[k] ?? "").trim() !== "");
  if (present.length > 0) {
    throw new ProductionGuardError(
      `Variables productivas presentes en el entorno: ${present.join(", ")}. ` +
        `La suite no requiere ninguna credencial real; abortada para evitar uso accidental.`,
    );
  }
}

/** Genera un nombre de base único que siempre satisface la guarda. */
export function makeTestDbName(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${TEST_DB_PREFIX}${process.pid}_${rand}`;
}
