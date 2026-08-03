/**
 * P3-N1A0 · Guarda compartida para los scripts .mjs del harness (M-01 de la
 * segunda revisión C4).
 *
 * Los scripts no pueden importar los módulos TypeScript sin un paso de build,
 * y la revisión encontró que `assert-no-residual-databases.mjs` aplicaba una
 * guarda reducida y divergente de `connectGuarded`. Este módulo replica las
 * MISMAS reglas — host único, sin query, decodificación, patrones prohibidos,
 * variables libpq y version gate — y la PARIDAD con `guard.ts` /
 * `version-gate.ts` está verificada por t-a0-14-script-guards.test.ts, que
 * ejecuta los mismos vectores contra ambas implementaciones y exige veredictos
 * idénticos.
 */

export const TEST_DB_PREFIX = "p3n1a0_test_";
export const ONLY_ALLOWED_HOST = "127.0.0.1";
export const MIN_SERVER_VERSION_NUM = 170_000;
export const MAX_SERVER_VERSION_NUM = 180_000; // exclusivo

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
  "azure.com",
  "googleapis.com",
  "digitalocean.com",
  "heroku",
  "planetscale",
  "cockroachlabs",
  "timescale",
];

const KNOWN_PROJECT_REFS = [
  "arsksytgdnzukbmfgkju",
  "bmrtlojmqmkuirhuzhyt",
  "nwuxkwmtpbdiuvmvmwow",
];

export const FORBIDDEN_ENV_VARS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGPASSFILE",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGSSLCERT",
  "PGSSLKEY",
  "PGREQUIRESSL",
  "PGOPTIONS",
  "PGCONNECT_TIMEOUT",
  "PGCHANNELBINDING",
  "PGTARGETSESSIONATTRS",
  "PGGSSENCMODE",
  "PGKRBSRVNAME",
];

export class ProductionGuardError extends Error {
  constructor(message) {
    super(`[P3-N1A0 GUARD] ${message}`);
    this.name = "ProductionGuardError";
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function redact(value) {
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}…*** (${value.length} car.)`;
}

function findForbidden(haystack) {
  const lowered = haystack.toLowerCase();
  for (const fragment of FORBIDDEN_FRAGMENTS) {
    if (lowered.includes(fragment)) return `fragmento remoto "${fragment}"`;
  }
  for (const ref of KNOWN_PROJECT_REFS) {
    if (lowered.includes(ref)) return "un project ref conocido de producción";
  }
  return null;
}

export function assertLocalTestUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new ProductionGuardError("URL de conexión vacía o inválida.");
  }
  const rawHit = findForbidden(rawUrl);
  if (rawHit) {
    throw new ProductionGuardError(`La URL contiene ${rawHit}. Conexión abortada.`);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ProductionGuardError("URL de conexión no parseable.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new ProductionGuardError(
      `Protocolo "${parsed.protocol}" no admitido; se espera postgres(ql).`,
    );
  }

  if (parsed.search !== "") {
    throw new ProductionGuardError(
      "La URL incluye query parameters. No se admite ninguno: pueden " +
        "redirigir el destino efectivo (?host=, ?port=, ?dbname=, ?sslmode=, " +
        "?service=) o forzar un socket Unix. Conexión abortada.",
    );
  }

  if (parsed.hostname !== ONLY_ALLOWED_HOST) {
    throw new ProductionGuardError(
      `Host "${parsed.hostname}" no admitido. El único destino permitido es ` +
        `${ONLY_ALLOWED_HOST} (literal numérica: sin localhost, sin ::1, sin ` +
        `hostnames, sin DNS, sin sockets Unix).`,
    );
  }

  const components = [
    ["usuario", parsed.username],
    ["contraseña", parsed.password],
    ["ruta", parsed.pathname],
  ];
  for (const [label, raw] of components) {
    if (raw === "") continue;
    const decoded = safeDecode(raw);
    if (decoded === null) {
      throw new ProductionGuardError(
        `El componente "${label}" no se puede decodificar de forma ` +
          `determinista (${redact(raw)}). Conexión abortada.`,
      );
    }
    const hit = findForbidden(decoded);
    if (hit) {
      throw new ProductionGuardError(
        `El componente "${label}" contiene ${hit} tras decodificar ` +
          `(${redact(decoded)}). Conexión abortada.`,
      );
    }
  }

  const rawPath = parsed.pathname.replace(/^\//, "");
  if (!rawPath) {
    throw new ProductionGuardError("La URL no especifica nombre de base de datos.");
  }
  const dbName = safeDecode(rawPath);
  if (dbName === null) {
    throw new ProductionGuardError("El nombre de base no se puede decodificar. Conexión abortada.");
  }
  if (!dbName.startsWith(TEST_DB_PREFIX)) {
    throw new ProductionGuardError(
      `La base "${redact(dbName)}" no lleva el prefijo obligatorio "${TEST_DB_PREFIX}". Conexión abortada.`,
    );
  }
  if (dbName.includes("/")) {
    throw new ProductionGuardError("El nombre de base contiene '/': no es un identificador simple.");
  }
}

export function assertLocalMaintenanceUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ProductionGuardError("URL de mantenimiento no parseable.");
  }
  const dbName = safeDecode(parsed.pathname.replace(/^\//, ""));
  if (dbName !== "postgres") {
    throw new ProductionGuardError(
      `La URL de mantenimiento debe apuntar a la base "postgres"; apunta a ` +
        `"${dbName === null ? "<no decodificable>" : redact(dbName)}".`,
    );
  }
  const probe = new URL(rawUrl);
  probe.pathname = `/${TEST_DB_PREFIX}maintenance_probe`;
  assertLocalTestUrl(probe.toString());
}

export function assertNoProductionEnv(env = process.env) {
  const present = FORBIDDEN_ENV_VARS.filter((k) => (env[k] ?? "").trim() !== "");
  if (present.length > 0) {
    throw new ProductionGuardError(
      `Variables prohibidas presentes en el entorno: ${present.join(", ")}. ` +
        `La suite no requiere ninguna credencial real y no admite overrides de ` +
        `libpq: pueden cambiar el destino efectivo sin que la URL lo delate. Abortada.`,
    );
  }
}

export function parseAndCheckServerVersion(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new ProductionGuardError(
      `PostgreSQL no soportado: server_version_num ausente o de tipo inesperado (${typeof raw}).`,
    );
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    throw new ProductionGuardError(
      `PostgreSQL no soportado: server_version_num no numérico ("${text.slice(0, 32)}").`,
    );
  }
  const num = Number.parseInt(text, 10);
  if (num < MIN_SERVER_VERSION_NUM || num >= MAX_SERVER_VERSION_NUM) {
    const major = Math.floor(num / 10_000);
    throw new ProductionGuardError(
      `PostgreSQL no soportado: server_version_num=${num} (major ${major}). Se exige la serie 17.`,
    );
  }
  return num;
}
