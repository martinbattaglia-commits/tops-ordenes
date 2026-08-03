/**
 * P3-N1A0 · Guarda FAIL-CLOSED contra conexiones a producción.
 *
 * Endurecida tras el hallazgo B-01 de la revisión C4: la versión anterior
 * admitía `localhost` / `::1` e ignoraba los query parameters, de modo que un
 * `?host=` podía redirigir la conexión efectiva de node-postgres a un destino
 * remoto pese a que la URL declarara loopback.
 *
 * Reglas definitivas:
 *   · un ÚNICO host admitido, numérico: 127.0.0.1. Sin `localhost`, sin `::1`,
 *     sin hostnames, sin DNS, sin alias, sin sockets Unix. Restringirlo a una
 *     literal numérica elimina de raíz la resolución de nombres y las
 *     diferencias entre parsers;
 *   · cualquier query string es rechazada sin interpretarse: en P3-N1A0 no hay
 *     ni un parámetro legítimo, así que no hay allowlist que mantener;
 *   · usuario, contraseña y base se decodifican antes de inspeccionarse, y los
 *     patrones prohibidos se buscan tanto sobre el valor decodificado como
 *     sobre la representación original;
 *   · toda variable libpq capaz de alterar el destino efectivo es motivo de
 *     aborto, no sólo las credenciales de Supabase.
 *
 * Sigue el patrón institucional de `src/lib/cron-auth.ts`: sin configuración
 * válida no se degrada a permisivo — se lanza.
 */

/** Marca obligatoria en el nombre de la base de datos de test. */
export const TEST_DB_PREFIX = "p3n1a0_test_";

/** Único host admitido. Literal numérica, deliberadamente sin alternativas. */
export const ONLY_ALLOWED_HOST = "127.0.0.1";

/**
 * Fragmentos que delatan un destino remoto o gestionado. Se buscan sobre la
 * URL completa y sobre cada componente decodificado.
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
  "azure.com",
  "googleapis.com",
  "digitalocean.com",
  "heroku",
  "planetscale",
  "cockroachlabs",
  "timescale",
];

/**
 * Project refs conocidos del ecosistema. Se rechazan explícitamente además de
 * por host, para que un túnel, un alias o un ref percent-encoded tampoco sirvan.
 *   arsksytgdnzukbmfgkju → Nexus OS producción (ERP)
 *   bmrtlojmqmkuirhuzhyt → Tops Connect B2B producción
 *   nwuxkwmtpbdiuvmvmwow → Nexus Creative producción
 */
const KNOWN_PROJECT_REFS = [
  "arsksytgdnzukbmfgkju",
  "bmrtlojmqmkuirhuzhyt",
  "nwuxkwmtpbdiuvmvmwow",
];

/**
 * Variables que jamás deben influir en la suite.
 *
 * Incluye credenciales productivas Y todo el juego libpq: node-postgres cae en
 * `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSERVICE`, etc.
 * cuando el connection string no fija ese campo, de modo que una variable de
 * entorno puede desviar el destino efectivo sin que la URL lo delate.
 */
const FORBIDDEN_ENV_VARS = [
  // credenciales productivas
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
  // libpq: destino
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
] as const;

export class ProductionGuardError extends Error {
  constructor(message: string) {
    super(`[P3-N1A0 GUARD] ${message}`);
    this.name = "ProductionGuardError";
  }
}

/**
 * Percent-decoding seguro. Devuelve `null` si la secuencia es inválida: una
 * URL que no se puede decodificar de forma determinista no se interpreta, se
 * rechaza.
 */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Recorta un valor para el mensaje de error: nunca se imprime completo. */
function redact(value: string): string {
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}…${"*".repeat(3)} (${value.length} car.)`;
}

/** Busca fragmentos y refs prohibidos en un texto ya normalizado. */
function findForbidden(haystack: string): string | null {
  const lowered = haystack.toLowerCase();
  for (const fragment of FORBIDDEN_FRAGMENTS) {
    if (lowered.includes(fragment)) return `fragmento remoto "${fragment}"`;
  }
  for (const ref of KNOWN_PROJECT_REFS) {
    if (lowered.includes(ref)) return "un project ref conocido de producción";
  }
  return null;
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

  // ── 1) Patrones prohibidos sobre la representación ORIGINAL ─────────────
  const rawHit = findForbidden(rawUrl);
  if (rawHit) {
    throw new ProductionGuardError(
      `La URL contiene ${rawHit}. Conexión abortada.`,
    );
  }

  // ── 2) Parseo estricto ──────────────────────────────────────────────────
  let parsed: URL;
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

  // ── 3) Query string: rechazo total, sin interpretar ──────────────────────
  // `?host=`, `?port=`, `?dbname=`, `?sslmode=`, `?service=` y demás overrides
  // pueden tener prioridad sobre los campos de la URL en node-postgres. En
  // P3-N1A0 no existe ningún parámetro legítimo, así que no se analizan: se
  // rechaza cualquier query no vacía.
  if (parsed.search !== "") {
    throw new ProductionGuardError(
      "La URL incluye query parameters. No se admite ninguno: pueden " +
        "redirigir el destino efectivo (?host=, ?port=, ?dbname=, ?sslmode=, " +
        "?service=) o forzar un socket Unix. Conexión abortada.",
    );
  }

  // ── 4) Host: única literal numérica admitida ─────────────────────────────
  if (parsed.hostname !== ONLY_ALLOWED_HOST) {
    throw new ProductionGuardError(
      `Host "${parsed.hostname}" no admitido. El único destino permitido es ` +
        `${ONLY_ALLOWED_HOST} (literal numérica: sin localhost, sin ::1, sin ` +
        `hostnames, sin DNS, sin sockets Unix).`,
    );
  }

  // ── 5) Componentes decodificados ─────────────────────────────────────────
  const components: ReadonlyArray<readonly [string, string]> = [
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

  // ── 6) Nombre de base: decodificado y con la marca exacta ────────────────
  const rawPath = parsed.pathname.replace(/^\//, "");
  if (!rawPath) {
    throw new ProductionGuardError("La URL no especifica nombre de base de datos.");
  }
  const dbName = safeDecode(rawPath);
  if (dbName === null) {
    throw new ProductionGuardError(
      "El nombre de base no se puede decodificar. Conexión abortada.",
    );
  }
  if (!dbName.startsWith(TEST_DB_PREFIX)) {
    throw new ProductionGuardError(
      `La base "${redact(dbName)}" no lleva el prefijo obligatorio ` +
        `"${TEST_DB_PREFIX}". Conexión abortada.`,
    );
  }
  // Una barra adicional revelaría un pathname compuesto, no un nombre de base.
  if (dbName.includes("/")) {
    throw new ProductionGuardError(
      "El nombre de base contiene '/': no es un identificador simple.",
    );
  }
}

/**
 * Valida la URL de MANTENIMIENTO del cluster (la base `postgres` del catálogo,
 * usada sólo para `CREATE DATABASE` / `DROP DATABASE`).
 *
 * Aplica EXACTAMENTE las mismas barreras que `assertLocalTestUrl` —host único,
 * sin query, protocolo, decodificación, patrones prohibidos— y sustituye la
 * regla del prefijo por una más estricta todavía: el nombre de base debe ser
 * literalmente `postgres`. No es una excepción a la guarda: es una restricción
 * distinta y más cerrada para un destino que, por definición, no puede llevar
 * el prefijo de test.
 */
export function assertLocalMaintenanceUrl(rawUrl: string): void {
  // Se reutiliza la guarda completa apuntándola a una base ficticia con
  // prefijo válido: así host, query, protocolo, encoding y patrones prohibidos
  // se evalúan con el MISMO código, sin duplicar reglas.
  let parsed: URL;
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

/**
 * Verifica que el proceso no esté contaminado con credenciales productivas ni
 * con variables libpq capaces de desviar el destino efectivo.
 *
 * Correr la suite no debe requerir ninguna clave real; si alguna variable de
 * la lista está presente, es señal de que se cargó un entorno productivo por
 * error, o de que alguien intenta redirigir la conexión por la puerta de atrás.
 */
export function assertNoProductionEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const present = FORBIDDEN_ENV_VARS.filter((k) => (env[k] ?? "").trim() !== "");
  if (present.length > 0) {
    throw new ProductionGuardError(
      `Variables prohibidas presentes en el entorno: ${present.join(", ")}. ` +
        `La suite no requiere ninguna credencial real y no admite overrides de ` +
        `libpq: pueden cambiar el destino efectivo sin que la URL lo delate. ` +
        `Abortada.`,
    );
  }
}

/** Lista de variables vigiladas, para las pruebas. */
export const WATCHED_ENV_VARS: readonly string[] = FORBIDDEN_ENV_VARS;

/** Genera un nombre de base único que siempre satisface la guarda. */
export function makeTestDbName(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${TEST_DB_PREFIX}${process.pid}_${rand}`;
}

/** Construye la URL local canónica. Único constructor de URLs del harness. */
export function buildLocalTestUrl(port: number, dbName: string): string {
  const url = `postgresql://postgres@${ONLY_ALLOWED_HOST}:${port}/${dbName}`;
  assertLocalTestUrl(url);
  return url;
}
