export interface InsertionResult {
  value: string;
  /** En una inserción, caretStart === caretEnd (caret colapsado al final). */
  caretStart: number;
  /** En un no-op con selección activa, [caretStart, caretEnd] la preservan. */
  caretEnd: number;
}

/**
 * Caracteres tras los cuales NO se antepone un espacio separador.
 * ":" NO está acá a propósito: es puntuación de cierre. "Notas:" + dictado
 * debe dar "Notas: hola", nunca "Notas:hola".
 */
const OPENERS = new Set(["", " ", "\t", "\n", "(", "[", "¿", "¡", '"', "'"]);

/** Caracteres antes de los cuales NO se agrega un espacio de cola. */
const CLOSERS = new Set([",", ".", ";", ":", "!", "?", ")", "]", "\n", " ", "\t"]);

/**
 * Calcula el resultado de insertar `text` en un campo, sin tocar el DOM.
 * Si hay una selección activa, la reemplaza. Si no, inserta en el caret.
 *
 * Precondición: 0 <= selStart <= selEnd <= value.length — exactamente lo que
 * entregan selectionStart/selectionEnd de un <input>/<textarea> reales. La
 * función no sanea índices inventados.
 */
export function planInsertion(
  value: string,
  selStart: number,
  selEnd: number,
  text: string,
): InsertionResult {
  const trimmed = text.trim();
  // No-op: nada que insertar. La selección del usuario se preserva tal cual.
  if (trimmed.length === 0) {
    return { value, caretStart: selStart, caretEnd: selEnd };
  }

  const before = value.slice(0, selStart);
  const after = value.slice(selEnd);

  const prevChar = before.slice(-1);
  const startsWithPunct = CLOSERS.has(trimmed[0]!);
  const lead = OPENERS.has(prevChar) || startsWithPunct ? "" : " ";

  const nextChar = after.slice(0, 1);
  const trail = nextChar.length > 0 && !CLOSERS.has(nextChar) ? " " : "";

  const inserted = lead + trimmed + trail;
  const caret = before.length + inserted.length;
  return { value: before + inserted + after, caretStart: caret, caretEnd: caret };
}
