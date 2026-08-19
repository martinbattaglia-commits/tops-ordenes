/**
 * HOTFIX-OC-EMISION-ATOMICA · el emisor de OC destruía el error real.
 *
 * `purchase_order_issue` aborta con una excepción nombrada por cada invariante
 * que protege (identidad, perfil, permisos, firmante canónico, forma del
 * payload). El emisor colapsaba TODAS ellas —más las quince condiciones del
 * guard de forma— en un único `console.error({ code: "PO_ISSUE_FAILED" })` y
 * en un mensaje que invitaba a reintentar. Ninguno de esos fallos es
 * transitorio: reintentar reproduce el mismo aborto, sin consumir siquiera un
 * número de OC.
 *
 * Este módulo es lógica pura: clasifica el desenlace de la RPC, nombra la
 * condición exacta que falló y produce (a) un mensaje accionable para el
 * operador y (b) un registro sin PII para el log del Server Action.
 */

export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export type IssueFailureKind =
  | "no_session"
  | "inactive_profile"
  | "signer_not_canonical"
  | "permission"
  | "validation"
  | "incomplete_result"
  | "transient"
  | "unknown";

/** Forma mínima que el emisor necesita para continuar sin inventar datos. */
export interface IssuedShape {
  id?: string | null;
  public_id?: string | null;
  price_state?: string | null;
  signed_by?: string | null;
  issued_at?: string | null;
  signature_hash?: string | null;
  integrity_hash?: string | null;
  emisor_name?: string | null;
  emisor_email?: string | null;
  emisor_role?: string | null;
  vendor_snapshot?: { id?: string | null; razon?: string | null; cuit?: string | null } | null;
}

export interface IssueFailureLog {
  kind: IssueFailureKind;
  failedCheck: string;
  sqlstate: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
}

export interface IssueFailure {
  ok: false;
  kind: IssueFailureKind;
  /** Nombre de la condición que falló: un campo del guard, o `rpc_error`. */
  failedCheck: string;
  userMessage: string;
  retryable: boolean;
  log: IssueFailureLog;
}

/**
 * Forma ya comprobada por `firstMissingIssuedField`: cada campo canónico está
 * presente y bien formado. El emisor consume ESTE tipo, de modo que el
 * compilador impide volver a tratar como opcional lo que el guard ya cerró.
 */
export interface IssuedCanonical {
  id: string;
  public_id: string;
  price_state: string;
  signed_by: string;
  issued_at: string;
  signature_hash: string;
  integrity_hash: string;
  emisor_name: string;
  emisor_email: string;
  emisor_role: string;
  vendor_snapshot: { id: string; razon: string; cuit: string };
}

export interface IssueSuccess<T extends IssuedShape> {
  ok: true;
  issued: T & IssuedCanonical;
}

const HEX64 = /^[a-f0-9]{64}$/;

/**
 * El log del Server Action no es un canal de datos del proveedor. Los mensajes
 * de la RPC son literales del servidor, pero se redactan igual: un futuro
 * `raise ... using message = %` no debe poder filtrar un email ni un CUIT.
 */
export function redactRpcText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/[^\s@,;]+@[^\s@,;()]+/g, "[email]")
    .replace(/\d[\d.\-]{6,}\d/g, "[num]")
    .slice(0, 500);
}

/**
 * `details` es el campo donde PostgreSQL vuelca «Failing row contains (…)»:
 * la fila entera, con razón social, domicilio y contacto del proveedor. Ni
 * redactado sirve —lo que queda no diagnostica nada que el `message` y la
 * constraint no digan ya—, así que se descarta entero y se deja la marca.
 */
export function redactRpcDetail(value: string | null | undefined): string | null {
  const redacted = redactRpcText(value);
  if (!redacted) return null;
  if (/failing row contains/i.test(redacted)) return "[fila omitida: payload del proveedor]";
  return redacted.slice(0, 200);
}

/**
 * Devuelve el PRIMER campo canónico ausente o malformado, o `null` si la
 * respuesta está completa. Reemplaza al OR de quince condiciones, que sabía
 * que algo faltaba pero nunca cuál.
 */
export function firstMissingIssuedField(issued: IssuedShape | null | undefined): string | null {
  if (!issued || typeof issued !== "object") return "id";
  const nonEmpty = (value: unknown): boolean =>
    typeof value === "string" && value.trim().length > 0;

  if (!nonEmpty(issued.id)) return "id";
  if (!nonEmpty(issued.public_id)) return "public_id";
  if (!nonEmpty(issued.signed_by)) return "signed_by";
  if (!nonEmpty(issued.issued_at)) return "issued_at";
  if (typeof issued.signature_hash !== "string" || !HEX64.test(issued.signature_hash)) {
    return "signature_hash";
  }
  if (typeof issued.integrity_hash !== "string" || !HEX64.test(issued.integrity_hash)) {
    return "integrity_hash";
  }
  if (!nonEmpty(issued.price_state)) return "price_state";
  if (!nonEmpty(issued.emisor_name)) return "emisor_name";
  if (!nonEmpty(issued.emisor_email)) return "emisor_email";
  if (!nonEmpty(issued.emisor_role)) return "emisor_role";
  const vendor = issued.vendor_snapshot;
  if (!vendor || typeof vendor !== "object") return "vendor_snapshot";
  if (!nonEmpty(vendor.id)) return "vendor_snapshot.id";
  if (!nonEmpty(vendor.razon)) return "vendor_snapshot.razon";
  if (!nonEmpty(vendor.cuit)) return "vendor_snapshot.cuit";
  return null;
}

/**
 * Un fallo es transitorio sólo si volver a intentarlo puede cambiar el
 * resultado: conexión caída, serialización, deadlock, cancelación o recursos.
 * Todo lo demás es una decisión del servidor y reintentar es mentirle al
 * operador.
 */
function isTransientSqlstate(code: string | null): boolean {
  if (!code) return false;
  if (code === "40001" || code === "40P01") return true;
  return code.startsWith("08") || code.startsWith("53") || code.startsWith("57");
}

function classifyRpcError(error: RpcErrorLike): {
  kind: IssueFailureKind;
  userMessage: string;
  retryable: boolean;
} {
  const code = typeof error.code === "string" ? error.code : null;
  const raw = typeof error.message === "string" ? error.message : "";
  const safe = redactRpcText(raw) ?? "sin mensaje del servidor";

  if (raw.includes("PO_ISSUE_SIN_IDENTIDAD") || code === "28000") {
    return {
      kind: "no_session",
      retryable: false,
      userMessage:
        "Tu sesión ya no es válida. Volvé a iniciar sesión y emití la orden de nuevo: "
        + "no se creó ninguna orden ni se envió nada al proveedor.",
    };
  }
  if (raw.includes("PO_ISSUE_SIN_PERFIL_ACTIVO")) {
    return {
      kind: "inactive_profile",
      retryable: false,
      userMessage:
        "Tu perfil figura como inactivo, así que el servidor no puede emitir en tu nombre. "
        + "Pedí que lo reactiven; reintentar ahora va a fallar igual.",
    };
  }
  if (raw.includes("firmante canónico")) {
    return {
      kind: "signer_not_canonical",
      retryable: false,
      userMessage:
        "La firma y emisión de órdenes de compra están reservadas al apoderado de TOPS. "
        + "Tu usuario puede prepararlas, pero no firmarlas: ingresá con el usuario apoderado "
        + "o pedile que la emita. No se creó ninguna orden y volver a intentarlo con este "
        + "usuario va a fallar siempre.",
    };
  }
  if (raw.includes("Sin permisos compras")) {
    return {
      kind: "permission",
      retryable: false,
      userMessage:
        "No tenés los permisos compras.create y compras.sign que exige la emisión. "
        + "Pedí que te los asignen; reintentar no cambia nada.",
    };
  }
  if (isTransientSqlstate(code)) {
    return {
      kind: "transient",
      retryable: true,
      userMessage:
        "La base rechazó la emisión por una condición transitoria y nada quedó a medias. "
        + "Reintentá en unos minutos.",
    };
  }
  if (code === "42501") {
    // Los tres 42501 nombrados de 0243 ya se interceptaron arriba. Lo que
    // llega acá es la pérdida del EXECUTE sobre la función o sobre
    // has_permission: configuración, nunca un dato del formulario.
    return {
      kind: "permission",
      retryable: false,
      userMessage:
        `La base rechazó la emisión por falta de privilegios: ${safe}. `
        + "Es un problema de configuración de permisos, no de los datos de la orden: "
        + "pasáselo a soporte. Reintentar no cambia nada.",
    };
  }
  if (code === "P0001" || code === "23514" || code === "22P02") {
    return {
      kind: "validation",
      retryable: false,
      userMessage:
        `El servidor rechazó la orden: ${safe}. Corregí ese dato y volvé a emitir; `
        + "no se creó ninguna orden y reintentar sin cambios va a fallar igual.",
    };
  }
  return {
    kind: "unknown",
    retryable: false,
    userMessage:
      `No se pudo emitir la orden y no se creó nada: ${safe}. `
      + "Pasale este detalle a soporte; reintentar sin cambios va a repetir el fallo.",
  };
}

export function classifyIssueOutcome<T extends IssuedShape>(args: {
  issueError: RpcErrorLike | null | undefined;
  issued: T | null | undefined;
}): IssueSuccess<T> | IssueFailure {
  if (args.issueError) {
    const { kind, userMessage, retryable } = classifyRpcError(args.issueError);
    return {
      ok: false,
      kind,
      failedCheck: "rpc_error",
      userMessage,
      retryable,
      log: {
        kind,
        failedCheck: "rpc_error",
        sqlstate: typeof args.issueError.code === "string" ? args.issueError.code : null,
        message: redactRpcText(args.issueError.message),
        details: redactRpcDetail(args.issueError.details),
        hint: redactRpcText(args.issueError.hint),
      },
    };
  }

  const missing = firstMissingIssuedField(args.issued);
  if (missing) {
    return {
      ok: false,
      kind: "incomplete_result",
      failedCheck: missing,
      retryable: false,
      userMessage:
        `La emisión devolvió una respuesta incompleta: falta o es inválido «${missing}». `
        + "No se creó ninguna orden ni se envió nada al proveedor. "
        + "Reportá este campo a soporte; reintentar va a devolver lo mismo.",
      log: {
        kind: "incomplete_result",
        failedCheck: missing,
        sqlstate: null,
        message: null,
        details: null,
        hint: null,
      },
    };
  }

  return { ok: true, issued: args.issued as T & IssuedCanonical };
}
