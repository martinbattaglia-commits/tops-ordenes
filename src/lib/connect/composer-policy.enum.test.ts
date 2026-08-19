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
 * Reconstruye el enum leyendo las migraciones en el orden en que se aplican.
 *
 * Dos formas, que son las que el linaje usa de verdad:
 *   · `create type public.<enum> as enum ('a','b',…)`  → valores iniciales;
 *   · `alter type public.<enum> add value [if not exists] 'x'` → agregados.
 */
function kindsSegunLasMigraciones(): string[] {
  const archivos = readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith(".sql") && !f.startsWith("ROLLBACK_"))
    .sort();

  const valores: string[] = [];
  for (const archivo of archivos) {
    const sql = readFileSync(join(MIGRACIONES, archivo), "utf8");
    if (!sql.includes(ENUM)) continue;

    const creacion = new RegExp(
      `create\\s+type\\s+public\\.${ENUM}\\s+as\\s+enum\\s*\\(([^)]*)\\)`,
      "i",
    ).exec(sql);
    if (creacion) {
      for (const m of creacion[1].matchAll(/'([^']+)'/g)) {
        if (!valores.includes(m[1])) valores.push(m[1]);
      }
    }

    const agregado = new RegExp(
      `alter\\s+type\\s+public\\.${ENUM}\\s+add\\s+value\\s+(?:if\\s+not\\s+exists\\s+)?'([^']+)'`,
      "gi",
    );
    for (const m of sql.matchAll(agregado)) {
      if (!valores.includes(m[1])) valores.push(m[1]);
    }
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
    const desdeElCodigo = [...CONVERSATION_KINDS].sort();

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
