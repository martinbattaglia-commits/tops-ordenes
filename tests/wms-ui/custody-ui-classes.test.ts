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

/** Clases escritas en `className`, incluidas las de expresiones con template. */
function classTokens(file: string): string[] {
  const src = readFileSync(resolve(ROOT, file), "utf8");
  const out = new Set<string>();
  const re = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    for (const group of [m[1], m[2], m[3]]) {
      if (!group) continue;
      for (const t of group.split(/\s+/)) {
        const token = t.trim();
        if (token && !token.includes("{") && !token.startsWith("$")) out.add(token);
      }
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
