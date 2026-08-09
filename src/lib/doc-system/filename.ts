/**
 * Sanea el nombre de archivo del header Content-Disposition.
 *
 * `public_id` lo asigna un trigger, pero sólo cuando llega NULL o vacío: un
 * escritor interno puede fijar uno con comillas o CRLF y romper la respuesta.
 * Reducimos a un conjunto seguro en vez de confiar en el origen del dato.
 */
export function safeFilename(raw: string, fallback = "documento"): string {
  const clean = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return clean || fallback;
}
