/**
 * W22-TER-C4 · CONTRATO CANÓNICO DE CUSTODIA — parsers puros
 *
 * ─── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *
 * La versión anterior validaba con predicados booleanos dispersos que aceptaban
 * `value.trim()` y después devolvían el valor CRUDO. Eso permitía que una
 * respuesta con `"\t<uuid>\n"` se acreditara como éxito y que un identificador
 * no canónico saliera hacia la UI, los logs y la auditoría, donde después falla
 * como parámetro `uuid` o diverge de la fila real.
 *
 * Acá no hay predicados: hay PARSERS. Cada uno devuelve la forma canónica o
 * `null`. El llamador nunca vuelve a tocar el payload de origen: lo que se
 * propaga es exclusivamente lo que el parser devolvió. Si el parser dice `null`,
 * no hay decisión posible y el llamador tiene que fallar cerrado.
 *
 * ─── DE DÓNDE SALE CADA FORMA ──────────────────────────────────────────────
 *
 * Ninguna se inventa acá. Todas se derivan del productor autoritativo real:
 *
 *   · UUID           → `uuid_out` de PostgreSQL: 36 caracteres, hex EN
 *                      MINÚSCULA, guiones en 8-4-4-4-12. Es la única
 *                      representación que emite `gen_random_uuid()` a través de
 *                      PostgREST. Mayúsculas, llaves, forma sin guiones o
 *                      cualquier envoltura son ENTRADAS que PostgreSQL tolera
 *                      pero jamás SALIDAS: si aparecen en una respuesta, la
 *                      respuesta no vino del contrato.
 *   · event_public_id → `public.set_custody_event_public_id()` (0036):
 *                      'CUST-' || to_char(created_at,'YYYY') || '-' ||
 *                      lpad(short_id::text, 4, '0')
 *                      ⇒ `CUST-<4 dígitos>-<4 o más dígitos>`.
 *   · pares (stage, event_type) → `custody_events_stage_type_chk` (0222 §0),
 *                      replicado idéntico en `attach_custody_evidence` (0226).
 *   · buckets        → allowlist de `attach_custody_evidence` (0226).
 *
 * ─── LA TRAMPA DEL ANCLA `$` ───────────────────────────────────────────────
 *
 * En JavaScript `/^x$/.test("x\n")` es TRUE: `$` casa antes de un salto final
 * aunque no esté el flag `m`. Un regex "anclado" habría seguido aceptando
 * `"<uuid>\n"`. Por eso cada parser comprueba además longitud o alfabeto
 * completo, que es lo que realmente cierra el flanco.
 */

import type { CustodyBucket, CustodyEventType, CustodyStage, EvidenceKind } from "./types";

/** Alcance de una captura: la entidad a la que se adosa la evidencia. */
export type CustodyScope = "packing_unit" | "shipment";

/** Forma EXACTA que emite `uuid_out`. Sin trim, sin mayúsculas, sin llaves. */
const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANONICAL_UUID_LENGTH = 36;

/**
 * Devuelve el UUID canónico o `null`. NO normaliza: un valor que necesita ser
 * normalizado para pasar es, por definición, un valor que el contrato no
 * produjo, y aceptarlo silenciosamente era el defecto MAJOR-1.
 */
export function parseCanonicalUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // La longitud fija es lo que mata `"<uuid>\n"`, que el ancla `$` dejaría pasar.
  if (value.length !== CANONICAL_UUID_LENGTH) return null;
  if (!CANONICAL_UUID_RE.test(value)) return null;
  return value;
}

/** Alfabeto completo de un `public_id`: si aparece otra cosa, no es del contrato. */
const PUBLIC_ID_ALPHABET_RE = /^[A-Z0-9-]+$/;
const CUSTODY_EVENT_PUBLIC_ID_RE = /^CUST-[0-9]{4}-[0-9]{4,}$/;
/** `CUST-` + año + `-` + al menos 4 dígitos; el tope evita valores absurdos. */
const PUBLIC_ID_MAX_LENGTH = 32;

/**
 * Devuelve el `event_public_id` canónico o `null`.
 *
 * La comprobación de alfabeto va PRIMERO y es total: descarta de una sola vez
 * espacios exteriores e interiores, tabs, saltos, `/` y `..` de traversal,
 * separadores y confusables Unicode (la `С` cirílica no está en `[A-Z0-9-]`),
 * sin depender de que el ancla del regex de forma se comporte.
 */
export function parseCustodyEventPublicId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > PUBLIC_ID_MAX_LENGTH) return null;
  if (!PUBLIC_ID_ALPHABET_RE.test(value)) return null;
  if (!CUSTODY_EVENT_PUBLIC_ID_RE.test(value)) return null;
  return value;
}

/** Digest tal como lo emite `encode(digest(...),'hex')` y lo exige 0226. */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export function parseSha256Hex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length !== 64) return null;
  return SHA256_HEX_RE.test(value) ? value : null;
}

/** Tamaño en bytes: entero positivo y finito. */
export function parsePositiveSize(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

const SCOPES: ReadonlySet<string> = new Set<CustodyScope>(["packing_unit", "shipment"]);

export function parseCustodyScope(value: unknown): CustodyScope | null {
  return typeof value === "string" && SCOPES.has(value) ? (value as CustodyScope) : null;
}

const BUCKETS: ReadonlySet<string> = new Set<CustodyBucket>([
  "custody-evidence",
  "custody-pii",
  "custody-pod",
]);

export function parseCustodyBucket(value: unknown): CustodyBucket | null {
  return typeof value === "string" && BUCKETS.has(value) ? (value as CustodyBucket) : null;
}

const EVIDENCE_KINDS: ReadonlySet<string> = new Set<EvidenceKind>(["foto", "firma", "documento"]);

export function parseEvidenceKind(value: unknown): EvidenceKind | null {
  return typeof value === "string" && EVIDENCE_KINDS.has(value)
    ? (value as EvidenceKind)
    : null;
}

/**
 * Pares (stage, event_type) admitidos, copia literal de
 * `custody_events_stage_type_chk` (0222) y del guard de 0226. Un par fuera de
 * esta tabla no puede existir en la DB: dejarlo llegar al upload sólo sirve
 * para dejar un objeto huérfano que después hay que compensar.
 */
const STAGE_EVENT_PAIRS: ReadonlyMap<CustodyStage, ReadonlySet<CustodyEventType>> = new Map([
  ["packing", new Set<CustodyEventType>(["foto_packing"])],
  ["despacho", new Set<CustodyEventType>(["cargado", "inspeccion_humana"])],
  ["transporte", new Set<CustodyEventType>(["en_transito"])],
  ["entrega", new Set<CustodyEventType>(["foto_entrega", "firmado"])],
  ["pod", new Set<CustodyEventType>(["pod"])],
]);

export interface CustodyStagePair {
  stage: CustodyStage;
  eventType: CustodyEventType;
}

export function parseCustodyStagePair(stage: unknown, eventType: unknown): CustodyStagePair | null {
  if (typeof stage !== "string" || typeof eventType !== "string") return null;
  const allowed = STAGE_EVENT_PAIRS.get(stage as CustodyStage);
  if (!allowed || !allowed.has(eventType as CustodyEventType)) return null;
  return { stage: stage as CustodyStage, eventType: eventType as CustodyEventType };
}

/** `(despacho, inspeccion_humana)` es el único par que exige atestación (0226). */
export function isInspectionPair(pair: CustodyStagePair): boolean {
  return pair.stage === "despacho" && pair.eventType === "inspeccion_humana";
}

/** Extensión de archivo: minúsculas alfanuméricas y corta, o nada. */
const EXTENSION_RE = /^[a-z0-9]{1,8}$/;

export function parseObjectExtension(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > 8) return null;
  return EXTENSION_RE.test(value) ? value : null;
}

/**
 * Clave de Storage completa. Cada segmento sale de un conjunto cerrado o de un
 * UUID canónico, así que la clave resultante no puede contener `..`, `/` extra,
 * espacios ni Unicode: no hay forma de que el navegador dirija el objeto a un
 * prefijo arbitrario del bucket.
 */
const STORAGE_PATH_RE =
  /^(packing_unit|shipment)\/[0-9a-f-]{36}\/(packing|despacho|transporte|entrega|pod)\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;

export interface CustodyStoragePathInput {
  scope: CustodyScope;
  entityId: string;
  stage: CustodyStage;
  objectId: string;
  extension: string;
}

export function buildCustodyStoragePath(input: CustodyStoragePathInput): string | null {
  const scope = parseCustodyScope(input.scope);
  const entityId = parseCanonicalUuid(input.entityId);
  const objectId = parseCanonicalUuid(input.objectId);
  const extension = parseObjectExtension(input.extension);
  const stage = typeof input.stage === "string" && STAGE_EVENT_PAIRS.has(input.stage as CustodyStage)
    ? (input.stage as CustodyStage)
    : null;
  if (!scope || !entityId || !objectId || !extension || !stage) return null;
  const path = `${scope}/${entityId}/${stage}/${objectId}.${extension}`;
  // Cinturón y tirantes: la clave se vuelve a validar entera antes de salir.
  return STORAGE_PATH_RE.test(path) && path.length === scope.length + stage.length + 76 + extension.length
    ? path
    : null;
}

/** Valida una clave ya construida (p. ej. la que llega al orquestador). */
export function parseCustodyStoragePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length > 160) return null;
  if (/[^a-z0-9/._-]/.test(value)) return null;
  return STORAGE_PATH_RE.test(value) ? value : null;
}

/**
 * Resultado canónico de `attach_custody_evidence`. Los tres campos salen del
 * parser, nunca del payload: es lo que garantiza que la UI, el log y la
 * auditoría vean exactamente lo que hay en la fila.
 */
export interface CanonicalAttachResult {
  eventId: string;
  evidenceId: string;
  eventPublicId: string;
}

/**
 * Parsea la respuesta de `attach_custody_evidence`.
 *
 * `null` significa AMBIGUO, no "falló": una respuesta sin error pero incompleta
 * o no canónica no acredita nada y tampoco prueba que la transacción se haya
 * rechazado. El llamador debe reconciliar, jamás compensar destructivamente.
 */
export function parseAttachResult(value: unknown): CanonicalAttachResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const eventId = parseCanonicalUuid(raw.event_id);
  const evidenceId = parseCanonicalUuid(raw.evidence_id);
  const eventPublicId = parseCustodyEventPublicId(raw.event_public_id);
  if (!eventId || !evidenceId || !eventPublicId) return null;
  // Dos identificadores distintos que llegan iguales delatan una respuesta
  // cruzada o sintética: no se acredita.
  if (eventId === evidenceId) return null;
  return { eventId, evidenceId, eventPublicId };
}
