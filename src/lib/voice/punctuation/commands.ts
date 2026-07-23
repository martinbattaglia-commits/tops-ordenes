/**
 * Solo comandos multi-palabra inequívocos.
 *
 * Deliberadamente NO se mapean las palabras aisladas "punto" ni "coma":
 * romperían "el punto de encuentro" y "que coma tranquilo". En un ERP donde se
 * dictan observaciones operativas, eso corrompe datos en silencio.
 * Ver spec §7.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // "punto y aparte" primero: contiene la palabra "punto".
  [/\bpunto y aparte\b/giu, ".\n"],
  [/\bnuevo p[áa]rrafo\b/giu, "\n\n"],
  [/\bnueva l[íi]nea\b/giu, "\n"],
  [/\bsigno de interrogaci[óo]n\b/giu, "?"],
  [/\bsigno de exclamaci[óo]n\b/giu, "!"],
];

/** Puro. La limpieza de espacios la hace normalize(), después. */
export function applyCommands(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
