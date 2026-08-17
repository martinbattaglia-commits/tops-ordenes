import { describe, expect, it } from "vitest";
import { evaluateEgressGate, type EgressGateInput } from "./custody/egress-gate";
import { guidance, GUIDED_CODES } from "./custody/blocker-guidance";

/** Nivel 2, todo en orden y ya liberado con certificado: el camino que despacha. */
function nivel2Despachable(): EgressGateInput {
  return {
    level: 2,
    state: "RELEASED",
    caseExists: true,
    hasIngressPhoto: true,
    hasEgressPhoto: true,
    decision: { kind: "release" },
    holdReasons: [],
    releaseCertificateIssued: true,
    chainAdvancedAfterRelease: false,
  };
}

describe("S2-3 · LA IA ALERTA; NO DECIDE", () => {
  /**
   * El caso central del bloque. Concordancia alta, sin banderas, las dos fotos
   * cargadas: el análisis no tiene nada que objetar. Aun así NO despacha,
   * porque falta la firma humana. Si esta prueba se pusiera verde con
   * `decision: null`, la IA estaría liberando mercadería sola.
   */
  it("el CAMINO FELIZ sin decisión humana NO despacha", () => {
    const g = evaluateEgressGate({
      ...nivel2Despachable(),
      state: "REVIEW_REQUIRED",
      decision: null,
      releaseCertificateIssued: false,
    });
    expect(g.dispatchAllowed).toBe(false);
    expect(g.podAllowed).toBe(false);
    expect(g.awaitingHumanDecision).toBe(true);
    // Y el motivo manda a decidir, no a esperar a que el modelo se convenza.
    expect(g.blockers.join(" ")).toContain("inspector");
  });

  it("con la decisión humana registrada, el mismo caso SÍ despacha", () => {
    const g = evaluateEgressGate(nivel2Despachable());
    expect(g.dispatchAllowed).toBe(true);
    expect(g.podAllowed).toBe(true);
    expect(g.blockers).toEqual([]);
  });

  /**
   * Concordancia insuficiente: la IA ALERTA. No bloquea para siempre ni decide
   * la cuarentena — marca que hay que mirar el bien. El inspector sigue
   * pudiendo liberar como override.
   */
  it("la concordancia insuficiente ALERTA, y el humano sigue pudiendo liberar", () => {
    const alerta = evaluateEgressGate({
      ...nivel2Despachable(),
      state: "REVIEW_REQUIRED",
      decision: null,
      holdReasons: ["BELOW_SIMILARITY_THRESHOLD"],
      releaseCertificateIssued: false,
    });
    expect(alerta.reinforcedInspectionRequired).toBe(true);
    expect(alerta.dispatchAllowed).toBe(false);

    const liberado = evaluateEgressGate({
      ...nivel2Despachable(),
      holdReasons: ["BELOW_SIMILARITY_THRESHOLD"],
    });
    expect(liberado.reinforcedInspectionRequired).toBe(true);
    expect(liberado.dispatchAllowed).toBe(true);
  });

  it("ninguna cadena de cara al operario nombra un umbral porcentual (I3)", () => {
    const textos = [
      ...evaluateEgressGate({
        ...nivel2Despachable(),
        state: "REVIEW_REQUIRED",
        decision: null,
        holdReasons: ["BELOW_SIMILARITY_THRESHOLD", "DAMAGE_SUSPECTED"],
        releaseCertificateIssued: false,
      }).blockers,
      ...GUIDED_CODES.map(guidance),
    ].join(" ");
    expect(textos).not.toMatch(/\d\s*%/);
    expect(textos.toLowerCase()).not.toContain("umbral");
  });
});

describe("S2-3 · LA FOTO DE EGRESO ES OBLIGATORIA EN NIVEL 2", () => {
  it("sin foto de egreso no despacha, y el motivo es el que el operario resuelve", () => {
    const g = evaluateEgressGate({
      ...nivel2Despachable(),
      state: "REVIEW_REQUIRED",
      hasEgressPhoto: false,
      decision: null,
      releaseCertificateIssued: false,
    });
    expect(g.dispatchAllowed).toBe(false);
    expect(g.requiresEgressPhoto).toBe(true);
    expect(g.blockers[0]).toContain("foto de egreso");
  });

  it("sin foto de INGRESO no hay contra qué comparar: no despacha", () => {
    const g = evaluateEgressGate({ ...nivel2Despachable(), hasIngressPhoto: false });
    expect(g.dispatchAllowed).toBe(false);
  });

  it("el certificado ausente y la cadena avanzada detienen la liberación ya tomada", () => {
    expect(
      evaluateEgressGate({ ...nivel2Despachable(), releaseCertificateIssued: false })
        .dispatchAllowed,
    ).toBe(false);
    expect(
      evaluateEgressGate({ ...nivel2Despachable(), chainAdvancedAfterRelease: true })
        .dispatchAllowed,
    ).toBe(false);
  });

  it("la cuarentena detiene despacho y POD", () => {
    const g = evaluateEgressGate({
      ...nivel2Despachable(),
      state: "QUARANTINED",
      decision: { kind: "quarantine" },
      releaseCertificateIssued: false,
    });
    expect(g.dispatchAllowed).toBe(false);
    expect(g.podAllowed).toBe(false);
  });
});

describe("S2-3 · EL NIVEL 1 NO PASA POR NADA DE ESTO", () => {
  /**
   * Contrato §9.8. La foto de ingreso es OPCIONAL y su ausencia no bloquea
   * nada. Los dos caminos —con foto y sin foto— tienen que despachar.
   */
  it("nivel 1 CON foto de ingreso: despacha", () => {
    const g = evaluateEgressGate({
      level: 1,
      state: "PENDING_EVIDENCE",
      caseExists: false,
      hasIngressPhoto: true,
      hasEgressPhoto: false,
      decision: null,
      holdReasons: [],
      releaseCertificateIssued: false,
    });
    expect(g.dispatchAllowed).toBe(true);
    expect(g.podAllowed).toBe(true);
    expect(g.blockers).toEqual([]);
    expect(g.requiresEgressPhoto).toBe(false);
  });

  it("nivel 1 SIN foto de ingreso: despacha igual", () => {
    const g = evaluateEgressGate({
      level: 1,
      state: "PENDING_EVIDENCE",
      caseExists: false,
      hasIngressPhoto: false,
      hasEgressPhoto: false,
      decision: null,
      holdReasons: [],
      releaseCertificateIssued: false,
    });
    expect(g.dispatchAllowed).toBe(true);
    expect(g.blockers).toEqual([]);
  });

  it("nivel 1 no pide IA, ni cuarentena, ni certificado, ni decisión humana", () => {
    const g = evaluateEgressGate({
      level: 1,
      state: "PENDING_EVIDENCE",
      caseExists: false,
      hasIngressPhoto: false,
      hasEgressPhoto: false,
      decision: null,
      holdReasons: ["BELOW_SIMILARITY_THRESHOLD", "DAMAGE_SUSPECTED"],
      releaseCertificateIssued: false,
      chainAdvancedAfterRelease: true,
    });
    // Ni siquiera las retenciones ni la cadena avanzada lo tocan: está FUERA.
    expect(g.dispatchAllowed).toBe(true);
    expect(g.reinforcedInspectionRequired).toBe(false);
    expect(g.awaitingHumanDecision).toBe(false);
  });

  /**
   * ⚠ LA LÍNEA ROJA. La excepción del nivel 1 tiene que estar acotada POR
   * NIVEL. Esta prueba toma exactamente el input que el nivel 1 despacha y le
   * cambia UNA cosa —el nivel— para comprobar que el nivel 2 lo rechaza.
   */
  it("el MISMO input en nivel 2 NO despacha: la excepción está acotada", () => {
    const comun = {
      state: "PENDING_EVIDENCE" as const,
      caseExists: false,
      hasIngressPhoto: false,
      hasEgressPhoto: false,
      decision: null,
      holdReasons: [],
      releaseCertificateIssued: false,
    };
    expect(evaluateEgressGate({ ...comun, level: 1 }).dispatchAllowed).toBe(true);
    expect(evaluateEgressGate({ ...comun, level: 2 }).dispatchAllowed).toBe(false);
  });
});

describe("S2-6 · EL TRADUCTOR GUÍA", () => {
  it("ningún código guiado sale crudo, y cada guía dice qué hacer", () => {
    for (const code of GUIDED_CODES) {
      const texto = guidance(code);
      expect(texto).not.toBe(code);
      expect(texto.length).toBeGreaterThan(30);
      // Ninguna guía filtra internals sobre los que el operario no puede obrar.
      expect(texto).not.toMatch(/custody_[a-z_]+|public\.|storage_path|sha256/);
    }
  });

  it("los 22 códigos del certificado están cubiertos", () => {
    const certificado = [
      "CHAIN_NOT_VERIFIED", "CHAIN_EVENTS_NOT_POSITIVE_INT", "CHAIN_ATTESTATION_STALE",
      "EVIDENCE_INVALID", "EVIDENCE_NOT_LINKED", "ASSESSMENT_NOT_OK", "EXECUTION_NOT_REAL",
      "VERDICT_NOT_MATCHING", "CONFIDENCE_NOT_NUMERIC", "NO_HUMAN_DECISION",
      "DECISION_NOT_RELEASE", "DECISION_STATE_INCOHERENT", "DECISION_CLIENT_MISMATCH",
      "DECISION_PERMISSION_INVALID", "DECISION_ACTOR_INVALID", "DECISION_TIMESTAMP_INVALID",
      "DECISION_REASON_TOO_SHORT", "NO_INSPECTION_EVIDENCE", "INSPECTION_SET_NOT_CANONICAL",
      "DECISION_CHAIN_HEAD_MISMATCH", "STATE_NOT_RELEASED", "CLIENT_MISMATCH",
    ];
    expect(certificado).toHaveLength(22);
    for (const c of certificado) expect(guidance(c)).not.toBe(c);
    // El que el master nombró: hoy un operario ya no lo vería crudo.
    expect(guidance("DECISION_CHAIN_HEAD_MISMATCH").toLowerCase()).toContain("volvé a evaluar");
  });

  it("los códigos del gate de despacho están cubiertos", () => {
    for (const c of [
      "CUSTODY_CASE_MISSING", "CUSTODY_HOLD", "CUSTODY_RELEASE_CERTIFICATE_MISSING",
      "CUSTODY_CHAIN_ADVANCED_AFTER_RELEASE", "CUSTODY_GENEALOGY_MISSING",
      "CUSTODY_ZERO_APPLICABLE_CASES", "CUSTODY_EGRESS_PHOTO_MISSING",
    ]) expect(guidance(c)).not.toBe(c);
  });

  /**
   * La frase ya traducida pasa intacta. Es lo que permite aplicar el traductor
   * en el borde de render sin romper los cinco `blockers[]` que hoy
   * transportan castellano.
   */
  it("una frase ya traducida no se vuelve a traducir", () => {
    const frase = "El caso ya tiene una decisión registrada";
    expect(guidance(frase)).toBe(frase);
  });

  it("un código desconocido se declara como tal, no se esconde en un genérico", () => {
    const texto = guidance("UN_CODIGO_QUE_NO_EXISTE");
    expect(texto).toContain("UN_CODIGO_QUE_NO_EXISTE");
    expect(texto).toContain("supervisión");
  });
});
