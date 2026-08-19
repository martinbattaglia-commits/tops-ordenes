/**
 * INC-04-R2 · EL UNIVERSO DE KINDS, CONTRA SU FUENTE REAL.
 *
 * ─── POR QUÉ EXISTE ESTE ARCHIVO ────────────────────────────────────────────
 *
 * `composer-policy.ts` ya tenía un guarda de exhaustividad:
 *
 *     type KindsAreExhaustive =
 *       ConversationKind extends (typeof CONVERSATION_KINDS)[number] ? true : never;
 *
 * con el comentario «falla la compilación si types.ts agrega un kind y este
 * archivo no se entera». Era cierto, y no alcanzó: compara CÓDIGO CONTRA
 * CÓDIGO. Las dos listas estaban desactualizadas EN EL MISMO SENTIDO —a las dos
 * les faltaba `task`— así que el guarda pasó en verde durante ocho días
 * mientras 22 conversaciones de tarea no podían enviar un mensaje.
 *
 * Un invariante cuya única referencia es otra copia de la misma suposición da
 * falsa confianza, que es peor que no tener guarda: quien lo lee cree que está
 * cubierto.
 *
 * Acá la referencia es EXTERNA al código de aplicación: las migraciones que
 * construyen el enum `connect_conversation_kind_t`. Un kind agregado por
 * migración rompe esta prueba en el mismo commit que lo agrega.
 *
 * ─── POR QUÉ EN LA SUITE DE APLICACIÓN Y NO EN EL HARNESS DE BASE ───────────
 *
 * Medido sobre los workflows: `app-ci.yml` corre `npm test` en CADA PR, sin
 * PostgreSQL y sin credenciales. Los jobs con base son otros
 * (`p3-n1a0-db-harness`, `wms-custody-db-harness`) y no corren en todo cambio.
 *
 * Esta prueba no necesita conexión: lee las migraciones EN DISCO, que son la
 * fuente que construye el enum y el archivo que toca quien agrega un kind. Ése
 * es el momento exacto en que tiene que enterarse. Un guarda que sólo corriera
 * con base viva detectaría lo mismo más tarde y sólo si ese job corre — y un
 * guarda que no corre es exactamente el problema que este expediente arregla.
 *
 * ⚠ LÍMITE DECLARADO: esto compara el código contra las MIGRACIONES, no contra
 *   la base productiva. Si producción tuviera un valor de enum que ninguna
 *   migración creó, esta prueba no lo vería — pero eso sería una deuda de
 *   linaje, que tiene sus propias guardas, y no un defecto de este módulo.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { CONVERSATION_KINDS } from "./composer-policy";

const MIGRACIONES = join(process.cwd(), "supabase", "migrations");
const ENUM = "connect_conversation_kind_t";

/**
 * H-1 del C4 · NORMALIZACIÓN ANTES DE LAS REGEX.
 *
 * La primera versión de este parser exigía el prefijo `public.` literal, el
 * identificador sin comillas y el literal pegado a `add value`. Tres formas
 * legales de SQL lo evadían EN VERDE — y la primera no es hipotética: 8 de los
 * 37 `alter type` del propio linaje van sin prefijo de esquema. Un guarda que
 * se cree exhaustivo y no lo es reproduce el defecto original con más
 * confianza, que es el criterio de este mismo expediente.
 *
 * Se normaliza: fuera comentarios (de línea y de bloque), fuera comillas
 * dobles de identificadores, espacios colapsados. LÍMITE DECLARADO: quitar
 * `"` globalmente podría deformar un string literal que contuviera comillas
 * dobles; el DDL de un enum no las lleva, y este parser sólo alimenta las
 * regex del enum — no interpreta el resto del archivo.
 */
function normalizarSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/"/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Extrae los valores del enum de UN texto SQL ya normalizable. Pura y
 * exportada al describe de formas evasivas: la propiedad se prueba contra
 * cadenas construidas, no sólo contra el linaje real de hoy.
 *
 * Dos formas, que son las que el linaje usa de verdad — con o sin `public.`:
 *   · `create type [public.]<enum> as enum ('a','b',…)`  → valores iniciales;
 *   · `alter type [public.]<enum> add value [if not exists] 'x'` → agregados.
 */
function kindsEnSql(sql: string, valores: string[]): void {
  const plano = normalizarSql(sql);
  if (!plano.includes(ENUM)) return;

  const creacion = new RegExp(
    `create\\s+type\\s+(?:public\\.)?${ENUM}\\s+as\\s+enum\\s*\\(([^)]*)\\)`,
    "i",
  ).exec(plano);
  if (creacion) {
    for (const m of creacion[1].matchAll(/'([^']+)'/g)) {
      if (!valores.includes(m[1])) valores.push(m[1]);
    }
  }

  const agregado = new RegExp(
    `alter\\s+type\\s+(?:public\\.)?${ENUM}\\s+add\\s+value\\s+(?:if\\s+not\\s+exists\\s+)?'([^']+)'`,
    "gi",
  );
  for (const m of plano.matchAll(agregado)) {
    if (!valores.includes(m[1])) valores.push(m[1]);
  }
}

/** Reconstruye el enum leyendo las migraciones en el orden en que se aplican. */
function kindsSegunLasMigraciones(): string[] {
  const archivos = readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith(".sql") && !f.startsWith("ROLLBACK_"))
    .sort();

  const valores: string[] = [];
  for (const archivo of archivos) {
    kindsEnSql(readFileSync(join(MIGRACIONES, archivo), "utf8"), valores);
  }
  return valores;
}

describe("INC-04-R2 · el universo de kinds se mide contra las migraciones", () => {
  // Si esto falla, el parser dejó de encontrar el enum y la prueba de abajo
  // pasaría por vacía. Un guarda que no ve nada no es un guarda que aprueba.
  it("las migraciones declaran el enum y se puede reconstruir", () => {
    const desdeMigraciones = kindsSegunLasMigraciones();
    expect(desdeMigraciones.length).toBeGreaterThanOrEqual(7);
    expect(desdeMigraciones).toContain("whatsapp");
  });

  it("el código conoce EXACTAMENTE los kinds que crean las migraciones", () => {
    const desdeMigraciones = [...kindsSegunLasMigraciones()].sort();
    // `string[]` a propósito: comparar contra el tipo literal haría que el
    // compilador «supiera» de antemano qué kinds hay, que es justo la
    // suposición que esta prueba viene a NO dar por buena.
    const desdeElCodigo: string[] = [...CONVERSATION_KINDS].sort();

    // Se comparan los dos sentidos por separado para que el error diga QUÉ
    // pasó: un kind que la base tiene y el código no enmudece el composer para
    // ese tipo; uno que el código tiene y la base no es un valor imposible que
    // el fail-closed nunca va a alcanzar.
    const faltanEnElCodigo = desdeMigraciones.filter((k) => !desdeElCodigo.includes(k));
    const sobranEnElCodigo = desdeElCodigo.filter((k) => !desdeMigraciones.includes(k));

    expect(
      faltanEnElCodigo,
      `Kinds que las migraciones crean y CONVERSATION_KINDS no conoce: ${faltanEnElCodigo.join(", ")}. `
        + "El composer va a quedar mudo para esos tipos, igual que pasó con 'task'. "
        + "Agregalos a CONVERSATION_KINDS y a ConversationKind, y decidí sus capacidades.",
    ).toEqual([]);

    expect(
      sobranEnElCodigo,
      `Kinds que CONVERSATION_KINDS declara y ninguna migración crea: ${sobranEnElCodigo.join(", ")}.`,
    ).toEqual([]);
  });

  it("`task` está entre ellos: es el kind que originó este expediente", () => {
    expect(kindsSegunLasMigraciones()).toContain("task");
    expect(CONVERSATION_KINDS as readonly string[]).toContain("task");
  });
});

// H-1 del C4 · LAS TRES FORMAS EVASIVAS, COMO CASOS PERMANENTES.
//
// Cada una es SQL legal que la primera versión del parser dejaba pasar en
// verde. Se prueban contra `kindsEnSql` con cadenas construidas: si alguien
// endurece las regex y vuelve a exigir la forma exacta, esto lo delata.
describe("H-1 · el parser no se deja evadir por formas legales de SQL", () => {
  const extraer = (sql: string) => {
    const v: string[] = [];
    kindsEnSql(sql, v);
    return v;
  };

  it("alter type SIN prefijo public. (8 de 37 en el linaje real van así)", () => {
    expect(extraer("alter type connect_conversation_kind_t add value if not exists 'evasivo1';"))
      .toContain("evasivo1");
  });

  it("identificador entre comillas dobles", () => {
    expect(extraer(`alter type public."connect_conversation_kind_t" add value 'evasivo2';`))
      .toContain("evasivo2");
  });

  it("comentario SQL entre `add value` y el literal", () => {
    expect(extraer(
      "alter type public.connect_conversation_kind_t add value -- pendiente de revisar\n  'evasivo3';",
    )).toContain("evasivo3");
  });

  it("comentario de bloque en el medio del create type", () => {
    expect(extraer(
      "create type connect_conversation_kind_t as enum /* v1 */ ('a', 'b');",
    )).toEqual(["a", "b"]);
  });

  it("y un ROLLBACK con remove value NO agrega nada (no hay remove en el parser)", () => {
    expect(extraer("-- alter type public.connect_conversation_kind_t add value 'comentado';"))
      .toEqual([]);
  });
});
