/**
 * P3-N1B · PUENTE DE IDENTIDAD CANÓNICA DE CLIENTE — lógica pura.
 *
 * Toda cabecera operativa WMS (recepciones, pedidos logísticos) debe nacer con
 * `client_id` canónico de `public.clients`. El navegador NUNCA es autoridad
 * sobre `client_name`: el nombre se DERIVA server-side de la fila canónica.
 *
 * La lógica queda aislada con el lookup INYECTADO (mismo patrón que
 * tests/custody-db/harness/vanilla-guard.ts): las pruebas la ejercitan sin
 * tocar Supabase, y ningún camino puede "resolver por nombre" porque el puerto
 * sólo acepta un UUID.
 *
 * PRECONDICIÓN DE DESPLIEGUE: la migración 0219 (columnas `client_id`) debe
 * estar aplicada ANTES de publicar este código. Diseñado para operar igual
 * antes y después de 0220 (el corte sólo endurece lo que acá ya se cumple) y
 * sin depender de Custodia 0221–0232.
 */

/** Referencia canónica mínima de un cliente. */
export interface CanonicalClientRef {
  id: string;
  razon: string;
  activo: boolean;
}

/** Puerto de búsqueda canónica: SOLO por UUID. Devuelve null si no existe. */
export type CanonicalClientLookup = (clientId: string) => Promise<CanonicalClientRef | null>;

/**
 * Selección de cliente tal como llega del navegador. `client_name` puede venir
 * (payload legado o adulterado) y se IGNORA salvo en el escape controlado.
 */
export interface ClientSelectionInput {
  /** UUID canónico elegido en el selector. */
  client_id?: string | null;
  /** Escape controlado «cliente no listado»: texto libre EXPLÍCITO. */
  unlisted_client_name?: string | null;
  /** Ignorado como autoridad. Presente sólo por compatibilidad de payloads. */
  client_name?: string | null;
}

/** Resultado canónico: lo ÚNICO que se escribe en la cabecera. */
export interface ResolvedClientIdentity {
  client_id: string | null;
  client_name: string;
  /** true cuando se usó el escape controlado (fila que 0220 bloqueará hasta resolverse). */
  unlisted: boolean;
}

export type ClientIdentityErrorCode =
  | "CLIENT_REQUIRED"
  | "INVALID_CLIENT_ID"
  | "CLIENT_NOT_FOUND"
  | "CLIENT_DISABLED"
  | "AMBIGUOUS_SELECTION"
  | "UNLISTED_NAME_EMPTY";

export class ClientIdentityError extends Error {
  constructor(
    public readonly code: ClientIdentityErrorCode,
    detalle: string,
  ) {
    super(`[P3-N1B ${code}] ${detalle}`);
    this.name = "ClientIdentityError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_UNLISTED_LEN = 200;

/**
 * Resuelve la selección del navegador a una identidad canónica.
 *
 * FAIL-CLOSED en todos los bordes: sin selección, UUID inválido, cliente
 * inexistente, cliente deshabilitado o selección contradictoria ⇒ error.
 * El `client_name` del navegador jamás participa de la resolución.
 */
export async function resolveClientSelection(
  input: ClientSelectionInput,
  lookup: CanonicalClientLookup,
): Promise<ResolvedClientIdentity> {
  const clientId = input.client_id?.trim() || null;
  const unlistedRaw = input.unlisted_client_name;
  const hasUnlisted = unlistedRaw !== undefined && unlistedRaw !== null;

  if (clientId && hasUnlisted) {
    throw new ClientIdentityError(
      "AMBIGUOUS_SELECTION",
      "se recibieron client_id y «cliente no listado» a la vez: la selección debe ser una sola",
    );
  }

  if (clientId) {
    if (!UUID_RE.test(clientId)) {
      throw new ClientIdentityError("INVALID_CLIENT_ID", "client_id no es un UUID válido");
    }
    const row = await lookup(clientId);
    if (!row) {
      throw new ClientIdentityError("CLIENT_NOT_FOUND", `cliente ${clientId} inexistente en public.clients`);
    }
    if (!row.activo) {
      throw new ClientIdentityError("CLIENT_DISABLED", `cliente ${clientId} está deshabilitado`);
    }
    // El nombre SIEMPRE se deriva de la fila canónica; lo que mandó el
    // navegador en `client_name` queda descartado acá.
    return { client_id: row.id, client_name: row.razon, unlisted: false };
  }

  if (hasUnlisted) {
    const nombre = String(unlistedRaw).trim();
    if (!nombre) {
      throw new ClientIdentityError("UNLISTED_NAME_EMPTY", "el escape «cliente no listado» exige un nombre no vacío");
    }
    if (nombre.length > MAX_UNLISTED_LEN) {
      throw new ClientIdentityError("UNLISTED_NAME_EMPTY", `el nombre libre supera ${MAX_UNLISTED_LEN} caracteres`);
    }
    // Escape controlado: NO crea cliente, NO infiere. La fila queda sin
    // client_id y 0220 la bloqueará hasta su resolución administrativa.
    return { client_id: null, client_name: nombre, unlisted: true };
  }

  throw new ClientIdentityError(
    "CLIENT_REQUIRED",
    "toda cabecera WMS exige un cliente canónico (o el escape explícito «cliente no listado»)",
  );
}
