/**
 * W22-TER-B · M5 — PRESENTACIÓN CANÓNICA DEL ESTADO DE CADENA.
 *
 * Único lugar donde se decide cómo se NOMBRA y se COLOREA la integridad de una
 * cadena de custodia. La UI y el POD-PDF consumen esta función y nada más: si
 * cada superficie tradujera el estado por su cuenta, volvería a pasar lo que el
 * DB-C4 marcó —una superficie diciendo «ROTA» y la otra «INVÁLIDA» sobre el
 * mismo hecho, y ninguna de las dos capaz de decir «no lo sé»—.
 *
 * ─── POR QUÉ EL FALLBACK NO INFIERE `invalid` ─────────────────────────────
 *
 * Antes de 0225 el resumen sólo traía `chain_valid: boolean`. Una respuesta
 * vieja —una caché, un cliente sin actualizar, un POD regenerado desde datos
 * previos— puede llegar sin `chain_status`. En ese caso:
 *
 *   · `chain_valid === true`  → `verified`   (la cadena se verificó de verdad)
 *   · `chain_valid === false` → `unverifiable`
 *
 * `false` significaba DOS cosas distintas —rota o sin evidencia— y el defecto
 * consistía precisamente en imprimir la peor de las dos. Degradar a
 * `unverifiable` no es indulgencia: es negarse a acusar de adulteración con un
 * dato que no distingue. `invalid` sólo se afirma cuando la base lo afirma.
 */

/** Espejo del `chain_status` que publica `get_shipment_custody_summary`. */
export type CustodyChainStatus = "verified" | "invalid" | "unverifiable";

export interface ChainStatusPresentation {
  status: CustodyChainStatus;
  /** Etiqueta de UI (pantalla de custodia). */
  uiLabel: string;
  /** Etiqueta del POD-PDF, en mayúsculas como el resto del documento. */
  pdfLabel: string;
  /** Color del texto/acento. */
  color: string;
  /** Fondo de la píldora del PDF (mismo tono, alfa baja). */
  pdfBackground: string;
  /** `true` sólo para `verified`: espejo exacto del `chain_valid` legacy. */
  isValid: boolean;
  /**
   * `true` sólo cuando el POD PUEDE acreditar la integridad de la carga.
   * Separado de `isValid` a propósito: `isValid` responde «¿qué dice la
   * cadena?» y esto responde «¿qué puede afirmar el documento probatorio?».
   * Colapsarlos invita a que una superficie futura certifique con el booleano
   * equivocado.
   */
  certifiesIntegrity: boolean;
  /**
   * Enunciado que el POD imprime junto a la píldora. Un POD que sólo muestra
   * un color y una etiqueta puede leerse como favorable de todos modos: acá se
   * dice explícitamente qué acredita y qué no.
   */
  podStatement: string;
  /**
   * Cómo se nombra el conteo de eventos. Sólo `verified` puede decir
   * «verificados»; en los otros dos estados los eventos fueron RECORRIDOS, que
   * no es lo mismo, y llamarlos verificados sería certificar de más.
   */
  eventsCountLabel: string;
}

const PRESENTATION: Record<CustodyChainStatus, ChainStatusPresentation> = {
  verified: {
    status: "verified",
    uiLabel: "Íntegra",
    pdfLabel: "CADENA VÁLIDA",
    color: "#16a34a",
    pdfBackground: "#16a34a1a",
    isValid: true,
    certifiesIntegrity: true,
    podStatement:
      "La verificación cubrió todos los tramos requeridos: este documento acredita la integridad de la cadena de custodia.",
    eventsCountLabel: "eventos verificados",
  },
  invalid: {
    status: "invalid",
    uiLabel: "Inválida",
    pdfLabel: "CADENA INVÁLIDA",
    color: "#C90812",
    pdfBackground: "#C908121a",
    isValid: false,
    certifiesIntegrity: false,
    podStatement:
      "Se detectó una discontinuidad en la cadena de custodia: este documento NO acredita la integridad de la carga.",
    eventsCountLabel: "eventos recorridos",
  },
  unverifiable: {
    status: "unverifiable",
    // Ni acusa ni absuelve: describe lo que falta.
    uiLabel: "Sin evidencia suficiente",
    pdfLabel: "SIN EVIDENCIA SUFICIENTE",
    color: "#B45309",
    pdfBackground: "#B453091a",
    isValid: false,
    certifiesIntegrity: false,
    podStatement:
      "No hay evidencia suficiente para verificar la cadena de custodia: este documento NO acredita la integridad de la carga, y tampoco afirma que haya sido vulnerada.",
    eventsCountLabel: "eventos recorridos",
  },
};

/** Forma mínima que necesita la resolución; sirve para respuestas viejas. */
export interface ChainStatusSource {
  chain_status?: CustodyChainStatus | string | null;
  chain_valid?: boolean | null;
}

const KNOWN: ReadonlySet<string> = new Set<CustodyChainStatus>([
  "verified",
  "invalid",
  "unverifiable",
]);

/**
 * Estado efectivo de una respuesta del resumen, tolerante con las respuestas
 * anteriores a 0225. Un `chain_status` desconocido se trata como ausente: se
 * cae al booleano legacy en vez de confiar en un valor que este código no sabe
 * interpretar.
 */
export function resolveChainStatus(source: ChainStatusSource | null | undefined): CustodyChainStatus {
  const raw = source?.chain_status;
  if (typeof raw === "string" && KNOWN.has(raw)) {
    return raw as CustodyChainStatus;
  }
  return source?.chain_valid === true ? "verified" : "unverifiable";
}

/** Presentación canónica de un estado ya resuelto. */
export function presentChainStatus(status: CustodyChainStatus): ChainStatusPresentation {
  return PRESENTATION[status];
}

/** Atajo: resuelve y presenta en un paso. Es lo que usan UI y PDF. */
export function presentChain(source: ChainStatusSource | null | undefined): ChainStatusPresentation {
  return presentChainStatus(resolveChainStatus(source));
}
