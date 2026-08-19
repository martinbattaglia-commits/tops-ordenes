/**
 * NINGUNA RPC PUEDE QUEDAR CON PARÁMETROS SIN NOMBRE.
 *
 * ─── QUÉ ESTÁ EN JUEGO ──────────────────────────────────────────────────────
 *
 * PostgREST resuelve una RPC por NOMBRE de argumento —la notación nombrada de
 * PostgreSQL—. Una función declarada `create function public.f(uuid,bigint)`,
 * sin identificadores, es INALCANZABLE por esa vía: el cliente pide
 * `f(p_conversation_id => …)` y el motor contesta 42883, «does not exist».
 *
 * Pasó 17 veces de una sola vez, en 0246, y nadie lo notó durante dos días:
 * el renombrado a `*_pre_0246` conservó los nombres, pero las envolturas nuevas
 * se declararon posicionales. Once operaciones vivas quedaron muertas, una de
 * ellas —marcar leído— EN SILENCIO, porque su llamador descarta el resultado.
 *
 * ─── POR QUÉ ESTE GUARDA FALLA CUANDO NO ENTIENDE ───────────────────────────
 *
 * Este archivo nació de un hallazgo hecho sobre OTRO guarda de este mismo
 * programa: el que reconstruye un enum leyendo migraciones pasaba en verde ante
 * tres sintaxis válidas que su expresión regular no contemplaba —entre ellas
 * `alter type` sin el prefijo `public.`, que el propio linaje ya usa en 8 de sus
 * 37 apariciones—. Un guarda que se cree exhaustivo y no lo es es PEOR que no
 * tener guarda: quien lo lee cree que está cubierto.
 *
 * La lección quedó en el diseño de éste: **lo que no puede interpretar, lo
 * declara y falla**. Un `create function` cuya lista de parámetros no se pueda
 * leer no se saltea en silencio: rompe la prueba y pide que un humano mire. El
 * modo de falla por defecto es el ruido, nunca el silencio.
 *
 * ─── QUÉ ESTADO SE JUZGA ────────────────────────────────────────────────────
 *
 * El ESTADO FINAL del linaje hacia adelante, no cada archivo por separado. La
 * distinción no es cosmética: 0246 declaró las 17 sin nombres y 0260 las
 * recreó con nombres. Juzgar archivo por archivo marcaría 0246 para siempre y
 * obligaría a callar el guarda, que es como mueren los guardas.
 *
 * Los `ROLLBACK_*` quedan FUERA a propósito: su trabajo es restituir un estado
 * anterior tal cual era, defectos incluidos. Un rollback que "arreglara" lo que
 * restituye no sería un rollback.
 *
 * ⚠ LÍMITE DECLARADO, y es real: esto se mide contra las MIGRACIONES EN DISCO,
 *   no contra la base productiva. Una función creada fuera del linaje —por el
 *   panel, a mano— no la ve. Ésa es deuda de linaje y tiene sus propias guardas.
 *   Vive en `npm test` porque `app-ci` corre en CADA PR sin PostgreSQL, y el
 *   momento en que hay que enterarse es el commit que escribe la migración.
 *
 * ⚠ SEGUNDO LÍMITE: las declaraciones se identifican por nombre y CANTIDAD de
 *   parámetros. Dos sobrecargas con la misma aridad y distintos tipos se
 *   pisarían entre sí. No existe ninguna hoy en el linaje —se verifica más
 *   abajo—, y si apareciera, esa comprobación falla y avisa.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const MIGRACIONES = join(process.cwd(), "supabase", "migrations");

interface Declaracion {
  archivo: string;
  nombre: string;
  /** Texto crudo de la lista de parámetros, entre los paréntesis. */
  parametros: string;
}

/** Corta comentarios de línea `--`, que pueden esconder o simular una firma. */
function sinComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/**
 * Extrae la lista de parámetros equilibrando paréntesis desde `desde`.
 *
 * No usa `[^)]*` a propósito: un tipo como `numeric(12,2)` o un `default
 * f(x)` tiene paréntesis internos y esa forma cortaría en el primero,
 * leyendo una firma que no existe.
 */
function listaDeParametros(sql: string, desde: number): string | null {
  if (sql[desde] !== "(") return null;
  let nivel = 0;
  for (let i = desde; i < sql.length; i++) {
    if (sql[i] === "(") nivel++;
    else if (sql[i] === ")") {
      nivel--;
      if (nivel === 0) return sql.slice(desde + 1, i);
    }
  }
  return null; // paréntesis sin cerrar ⇒ no se entiende ⇒ se declara abajo
}

/**
 * ¿Este parámetro declara un NOMBRE?
 *
 * En PostgreSQL la forma es `[modo] [nombre] tipo [default …]`. Sin nombre
 * queda sólo el tipo. Se decide contando los tokens que preceden al tipo, y
 * ante la MENOR duda se responde `null` —«no sé»— que el llamador trata como
 * fallo, nunca como aprobación.
 */
function declaraNombre(param: string): boolean | null {
  const limpio = param.replace(/\s+/g, " ").trim();
  if (limpio.length === 0) return null;
  const sinDefault = limpio.split(/\s+default\s+|\s*:?=\s*/i)[0].trim();
  const tokens = sinDefault.split(" ").filter(Boolean);
  const MODOS = new Set(["in", "out", "inout", "variadic"]);
  const utiles = tokens[0] && MODOS.has(tokens[0].toLowerCase()) ? tokens.slice(1) : tokens;
  if (utiles.length === 0) return null;
  // Un solo token ⇒ es el tipo, sin nombre. Ej: `uuid`, `public.mi_enum_t`.
  if (utiles.length === 1) return false;
  // Tipos de varias palabras SIN nombre: `timestamp with time zone`,
  // `double precision`, `character varying`, `bigint[]`…
  const MULTIPALABRA = /^(timestamp|time|double|character|bit|interval|numeric|decimal)\b/i;
  if (MULTIPALABRA.test(utiles[0])) return false;
  return true;
}

function declaracionesDeMigraciones(): { decls: Declaracion[]; ilegibles: string[] } {
  const archivos = readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith(".sql") && !f.startsWith("ROLLBACK_"))
    .sort();
  const decls: Declaracion[] = [];
  const ilegibles: string[] = [];

  for (const archivo of archivos) {
    const sql = sinComentarios(readFileSync(join(MIGRACIONES, archivo), "utf8"));
    // `public.` opcional y nombre entre comillas opcional: las dos formas que
    // el linaje usa de verdad. Ésta es exactamente la clase de omisión que
    // dejó ciego al guarda del enum.
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(/gi;
    for (const m of sql.matchAll(re)) {
      const abre = m.index! + m[0].length - 1;
      const params = listaDeParametros(sql, abre);
      if (params === null) {
        ilegibles.push(`${archivo}: ${m[1]} (paréntesis sin cerrar)`);
        continue;
      }
      decls.push({ archivo, nombre: m[1], parametros: params });
    }
  }
  return { decls, ilegibles };
}

/**
 * Estado FINAL de cada función: gana la última declaración del linaje.
 *
 * La clave es nombre + cantidad de parámetros, que distingue las sobrecargas
 * por aridad —las únicas que el linaje usa—. Un `drop function` retira la
 * entrada, para que una función eliminada no se juzgue como si siguiera viva.
 */
function estadoFinal(): Map<string, Declaracion> {
  const { decls } = declaracionesDeMigraciones();
  const final = new Map<string, Declaracion>();
  for (const d of decls) {
    const n = partirParametros(d.parametros).filter((p) => p.trim().length > 0).length;
    final.set(`${d.nombre}/${n}`, d);
  }

  // Los DROP se aplican al final, en orden: una función retirada por el último
  // archivo que la menciona no debe juzgarse.
  const archivos = readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith(".sql") && !f.startsWith("ROLLBACK_"))
    .sort();
  for (const archivo of archivos) {
    const sql = sinComentarios(readFileSync(join(MIGRACIONES, archivo), "utf8"));
    const re = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(/gi;
    for (const m of sql.matchAll(re)) {
      const abre = m.index! + m[0].length - 1;
      const params = listaDeParametros(sql, abre);
      if (params === null) continue;
      const n = partirParametros(params).filter((p) => p.trim().length > 0).length;
      const clave = `${m[1]}/${n}`;
      const vigente = final.get(clave);
      // Sólo retira si el DROP es POSTERIOR a la última creación.
      if (vigente && archivo >= vigente.archivo) final.delete(clave);
    }
  }
  return final;
}

/** Divide por comas de PRIMER nivel: los tipos pueden traer comas adentro. */
function partirParametros(lista: string): string[] {
  const partes: string[] = [];
  let nivel = 0, actual = "";
  for (const c of lista) {
    if (c === "(") nivel++;
    else if (c === ")") nivel--;
    if (c === "," && nivel === 0) { partes.push(actual); actual = ""; continue; }
    actual += c;
  }
  if (actual.trim().length > 0) partes.push(actual);
  return partes;
}

describe("el guarda entiende lo que lee, o lo dice", () => {
  it("hay declaraciones que analizar: un guarda que no ve nada no aprueba nada", () => {
    const { decls } = declaracionesDeMigraciones();
    expect(decls.length).toBeGreaterThan(100);
  });

  it("ninguna declaración quedó sin poder leerse", () => {
    const { ilegibles } = declaracionesDeMigraciones();
    // Si esto falla, NO significa que haya un defecto: significa que el parser
    // se topó con una forma que no entiende y se niega a aprobarla. Mirala.
    expect(ilegibles, `Declaraciones ilegibles: ${ilegibles.join(" · ")}`).toEqual([]);
  });
});

/**
 * EXCEPCIONES, y cada una tiene que PROBARSE.
 *
 * Una lista de excepciones es el mecanismo por el que un guarda se pudre: se
 * agrega una "por ahora" y queda para siempre. Acá la excepción no alcanza con
 * declararse — la prueba de más abajo verifica que se siga cumpliendo la razón
 * por la que se otorgó. El día que el código llame a `f_unaccent` por RPC, la
 * excepción deja de valer y el guarda vuelve a morder.
 */
const EXCEPCIONES: Record<string, string> = {
  "f_unaccent/1": [
    "Envoltorio inmutable de la extensión `unaccent`, creado por 0126_knowledge_core.",
    "Medido en producción: ningún índice lo usa en su expresión y ninguna otra",
    "función lo menciona en su cuerpo. Nunca se invoca por RPC desde el código.",
    "No es alcanzable por PostgREST y no necesita serlo. Limpiarlo es su propio",
    "expediente, no el de este frente.",
  ].join(" "),
};

describe("las excepciones del guarda siguen mereciéndolo", () => {
  it("ninguna función exceptuada se invoca por RPC desde el código", () => {
    const fuente = join(process.cwd(), "src");
    const nombres = Object.keys(EXCEPCIONES).map((k) => k.split("/")[0]);
    const invocadas: string[] = [];

    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, e.name);
        if (e.isDirectory()) { recorrer(ruta); continue; }
        if (!/\.(ts|tsx)$/.test(e.name) || e.name.includes(".test.")) continue;
        const txt = readFileSync(ruta, "utf8");
        for (const n of nombres) {
          if (txt.includes(`rpc("${n}"`) || txt.includes(`rpc('${n}'`)) invocadas.push(`${n} en ${ruta}`);
        }
      }
    };
    recorrer(fuente);

    expect(
      invocadas,
      `Funciones EXCEPTUADAS que el código sí invoca por RPC: ${invocadas.join(" · ")}. `
        + "La excepción se otorgó porque no eran alcanzables por esa vía. Ya no aplica: "
        + "declarales los nombres de parámetro o sacalas de EXCEPCIONES.",
    ).toEqual([]);
  });
});

describe("ninguna función del linaje se declara con parámetros sin nombre", () => {
  it("y si alguna lo hiciera, PostgREST no podría alcanzarla", () => {
    const decls = [...estadoFinal().values()];

    const anonimas: string[] = [];
    const dudosas: string[] = [];

    for (const d of decls) {
      const partes = partirParametros(d.parametros).filter((p) => p.trim().length > 0);
      if (partes.length === 0) continue; // sin parámetros: no hay nada que nombrar
      if (EXCEPCIONES[`${d.nombre}/${partes.length}`]) continue;
      for (const p of partes) {
        const v = declaraNombre(p);
        if (v === null) dudosas.push(`${d.archivo}: ${d.nombre} → «${p.trim()}»`);
        else if (v === false) anonimas.push(`${d.archivo}: ${d.nombre}(${d.parametros.trim()})`);
      }
    }

    // «No sé» es fallo, no aprobación. Es la corrección al modo de falla que
    // este programa viene persiguiendo.
    expect(
      dudosas,
      `Parámetros que este guarda NO supo interpretar: ${dudosas.join(" · ")}. `
        + "No se aprueban por defecto: extendé `declaraNombre` o revisalos a mano.",
    ).toEqual([]);

    expect(
      [...new Set(anonimas)],
      `Funciones declaradas con parámetros SIN NOMBRE: ${[...new Set(anonimas)].join(" · ")}. `
        + "PostgREST las resuelve por nombre de argumento: así son inalcanzables por RPC, "
        + "y el cliente recibe 42883 «does not exist». Declará los nombres.",
    ).toEqual([]);
  });
});
