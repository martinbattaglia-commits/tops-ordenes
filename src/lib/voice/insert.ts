export interface InsertionResult {
  value: string;
  caret: number;
}

/** Caracteres tras los cuales NO se antepone un espacio separador. */
const OPENERS = new Set(["", " ", "\t", "\n", "(", "[", "¿", "¡", '"', "'", ":"]);

/** Caracteres antes de los cuales NO se agrega un espacio de cola. */
const CLOSERS = new Set([",", ".", ";", ":", "!", "?", ")", "]", "\n", " ", "\t"]);

/**
 * Calcula el resultado de insertar `text` en un campo, sin tocar el DOM.
 * Si hay una selección activa, la reemplaza. Si no, inserta en el caret.
 */
export function planInsertion(
  value: string,
  selStart: number,
  selEnd: number,
  text: string,
): InsertionResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { value, caret: selStart };

  const before = value.slice(0, selStart);
  const after = value.slice(selEnd);

  const prevChar = before.slice(-1);
  const startsWithPunct = CLOSERS.has(trimmed[0]!);
  const lead = OPENERS.has(prevChar) || startsWithPunct ? "" : " ";

  const nextChar = after.slice(0, 1);
  const trail = nextChar.length > 0 && !CLOSERS.has(nextChar) ? " " : "";

  const inserted = lead + trimmed + trail;
  return {
    value: before + inserted + after,
    caret: before.length + inserted.length,
  };
}
