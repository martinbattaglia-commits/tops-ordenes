/**
 * La cabecera `Permissions-Policy`, fijada por prueba.
 *
 * ─── QUÉ PASÓ ─────────────────────────────────────────────────────────────
 *
 * La política decía `microphone=()`. Una allowlist VACÍA no es «pedir permiso»:
 * el navegador niega `getUserMedia` incluso al PROPIO origen, y el permiso que
 * el usuario conceda no lo revierte. Era una regla de endurecimiento correcta
 * mientras la app no usaba micrófono; Nexus Link sumó los mensajes de voz y la
 * regla nunca se actualizó.
 *
 * El síntoma que llegó de producción era engañoso a propósito: dos personas, en
 * dos máquinas, con Chrome y con Edge, veían «Micrófono no disponible o permiso
 * denegado» DESPUÉS de conceder el permiso. En Safari andaba, porque no aplica
 * Permissions-Policy con el mismo rigor — lo que hacía parecer un problema de
 * máquina.
 *
 * ─── POR QUÉ ESTA PRUEBA LEE LOS DOS ARCHIVOS ─────────────────────────────
 *
 * La cabecera se emite desde DOS lugares y ninguno es autoridad del otro:
 * `netlify.toml` gobierna producción y `next.config.mjs` gobierna desarrollo.
 * Si divergen no hay error en ningún lado: hay DOS VERDADES, y el defecto
 * aparece sólo en uno de los dos entornos, que es la forma más cara de
 * encontrarlo. Por eso lo que se afirma es la igualdad, no cada valor por
 * separado.
 *
 * Estructural, sobre el código REAL en disco — mismo método que
 * `media-no-secrets.test.ts`: una ausencia se demuestra leyendo la fuente.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const leer = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/**
 * Extrae el valor de la política, en las DOS formas que existen:
 *   netlify.toml     Permissions-Policy = "…"
 *   next.config.mjs  { key: "Permissions-Policy", value: "…" }
 */
function politicaDe(fuente: string): string | null {
  const m = fuente.match(
    /Permissions-Policy["']?(?:\s*,\s*value)?\s*[:=]\s*["']([^"']+)["']/,
  );
  return m ? m[1] : null;
}

const NETLIFY = "netlify.toml";
const NEXT = "next.config.mjs";

describe("Permissions-Policy · el micrófono está habilitado para el propio origen", () => {
  it.each([NETLIFY, NEXT])("%s permite microphone=(self)", (archivo) => {
    const politica = politicaDe(leer(archivo));
    expect(politica, archivo).not.toBeNull();
    expect(politica, archivo).toContain("microphone=(self)");
  });

  it.each([NETLIFY, NEXT])("%s NO deja la allowlist del micrófono vacía", (archivo) => {
    // `microphone=()` niega el acceso al propio origen y NINGÚN permiso del
    // usuario lo revierte. Ésta es la regresión exacta que se está cerrando.
    expect(politicaDe(leer(archivo)), archivo).not.toMatch(/microphone=\(\s*\)/);
  });

  it("las dos fuentes dicen EXACTAMENTE lo mismo", () => {
    // Si divergen, producción y desarrollo se comportan distinto sin que nada
    // falle: el defecto sólo se ve en uno de los dos.
    expect(politicaDe(leer(NETLIFY))).toBe(politicaDe(leer(NEXT)));
  });
});

describe("Permissions-Policy · lo que ya estaba bien no se aflojó", () => {
  it.each([NETLIFY, NEXT])("%s mantiene cámara y geolocalización acotadas al origen", (archivo) => {
    const politica = politicaDe(leer(archivo))!;
    expect(politica).toContain("camera=(self)");
    expect(politica).toContain("geolocation=(self)");
  });

  it.each([NETLIFY, NEXT])("%s no habilita a NINGÚN tercer origen", (archivo) => {
    const politica = politicaDe(leer(archivo))!;
    // `(self)` y nada más: ni `*`, ni un dominio suelto entre comillas.
    expect(politica).not.toContain("*");
    expect(politica).not.toMatch(/https?:\/\//);
  });
});
