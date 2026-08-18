/**
 * TRADUCTOR GUÍA DE CÓDIGOS DE BLOQUEO · S2-6
 *
 * ─── EL CRITERIO NO ES TRADUCIR: ES GUIAR ─────────────────────────────────
 *
 * Un operario que lee `DECISION_CHAIN_HEAD_MISMATCH` no aprende nada y llama a
 * soporte. Un operario que lee «El caso cambió después de la decisión: volvé a
 * evaluarlo y decidí de nuevo» resuelve solo. Cada entrada de este módulo dice
 * DOS cosas: qué falta y qué hacer. Una entrada que sólo describa el defecto
 * está a medio escribir.
 *
 * ─── QUÉ CUBRE, Y POR QUÉ ESTABA DESCUBIERTO ──────────────────────────────
 *
 * `case-presentation.ts` ya traducía dos familias: `HoldReason` y
 * `ReleaseBlocker`. Quedaban dos familias enteras sin ningún traductor, ambas
 * verificadas por ausencia sobre el árbol de esta sesión:
 *
 *  · `CertificateBlocker` (22 códigos, `integrity/certificate-policy.ts:22-44`)
 *    → `grep -rn "evaluateCertificateEligibility" src/` fuera del propio módulo
 *      devuelve 0 resultados. Hoy no llega a pantalla porque el certificado
 *      está CORTADO EN lectura (contrato §2 fila 7); llega en cuanto 2-C lo
 *      cablee, y llegaría crudo.
 *
 *  · Los códigos de gate de despacho `CUSTODY_*` (6, más el que agrega 0253)
 *    → `grep -rn "CUSTODY_HOLD\|CUSTODY_GENEALOGY_MISSING\|…" src/` devuelve 0
 *      resultados. Éstos NO son teóricos: el gate es un trigger, y su excepción
 *      de PostgreSQL sube tal cual al despachante (contrato §2 fila 8).
 *
 * ─── POR QUÉ `guidance()` DEVUELVE LA ENTRADA CUANDO NO LA CONOCE ─────────
 *
 * Los cinco `blockers[]` del view-model transportan HOY cadenas ya traducidas.
 * Un traductor que exigiera códigos rompería esas cinco superficies, y uno que
 * devolviera un genérico las degradaría. Al pasar de largo lo que no es un
 * código conocido, este módulo se puede aplicar en el borde de render sin
 * tocar lo que ya estaba bien, y captura cualquier código que aparezca después
 * —incluidos los 22 del certificado cuando 2-C los cablee— sin volver a tocar
 * los paneles. La detección de «esto es un código» es estructural
 * (`CODE_SHAPE`), no una lista negra.
 */

/** Un código crudo es MAYÚSCULAS, dígitos y guiones bajos, sin espacios. */
const CODE_SHAPE = /^[A-Z][A-Z0-9_]{2,}$/;

/**
 * Cada valor dice qué falta y qué hacer. Sin nombres de tabla, de función, de
 * bucket ni de ruta: el operario no puede actuar sobre eso y el módulo es
 * probatorio.
 *
 * La regla de borrado (I3) sigue vigente acá: ninguna cadena de cara al
 * usuario nombra un umbral porcentual de similitud.
 */
const GUIDANCE: Record<string, string> = {
  // ── Gate de despacho · los códigos que hoy suben crudos al despachante ──
  CUSTODY_CASE_MISSING:
    "Esta unidad está bajo custodia digital y todavía no tiene caso abierto. Avisá a supervisión antes de seguir con el despacho: no lo resuelve el depósito.",
  CUSTODY_HOLD:
    "La unidad todavía no fue liberada por un inspector. Entrá al caso de custodia, registrá la decisión humana y volvé a intentar el despacho.",
  CUSTODY_RELEASE_CERTIFICATE_MISSING:
    "Falta el certificado de liberación de esta unidad. Volvé al caso y registrá la liberación: el certificado se emite con esa decisión.",
  CUSTODY_CHAIN_ADVANCED_AFTER_RELEASE:
    "Se registró un movimiento sobre la unidad después de liberarla, así que la liberación quedó vencida. Volvé a evaluar el caso y liberá de nuevo antes de despachar.",
  CUSTODY_GENEALOGY_MISSING:
    "Lo reservado no coincide con las unidades físicas registradas. Revisá la reserva contra lo que hay en el depósito: falta cargar unidades o sobra cantidad reservada.",
  CUSTODY_ZERO_APPLICABLE_CASES:
    "No hay ninguna unidad bajo custodia en este despacho. Verificá que estés despachando la mercadería correcta.",
  // 0253 · la puerta de egreso
  CUSTODY_EGRESS_PHOTO_MISSING:
    "Falta la foto de egreso de esta unidad. Sacala ahora, con los mismos ángulos que la de ingreso, y después registrá la decisión.",
  CUSTODY_EGRESS_NOT_APPLICABLE:
    "Esta mercadería no tiene custodia digital contratada: no lleva foto de egreso. Seguí con el despacho normal.",

  // ── Certificado · las 22 del contrato probatorio ────────────────────────
  CHAIN_NOT_VERIFIED:
    "La cadena de custodia no está verificada. Volvé a evaluar el caso: la verificación se rehace con el análisis.",
  CHAIN_EVENTS_NOT_POSITIVE_INT:
    "La verificación de cadena no cerró bien. Volvé a evaluar el caso; si vuelve a pasar, avisá a supervisión.",
  CHAIN_ATTESTATION_STALE:
    "La verificación de cadena no estaba vigente en el momento de la liberación. Volvé a evaluar el caso y decidí de nuevo.",
  EVIDENCE_INVALID:
    "Las fotos comparadas no son válidas. Sacá de nuevo la que falte o esté mal y volvé a evaluar.",
  EVIDENCE_NOT_LINKED:
    "Las fotos no quedaron ligadas a la cadena de custodia. Volvé a evaluar el caso para que se vinculen.",
  ASSESSMENT_NOT_OK:
    "Todavía no hay un análisis utilizable de este caso. Pedí la evaluación y esperá el resultado.",
  EXECUTION_NOT_REAL:
    "El análisis no se ejecutó en modo real, así que no sirve para emitir el certificado. Volvé a evaluar el caso.",
  VERDICT_NOT_MATCHING:
    "El análisis no confirma que la mercadería sea la misma que ingresó. Registrá la inspección física antes de decidir.",
  CONFIDENCE_NOT_NUMERIC:
    "El análisis no informó su confianza. Volvé a evaluar el caso antes de decidir.",
  NO_HUMAN_DECISION:
    "Falta la decisión humana. Un inspector tiene que liberar o cuarentenar el caso: el certificado sale de esa decisión, no del análisis.",
  DECISION_NOT_RELEASE:
    "El caso no fue liberado, así que no corresponde certificado de liberación.",
  DECISION_STATE_INCOHERENT:
    "La liberación no partió de una revisión humana. El certificado sólo se emite cuando un inspector revisó el caso y lo liberó.",
  DECISION_CLIENT_MISMATCH:
    "La decisión registrada es de otro cliente. No sigas: avisá a supervisión.",
  DECISION_PERMISSION_INVALID:
    "Quien decidió no tenía el permiso exacto que exige la liberación. Hay que volver a decidir con un usuario autorizado.",
  DECISION_ACTOR_INVALID:
    "La decisión quedó sin identificar quién la tomó. Volvé a registrarla desde una sesión iniciada.",
  DECISION_TIMESTAMP_INVALID:
    "La decisión quedó sin fecha válida. Volvé a registrarla.",
  DECISION_REASON_TOO_SHORT:
    "El motivo de la liberación es demasiado corto. Volvé a decidir explicando qué se revisó y por qué se libera.",
  NO_INSPECTION_EVIDENCE:
    "Falta la foto de inspección física. Sacala desde el caso y volvé a decidir.",
  INSPECTION_SET_NOT_CANONICAL:
    "Las fotos de inspección declaradas no son las que el caso tiene registradas. Volvé a evaluar y decidí de nuevo.",
  DECISION_CHAIN_HEAD_MISMATCH:
    "La liberación no coincide con la verificación de cadena que la sostuvo. Volvé a evaluar el caso y decidí de nuevo.",
  STATE_NOT_RELEASED:
    "El caso todavía no está liberado. Registrá la decisión humana de liberación.",
  CLIENT_MISMATCH:
    "Este caso pertenece a otro cliente. No sigas: avisá a supervisión.",
};

/**
 * Traduce un código a lo que hay que HACER. Si la entrada no tiene forma de
 * código —porque ya es una frase traducida— la devuelve intacta.
 *
 * Un código con forma de código pero desconocido NO cae en un genérico mudo:
 * se lo declara como tal y se indica el único paso que el operario puede dar.
 */
export function guidance(entry: string): string {
  const value = (entry ?? "").trim();
  if (value.length === 0) return value;
  if (!CODE_SHAPE.test(value)) return value;
  const known = GUIDANCE[value];
  if (known) return known;
  return "El sistema bloqueó este paso por un motivo que la pantalla todavía no sabe explicar. Anotá el código y avisá a supervisión: " + value;
}

/** Aplica `guidance` a una lista, preservando el orden y sin repetir. */
export function guidanceList(entries: readonly string[]): string[] {
  return [...new Set(entries.map(guidance))];
}

/** Los códigos con guía escrita. Expuesto para que las pruebas los recorran. */
export const GUIDED_CODES: readonly string[] = Object.keys(GUIDANCE);
