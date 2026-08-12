import { createHash } from "node:crypto";
import {
  createClient,
  createAdminClient,
  createCustodyAdminMutationClient,
  createCustodyMutationClient,
  noRetryTransport,
} from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  isInspectionPair,
  parseAttachResult,
  parseCanonicalUuid,
  parseCustodyBucket,
  parseCustodyScope,
  parseCustodyStagePair,
  parseCustodyStoragePath,
  parseEvidenceKind,
  parsePositiveSize,
  parseSha256Hex,
} from "./canonical-contract";
import type {
  AttachEvidenceInput,
  AttachResult,
  CustodyEventRow,
  CustodyTimeline,
  CustodyTokenResult,
  DeliveryPodDetail,
  DeliveryPodRow,
  GeneratePodInput,
  RegisterEventInput,
  ShipmentCustodySummary,
  SignedUrlGrant,
  VerifyChainResult,
  CustodyEventType,
  CustodyStage,
} from "./types";

/**
 * Capa de datos de la Cadena de Custodia (GATE 5). Envuelve EXCLUSIVAMENTE las
 * RPC SECURITY DEFINER de 0036–0039 y lecturas tipadas vía PostGREST. Las
 * mutaciones (attach/register/redact/pod) van solo por RPC. Los binarios de
 * Storage se sirven SIEMPRE por emit_custody_signed_url (auditado). Sin SQL inline.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}


// ===========================================================================
// M2 · ATESTACIÓN SERVER-SIDE DEL CONTENIDO ALMACENADO
//
// La DB dejó de aceptar una inspección humana con el digest que declara el
// llamador (0226). El digest autoritativo sale de RELEER el objeto guardado en
// Storage y hashear ESOS bytes; el que trae el `FormData` sólo sirve para poder
// decir que difiere.
// ===========================================================================

/**
 * Puerto de Storage, inyectable. Existe para que la verificación del contenido
 * sea probable sin plataforma: el adaptador productivo pasa el cliente admin de
 * Supabase, y una prueba focalizada puede pasar un doble. Lo que el doble
 * ejercita es la ORQUESTACIÓN; la lectura del objeto real sólo la puede
 * demostrar un Storage real.
 */
export interface CustodyStoragePort {
  /** Sube el objeto SIN sobrescribir. Lanza si Storage rechaza. */
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Descarga el objeto. Devuelve `null` si no existe o la respuesta es ambigua. */
  download(bucket: string, path: string): Promise<Uint8Array | null>;
  /**
   * Borra el objeto. LANZA si Storage devuelve error: un `remove` que ignora
   * `{ error }` deja creer que el huérfano se limpió cuando sigue ahí, y esa
   * mentira es peor que el huérfano.
   */
  remove(bucket: string, path: string): Promise<void>;
}

export interface VerifiedContent {
  sha256: string;
  sizeBytes: number;
}

/** Fallo de Storage. Nunca lleva bucket, path, digest ni nombre de archivo. */
export class CustodyStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustodyStorageError";
  }
}

/**
 * Precondición LOCAL que falló ANTES de emitir ninguna llamada.
 *
 * Es el único fallo no-SQLSTATE que puede tratarse como determinista: prueba
 * que la RPC nunca salió del proceso, así que no hay transacción que pueda
 * haber confirmado. No amplía la allowlist de SQLSTATE ni se infiere de un
 * `Error` genérico: hay que lanzarlo explícitamente.
 */
export class CustodyPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustodyPreflightError";
  }
}

/** Fallo de la frontera de identidad: sin usuario o sesión confiables. */
export class TrustBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrustBoundaryError";
  }
}

/**
 * W22-TER-C4 · O-4 · Un cliente ausente es una precondición LOCAL, no un
 * resultado remoto.
 *
 * La versión anterior lanzaba `new Error("Supabase no configurado")`, que el
 * clasificador —correctamente— trataba como AMBIGUO: se abría un
 * `reconciliation_required` y quedaba un objeto huérfano por una falla que
 * jamás salió del proceso. `CustodyPreflightError` dice la verdad: no hubo
 * transacción, la compensación es segura y no hay nada que reconciliar.
 *
 * Se usa en TODAS las mutaciones de custodia para que ninguna vuelva a
 * disfrazar una falta de configuración de incertidumbre remota.
 */
export function requireCustodyClient<T>(client: T | null | undefined, what: string): T {
  if (!client) {
    throw new CustodyPreflightError(`${what} no disponible: falta la configuración de servidor`);
  }
  return client;
}

/**
 * Fallo de una RPC, clasificado.
 *
 * `deterministic = true` cuando PostgREST devolvió un error CON código: la
 * transacción se rechazó y no quedó nada escrito, así que compensar es seguro.
 * `deterministic = false` cuando el fallo fue de red o timeout: no se sabe si
 * la transacción se confirmó, y borrar el objeto podría destruir la evidencia
 * de una inspección efectivamente registrada.
 */
export class CustodyRpcError extends Error {
  readonly deterministic: boolean;
  readonly code: string | null;
  constructor(message: string, deterministic: boolean, code: string | null) {
    super(message);
    this.name = "CustodyRpcError";
    this.deterministic = deterministic;
    this.code = code;
  }
}

/**
 * SQLSTATE cuya semántica PRUEBA que la sentencia fue rechazada y la
 * transacción abortó. Allowlist EXACTA: todo lo que no esté acá es ambiguo.
 *
 *   23502 not_null_violation      · 23503 foreign_key_violation
 *   23505 unique_violation        · 23514 check_violation
 *   23P01 exclusion_violation
 *     → violación de integridad: el servidor abortó la transacción.
 *   22P02 invalid_text_representation · 22023 invalid_parameter_value
 *   22001 string_data_right_truncation
 *     → dato inválido: la sentencia nunca se aplicó.
 *   42501 insufficient_privilege  · 42883 undefined_function
 *   42P01 undefined_table         · 42703 undefined_column
 *   42804 datatype_mismatch
 *     → rechazo de autorización o de contrato: no hubo efecto.
 *   P0001 raise_exception         · P0002 no_data_found
 *     → nuestras propias RAISE: la función abortó explícitamente.
 *   40001 serialization_failure   · 40P01 deadlock_detected
 *     → PostgreSQL ya hizo ROLLBACK; no quedó nada escrito.
 *   25006 read_only_sql_transaction
 *     → la escritura fue rechazada de plano.
 *
 * Deliberadamente NO figuran familias enteras: `23*` incluiría códigos
 * futuros, y `40*` incluye `40003 statement_completion_unknown`, que es
 * exactamente el caso ambiguo que este clasificador existe para no confundir.
 */
const DETERMINISTIC_SQLSTATES: ReadonlySet<string> = new Set([
  "23502", "23503", "23505", "23514", "23P01",
  "22P02", "22023", "22001",
  "42501", "42883", "42P01", "42703", "42804",
  "P0001", "P0002",
  "40001", "40P01",
  "25006",
]);

/**
 * Clasifica el error de una RPC. **Ambiguo por defecto.**
 *
 * La versión anterior trataba «tiene `code`» como prueba de rollback, y eso es
 * falso: `08006` (connection_failure), `57014` (query_canceled), `53300`
 * (too_many_connections), `58000` (system_error), `XX000` (internal_error) y
 * los `PGRST00x` traen código y NO dicen nada sobre si la transacción
 * confirmó. Compensar con esa premisa podía revocar y borrar la evidencia de
 * una inspección ya registrada.
 *
 * `attempts` cierra el otro flanco: si el transporte observó más de un intento,
 * la clasificación degrada a AMBIGUA cualquiera sea el código —un `23505` en el
 * segundo intento puede ser el eco del primero, que confirmó—.
 */
export function classifyRpcError(
  error: unknown,
  label: string,
  attempts = 1,
): CustodyRpcError {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? ((error as { code?: unknown }).code as string | undefined) ?? null
      : null;

  const normalized = typeof code === "string" ? code.trim().toUpperCase() : null;
  const deterministic =
    attempts <= 1 && normalized !== null && DETERMINISTIC_SQLSTATES.has(normalized);

  return new CustodyRpcError(label, deterministic, normalized);
}

/** Los códigos declarados deterministas, para poder auditarlos desde fuera. */
export const DETERMINISTIC_RPC_CODES: readonly string[] = [...DETERMINISTIC_SQLSTATES].sort();

export class StoredContentMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoredContentMismatchError";
  }
}

/**
 * Relee el objeto ALMACENADO y calcula su SHA-256. Falla cerrado ante cualquier
 * ambigüedad: objeto ilegible, tamaño distinto del subido o digest distinto del
 * declarado. No se crea evento, evidencia ni inspección si esto no pasa.
 */
export async function verifyStoredContent(
  storage: CustodyStoragePort,
  bucket: string,
  path: string,
  expected: { sha256?: string | null; sizeBytes?: number | null },
): Promise<VerifiedContent> {
  const bytes = await storage.download(bucket, path);
  if (bytes === null || bytes.byteLength === 0) {
    throw new StoredContentMismatchError(
      "no se pudo releer el objeto almacenado: la evidencia no se registra",
    );
  }
  const sha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const sizeBytes = bytes.byteLength;

  if (expected.sizeBytes != null && expected.sizeBytes !== sizeBytes) {
    throw new StoredContentMismatchError(
      "el tamaño del objeto almacenado no coincide con el subido",
    );
  }
  if (expected.sha256 && expected.sha256 !== sha256) {
    throw new StoredContentMismatchError(
      "el contenido almacenado no coincide con el digest declarado",
    );
  }
  return { sha256, sizeBytes };
}

export interface AttestContentInput {
  bucket: string;
  storagePath: string;
  sha256: string;
  sizeBytes: number;
  actorId: string;
  sessionId: string;
  scope: "packing_unit" | "shipment";
  entityId: string;
  stage: CustodyStage;
  eventType: CustodyEventType;
}

/**
 * Emite la atestación en la DB con el rol interno de servidor. Sin cliente
 * admin no hay atestación, y sin atestación la inspección humana no se registra:
 * fail-closed, sin caminos alternativos.
 */
export async function attestCustodyContent(input: AttestContentInput): Promise<string> {
  const transport = noRetryTransport();
  const admin = requireCustodyClient(
    createCustodyAdminMutationClient(transport),
    "atestación",
  );
  const { data, error } = await admin.rpc("attest_custody_content", {
    p_bucket: input.bucket,
    p_storage_path: input.storagePath,
    p_sha256: input.sha256,
    p_size_bytes: input.sizeBytes,
    p_actor_id: input.actorId,
    p_session_id: input.sessionId,
    p_scope: input.scope,
    p_entity_id: input.entityId,
    p_stage: input.stage,
    p_event_type: input.eventType,
  });
  if (error) {
    throw classifyRpcError(
      error,
      "no se pudo atestar el contenido almacenado",
      transport.rpcAttempts("attest_custody_content"),
    );
  }
  return data as string;
}

/** Revoca una atestación no consumida. Rol interno de servidor. */
export async function revokeCustodyContentAttestation(attestationId: string): Promise<void> {
  const transport = noRetryTransport();
  const admin = requireCustodyClient(
    createCustodyAdminMutationClient(transport),
    "revocación",
  );
  const { error } = await admin.rpc("revoke_custody_content_attestation", { p_id: attestationId });
  if (error) {
    throw classifyRpcError(
      error,
      "no se pudo revocar la atestación",
      transport.rpcAttempts("revoke_custody_content_attestation"),
    );
  }
}

/** Puerto de Storage sobre el cliente admin de Supabase. */
interface SupabaseStorageLike {
  storage: {
    from: (b: string) => {
      upload: (
        p: string,
        body: Uint8Array,
        o?: { contentType?: string; upsert?: boolean },
      ) => Promise<{ error: { message: string } | null }>;
      download: (p: string) => Promise<{ data: Blob | null; error: unknown }>;
      remove: (p: string[]) => Promise<{ error: { message: string } | null }>;
    };
  };
}

export function supabaseStoragePort(admin: SupabaseStorageLike): CustodyStoragePort {
  return {
    async upload(bucket, path, bytes, contentType) {
      const { error } = await admin.storage
        .from(bucket)
        .upload(path, bytes, { contentType, upsert: false });
      if (error) throw new CustodyStorageError("no se pudo almacenar el archivo");
    },
    async download(bucket, path) {
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(bucket, path) {
      const { error } = await admin.storage.from(bucket).remove([path]);
      // El resultado NO se ignora: si Storage falla, la compensación falló.
      if (error) throw new CustodyStorageError("no se pudo eliminar el objeto");
    },
  };
}


// ===========================================================================
// M2 · IDENTIDAD CONFIABLE Y COMPENSACIÓN SEGURA (W22-TER-C1)
// ===========================================================================

export interface TrustedActor {
  actorId: string;
  sessionId: string;
}

/** Forma mínima del cliente de SESIÓN que necesita la frontera de identidad. */
export interface SessionAuthLike {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } | null; error: unknown }>;
    getClaims(): Promise<{
      data: { claims: Record<string, unknown> } | null;
      error: unknown;
    }>;
  };
}

/**
 * Actor y sesión derivados del CONTEXTO AUTENTICADO, nunca del formulario.
 *
 * Dos comprobaciones distintas y ninguna deducible de la otra:
 *   · `getUser()` valida el token contra el servidor de auth y devuelve el
 *     usuario real;
 *   · `getClaims()` devuelve los claims VERIFICADOS —firma contra el JWKS, o
 *     `getUser(token)` de red cuando la clave es simétrica—, y de ahí sale
 *     `session_id`, que es un claim requerido.
 *
 * Se exige además que `claims.sub` coincida con el usuario validado: dos
 * fuentes que se contradicen no son una identidad. La DB vuelve a validar el
 * par contra `auth.sessions`, de modo que esto es la primera línea, no la única.
 */
export async function resolveTrustedActor(client: SessionAuthLike): Promise<TrustedActor> {
  const { data: userData, error: userError } = await client.auth.getUser();
  const userId = userData?.user?.id ?? null;
  if (userError || !userId) {
    throw new TrustBoundaryError("sesión no autenticada");
  }

  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  const claims = claimsData?.claims ?? null;
  if (claimsError || !claims) {
    throw new TrustBoundaryError("no se pudo verificar la sesión");
  }

  const sub = typeof claims.sub === "string" ? claims.sub : null;
  const sessionId = typeof claims.session_id === "string" ? claims.session_id : null;
  if (!sub || !sessionId) {
    throw new TrustBoundaryError("la sesión verificada no acredita sujeto ni sesión");
  }
  if (sub !== userId) {
    throw new TrustBoundaryError("la sesión verificada no corresponde al usuario");
  }
  return { actorId: userId, sessionId };
}

/**
 * W22-TER-C4 · MAJOR-1
 *
 * Antes esto era `UUID_RE.test(value.trim())` con el flag `i`: aceptaba
 * `"\t<uuid>\n"` y mayúsculas, y el llamador devolvía después el valor CRUDO.
 * Ahora el único juez es `parseCanonicalUuid`, que no normaliza nada: un valor
 * que necesita `trim()` para pasar no vino del contrato de PostgreSQL.
 *
 * El predicado se conserva porque es la forma legible de expresar la intención
 * en un `if`, pero NUNCA debe usarse para decidir qué se propaga: para eso está
 * el parser, que devuelve el valor canónico.
 */
export function isCanonicalUuid(value: unknown): value is string {
  return parseCanonicalUuid(value) !== null;
}

/**
 * F3 · Una respuesta HTTP sin error pero con resultado nulo, incompleto o
 * malformado NO acredita nada, y tampoco prueba que la transacción falló: es
 * AMBIGUA. Se valida antes de darla por buena.
 *
 * W22-TER-C4: la validación delega en `parseAttachResult`, que además exige un
 * `event_public_id` con la forma que produce `set_custody_event_public_id()`
 * (0036) — antes bastaba cualquier string no vacío.
 */
export function isCompleteAttachResult(value: unknown): value is AttachResult {
  return parseAttachResult(value) !== null;
}

/**
 * Clasifica un fallo como DETERMINISTA, es decir: se demostró que la operación
 * no dejó efecto.
 *
 *   · `CustodyPreflightError`        — la llamada nunca salió;
 *   · `StoredContentMismatchError`   — verificación local, sin RPC de por medio;
 *   · `CustodyStorageError`          — fallo de Storage, sin RPC de por medio;
 *   · `CustodyRpcError`              — sólo si su SQLSTATE está en la allowlist.
 *
 * Todo lo demás —incluido un `Error` genérico— es AMBIGUO. Tratar una excepción
 * cualquiera como rechazo era justamente el defecto: una respuesta perdida se
 * parece a un error, y borrar por eso destruye evidencia ya registrada.
 */
export function isDeterministicFailure(e: unknown): boolean {
  if (e instanceof CustodyPreflightError) return true;
  if (e instanceof StoredContentMismatchError) return true;
  if (e instanceof CustodyStorageError) return true;
  if (e instanceof CustodyRpcError) return e.deterministic;
  return false;
}

/** Puertos de la captura. Inyectables: la orquestación se prueba sin plataforma. */
export interface CustodyCapturePorts {
  storage: CustodyStoragePort;
  attest(input: AttestContentInput): Promise<string>;
  attach(input: AttachEvidenceInput): Promise<AttachResult>;
  revokeAttestation(attestationId: string): Promise<void>;
}

export interface CaptureEvidenceInput {
  bucket: string;
  storagePath: string;
  contentType: string;
  bytes: Uint8Array;
  declaredSha256: string;
  declaredSizeBytes: number;
  scope: "packing_unit" | "shipment";
  entityId: string;
  stage: CustodyStage;
  eventType: CustodyEventType;
  kind: string;
  fileName: string | null;
  notes: string | null;
  actor: TrustedActor;
}

/**
 * Resultado de la captura. Los estados de fallo NO llevan bucket, path, digest,
 * nombre de archivo ni ningún dato del contenido: son etiquetas operables.
 */
export type CaptureEvidenceOutcome =
  | { status: "ok"; evidenceId: string; eventPublicId: string }
  /** Falló una fase determinista y la compensación se completó. */
  | { status: "failed"; reason: string }
  /** Falló la compensación: quedó un objeto que alguien debe limpiar. */
  | { status: "cleanup_required"; reason: string }
  /** El attach fue AMBIGUO: no se borra, no se reintenta, se reconcilia. */
  | { status: "reconciliation_required"; reason: string };

/**
 * `upload → reread/hash → attest → attach`, con compensación explícita.
 *
 * La regla que gobierna todo: sólo se compensa ante un fallo DETERMINISTA. Ante
 * un timeout del attach la transacción pudo haberse confirmado, y borrar el
 * objeto destruiría la evidencia de una inspección real. Ese caso se devuelve
 * como `reconciliation_required` y NO se toca nada.
 */
export async function captureCustodyEvidence(
  ports: CustodyCapturePorts,
  input: CaptureEvidenceInput,
): Promise<CaptureEvidenceOutcome> {
  // ── FASE 0 · CONTRATO CANÓNICO DE ENTRADA (W22-TER-C4 · O-1) ─────────────
  //
  //    Nada del navegador entra al bucket sin pasar por acá. Antes, `scope`,
  //    `entity_id` y `stage` viajaban del `FormData` a la clave de Storage sin
  //    validarse: se podían crear objetos en prefijos arbitrarios del bucket y
  //    la única barrera era que el `attach` fallara después. Ahora un par
  //    inválido no llega siquiera al upload, así que no hay objeto que
  //    compensar.
  //
  //    Es validación DEFENSIVA, no la única: la acción valida antes de leer el
  //    archivo, y la DB vuelve a validar en `attach_custody_evidence`. Que las
  //    tres digan lo mismo es el punto.
  const pair = parseCustodyStagePair(input.stage, input.eventType);
  const scope = parseCustodyScope(input.scope);
  const entityId = parseCanonicalUuid(input.entityId);
  const bucket = parseCustodyBucket(input.bucket);
  const storagePath = parseCustodyStoragePath(input.storagePath);
  const kind = parseEvidenceKind(input.kind);
  const declaredSha256 = parseSha256Hex(input.declaredSha256);
  const declaredSizeBytes = parsePositiveSize(input.declaredSizeBytes);
  const actorId = parseCanonicalUuid(input.actor?.actorId);
  const sessionId = parseCanonicalUuid(input.actor?.sessionId);

  if (
    !pair || !scope || !entityId || !bucket || !storagePath || !kind ||
    !declaredSha256 || !declaredSizeBytes || !actorId || !sessionId ||
    // La clave tiene que pertenecer a ESTA entidad y a ESTA etapa: si no, un
    // caller podría depositar el objeto bajo el prefijo de otro despacho.
    !storagePath.startsWith(`${scope}/${entityId}/${pair.stage}/`)
  ) {
    return { status: "failed", reason: "solicitud de captura no canónica" };
  }

  const isInspection = isInspectionPair(pair);

  // ── FASE 1 · upload. Si falla, no hay nada que compensar.
  //
  //    A partir de acá sólo se usan los valores PARSEADOS: `bucket` y
  //    `storagePath`, nunca `input.bucket` / `input.storagePath`. Es la misma
  //    disciplina que en la salida — lo que circula es lo que el parser
  //    devolvió, no lo que el llamador escribió.
  try {
    await ports.storage.upload(bucket, storagePath, input.bytes, input.contentType);
  } catch {
    return { status: "failed", reason: "no se pudo almacenar el archivo" };
  }

  let attestationId: string | null = null;

  const AMBIGUO = "la operación quedó sin confirmar";

  /**
   * Compensación. ORDEN NO NEGOCIABLE (F2): primero se revoca la atestación y
   * SÓLO una revocación confirmada habilita borrar el objeto. Si la revocación
   * falla de cualquier forma se preserva el objeto y se devuelve
   * `cleanup_required`: una atestación potencialmente activa apuntando a un
   * objeto borrado es un estado peor que un huérfano.
   */
  const compensate = async (reason: string): Promise<CaptureEvidenceOutcome> => {
    if (attestationId !== null) {
      try {
        await ports.revokeAttestation(attestationId);
      } catch {
        // Ni determinista ni ambigua habilitan el borrado: en ambos casos la
        // atestación puede seguir viva.
        return { status: "cleanup_required", reason };
      }
    }
    try {
      await ports.storage.remove(bucket, storagePath);
    } catch {
      return { status: "cleanup_required", reason };
    }
    return { status: "failed", reason };
  };

  // ── FASE 2 · relectura y hash del objeto ALMACENADO.
  //
  //    Todavía no se emitió ninguna RPC: no hay transacción que pueda haber
  //    confirmado, y el objeto que se borraría es el que acabamos de subir y al
  //    que nada apunta. Compensar acá es seguro por construcción.
  let verified: VerifiedContent;
  try {
    verified = await verifyStoredContent(ports.storage, bucket, storagePath, {
      sha256: declaredSha256,
      sizeBytes: declaredSizeBytes,
    });
  } catch (e) {
    if (!isDeterministicFailure(e)) {
      return { status: "reconciliation_required", reason: AMBIGUO };
    }
    return compensate(e instanceof Error ? e.message : "contenido no verificable");
  }

  // ── FASE 3 · atestación (sólo la inspección humana la exige).
  if (isInspection) {
    let issued: string;
    try {
      issued = await ports.attest({
        bucket,
        storagePath,
        sha256: verified.sha256,
        sizeBytes: verified.sizeBytes,
        actorId,
        sessionId,
        scope,
        entityId,
        stage: pair.stage,
        eventType: pair.eventType,
      });
    } catch (e) {
      // F1 · una atestación AMBIGUA pudo confirmar: cero remove, cero revoke,
      // cero attach, cero retry.
      if (!isDeterministicFailure(e)) {
        return { status: "reconciliation_required", reason: AMBIGUO };
      }
      return compensate(e instanceof Error ? e.message : "no se pudo atestar el contenido");
    }

    // F3 · respuesta sin error pero sin identificador canónico: la atestación
    // PUEDE existir y no tenemos su id para revocarla. Ambigua, sin compensar.
    //
    // W22-TER-C4: el id que se guarda sale del PARSER. Antes salía de
    // `issued.trim()`, que es exactamente la normalización silenciosa que
    // convertía un valor no canónico en uno aparentemente válido.
    const parsedAttestationId = parseCanonicalUuid(issued);
    if (parsedAttestationId === null) {
      return { status: "reconciliation_required", reason: AMBIGUO };
    }
    attestationId = parsedAttestationId;
  }

  // ── FASE 4 · attach.
  let result: AttachResult;
  try {
    result = await ports.attach({
      packingUnitId: scope === "packing_unit" ? entityId : null,
      shipmentId: scope === "shipment" ? entityId : null,
      stage: pair.stage,
      eventType: pair.eventType,
      kind,
      bucket,
      storagePath,
      sha256: verified.sha256,
      fileName: input.fileName,
      mimeType: input.contentType,
      sizeBytes: verified.sizeBytes,
      notes: input.notes,
    });
  } catch (e) {
    if (!isDeterministicFailure(e)) {
      return { status: "reconciliation_required", reason: AMBIGUO };
    }
    return compensate(e instanceof Error ? e.message : "no se pudo registrar la evidencia");
  }

  // F3 · un attach que devuelve IDs incompletos, no canónicos o cruzados no
  // acredita ni desmiente nada: AMBIGUO, sin compensación destructiva.
  //
  // W22-TER-C4 · MAJOR-1 · Lo que sale de acá son los valores del PARSER. La
  // versión anterior validaba con un predicado permisivo y después devolvía
  // `result.evidence_id` y `result.event_public_id` CRUDOS, de modo que un
  // `"\t<uuid>\n"` llegaba a la UI y moría después como parámetro `uuid`.
  const canonical = parseAttachResult(result);
  if (canonical === null) {
    return { status: "reconciliation_required", reason: AMBIGUO };
  }

  return {
    status: "ok",
    evidenceId: canonical.evidenceId,
    eventPublicId: canonical.eventPublicId,
  };
}

// ===========================================================================
// Mutaciones — SOLO vía RPC SECURITY DEFINER
// ===========================================================================

/** Crea evento + evidencia (la app ya subió el archivo y pasa bucket/path/sha256). */
export async function attachCustodyEvidence(input: AttachEvidenceInput): Promise<AttachResult> {
  // Mutación NO idempotente: cliente acotado con transporte sin reintentos.
  const transport = noRetryTransport();
  const supabase = requireCustodyClient(createCustodyMutationClient(transport), "registro de evidencia");
  const { data, error } = await supabase.rpc("attach_custody_evidence", {
    p_packing_unit_id: input.packingUnitId ?? null,
    p_shipment_id: input.shipmentId ?? null,
    p_stage: input.stage,
    p_event_type: input.eventType,
    p_kind: input.kind,
    p_bucket: input.bucket,
    p_storage_path: input.storagePath,
    p_sha256: input.sha256,
    p_file_name: input.fileName ?? null,
    p_mime_type: input.mimeType ?? null,
    p_size_bytes: input.sizeBytes ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) {
    throw classifyRpcError(
      error,
      "no se pudo registrar la evidencia",
      transport.rpcAttempts("attach_custody_evidence"),
    );
  }
  return data as AttachResult;
}

/** Registra un evento sin archivo (cargado / en_transito / etc.). Devuelve event_id. */
export async function registerCustodyEvent(input: RegisterEventInput): Promise<string> {
  const supabase = requireCustodyClient(createClient(), "operación de custodia");
  const { data, error } = await supabase.rpc("register_custody_event", {
    p_packing_unit_id: input.packingUnitId ?? null,
    p_shipment_id: input.shipmentId ?? null,
    p_stage: input.stage,
    p_event_type: input.eventType,
    p_geo_lat: input.geoLat ?? null,
    p_geo_lng: input.geoLng ?? null,
    p_geo_source: input.geoSource ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw new Error(`registerCustodyEvent: ${error.message}`);
  return data as string;
}

/** Verifica la integridad de la cadena de una entidad. */
export async function verifyCustodyChain(
  packingUnitId: string | null,
  shipmentId: string | null
): Promise<VerifyChainResult> {
  const supabase = requireCustodyClient(createClient(), "operación de custodia");
  const { data, error } = await supabase.rpc("verify_custody_chain", {
    p_packing_unit_id: packingUnitId,
    p_shipment_id: shipmentId,
  });
  if (error) throw new Error(`verifyCustodyChain: ${error.message}`);
  return data as VerifyChainResult;
}

/** Redacta (erasure de PII) una evidencia. No borra la fila. */
export async function redactCustodyEvidence(evidenceId: string, reason?: string | null): Promise<void> {
  const supabase = requireCustodyClient(createClient(), "operación de custodia");
  const { error } = await supabase.rpc("redact_custody_evidence", {
    p_evidence_id: evidenceId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(`redactCustodyEvidence: ${error.message}`);
}

/** Genera el POD de un shipment. */
export async function generateDeliveryPod(input: GeneratePodInput): Promise<{ pod_id: string; public_id: string }> {
  const supabase = requireCustodyClient(createClient(), "operación de custodia");
  const { data, error } = await supabase.rpc("generate_delivery_pod", {
    p_shipment_id: input.shipmentId,
    p_receiver_name: input.receiverName,
    p_receiver_document: input.receiverDocument ?? null,
    p_observations: input.observations ?? null,
    p_signature_evidence_id: input.signatureEvidenceId ?? null,
    p_pod_storage_path: input.podStoragePath ?? null,
  });
  if (error) throw new Error(`generateDeliveryPod: ${error.message}`);
  return data as { pod_id: string; public_id: string };
}

// ===========================================================================
// Signed URL — emit (auditado) + firma (Supabase SDK). Único camino al binario.
// ===========================================================================

/** Emite el grant (autoriza + audita la lectura). La firma del URL la hace la app. */
export async function emitCustodySignedUrl(evidenceId: string, reason?: string | null): Promise<SignedUrlGrant> {
  const supabase = requireCustodyClient(createClient(), "operación de custodia");
  const { data, error } = await supabase.rpc("emit_custody_signed_url", {
    p_evidence_id: evidenceId,
    p_reason: reason ?? null,
    p_ip: null,
  });
  if (error) throw new Error(`emitCustodySignedUrl: ${error.message}`);
  return data as SignedUrlGrant;
}

/**
 * Emite el grant (auditado, cliente de SESIÓN) y firma el signed URL (cliente
 * ADMIN). TTL corto.
 *
 * W22-TER-C4 · O-2 · Cada paso declara qué cliente necesita y no acepta otro.
 * La versión anterior degradaba al cliente de sesión con un `??` cuando faltaba
 * el rol de servidor: la firma se intentaba en silencio con la identidad
 * equivocada. No escalaba privilegios —al revés—, pero volvía el resultado
 * dependiente de una configuración invisible: la misma llamada firmaba o no
 * según qué variable de entorno estuviera cargada, y el fallo aparecía como un
 * error de Storage en vez de como lo que era. Ahora falta el cliente ⇒ falla
 * cerrada y dice cuál falta.
 */
export async function getEvidenceSignedUrl(evidenceId: string, reason?: string | null): Promise<string> {
  const grant = await emitCustodySignedUrl(evidenceId, reason);
  const admin = requireCustodyClient(createAdminClient(), "firma de URL");
  const { data, error } = await admin.storage.from(grant.bucket).createSignedUrl(grant.path, 300);
  if (error) throw new Error(`signedUrl: ${error.message}`);
  return data.signedUrl;
}

// ===========================================================================
// Lecturas estructuradas (RPC) + mocks demo
// ===========================================================================

const MOCK_TIMELINE: CustodyTimeline = {
  scope: "shipment",
  entity_id: "ship-demo",
  nodes: [
    {
      type: "event", event_id: "ev-1", public_id: "CUST-2026-0001", stage: "packing",
      event_type: "foto_packing", actor_id: null, occurred_at: "2026-06-03T10:00:00Z",
      geo: null, notes: null,
      evidences: [{ evidence_id: "evi-1", kind: "foto", bucket: "custody-evidence", sha256: "abc", redacted: false }],
    },
    {
      type: "event", event_id: "ev-2", public_id: "CUST-2026-0002", stage: "despacho",
      event_type: "cargado", actor_id: null, occurred_at: "2026-06-03T12:00:00Z",
      geo: { lat: -34.6037, lng: -58.3816, source: "device" }, notes: "Cargado al camión",
      evidences: [],
    },
    {
      type: "pod", pod_id: "pod-1", public_id: "POD-2026-0001", signed_at: "2026-06-03T16:00:00Z",
      receiver_name: "Juan Receptor", has_document: true, signature_evidence_id: "evi-firma",
    },
  ],
};

export async function getCustodyTimeline(
  packingUnitId: string | null,
  shipmentId: string | null
): Promise<CustodyTimeline> {
  if (isMock()) return MOCK_TIMELINE;
  const supabase = createClient();
  if (!supabase) return MOCK_TIMELINE;
  const { data, error } = await supabase.rpc("get_custody_timeline", {
    p_packing_unit_id: packingUnitId,
    p_shipment_id: shipmentId,
  });
  if (error) throw new Error(`getCustodyTimeline: ${error.message}`);
  return data as CustodyTimeline;
}

export async function getCustodyByToken(token: string): Promise<CustodyTokenResult | null> {
  if (isMock()) {
    return {
      scope: "shipment", public_id: "DSP-2026-0001", status: "entregado", pod_present: true,
      events: [{ stage: "packing", event_type: "foto_packing", occurred_at: "2026-06-03T10:00:00Z" }],
    };
  }
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_custody_by_token", { p_token: token });
  if (error) {
    if (error.message?.includes("no resuelto") || error.code === "P0002") return null;
    throw new Error(`getCustodyByToken: ${error.message}`);
  }
  return data as CustodyTokenResult;
}

export async function getShipmentCustodySummary(shipmentId: string): Promise<ShipmentCustodySummary> {
  if (isMock()) {
    return { shipment_id: shipmentId, events: 3, evidences: 2, pod_present: true, chain_status: "verified", chain_valid: true, chain_events_checked: 3, last_activity: "2026-06-03T16:00:00Z" };
  }
  const supabase = requireCustodyClient(createClient(), "operación de custodia");
  const { data, error } = await supabase.rpc("get_shipment_custody_summary", { p_shipment_id: shipmentId });
  if (error) throw new Error(`getShipmentCustodySummary: ${error.message}`);
  return data as ShipmentCustodySummary;
}

// ===========================================================================
// Lecturas de lista (dashboard) — PostGREST (RLS lectura authenticated)
// ===========================================================================

interface RawEvent {
  id: string; public_id: string; stage: string; event_type: string;
  packing_unit_id: string | null; shipment_id: string | null; occurred_at: string;
  custody_evidence?: { id: string }[] | null;
}

const MOCK_EVENTS: CustodyEventRow[] = [
  { id: "ev-1", public_id: "CUST-2026-0002", stage: "despacho", event_type: "cargado", scope: "shipment", entity_id: "ship-demo", occurred_at: "2026-06-03T12:00:00Z", has_evidence: false },
  { id: "ev-2", public_id: "CUST-2026-0001", stage: "packing", event_type: "foto_packing", scope: "packing_unit", entity_id: "bulto-demo", occurred_at: "2026-06-03T10:00:00Z", has_evidence: true },
];

export async function listRecentCustodyEvents(limit = 50): Promise<CustodyEventRow[]> {
  if (isMock()) return MOCK_EVENTS;
  const supabase = createClient();
  if (!supabase) return MOCK_EVENTS;
  const { data, error } = await supabase
    .from("custody_events")
    .select("id, public_id, stage, event_type, packing_unit_id, shipment_id, occurred_at, custody_evidence(id)")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listRecentCustodyEvents: ${error.message}`);
  return ((data ?? []) as unknown as RawEvent[]).map((e): CustodyEventRow => ({
    id: e.id,
    public_id: e.public_id,
    stage: e.stage as CustodyStage,
    event_type: e.event_type as CustodyEventType,
    scope: e.packing_unit_id ? "packing_unit" : "shipment",
    entity_id: (e.packing_unit_id ?? e.shipment_id) as string,
    occurred_at: e.occurred_at,
    has_evidence: (e.custody_evidence?.length ?? 0) > 0,
  }));
}

interface RawPod {
  id: string; public_id: string; shipment_id: string; receiver_name: string;
  signed_at: string | null; signature_evidence_id: string | null; receiver_document: string | null;
  observations: string | null; pod_storage_path: string | null;
  shipments?: { public_id: string } | { public_id: string }[] | null;
}

function shipPub(s: RawPod["shipments"]): string | null {
  if (!s) return null;
  return Array.isArray(s) ? (s[0]?.public_id ?? null) : s.public_id;
}

const MOCK_PODS: DeliveryPodRow[] = [
  { id: "pod-1", public_id: "POD-2026-0001", shipment_id: "ship-demo", shipment_public_id: "DSP-2026-0001", receiver_name: "Juan Receptor", signed_at: "2026-06-03T16:00:00Z", has_signature: true },
];

export async function listRecentPods(limit = 50): Promise<DeliveryPodRow[]> {
  if (isMock()) return MOCK_PODS;
  const supabase = createClient();
  if (!supabase) return MOCK_PODS;
  const { data, error } = await supabase
    .from("delivery_pods")
    .select("id, public_id, shipment_id, receiver_name, signed_at, signature_evidence_id, shipments(public_id)")
    .order("signed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listRecentPods: ${error.message}`);
  return ((data ?? []) as unknown as RawPod[]).map((p): DeliveryPodRow => ({
    id: p.id, public_id: p.public_id, shipment_id: p.shipment_id,
    shipment_public_id: shipPub(p.shipments), receiver_name: p.receiver_name,
    signed_at: p.signed_at, has_signature: p.signature_evidence_id != null,
  }));
}

export async function getDeliveryPodByShipment(shipmentId: string): Promise<DeliveryPodDetail | null> {
  if (isMock()) {
    return { id: "pod-1", public_id: "POD-2026-0001", shipment_id: shipmentId, shipment_public_id: "DSP-2026-0001", receiver_name: "Juan Receptor", signed_at: "2026-06-03T16:00:00Z", has_signature: true, receiver_document: "30.123.456", observations: "Entrega conforme", signature_evidence_id: "evi-firma", pod_storage_path: null };
  }
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("delivery_pods")
    .select("id, public_id, shipment_id, receiver_name, receiver_document, observations, signature_evidence_id, pod_storage_path, signed_at, shipments(public_id)")
    .eq("shipment_id", shipmentId)
    .maybeSingle();
  if (error) throw new Error(`getDeliveryPodByShipment: ${error.message}`);
  if (!data) return null;
  const p = data as unknown as RawPod;
  return {
    id: p.id, public_id: p.public_id, shipment_id: p.shipment_id, shipment_public_id: shipPub(p.shipments),
    receiver_name: p.receiver_name, receiver_document: p.receiver_document, observations: p.observations,
    signature_evidence_id: p.signature_evidence_id, pod_storage_path: p.pod_storage_path,
    signed_at: p.signed_at, has_signature: p.signature_evidence_id != null,
  };
}

/** custody_token de un shipment (para generar el QR del despacho). */
export async function getShipmentToken(shipmentId: string): Promise<string | null> {
  if (isMock()) return "tok-demo-shipment";
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("shipments")
    .select("custody_token")
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) throw new Error(`getShipmentToken: ${error.message}`);
  return (data as { custody_token: string } | null)?.custody_token ?? null;
}

/** Fila de caso de integridad para el listado. Sin internals ni digests. */
export interface CustodyIntegrityCaseRow {
  id: string;
  public_id: string;
  state: string;
  scope: "packing_unit" | "shipment";
  entity_id: string;
  updated_at: string;
}

const MOCK_CASES: CustodyIntegrityCaseRow[] = [
  { id: "11111111-1111-4111-8111-111111111111", public_id: "CINT-2026-0001", state: "REVIEW_REQUIRED", scope: "shipment", entity_id: "ship-demo", updated_at: "2026-06-03T16:00:00Z" },
];

/**
 * Casos de integridad visibles para el usuario. La RLS de 0222 ya acota por
 * tenant; acá no se agrega ningún filtro por cliente enviado por el navegador.
 */
export async function listCustodyIntegrityCases(limit = 50): Promise<CustodyIntegrityCaseRow[]> {
  if (isMock()) return MOCK_CASES;
  const supabase = createClient();
  if (!supabase) return MOCK_CASES;
  const { data, error } = await supabase
    .from("custody_integrity_cases")
    .select("id, public_id, state, packing_unit_id, shipment_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listCustodyIntegrityCases: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((c): CustodyIntegrityCaseRow => ({
    id: c.id as string,
    public_id: c.public_id as string,
    state: c.state as string,
    scope: c.packing_unit_id ? "packing_unit" : "shipment",
    entity_id: (c.packing_unit_id ?? c.shipment_id) as string,
    updated_at: c.updated_at as string,
  }));
}

export type { CustodyStage, CustodyEventType };
