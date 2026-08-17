/**
 * 2-C-2 · LA FRONTERA DEL PROVEEDOR DE VISIÓN, MEDIDA SOBRE EL GRAFO REAL.
 *
 * ─── POR QUÉ ESTE ARCHIVO EXISTE ─────────────────────────────────────────
 *
 * El master dice que «el boundary guard lo va a cazar». **Medido: no lo caza.**
 * El único guard de clausura del repositorio —`clients-native-only.test.ts`—
 * está enraizado en `ORIGENES`, y ahí figuran `wms/recepciones/nueva`,
 * `clientes`, `orders/new` y compañía. **`wms/despachos` no está.** Ese guard
 * protege el maestro de clientes, no el grafo de despachos, y por eso 2-A lo
 * cazó entonces y no cazaría esto ahora.
 *
 * De modo que la propiedad que Dirección puso como causal de detención —«que la
 * extracción arrastre el proveedor de visión al grafo de despachos»— estaba sin
 * medir. Este archivo la mide.
 *
 * ─── QUÉ SE MIDE, EXACTAMENTE ────────────────────────────────────────────
 *
 * La clausura de imports **ESTÁTICOS** desde las entradas de despachos. Un
 * `import()` dinámico NO cuenta como arista, y ésa es justamente la diferencia
 * que hace que la extracción sea correcta:
 *
 *   · el grafo estático de despachos no contiene `openai-vision-provider` ni
 *     `productive-vision-evaluation` ⇒ el bundle del servidor de despachos no
 *     arrastra el cliente HTTP de OpenAI;
 *   · en tiempo de ejecución el análisis SÍ corre, porque para eso se hizo.
 *
 * No se promete inalcanzabilidad en runtime: se prueba ausencia de acoplamiento
 * de módulos, que es la propiedad que 2-A perdió.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RAIZ = resolve(__dirname, "..", "..");

/** Módulos cuya presencia en el grafo de despachos es el defecto a evitar. */
const PROHIBIDOS = ["openai-vision-provider", "productive-vision-evaluation"];

/**
 * EL CAMINO DE LA FOTO DE EGRESO. Es lo que este bloque gobierna y lo que la
 * causal de detención nombra: que LA EXTRACCIÓN no arrastre el proveedor.
 *
 * No es toda la ruta `/wms/despachos`, y la diferencia está medida y explicada
 * en el test de la fuga preexistente, más abajo.
 */
const ENTRADAS = [
  "src/app/(app)/wms/despachos/actions.ts",
  "src/app/(app)/wms/despachos/_components/DispatchEgressPanel.tsx",
  "src/lib/custody/dispatch-egress.ts",
  "src/lib/custody/physical-egress.ts",
  "src/lib/custody/analysis-trigger.ts",
];

/**
 * FUGA PREEXISTENTE, ANTERIOR A 2-C-1 Y A 2-C-2. Se fija acá para que no crezca
 * en silencio y para que quien la corrija sepa que este test hay que tocarlo.
 *
 * `despachos/[id]/page.tsx` monta `CustodyShipmentSection`, que es la superficie
 * de custodia por SHIPMENT —la que el contrato registra en §2 fila 10— y que
 * importa `wms/custody/actions.ts` entero para sus botones. Por ahí el proveedor
 * de visión entra al grafo de la PÁGINA de despacho, y entraba desde mucho antes
 * de que existiera la puerta de egreso.
 *
 * No se remedia acá: es la superficie de scope `shipment`, que arrastra HN-1 y
 * cuya decisión es de Dirección. Queda declarada, con su cadena exacta.
 */
const FUGA_CONOCIDA = "src/app/(app)/wms/despachos/[id]/page.tsx";

function archivosDe(rel: string): string[] {
  const base = join(RAIZ, rel);
  if (!existsSync(base)) return [];
  if (statSync(base).isFile()) return [base];
  const out: string[] = [];
  for (const e of readdirSync(base, { withFileTypes: true })) {
    const p = join(base, e.name);
    if (e.isDirectory()) out.push(...archivosDe(join(rel, e.name)));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * ─── H-1 · POR QUÉ ESTO YA NO ES UNA REGEX ───────────────────────────────
 *
 * La primera versión usaba `/(?:import|export)\s+(?!type\s)[^;\n]*?from .../`.
 * Ese `[^;\n]` EXCLUYE el salto de línea, así que **todo import multilínea era
 * invisible**:
 *
 *     import {
 *       OpenAICustodyVisionProvider,
 *     } from "@/lib/custody/openai-vision-provider";
 *
 * No hace falta mala fe para producirlo: Prettier envuelve solo cualquier import
 * que pase el ancho de línea, y ese formato abunda en el repositorio. C4 lo
 * reprodujo inyectando exactamente eso en una de las cinco semillas y el guard
 * siguió devolviendo `ofensores = []`.
 *
 * Un instrumento también es código. Se reemplaza por el AST del compilador de
 * TypeScript, que es lo que ya usa `clients-native-only.test.ts` —el otro guard
 * de clausura del repositorio— y que no tiene forma de equivocarse con el
 * formato. El control de abajo demuestra el falso negativo del parser viejo.
 */
function parsear(nombre: string, fuente: string): ts.SourceFile {
  return ts.createSourceFile(
    nombre,
    fuente,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    /\.tsx$/.test(nombre) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function recorrer(nodo: ts.Node, visita: (n: ts.Node) => void): void {
  visita(nodo);
  nodo.forEachChild((h) => recorrer(h, visita));
}

/**
 * ¿La cláusula importa SÓLO tipos? TypeScript los borra y no llegan al bundle,
 * así que no son aristas del grafo que este guard mide. Cubre las dos formas:
 * `import type { A } from` y `import { type A, type B } from`.
 */
function soloTipos(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false; // `import "x"` es efecto de módulo: SÍ es arista.
  if (clause.isTypeOnly) return true;
  const b = clause.namedBindings;
  if (b && ts.isNamedImports(b) && b.elements.length > 0 && !clause.name) {
    return b.elements.every((e) => e.isTypeOnly);
  }
  return false;
}

/**
 * Imports ESTÁTICOS de un archivo, por AST. El `import()` DINÁMICO se excluye a
 * propósito: es la costura que separa los dos grafos.
 */
function importsEstaticos(fuente: string, nombre = "m.ts"): string[] {
  const out: string[] = [];
  recorrer(parsear(nombre, fuente), (n) => {
    if (ts.isImportDeclaration(n)) {
      if (soloTipos(n.importClause)) return;
      if (ts.isStringLiteralLike(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n)) {
      if (n.isTypeOnly || !n.moduleSpecifier) return;
      if (ts.isStringLiteralLike(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      const e = n.moduleReference.expression;
      if (ts.isStringLiteralLike(e)) out.push(e.text);
    }
    // `import()` es CallExpression con ImportKeyword: NO se cuenta.
  });
  return out;
}

/**
 * El parser VIEJO, conservado ÚNICAMENTE para el control rojo→verde de H-1. No
 * lo usa el guard: si alguien lo llamara desde la clausura, el falso negativo
 * volvería.
 */
function importsEstaticosRegexLegacy(fuente: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)[^;\n]*?from\s*["']([^"']+)["']/g;
  const reBare = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  for (const m of fuente.matchAll(re)) out.push(m[1]);
  for (const m of fuente.matchAll(reBare)) out.push(m[1]);
  return out;
}

function resolver(desde: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(RAIZ, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(desde), spec);
  else return null; // paquete de node_modules: fuera de la clausura del producto
  for (const cand of [
    `${base}.ts`, `${base}.tsx`,
    join(base, "index.ts"), join(base, "index.tsx"),
  ]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

/** Clausura transitiva por aristas ESTÁTICAS. */
function clausura(semillas: string[]): Set<string> {
  const vistos = new Set<string>();
  const cola = [...semillas];
  while (cola.length) {
    const f = cola.pop()!;
    if (vistos.has(f)) continue;
    vistos.add(f);
    let src: string;
    try {
      src = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const spec of importsEstaticos(src, f)) {
      const r = resolver(f, spec);
      if (r && !vistos.has(r)) cola.push(r);
    }
  }
  return vistos;
}

describe("2-C-2 · el proveedor de visión NO entra al grafo estático de despachos", () => {
  const semillas = ENTRADAS.flatMap(archivosDe);

  it("las entradas de despachos existen y se pudieron enumerar", () => {
    expect(semillas.length).toBeGreaterThan(0);
  });

  it("la clausura estática de despachos NO contiene el proveedor de visión", () => {
    const alcanzados = [...clausura(semillas)].map((f) => f.replace(`${RAIZ}/`, ""));
    const ofensores = alcanzados.filter((f) => PROHIBIDOS.some((p) => f.includes(p)));
    expect(ofensores).toEqual([]);
  });

  /**
   * El control que impide que la prueba pase por vacía: el disparo SÍ tiene que
   * estar en el grafo. Si `analysis-trigger` desapareciera de despachos, la
   * prueba de arriba pasaría igual y el análisis no arrancaría nunca.
   */
  it("pero el DISPARO sí está: la foto de egreso arranca el análisis", () => {
    const alcanzados = [...clausura(semillas)].map((f) => f.replace(`${RAIZ}/`, ""));
    expect(alcanzados.some((f) => f.endsWith("src/lib/custody/analysis-trigger.ts"))).toBe(true);
  });

  /**
   * Y la costura es la que se declaró: el disparo llega a la composición pesada
   * SÓLO por `import()` dinámico. Si alguien la volviera estática, el primer
   * test se pondría rojo — pero conviene decir por qué acá.
   */
  it("el disparo alcanza la composición pesada sólo por import() dinámico", () => {
    const src = readFileSync(join(RAIZ, "src/lib/custody/analysis-trigger.ts"), "utf8");
    expect(src).toContain('await import(');
    expect(importsEstaticos(src).some((s) => s.includes("vision-evaluation-composition"))).toBe(false);
    expect(importsEstaticos(src).some((s) => s.includes("openai-vision-provider"))).toBe(false);
  });

  /**
   * LA FUGA PREEXISTENTE, FIJADA. No es de este bloque, pero si alguien la
   * corrige este test se pone rojo y le avisa; y si aparece una SEGUNDA vía, el
   * conteo cambia y también se entera.
   */
  it("la fuga preexistente por CustodyShipmentSection sigue siendo la única", () => {
    const alcanzados = [...clausura([join(RAIZ, FUGA_CONOCIDA)])].map((f) =>
      f.replace(`${RAIZ}/`, ""),
    );
    const ofensores = alcanzados.filter((f) => PROHIBIDOS.some((p) => f.includes(p)));
    // Está, y son exactamente los dos módulos prohibidos que se documentaron.
    // `ofensores` cuenta MÓDULOS ALCANZADOS, no rutas de importación: una
    // segunda vía hacia los mismos dos módulos NO cambiaría este arreglo. Lo
    // que sí detecta es un módulo prohibido NUEVO, y la aserción de la cadena
    // de abajo fija por dónde entra la que ya se conoce.
    expect(ofensores.sort()).toEqual([
      "src/lib/custody/openai-vision-provider.ts",
      "src/lib/custody/productive-vision-evaluation.ts",
    ]);
    // Y entra por la sección de scope `shipment`, no por la puerta de egreso.
    expect(alcanzados).toContain(
      "src/app/(app)/wms/custody/_components/CustodyShipmentActions.tsx",
    );
  });

  /**
   * Y la composición pesada existe y es la ÚNICA que instancia el proveedor: si
   * apareciera un segundo `new OpenAICustodyVisionProvider` en otro módulo, la
   * frontera tendría dos puertas y sólo una estaría medida.
   */
  it("hay una sola instanciación del proveedor en todo src/", () => {
    const todos = archivosDe("src");
    const instancian = todos
      .filter((f) => /new\s+OpenAICustodyVisionProvider\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(`${RAIZ}/`, ""));
    expect(instancian).toEqual(["src/lib/custody/vision-evaluation-composition.ts"]);
  });
});

describe("H-1 · el parser del guard, con su propio control rojo→verde", () => {
  /**
   * El import multilínea EXACTO que C4 inyectó en `dispatch-egress.ts` —una de
   * las cinco semillas— y que el guard viejo no vio. No es una forma rebuscada:
   * es lo que Prettier produce solo al pasar el ancho de línea.
   */
  const MULTILINEA = [
    "import {",
    "  OpenAICustodyVisionProvider,",
    '} from "@/lib/custody/openai-vision-provider";',
    "",
    "export const x = OpenAICustodyVisionProvider;",
  ].join("\n");

  it("ROJO · el parser VIEJO no ve el import multilínea (el falso negativo)", () => {
    expect(importsEstaticosRegexLegacy(MULTILINEA)).not.toContain(
      "@/lib/custody/openai-vision-provider",
    );
  });

  it("VERDE · el parser NUEVO sí lo ve", () => {
    expect(importsEstaticos(MULTILINEA)).toContain("@/lib/custody/openai-vision-provider");
  });

  /**
   * Y el guard COMPLETO lo caza: se inyecta el import en una copia de una
   * semilla real y se comprueba que la clausura lo alcanza. Es la propiedad que
   * importa — que el parser mejore no sirve si el walker no lo usa.
   */
  it("VERDE · la clausura del guard alcanza el módulo prohibido inyectado", () => {
    const semilla = join(RAIZ, "src/lib/custody/dispatch-egress.ts");
    const original = readFileSync(semilla, "utf8");
    // No se toca el archivo: se parsea el contenido mutado EN MEMORIA.
    const mutado = `${MULTILINEA}\n${original}`;
    expect(importsEstaticos(mutado, semilla)).toContain(
      "@/lib/custody/openai-vision-provider",
    );
    expect(importsEstaticosRegexLegacy(mutado)).not.toContain(
      "@/lib/custody/openai-vision-provider",
    );
  });

  it("el import DINÁMICO sigue sin contar, que es la costura de 2-C-2", () => {
    const din = 'const m = await import("@/lib/custody/vision-evaluation-composition");';
    expect(importsEstaticos(din)).toEqual([]);
  });

  it("los imports SÓLO de tipo no son aristas, en sus dos formas", () => {
    expect(importsEstaticos('import type { A } from "@/x";')).toEqual([]);
    expect(importsEstaticos('import { type A, type B } from "@/x";')).toEqual([]);
    // Pero uno MIXTO sí lo es: importa un valor.
    expect(importsEstaticos('import { A, type B } from "@/x";')).toEqual(["@/x"]);
    // Y `import "x"` es efecto de módulo: cuenta.
    expect(importsEstaticos('import "server-only";')).toEqual(["server-only"]);
  });
});
