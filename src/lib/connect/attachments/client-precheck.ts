// Nexus Link · FASE B — verificación PREVIA del adjunto, del lado del cliente.
//
// ─── QUÉ ES Y QUÉ NO ES ────────────────────────────────────────────────────
//
// Esto NO valida nada en el sentido de seguridad. La validación de verdad es
// `validate.ts`, que corre en el servidor, lee la firma binaria real y no le
// cree ni al MIME ni a la extensión que declara el navegador. Este módulo
// existe para una razón distinta y mucho más chica: evitarle al operador subir
// 20 MB por una conexión de depósito para que recién entonces el servidor le
// diga que el archivo no servía.
//
// Por eso es DELIBERADAMENTE más permisivo que el servidor: sólo rechaza lo que
// puede decidir sin leer el contenido —tamaño y extensión—. Todo lo que pasa
// acá todavía puede —y debe— caerse del lado del servidor.
//
// No importa `validate.ts`: ese módulo usa `node:zlib` para abrir los paquetes
// OOXML y no tiene por qué viajar al navegador.

/** Espejo de `ATTACHMENT_LIMITS` del servidor. Ver la nota de duplicación abajo. */
export const CLIENT_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  /** Cuántos archivos se pueden encolar de una vez. */
  maxFiles: 5,
} as const;

// La duplicación de los topes es intencional: el cliente no puede importar el
// módulo del servidor, y una constante compartida en un tercer archivo tampoco
// resolvería el punto de fondo —el servidor SIEMPRE revalida—. Si divergen, el
// servidor gana y el operador ve el error un poco más tarde. Nunca al revés.

const EXTENSIONES_ACEPTADAS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "heic", "heif",
  "pdf", "docx", "xlsx", "pptx",
]);

const EXTENSIONES_DE_IMAGEN = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]);

export function extensionDe(nombre: string): string {
  const partes = nombre.toLowerCase().split(".");
  return partes.length > 1 ? partes[partes.length - 1] : "";
}

/** ¿Se puede mostrar una miniatura en el navegador? HEIC no se renderiza. */
export function tieneVistaPrevia(nombre: string, mime: string): boolean {
  const ext = extensionDe(nombre);
  if (ext === "heic" || ext === "heif") return false;
  return EXTENSIONES_DE_IMAGEN.has(ext) && mime.startsWith("image/");
}

export type PrecheckResult = { ok: true } | { ok: false; message: string };

/** Tamaño legible, para el chip del adjunto. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function precheckAttachment(file: { name: string; size: number }): PrecheckResult {
  if (file.size === 0) return { ok: false, message: "El archivo está vacío." };
  if (file.size > CLIENT_LIMITS.maxBytes) {
    return { ok: false, message: `«${file.name}» supera el máximo de 25 MB.` };
  }
  const ext = extensionDe(file.name);
  if (!EXTENSIONES_ACEPTADAS.has(ext)) {
    return {
      ok: false,
      message: "Sólo se aceptan imágenes, PDF y documentos de Office.",
    };
  }
  if (EXTENSIONES_DE_IMAGEN.has(ext) && file.size > CLIENT_LIMITS.maxImageBytes) {
    return { ok: false, message: `«${file.name}» supera el máximo de 10 MB para imágenes.` };
  }
  return { ok: true };
}

/** `accept` del input, alineado con la lista de arriba. */
export const ACCEPT_ATTR = [
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif",
  ".pdf", ".docx", ".xlsx", ".pptx",
].join(",");
