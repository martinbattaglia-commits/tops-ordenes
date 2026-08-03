/**
 * P3-N1A0 · Guarda de versión de PostgreSQL.
 *
 * Corrige M-03: la versión sólo se verificaba en un paso del workflow, de modo
 * que una URL externa podía apuntar a un PostgreSQL 16 o 18 sin que el harness
 * lo notara. Ahora se interroga al servidor REAL por la conexión que se va a
 * usar, antes de ejecutar el bootstrap y antes de cargar migración alguna.
 *
 * El paso equivalente del workflow se conserva como defensa en profundidad,
 * pero NO sustituye a esta guarda.
 */

/** Rango admitido: exclusivamente la serie mayor 17. */
export const MIN_SERVER_VERSION_NUM = 170_000;
export const MAX_SERVER_VERSION_NUM = 180_000; // exclusivo

export class UnsupportedPostgresVersionError extends Error {
  constructor(readonly versionNum: number, detail: string) {
    super(
      `[P3-N1A0] PostgreSQL no soportado: ${detail}. ` +
        `El esquema productivo corre sobre PostgreSQL 17; se exige ` +
        `${MIN_SERVER_VERSION_NUM} <= server_version_num < ${MAX_SERVER_VERSION_NUM}. ` +
        `No se ejecuta bootstrap ni se cargan migraciones.`,
    );
    this.name = "UnsupportedPostgresVersionError";
  }
}

/**
 * Parsea y valida el valor crudo de `show server_version_num`.
 * Función pura: es la que ejercitan las pruebas para 16, 17 y 18.
 */
export function parseAndCheckServerVersion(raw: unknown): number {
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new UnsupportedPostgresVersionError(
      Number.NaN,
      `server_version_num ausente o de tipo inesperado (${typeof raw})`,
    );
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    throw new UnsupportedPostgresVersionError(
      Number.NaN,
      `server_version_num no numérico ("${text.slice(0, 32)}")`,
    );
  }
  const num = Number.parseInt(text, 10);
  if (num < MIN_SERVER_VERSION_NUM || num >= MAX_SERVER_VERSION_NUM) {
    const major = Math.floor(num / 10_000);
    throw new UnsupportedPostgresVersionError(
      num,
      `server_version_num=${num} (major ${major})`,
    );
  }
  return num;
}

/** Cliente mínimo requerido: sólo `query`. */
export interface VersionQueryable {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * Interroga al servidor y valida. Lanza `UnsupportedPostgresVersionError` si
 * no es PostgreSQL 17. El llamador es responsable de cerrar la conexión.
 */
export async function assertPostgres17(client: VersionQueryable): Promise<number> {
  const { rows } = await client.query("show server_version_num");
  const raw = rows[0]?.server_version_num;
  return parseAndCheckServerVersion(raw);
}
