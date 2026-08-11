/**
 * wa-sandbox.ts — WA-8R9 CLOSEOUT · HIGH-2 · aislamiento REAL para la suite WhatsApp.
 *
 * ─── QUÉ ESTABA MAL ────────────────────────────────────────────────────────
 *
 * Las suites `t-wa-r9-*` creaban sus tablas en `public` del cluster COMPARTIDO
 * y limpiaban con `drop ... cascade`. Eso es destructivo por partida doble:
 *
 *  · `cascade` no se limita a lo propio — arrastra policies, grants, triggers,
 *    vistas y funciones dependientes que pertenecen a otras suites;
 *  · sustituir `auth.uid()` o `has_permission()` y "restaurarlas después" es
 *    una restauración PARCIAL: depende de que el teardown corra, de que corra
 *    completo y del orden de los archivos. Cualquiera de las tres cosas que
 *    falle deja el cluster contaminado para el resto de la corrida.
 *
 * ─── LA SOLUCIÓN ───────────────────────────────────────────────────────────
 *
 * Cada archivo de prueba recibe su PROPIA BASE DE DATOS efímera dentro del
 * mismo cluster. No hay nada que restaurar porque no se toca nada ajeno: el
 * aislamiento es total por construcción, no por disciplina de limpieza.
 *
 * El nombre usa `makeTestDbName()`, así que cae bajo el prefijo que vigila
 * `assert-no-residual-databases.mjs`: si una base quedara viva, el guard de
 * residuos lo detecta. La limpieza no depende de que yo me acuerde.
 *
 * Consecuencia deseada: el orden de los archivos deja de importar. Ninguna
 * suite puede ver, pisar ni depender del estado de otra.
 */

import { Client } from "pg";
import { connectGuarded } from "./cluster";
import { makeTestDbName, assertLocalTestUrl } from "./guard";

export interface WaSandbox {
  /** Cliente conectado a la base dedicada. */
  client: Client;
  /** URL de la base dedicada; para abrir conexiones extra (concurrencia). */
  url: string;
  /** Abre otra conexión a la MISMA base dedicada. */
  connect(): Promise<Client>;
  /** Cierra conexiones y destruye la base. Idempotente. */
  destroy(): Promise<void>;
}

/** URL de mantenimiento derivada de la del cluster (base `postgres`). */
function maintenanceUrlFrom(testUrl: string): string {
  const u = new URL(testUrl);
  u.pathname = "/postgres";
  return u.toString();
}

/** URL de la base dedicada, sobre el mismo host y puerto del cluster. */
function dedicatedUrlFrom(testUrl: string, dbName: string): string {
  const u = new URL(testUrl);
  u.pathname = `/${dbName}`;
  const url = u.toString();
  // Se revalida con la MISMA guarda del harness: host local, prefijo correcto.
  assertLocalTestUrl(url);
  return url;
}

/**
 * Crea una base efímera dedicada y devuelve el sandbox.
 *
 * @param clusterUrl URL provista por el global setup (`inject("dbUrl")`).
 */
export async function createWaSandbox(clusterUrl: string): Promise<WaSandbox> {
  const dbName = makeTestDbName();
  const adminUrl = maintenanceUrlFrom(clusterUrl);

  const admin = await connectGuarded(adminUrl, "maintenance");
  try {
    // El nombre viene de `makeTestDbName()`, no de entrada externa; aun así se
    // cita como identificador para que no exista un camino de inyección.
    await admin.query(`create database "${dbName}"`);
  } finally {
    await admin.end().catch(() => {});
  }

  const url = dedicatedUrlFrom(clusterUrl, dbName);
  const abiertas: Client[] = [];

  const connect = async (): Promise<Client> => {
    const c = await connectGuarded(url);
    abiertas.push(c);
    return c;
  };

  const client = await connect();

  const destroy = async (): Promise<void> => {
    for (const c of abiertas) await c.end().catch(() => {});
    abiertas.length = 0;
    const adm = await connectGuarded(adminUrl, "maintenance");
    try {
      // Se cortan conexiones remanentes antes de soltar la base: un cliente
      // olvidado no puede impedir la limpieza.
      await adm.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
        [dbName],
      );
      await adm.query(`drop database if exists "${dbName}"`);
    } finally {
      await adm.end().catch(() => {});
    }
  };

  return { client, url, connect, destroy };
}

/**
 * Fotografía del catálogo de una base, para comparar antes/después.
 *
 * Sirve como prueba POSITIVA de aislamiento: se toma sobre la base COMPARTIDA
 * y debe ser idéntica antes y después de correr una suite. Cubre lo que un
 * `drop ... cascade` se lleva puesto sin avisar.
 */
export interface CatalogSnapshot {
  tablas: string[];
  funciones: string[];
  policies: string[];
  triggers: string[];
  grants: string[];
  columnas: string[];
}

export async function snapshotCatalog(client: Client): Promise<CatalogSnapshot> {
  const q = async (sql: string): Promise<string[]> =>
    (await client.query(sql)).rows.map((r) => String(Object.values(r)[0]));

  return {
    tablas: await q(
      `select table_schema || '.' || table_name from information_schema.tables
        where table_schema in ('public','auth') order by 1`,
    ),
    funciones: await q(
      `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public','auth') order by 1`,
    ),
    policies: await q(
      `select schemaname || '.' || tablename || '.' || policyname from pg_policies
        where schemaname in ('public','auth') order by 1`,
    ),
    triggers: await q(
      `select event_object_schema || '.' || event_object_table || '.' || trigger_name
         from information_schema.triggers
        where event_object_schema in ('public','auth') order by 1`,
    ),
    grants: await q(
      `select grantee || ':' || table_schema || '.' || table_name || ':' || privilege_type
         from information_schema.role_table_grants
        where table_schema in ('public','auth') order by 1`,
    ),
    columnas: await q(
      `select table_schema || '.' || table_name || '.' || column_name || ':' || data_type
         from information_schema.columns
        where table_schema in ('public','auth') order by 1`,
    ),
  };
}

/** Diferencias entre dos fotografías. Vacío significa aislamiento total. */
export function diffCatalog(antes: CatalogSnapshot, despues: CatalogSnapshot): string[] {
  const problemas: string[] = [];
  for (const clave of Object.keys(antes) as Array<keyof CatalogSnapshot>) {
    const a = new Set(antes[clave]);
    const d = new Set(despues[clave]);
    const perdidos = [...a].filter((x) => !d.has(x));
    const agregados = [...d].filter((x) => !a.has(x));
    if (perdidos.length) problemas.push(`${clave} DESAPARECIDOS: ${perdidos.join(", ")}`);
    if (agregados.length) problemas.push(`${clave} AGREGADOS: ${agregados.join(", ")}`);
  }
  return problemas;
}
