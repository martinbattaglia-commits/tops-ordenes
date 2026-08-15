/**
 * Confirmación de alta ante candidatos a duplicado.
 *
 * ─── QUÉ PROBLEMA RESUELVE ─────────────────────────────────────────────────
 *
 * El servidor advierte cuando una razón social se parece a la de un cliente ya
 * registrado. La advertencia no puede bloquear —dos empresas distintas pueden
 * llamarse casi igual— pero tampoco puede saltearse sin que nadie la vea.
 *
 * El contrato anterior era un booleano, `confirmar_pese_a_duplicados`. Tenía
 * dos defectos, y los dos importaban:
 *
 *   · el modal del maestro nunca ofrecía confirmarlo, así que un nombre
 *     parecido dejaba el alta SIN SALIDA desde esa pantalla;
 *   · y bastaba mandarlo en `true` en la PRIMERA llamada para saltear la
 *     advertencia entera sin haber visto un solo candidato.
 *
 * Acá la confirmación deja de ser un sí/no y pasa a ser el ACUSE de una
 * advertencia concreta.
 *
 * ─── QUÉ GARANTIZA Y QUÉ NO ────────────────────────────────────────────────
 *
 * Garantiza COHERENCIA: el acuse vale para ese payload y ese conjunto de
 * candidatos. Si cambia el nombre, el CUIT, o la lista de parecidos —porque
 * alguien creó o desactivó un cliente mientras el modal estaba abierto—, el
 * acuse deja de coincidir y se vuelve a advertir con la foto fresca, en vez de
 * dar por confirmado algo que nadie vio.
 *
 * NO es un control de autenticación, y no se presenta como tal: el digesto es
 * determinístico y sin clave, así que quien conozca el algoritmo y los ids
 * puede calcularlo sin haber visto la advertencia. No se le pone clave porque
 * no compraría nada: para llegar hasta acá ya hay que tener `clientes.create` o
 * `wms.clients.create`, y con ese permiso el alta se consigue igual cambiando
 * una letra de la razón social. La autorización la siguen teniendo el permiso y
 * la RPC de 0242; esto sólo impide que una confirmación se aplique a ciegas.
 */
import { createHash } from "node:crypto";

export interface CandidatoDuplicado {
  id: string;
  razon: string;
  cuit: string;
}

export type DecisionAlta =
  /** No hay parecidos: se crea derecho. */
  | { estado: "crear"; duplicadosAdvertidos: null }
  /** Hay parecidos y no fueron acusados: se advierte y NO se crea. */
  | { estado: "advertir"; candidatos: CandidatoDuplicado[]; acuse: string; revisada: boolean }
  /** Los parecidos fueron acusados sobre esta misma foto: se crea y se registra. */
  | { estado: "crear"; duplicadosAdvertidos: string[] };

/**
 * Digesto que ata una confirmación al conjunto exacto de candidatos mostrado.
 *
 * Normaliza la razón social igual que la búsqueda —sin tildes, en minúsculas y
 * con espacios colapsados— para que un cambio cosmético no invalide el acuse,
 * y ordena los ids para que el digesto no dependa del orden en que la base
 * devolvió las filas.
 */
export function tokenDuplicados(razon: string, cuit: string, ids: readonly string[]): string {
  const razonNorm = razon
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const cuitNorm = cuit.replace(/\D/g, "");
  const base = `${razonNorm}|${cuitNorm}|${[...ids].sort().join(",")}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 32);
}

/**
 * Decide si un alta procede, dada la foto VIGENTE de candidatos.
 *
 * Los candidatos se recalculan en cada llamada, también cuando viene acuse: es
 * la única forma de comprobar que la confirmación corresponde a lo que hay
 * ahora y no a una foto anterior.
 */
export function decidirAlta(entrada: {
  razon: string;
  cuit: string;
  candidatos: readonly CandidatoDuplicado[];
  acuse?: string | null;
}): DecisionAlta {
  const { razon, cuit, candidatos, acuse } = entrada;

  if (candidatos.length === 0) return { estado: "crear", duplicadosAdvertidos: null };

  const vigente = tokenDuplicados(
    razon,
    cuit,
    candidatos.map((c) => c.id),
  );

  if (acuse && acuse === vigente) {
    return { estado: "crear", duplicadosAdvertidos: candidatos.map((c) => c.id).sort() };
  }

  return {
    estado: "advertir",
    candidatos: [...candidatos],
    acuse: vigente,
    // `revisada` distingue «todavía no viste nada» de «lo que viste ya no es
    // lo que hay», que merecen mensajes distintos.
    revisada: Boolean(acuse),
  };
}
