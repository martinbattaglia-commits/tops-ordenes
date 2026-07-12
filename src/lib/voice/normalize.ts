/**
 * Normalización determinística e inequívoca. Corre SIEMPRE, después del
 * Punctuator. No interpreta comandos hablados ni infiere puntuación:
 * eso es responsabilidad de src/lib/voice/punctuation/.
 */
export function normalize(input: string): string {
  let out = input.normalize("NFC");

  // Saltos de línea uniformes.
  out = out.replace(/\r\n?/g, "\n");

  // Colapsar espacios y tabulaciones (sin tocar los saltos de línea).
  out = out.replace(/[ \t]+/g, " ");

  // Los espacios que rodean un salto de línea se descartan.
  out = out.replace(/[ \t]*\n[ \t]*/g, "\n");

  // Como máximo un párrafo en blanco.
  out = out.replace(/\n{3,}/g, "\n\n");

  // Sin espacio antes de un signo de puntuación de cierre.
  out = out.replace(/[ \t]+([,.;:!?)])/g, "$1");

  out = out.trim();
  if (out.length === 0) return "";

  // Mayúscula inicial.
  //
  // El prefijo salta signos de apertura y espacios (`¿`, `¡`, `(`, comillas)
  // pero se DETIENE ante un dígito. Si aceptara cualquier no-letra (`\P{L}`),
  // "12 pallets al depósito" se convertiría en "12 Pallets al depósito": en un
  // ERP de logística el dictado arranca con la cantidad, y ese es el caso
  // normal, no el borde.
  out = out.replace(/^([^\p{L}\p{N}]*)(\p{L})/u, (_m, prefix: string, letter: string) =>
    prefix + letter.toLocaleUpperCase("es"),
  );

  // Mayúscula después de . ! ? seguidos de al menos un espacio.
  // El espacio obligatorio evita capitalizar la parte decimal de "3.5 kg".
  out = out.replace(
    /([.!?])(\s+)(\p{L})/gu,
    (_m, punct: string, gap: string, letter: string) =>
      punct + gap + letter.toLocaleUpperCase("es"),
  );

  return out;
}
