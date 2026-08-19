/**
 * SCOPE B · el pipeline de media destruía el error real.
 *
 * Tres sitios de `attachment-actions.ts` —abrir la subida (278), reclamarla
 * (342) y firmar la URL de lectura (484)— descartaban el error de la RPC y
 * devolvían un string fijo. Bajo ese string convivían condiciones que la base
 * SÍ distingue y que exigen conductas opuestas:
 *
 *   · «Sin sesión.» (42501)                 → volver a entrar;
 *   · «No tenés acceso…» (42501)            → pedir acceso, nunca reintentar;
 *   · «Bucket no admitido.» (22023)         → defecto de configuración;
 *   · «adjunto inexistente» (no_data_found) → el adjunto se fue;
 *   · PGRST202                              → la función no existe en la base:
 *                                             contrato app↔base roto, y el
 *                                             genérico lo hacía indistinguible
 *                                             de un problema de permisos;
 *   · fallo de red                          → lo ÚNICO reintentable.
 *
 * Es el mismo defecto que ya costó los hotfixes #91, #93 y #94, y el falso
 * incidente de WhatsApp: reintentar un fallo no transitorio reproduce el
 * aborto, y el operador reporta el síntoma porque el sistema nunca le dio la
 * causa.
 *
 * Módulo de lógica pura, sin IO: clasifica el desenlace, produce (a) un
 * mensaje accionable para el operador y (b) un registro que conserva la causa
 * real sin PII —ni paths, ni identidades, ni bytes—.
 *
 * POR QUÉ LA CAUSA VIAJA EN EL RESULTADO Y NO EN UN `console.*`: el gate H2
 * (`media-no-secrets.test.ts`) prohíbe TODO punto de log en la ruta de envío de
 * media, y su razón es exacta —«no hay dónde filtrar nada si no hay ningún
 * punto de log»—. Loguear la causa habría cambiado un defecto de diagnóstico
 * por un riesgo de secreto. Se resuelve al revés: el desenlace devuelve un
 * `diagnostic` CERRADO —clase, etapa y código— que es distinguible sin ser
 * texto libre. El `log`, que sí copia mensaje/details/hint del motor, queda
 * disponible para quien pueda consumirlo fuera de esta ruta; NO se emite acá.
 */

/** Forma mínima común a `PostgrestError` y a los errores de Storage. */
export interface MediaErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  /** Storage no usa SQLSTATE: reporta el HTTP en `statusCode`. */
  statusCode?: string | number | null;
}

/** Etapa del ciclo de vida en la que se rompió. Es parte del diagnóstico. */
export type MediaStage =
  | "upload_begin"
  | "claim_finalize"
  | "download"
  | "signed_url";

export type MediaFailureKind =
  | "no_session"
  | "no_access"
  | "bucket_rejected"
  | "attachment_missing"
  | "storage_object_missing"
  | "upload_not_claimable"
  | "ambiguous_row"
  | "rpc_missing"
  | "transient"
  | "empty_result"
  | "unknown";

export interface MediaFailureLog {
  kind: MediaFailureKind;
  stage: MediaStage;
  /** SQLSTATE, código PostgREST o HTTP de Storage. `null` si no vino ninguno. */
  sqlstate: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
}

/**
 * Lo que SÍ puede cruzar hacia el cliente: tres campos cerrados. Ni mensaje del
 * motor, ni details, ni hint —esos pueden contener rutas o fragmentos de
 * configuración—. Con esto alcanza para que dos causas nunca se confundan.
 */
export interface MediaDiagnostic {
  kind: MediaFailureKind;
  stage: MediaStage;
  sqlstate: string | null;
}

export interface MediaFailure {
  ok: false;
  kind: MediaFailureKind;
  userMessage: string;
  /** Causa distinguible, segura de devolver. */
  diagnostic: MediaDiagnostic;
  /** Sólo `transient` lo es. Reintentar el resto reproduce el mismo aborto. */
  retryable: boolean;
  log: MediaFailureLog;
}

/** Mensaje por causa. Distinguibles entre sí: es la condición del arreglo. */
const MENSAJES: Record<MediaFailureKind, string> = {
  no_session: "Tu sesión venció. Volvé a entrar y probá de nuevo.",
  no_access: "No tenés acceso a esta conversación o a este canal.",
  bucket_rejected:
    "El destino de archivos configurado no está admitido. Es un problema de configuración: avisá a soporte técnico.",
  attachment_missing: "El adjunto ya no existe.",
  storage_object_missing: "El archivo no llegó a destino: volvé a adjuntarlo.",
  upload_not_claimable:
    "Esta subida ya no está disponible: venció, ya se confirmó o pertenece a otra conversación. Volvé a adjuntar el archivo.",
  ambiguous_row:
    "El adjunto quedó registrado de forma ambigua. Es un defecto de datos: avisá a soporte técnico.",
  rpc_missing:
    "El servidor no reconoce esta operación de archivos. Es un defecto de instalación: avisá a soporte técnico.",
  transient: "No se pudo contactar al servidor. Probá de nuevo en unos segundos.",
  empty_result: "El servidor no devolvió respuesta para esta operación.",
  unknown: "Falló una operación de archivos por una causa no prevista. Avisá a soporte técnico.",
};

/** Códigos que Postgres devuelve como texto y no como los cinco dígitos. */
const SQLSTATE_POR_NOMBRE: Record<string, string> = {
  no_data_found: "02000",
  insufficient_privilege: "42501",
};

function normalizarCodigo(e: MediaErrorLike): string | null {
  const bruto = (e.code ?? "").toString().trim();
  if (bruto) return SQLSTATE_POR_NOMBRE[bruto] ?? bruto;
  const http = e.statusCode == null ? "" : e.statusCode.toString().trim();
  return http || null;
}

/**
 * Un 42501 cubre DOS condiciones opuestas: no hay sesión, o la hay y no
 * alcanza. La base las escribe con mensajes distintos y son la diferencia
 * entre «volvé a entrar» y «pedí acceso», así que se separan por el texto —
 * que es lo único que las distingue— y ante la duda se elige la que NO invita
 * a reintentar.
 */
function esFaltaDeSesion(mensaje: string): boolean {
  return /sin sesi[oó]n|jwt expired|no autenticad/i.test(mensaje);
}

function esFalloDeRed(mensaje: string): boolean {
  return /fetch failed|network|econnreset|etimedout|socket hang up|timeout/i.test(mensaje);
}

/**
 * Clasifica el desenlace de una operación del pipeline de media.
 *
 * `null`/`undefined` NO significa éxito: significa que el llamador llegó acá
 * sin error y sin resultado, y eso es su propia condición (`empty_result`).
 * Colapsarla en «no se pudo» es exactamente el defecto que este módulo cierra.
 */
export function classifyMediaFailure(
  error: MediaErrorLike | null | undefined,
  stage: MediaStage,
): MediaFailure {
  const e = error ?? {};
  const mensaje = (e.message ?? "").toString();
  const codigo = error ? normalizarCodigo(e) : null;

  const kind = clasificar(error, codigo, mensaje);

  return {
    ok: false,
    kind,
    userMessage: MENSAJES[kind],
    diagnostic: { kind, stage, sqlstate: codigo },
    retryable: kind === "transient",
    log: {
      kind,
      stage,
      sqlstate: codigo,
      message: e.message ?? null,
      details: e.details ?? null,
      hint: e.hint ?? null,
    },
  };
}

function clasificar(
  error: MediaErrorLike | null | undefined,
  codigo: string | null,
  mensaje: string,
): MediaFailureKind {
  if (!error) return "empty_result";

  switch (codigo) {
    case "42501":
      return esFaltaDeSesion(mensaje) ? "no_session" : "no_access";
    case "22023":
      return "bucket_rejected";
    case "02000":
      return "attachment_missing";
    case "PGRST202":
      return "rpc_missing";
    case "PGRST116":
      return "ambiguous_row";
    case "CLAIM_DENIED":
      return "upload_not_claimable";
    case "404":
      return "storage_object_missing";
  }

  if (esFalloDeRed(mensaje)) return "transient";
  if (/object not found|not_found/i.test(mensaje)) return "storage_object_missing";
  if (esFaltaDeSesion(mensaje)) return "no_session";

  return "unknown";
}
