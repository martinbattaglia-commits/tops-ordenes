/**
 * 2-C-2 · LA EMISIÓN DEL DOCUMENTO PROBATORIO.
 *
 * `evaluateCertificateEligibility` estaba escrita y verificada tres veces, y
 * **no la llamaba nadie**. Estas pruebas ejercitan el consumidor que faltaba, y
 * lo hacen contra la política REAL —no contra un doble—, porque lo que hay que
 * demostrar es justamente que el veredicto de la política llega intacto.
 */
import { describe, expect, it } from "vitest";
import { resolveCustodyDocument } from "@/lib/custody/certificate-emission";
import type { CertificateContext } from "@/lib/custody/integrity/certificate-policy";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const HEAD = "head-vigente";
const AHORA = "2026-08-17T12:00:00.000Z";
const ANTES = "2026-08-17T11:00:00.000Z";
const EV_ING = "ev-ingreso";
const EV_EGR = "ev-egreso";
const INSPECCION = ["insp-1"];

/** Un caso que cumple TODO: el camino del certificado. */
function contextoCompleto(): CertificateContext {
  return {
    state: "RELEASED",
    caseClientId: CLIENTE,
    requesterClientId: CLIENTE,
    evidenceOk: true,
    evidenceEventIds: [EV_ING, EV_EGR],
    chain: {
      status: "verified",
      attestation: {
        chainHead: HEAD,
        eventsChecked: 4,
        verifiedEventIds: [EV_ING, EV_EGR],
        attestedAt: ANTES,
        expiresAt: "2026-08-18T11:00:00.000Z",
      },
    } as unknown as CertificateContext["chain"],
    assessment: {
      outcome: "ok",
      verdict: "coincide",
      modelConfidence: 0.93,
      provenance: { executionMode: "real" },
    } as unknown as CertificateContext["assessment"],
    decision: {
      decision: "release",
      newState: "RELEASED",
      previousState: "REVIEW_REQUIRED",
      clientId: CLIENTE,
      permission: "wms.custody.decide",
      actorUserId: "u-1",
      actorSessionId: "s-1",
      actorRole: "admin",
      decidedAt: ANTES,
      reason: "Se verificó la mercadería contra la foto de ingreso y coincide.",
      observations: null,
      inspectionEvidenceIds: [...INSPECCION],
      chainHeadAtDecision: HEAD,
    } as unknown as CertificateContext["decision"],
    canonicalInspectionEvidenceIds: [...INSPECCION],
    currentChainHead: HEAD,
    issuedAt: AHORA,
  };
}

const ASIENTO = {
  id: "cert-1",
  basis: "vision_policy",
  chainHeadAtRelease: HEAD,
  issuedAt: ANTES,
};

describe("2-C-2 · el certificado se EMITE cuando corresponde", () => {
  it("caso completo ⇒ CERTIFICADO, sin motivos", () => {
    const d = resolveCustodyDocument(contextoCompleto(), ASIENTO);
    expect(d.kind).toBe("certificate");
    expect(d.isCertificate).toBe(true);
    expect(d.reasons).toEqual([]);
    expect(d.persisted?.id).toBe("cert-1");
    expect(d.missingPersistedRow).toBe(false);
  });

  /**
   * El acta NO es un fallo de emisión: es el documento correcto para un caso
   * liberado sin alcanzar la barra probatoria. Y sus motivos tienen que llegar
   * GUIADOS, no como códigos — es el traductor de 2-B el que los pasa.
   */
  it("caso liberado por override ⇒ ACTA, con motivos guiados y sin códigos crudos", () => {
    const ctx = contextoCompleto();
    const d = resolveCustodyDocument(
      { ...ctx, assessment: { ...(ctx.assessment as object), verdict: "difiere" } as never },
      { ...ASIENTO, basis: "human_override" },
    );
    expect(d.kind).toBe("acta_inspeccion");
    expect(d.isCertificate).toBe(false);
    expect(d.reasons.length).toBeGreaterThan(0);
    const texto = d.reasons.join(" ");
    expect(texto).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
    expect(texto.toLowerCase()).toContain("inspección");
  });

  it("sin decisión humana ⇒ ACTA, y lo dice", () => {
    const d = resolveCustodyDocument(
      { ...contextoCompleto(), decision: null, state: "REVIEW_REQUIRED" },
      null,
    );
    expect(d.kind).toBe("acta_inspeccion");
    expect(d.reasons.join(" ").toLowerCase()).toContain("decisión humana");
    // Sin liberación no hay asiento, y eso NO es una incoherencia.
    expect(d.missingPersistedRow).toBe(false);
  });

  /**
   * La incoherencia que sí hay que declarar: la política dice certificado y la
   * base no dejó asiento. Se muestra, no se esconde.
   */
  it("certificado sin asiento persistido ⇒ se DECLARA la incoherencia", () => {
    const d = resolveCustodyDocument(contextoCompleto(), null);
    expect(d.isCertificate).toBe(true);
    expect(d.missingPersistedRow).toBe(true);
  });

  /**
   * `certificate-policy.ts:107` exige `previousState === "REVIEW_REQUIRED"`, y
   * `0222:777` lo impone por CHECK en la base. Este test fija que el consumidor
   * NO lo relaja: es la propiedad que tres revisiones confirmaron.
   */
  it("una decisión que no venga de revisión humana NO da certificado", () => {
    const ctx = contextoCompleto();
    const d = resolveCustodyDocument(
      {
        ...ctx,
        decision: { ...(ctx.decision as object), previousState: "PENDING_EVIDENCE" } as never,
      },
      ASIENTO,
    );
    expect(d.kind).toBe("acta_inspeccion");
  });

  it("un caso de OTRO cliente nunca da certificado", () => {
    const d = resolveCustodyDocument(
      { ...contextoCompleto(), requesterClientId: "otro-cliente" },
      ASIENTO,
    );
    expect(d.kind).toBe("acta_inspeccion");
  });
});
