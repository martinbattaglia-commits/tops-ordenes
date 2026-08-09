/**
 * Extrae el texto de un PDF ya renderizado, para poder assertear CONTENIDO en
 * los tests en vez de sólo el tamaño del buffer.
 *
 * Un umbral de bytes no prueba nada: las fuentes embebidas y las bandas
 * institucionales ya suman decenas de KB, así que un documento vacío o roto lo
 * supera igual.
 */
import { PDFParse } from "pdf-parse";

export async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const res = await parser.getText();
    return res.text.replace(/\s+/g, " ");
  } finally {
    await parser.destroy();
  }
}

/**
 * Normaliza para comparar frases: quita TODO el espacio en blanco.
 *
 * Los rótulos institucionales usan `letterSpacing`, y el extractor lo devuelve
 * como caracteres sueltos ("A N U L A D O"). Comparar sin espacios evita tests
 * frágiles atados al tracking tipográfico.
 */
export function squash(s: string): string {
  return s.replace(/\s/g, "");
}

/** ¿El PDF contiene la frase, ignorando espaciado tipográfico? */
export function hasPhrase(pdfPlainText: string, phrase: string): boolean {
  return squash(pdfPlainText).includes(squash(phrase));
}
