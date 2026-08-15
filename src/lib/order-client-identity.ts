/**
 * D-6 · CONGRUENCIA CANÓNICA DE CLIENTE EN ÓRDENES DE SERVICIO — lógica pura.
 *
 * ─── QUÉ DEFECTO CIERRA ────────────────────────────────────────────────────
 *
 * El wizard de Nueva Orden precarga `client_id` con el primer cliente de la
 * lista y deja «Razón Social» y «CUIT» como campos libres. Nada limpiaba el
 * vínculo al editarlos, y el servidor prefería el `client_id` sobre el CUIT.
 *
 * Resultado medido por la revisión C4: un operador abría el wizard —cargado
 * con el cliente A—, escribía encima la razón y el CUIT de B, el resumen
 * mostraba B, y la orden se emitía **para A**. Antes de la corrección anterior
 * ese mismo camino moría con un `23505` ruidoso; se había vuelto corrupción
 * silenciosa.
 *
 * ─── CÓMO SE CIERRA ────────────────────────────────────────────────────────
 *
 * La UI invalida el vínculo al editar a mano, pero eso es una cortesía del
 * navegador. La decisión se toma acá, FAIL-CLOSED: ante cualquier discrepancia
 * entre el `client_id` y los datos visibles se rechaza. Nunca se prefiere en
 * silencio un `client_id` incompatible con lo que la persona está viendo.
 *
 * El lookup va INYECTADO —mismo patrón que `wms/client-identity.ts`— para que
 * las pruebas ejerciten la lógica sin tocar Supabase, y para que ningún camino
 * pueda «resolver por parecido»: el puerto sólo devuelve la fila canónica.
 */

/** Fila canónica mínima de `public.clients`. */
export interface CanonicalOrderClient {
  id: string;
  razon: string;
  cuit: string;
  activo: boolean;
}

/** Puerto de búsqueda. Por uuid o por CUIT normalizado; nunca por nombre. */
export type OrderClientLookup = (
  by: { id: string } | { cuitDigits: string },
) => Promise<CanonicalOrderClient | null>;

/** Lo que llega del navegador. Ninguno de los tres es autoridad por sí solo. */
export interface OrderClientInput {
  id?: string | null;
  razon: string;
  cuit: string;
}

export type OrderClientErrorCode =
  | "CLIENT_NO_ENCONTRADO"
  | "CLIENT_INACTIVO"
  | "CUIT_INCONGRUENTE"
  | "RAZON_INCONGRUENTE";

export class OrderClientError extends Error {
  constructor(
    public readonly code: OrderClientErrorCode,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "OrderClientError";
  }
}

/** Sólo dígitos: unifica el CUIT escrito con guiones, espacios o pegado. */
export function soloDigitos(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

/** Normaliza para comparar: sin tildes, minúsculas, espacios colapsados. */
export function normalizarRazon(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resuelve la identidad canónica del cliente de una orden.
 *
 * Prefiere el uuid cuando viene, pero NO le cree: verifica que el CUIT y la
 * razón social visibles coincidan con la fila canónica. Si el uuid no viene
 * —porque la UI lo invalidó al editar a mano— resuelve por CUIT.
 *
 * @throws OrderClientError ante cualquier incongruencia. Nunca devuelve una
 *         identidad que no case con lo que el usuario tiene delante.
 */
export async function resolveOrderClientIdentity(
  input: OrderClientInput,
  lookup: OrderClientLookup,
): Promise<CanonicalOrderClient> {
  const cuitDigits = soloDigitos(input.cuit);
  const id = input.id?.trim() || null;

  const fila = id
    ? await lookup({ id })
    : await lookup({ cuitDigits });

  if (!fila) {
    throw new OrderClientError(
      "CLIENT_NO_ENCONTRADO",
      `El cliente ${input.razon} (CUIT ${cuitDigits}) no existe en el registro maestro. ` +
        "Crealo primero: una orden no da de alta clientes.",
    );
  }

  if (!fila.activo) {
    throw new OrderClientError(
      "CLIENT_INACTIVO",
      `El cliente ${fila.razon} está desactivado y no admite órdenes nuevas.`,
    );
  }

  // Congruencia. Se evalúa SIEMPRE, también cuando se resolvió por CUIT: así
  // un payload manipulado que mande el uuid de A con los datos de B se rechaza
  // igual que uno que mande sólo los datos de B con el uuid de A.
  const cuitCanonico = soloDigitos(fila.cuit);
  if (cuitDigits && cuitCanonico !== cuitDigits) {
    throw new OrderClientError(
      "CUIT_INCONGRUENTE",
      `Los datos no coinciden con el cliente seleccionado: la orden apunta a ${fila.razon} ` +
        `(CUIT ${cuitCanonico}) pero el formulario dice ${cuitDigits}. ` +
        "Elegí el cliente de nuevo para resolver la identidad.",
    );
  }

  if (input.razon && normalizarRazon(fila.razon) !== normalizarRazon(input.razon)) {
    throw new OrderClientError(
      "RAZON_INCONGRUENTE",
      `La razón social no coincide con el cliente seleccionado (${fila.razon}). ` +
        "Elegí el cliente de nuevo para resolver la identidad.",
    );
  }

  return fila;
}

/**
 * ¿Un parche del wizard invalida el vínculo canónico?
 *
 * Editar a mano la razón social o el CUIT rompe la correspondencia con el
 * cliente elegido, así que el `client_id` deja de ser válido. Seleccionar un
 * cliente NO pasa por acá: fija los tres campos a la vez.
 */
export function invalidaVinculo(
  actual: { razon: string; cuit: string },
  patch: { razon?: string; cuit?: string },
): boolean {
  return (
    (patch.razon !== undefined && patch.razon !== actual.razon) ||
    (patch.cuit !== undefined && patch.cuit !== actual.cuit)
  );
}
