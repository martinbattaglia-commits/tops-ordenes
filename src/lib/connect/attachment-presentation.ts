/**
 * H-1 · cómo se PRESENTA un adjunto en el hilo. Lógica pura, sin IO.
 *
 * El defecto que cierra: `ThreadView` no tenía rama para `kind === "file"`, así
 * que todo adjunto caía al `else` de texto y se pintaba como la etiqueta
 * `📎 foto.png` —sin imagen, sin enlace, sin descarga—. El archivo llegaba
 * entero al receptor y era inabrible. La regla que fija este módulo es la
 * inversa y no admite excepción: **ningún adjunto queda sin forma de abrirse**.
 * Lo que no se puede previsualizar, se descarga.
 *
 * La decisión vive acá y no en el componente para que sea medible sin render y
 * para que las tres superficies —DM, Incidentes y canales, que montan el mismo
 * `ThreadView`— no puedan divergir.
 */

/** Lo que la lectura del hilo trae de `connect_attachments`. */
export interface MessageAttachmentLike {
  id: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  /** `clean` es el único estado que habilita previsualización. */
  scanStatus?: string | null;
}

export type AttachmentMode = "image" | "audio" | "download";

export interface AttachmentPresentation {
  id: string;
  mode: AttachmentMode;
  /** Nombre para mostrar. Nunca vacío. */
  label: string;
  /** Tamaño legible, o `null` si la fila no lo tiene. */
  sizeLabel: string | null;
  /**
   * El binario no pasó (todavía) el control de contenido. No se previsualiza
   * —una imagen se renderiza sola y eso es justo lo que no queremos de algo sin
   * verificar—, pero SÍ se puede descargar, con la marca a la vista.
   */
  unverified: boolean;
}

const ETIQUETA_SIN_NOMBRE = "Archivo adjunto";

/** MIME sin parámetros: `audio/ogg;codecs=opus` → `audio/ogg`. */
function tipoBase(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Tamaño legible en es-AR (coma decimal). Se muestra un decimal sólo cuando
 * aporta: `1,5 KB` sí, `1,0 KB` no.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const unidades = ["KB", "MB", "GB", "TB"] as const;
  let valor = bytes / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  const redondeado = Math.round(valor * 10) / 10;
  const texto = Number.isInteger(redondeado)
    ? String(redondeado)
    : redondeado.toString().replace(".", ",");
  return `${texto} ${unidades[i]}`;
}

export function presentAttachment(a: MessageAttachmentLike): AttachmentPresentation {
  const tipo = tipoBase(a.mimeType);
  // `scan_status` es NOT NULL en la tabla; un valor ausente acá sólo puede venir
  // de una proyección incompleta, y ante la duda NO se previsualiza.
  const unverified = (a.scanStatus ?? "") !== "clean";

  let mode: AttachmentMode = "download";
  if (!unverified) {
    if (tipo.startsWith("image/")) mode = "image";
    else if (tipo.startsWith("audio/")) mode = "audio";
  }

  const nombre = (a.fileName ?? "").trim();
  return {
    id: a.id,
    mode,
    label: nombre.length > 0 ? nombre : ETIQUETA_SIN_NOMBRE,
    sizeLabel: typeof a.fileSize === "number" ? formatFileSize(a.fileSize) : null,
    unverified,
  };
}
