/**
 * REMEDIACIÓN CONSOLIDADA · TODA CLASE USADA TIENE QUE PRODUCIR UNA REGLA.
 *
 * ─── POR QUÉ EXISTE ───────────────────────────────────────────────────────
 *
 * La UI de custodia se escribió con `text-muted`, `text-danger`,
 * `text-warning`, `text-success`, `btn-secondary` y `page`. Ninguna existe en
 * este sistema de diseño: Tailwind descarta en silencio lo que no reconoce y
 * `globals.css` no las define. El resultado no fallaba ninguna prueba y sin
 * embargo se veía mal —el error no salía en rojo, el aviso no salía en ámbar,
 * el texto secundario iba a contraste pleno—.
 *
 * El oráculo no es una lista escrita a mano: se COMPILA el CSS real con la
 * configuración real del proyecto y se exige que cada clase usada aparezca
 * como selector. Una clase nueva inventada rompe esto sin que nadie tenga que
 * acordarse de agregarla a ningún inventario.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const ROOT = process.cwd();

const UI_FILES = [
  "src/app/(app)/wms/custody/page.tsx",
  "src/app/(app)/wms/custody/[id]/page.tsx",
  "src/app/(app)/wms/custody/_components/CaseAiPanel.tsx",
  "src/app/(app)/wms/custody/_components/CaseDecisionPanel.tsx",
  "src/app/(app)/wms/custody/_components/CaseInspectionPanel.tsx",
  "src/app/(app)/wms/custody/_components/CasePodGate.tsx",
  "src/app/(app)/wms/custody/_components/CaseReevaluatePanel.tsx",
  // S1-3 · el panel de captura quedaba fuera del guard y ahora escribe clases
  // propias (dos slots, avisos por botón). Sin esto, una clase inventada acá
  // seguiría pasando en verde.
  "src/app/(app)/wms/custody/_components/PhysicalCapturePanel.tsx",
  // §7 VISUAL · las cuatro piezas nuevas escriben clases propias. Sin esto, una
  // clase inventada acá seguiría pasando en verde — el mismo motivo por el que
  // S1-3 incorporó el panel de captura.
  "src/app/(app)/wms/custody/_components/CaseProgressBar.tsx",
  "src/app/(app)/wms/custody/_components/CaseNowBlock.tsx",
  "src/app/(app)/wms/custody/_components/CaseEvidencePanel.tsx",
  "src/app/(app)/wms/custody/_components/CaseChecklist.tsx",
  "src/app/(app)/wms/custody/_components/CaseDocumentCard.tsx",
];

/**
 * Clases escritas en `className`, en CUALQUIERA de sus formas.
 *
 * ─── REMEDIACIÓN C4 · M-4 · EL GUARD NO LEÍA LA MITAD DE LAS CLASES ───────
 *
 * La versión anterior sólo reconocía `className="…"`, ``className={`…`}`` y
 * `className={"…"}`. NO reconocía `className={variable}`, que es la forma que
 * este módulo usa para TODAS sus clases condicionales —`seg`, `boton`,
 * `rotulo`, `fila`, `caja`, `bannerCls`, `estadoCls`—, ni el ternario en línea
 * `className={cond ? "a" : "b"}`.
 *
 * O sea: el guard existía, corría en verde, y no miraba precisamente las
 * clases que un cambio visual toca. Una clase inventada en cualquiera de esas
 * formas pasaba sin que nadie se enterara.
 *
 * Ahora se toma la EXPRESIÓN COMPLETA entre llaves balanceadas y se extraen
 * todos sus literales de cadena; si la expresión menciona identificadores, se
 * resuelve su `const` en el mismo archivo y se extraen también los de allí.
 * No es un parser de TypeScript y no pretende serlo: es exactamente lo que
 * hace falta para que ninguna clase escrita en estos archivos quede invisible.
 */

/**
 * Una cadena COMPARADA no es una clase.
 *
 * `view.tone === "released"` pregunta por el tono; no pinta nada. Extraer su
 * operando como clase haría que el guard reclamara una regla `.released` que no
 * debe existir — un guard con falsos positivos es un guard que alguien apaga.
 */
function stripComparisons(expr: string): string {
  return expr
    .replace(/(===|!==|==|!=)\s*(?:"[^"]*"|'[^']*'|`[^`]*`)/g, "$1 _")
    .replace(/(?:"[^"]*"|'[^']*'|`[^`]*`)\s*(===|!==|==|!=)/g, "_ $1")
    .replace(/\bcase\s+(?:"[^"]*"|'[^']*'|`[^`]*`)\s*:/g, "case _:");
}

/** Literales de cadena de una expresión, incluidas las partes estáticas de un template. */
function literalsOf(raw: string): string[] {
  const expr = stripComparisons(raw);
  const out: string[] = [];
  const re = /"([^"\\]*)"|'([^'\\]*)'|`([^`]*)`/g;
  for (let m = re.exec(expr); m !== null; m = re.exec(expr)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    // De un template sólo sirven los tramos fuera de `${…}`.
    for (const chunk of raw.split(/\$\{[^}]*\}/)) out.push(chunk);
  }
  return out;
}

/** Identificadores mencionados en una expresión. */
function identsOf(expr: string): string[] {
  const sinCadenas = expr.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, " ");
  return [...new Set(sinCadenas.match(/[A-Za-z_$][\w$]*/g) ?? [])];
}

/** Desde `i` (sobre el carácter de apertura), devuelve el contenido balanceado. */
function balanced(src: string, i: number, open: string, close: string): string {
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      k++;
      while (k < src.length && src[k] !== q) { if (src[k] === "\\") k++; k++; }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(i + 1, k); }
  }
  return "";
}

/** Cuerpo de `const <name> = …;` en el archivo, o `null`. */
function constBody(src: string, name: string): string | null {
  const re = new RegExp(`\\bconst\\s+${name}\\s*(?::[^=]*)?=`, "g");
  const m = re.exec(src);
  if (!m) return null;
  let depth = 0;
  const from = m.index + m[0].length;
  for (let k = from; k < src.length; k++) {
    const c = src[k];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      k++;
      while (k < src.length && src[k] !== q) { if (src[k] === "\\") k++; k++; }
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === ";" && depth <= 0) return src.slice(from, k);
  }
  return src.slice(from);
}

function classTokens(file: string): string[] {
  const src = readFileSync(resolve(ROOT, file), "utf8");
  const out = new Set<string>();

  const add = (texto: string) => {
    for (const t of texto.split(/\s+/)) {
      const token = t.trim();
      if (token && !token.includes("{") && !token.includes("$")) out.add(token);
    }
  };

  // 1 · `className="…"` literal.
  const lit = /className="([^"]*)"/g;
  for (let m = lit.exec(src); m !== null; m = lit.exec(src)) add(m[1]);

  // 2 · `className={<expr>}` en todas sus formas.
  const abre = /className=\{/g;
  for (let m = abre.exec(src); m !== null; m = abre.exec(src)) {
    const expr = balanced(src, m.index + "className=".length, "{", "}");
    for (const l of literalsOf(expr)) add(l);
    // 3 · y lo que aporte el `const` que la expresión nombra. UN SOLO SALTO,
    //     y es deliberado: el cuerpo de una `const` de clase es un ternario
    //     sobre literales de clase, pero los identificadores de su CONDICIÓN
    //     —`tono`, `estado`— son del dominio de los valores, no de las clases.
    //     Seguirlos un nivel más traía `"warn"` de `tone ?? "warn"` y hacía que
    //     el guard reclamara una regla `.warn` que nunca debió existir.
    for (const id of identsOf(expr)) {
      const cuerpo = constBody(src, id);
      if (cuerpo !== null) for (const l of literalsOf(cuerpo)) add(l);
    }
  }
  return [...out];
}

/** Selector CSS de una clase, con los metacaracteres escapados como Tailwind. */
function selectorOf(token: string): RegExp {
  // Dos pasos distintos y fáciles de confundir: primero el escape que hace
  // Tailwind AL EMITIR el selector (`lg:p-8` → `lg\:p-8`), y recién después
  // el escape para usarlo como expresión regular.
  const cssSel = token.replace(/([:./[\]%(),#!])/g, "\\$1");
  const forRegex = cssSel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // El selector termina ahí: `.page` NO se satisface con `.page-title`.
  return new RegExp("\\." + forRegex + "(?![-\\w\\\\])");
}

let compiled: string | null = null;
async function css(): Promise<string> {
  if (compiled !== null) return compiled;
  const input = readFileSync(resolve(ROOT, "src/app/globals.css"), "utf8");
  const base = (await import(resolve(ROOT, "tailwind.config.ts"))).default;
  const result = await postcss([
    // La configuración REAL del proyecto —tema, tokens, todo—; lo único que se
    // cambia es el contenido, acotado a la UI de custodia. El orden importa:
    // el override va DESPUÉS de la base, no antes.
    tailwindcss({
      ...base,
      content: UI_FILES.map((f) => resolve(ROOT, f)),
    } as never),
  ]).process(input, { from: undefined });
  compiled = result.css;
  return compiled;
}

describe("las clases de la UI de custodia existen de verdad", () => {
  it("cada clase usada produce una regla en el CSS compilado", async () => {
    const hoja = await css();
    const faltantes: string[] = [];
    for (const file of UI_FILES) {
      for (const token of classTokens(file)) {
        if (!selectorOf(token).test(hoja)) faltantes.push(`${token} (${file})`);
      }
    }
    expect(faltantes).toEqual([]);
  }, 30_000);

  it("las clases inventadas NO vuelven a aparecer en el código", () => {
    const inventadas = ["text-muted", "text-danger", "text-warning", "text-success", "btn-secondary"];
    const reincidencias: string[] = [];
    for (const file of UI_FILES) {
      const src = readFileSync(resolve(ROOT, file), "utf8");
      for (const clase of inventadas) {
        // Palabra completa: `text-status-danger` NO es `text-danger`.
        if (new RegExp(`(?<![-\\w])${clase}(?![-\\w])`).test(src)) {
          reincidencias.push(`${clase} (${file})`);
        }
      }
    }
    expect(reincidencias).toEqual([]);
  });

  it("los tokens semánticos REALES están en uso: error, aviso y éxito", () => {
    const todo = UI_FILES.map((f) => readFileSync(resolve(ROOT, f), "utf8")).join("\n");
    expect(todo).toMatch(/\btext-status-danger\b/);
    expect(todo).toMatch(/\btext-status-warning\b/);
    expect(todo).toMatch(/\btext-status-success\b/);
    expect(todo).toMatch(/\btext-fg-muted\b/);
  });

  it("los tokens semánticos compilan al color que corresponde", async () => {
    const hoja = await css();
    // Rojo de error, ámbar de aviso y verde de éxito, tal como los define el
    // sistema. Si alguien los repinta, esto lo cuenta.
    // El CSS compilado viene indentado: las aserciones toleran espacios.
    expect(hoja).toMatch(/\.text-status-danger\s*\{[\s\S]*?201 8 18/);
    expect(hoja).toMatch(/\.text-status-warning\s*\{[\s\S]*?180 83 9/);
    expect(hoja).toMatch(/\.text-status-success\s*\{[\s\S]*?14 124 58/);
    expect(hoja).toMatch(/\.text-fg-muted\s*\{[\s\S]*?var\(--fg-muted\)/);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// §7 · LA BARRA SE DIBUJA, Y SUS ESTADOS SE DISTINGUEN (C4 · H-5 y M-8)
// ═══════════════════════════════════════════════════════════════════════════
//
// Las dos son de la capa visual y ninguna rompía ninguna prueba: la barra medía
// CERO y «paso actual» y «paso bloqueado» se pintaban del mismo rojo. Un guard
// de existencia de clases no las habría visto nunca —las clases existían—, así
// que acá se mide lo que de verdad falló: la GEOMETRÍA y el CONTRASTE.

const BARRA = "src/app/(app)/wms/custody/_components/CaseProgressBar.tsx";

/** Resuelve `var(--cd-x)` contra las definiciones de `.cd-shell`. */
function resolveVar(hoja: string, valor: string): string {
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(valor.trim());
  if (!m) return valor.trim();
  const def = new RegExp(`${m[1]}\\s*:\\s*([^;]+);`).exec(hoja);
  return (def?.[1] ?? valor).trim();
}

/** `background` declarado por un selector de clase. */
function fondoDe(hoja: string, clase: string): string | null {
  const re = new RegExp(`\\.${clase.replace(/-/g, "\\-")}\\s*\\{([^}]*)\\}`);
  const bloque = re.exec(hoja)?.[1];
  if (!bloque) return null;
  const bg = /background(?:-color)?\s*:\s*([^;]+)/.exec(bloque)?.[1];
  return bg ? resolveVar(hoja, bg) : null;
}

describe("§7 · H-5 · las cinco barras tienen tamaño de verdad", () => {
  it("la clase de dimensión va en el `<li>`, no en un `<span>` vacío", () => {
    /**
     * EL DEFECTO ORIGINAL, para que no vuelva por descuido:
     *
     * el `flex` está en el `<ol>`, así que el `<li>` es flex ITEM pero no
     * flex CONTAINER. Colgar `cd-step` de un `<span>` VACÍO dentro del `<li>`
     * dejaba ese span en `display: inline`, y en una caja en línea no
     * reemplazada `width` y `height` NO APLICAN. Las cinco barras medían cero.
     */
    const src = readFileSync(resolve(ROOT, BARRA), "utf8");
    expect(src, "la clase de segmento debe ir en el <li>").toMatch(/<li[\s\S]{0,200}?className=\{seg\}/);
    expect(src, "no puede volver a colgar de un <span>").not.toMatch(/<span[^>]*className=\{seg\}/);
  });

  it("el segmento es hijo directo de un contenedor flex y tiene alto propio", async () => {
    const hoja = await css();
    expect(hoja, ".cd-steps debe ser flex").toMatch(/\.cd-steps\s*\{[^}]*display:\s*flex/);
    const step = /\.cd-step\s*\{([^}]*)\}/.exec(hoja)?.[1] ?? "";
    expect(step, ".cd-step debe declarar alto").toMatch(/height:\s*[1-9]/);
    expect(step, ".cd-step debe repartirse el ancho").toMatch(/flex:\s*1/);
  });
});

describe("§7 · M-8 · «actual» y «bloqueado» no se pintan igual", () => {
  it("los cuatro estados de la barra tienen fondos distintos entre sí", async () => {
    const hoja = await css();
    const estados = ["cd-step", "cd-step--done", "cd-step--current", "cd-step--blocked"];
    const fondos = new Map<string, string>();
    for (const e of estados) {
      const f = fondoDe(hoja, e);
      expect(f, `${e} debe declarar un fondo`).not.toBeNull();
      fondos.set(e, f!.toLowerCase());
    }
    // El defecto: `bg-accent` y `bg-status-danger` eran AMBOS #C90812, así que
    // «este es el paso donde estás» y «este paso está trabado» se veían igual.
    expect(
      fondos.get("cd-step--current"),
      "«paso actual» y «paso bloqueado» no pueden ser el mismo color",
    ).not.toBe(fondos.get("cd-step--blocked"));
    expect(new Set(fondos.values()).size, "los cuatro estados deben distinguirse").toBe(4);
  });
});
