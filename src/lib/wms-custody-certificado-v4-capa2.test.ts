/**
 * V4 · CAPA 2 · LA ATESTACIÓN VIVA APORTA LOS `verified_event_ids` (R-19).
 *
 * ROJO (medible en el árbol previo a V4): `mapChain` arma la atestación
 * almacenada con `verifiedEventIds: []`, así que un caso con atestación
 * `verified` y evidencias presentes llegaba a la política con lista vacía y
 * disparaba `EVIDENCE_NOT_LINKED`. El documento nunca podía ser certificado.
 *
 * VERDE: `buildDocumentChain` toma la atestación de la DECISIÓN (la política
 * exige que la atestación la preceda: una viva posterior daría edad negativa)
 * y la enriquece con los `verified_event_ids` que la verificación VIVA
 * re-deriva — siempre que la viva VERIFIQUE la cadena completa. Desde V4-bis
 * no se exige igualdad de heads: el avance operativo posterior a la
 * liberación no es adulteración (decisión firmada de Dirección).
 *
 * DIRECCIÓN DEL FAIL-CLOSED: ninguna rama de `buildDocumentChain` puede
 * convertir en certificable lo que la cadena viva no acredita.
 */
import { describe, expect, it } from "vitest";

import { buildDocumentChain } from "@/lib/custody/integrity/certificate-document";
import { evaluateCertificateEligibility } from "@/lib/custody/integrity/certificate-policy";
import type { CertificateContext } from "@/lib/custody/integrity/certificate-policy";
import type { ChainVerification } from "@/lib/custody/integrity/types";
import { createSupabaseCustodyQueryPort } from "@/lib/custody/integrity-supabase";
import type { CustodyDataClient } from "@/lib/custody/integrity-supabase";

const HEAD = "a".repeat(64);
const DECIDED_AT = "2026-08-18T12:05:00.000Z";

const stored: ChainVerification = {
  status: "verified",
  attestation: {
    scope: "physical_unit",
    entityId: "pu-1",
    chainHead: HEAD,
    eventsChecked: 4,
    verifiedEventIds: [],
    attestedAt: DECIDED_AT,
  },
};

describe("V4 · capa 2 · buildDocumentChain", () => {
  it("VERDE · la viva confirma el head ⇒ la atestación lleva los ids reales", () => {
    const out = buildDocumentChain(stored, {
      status: "verified",
      chainHead: HEAD,
      verifiedEventIds: ["evt-in", "evt-out", "evt-insp"],
    });
    expect(out?.status).toBe("verified");
    if (out?.status !== "verified") throw new Error("unreachable");
    expect(out.attestation.verifiedEventIds).toEqual(["evt-in", "evt-out", "evt-insp"]);
    // El instante y el head siguen siendo los de la decisión.
    expect(out.attestation.attestedAt).toBe(DECIDED_AT);
    expect(out.attestation.chainHead).toBe(HEAD);
  });

  it("fail-closed · sin contexto vivo, la almacenada queda intacta (lista vacía)", () => {
    const out = buildDocumentChain(stored, null);
    if (out?.status !== "verified") throw new Error("unreachable");
    expect(out.attestation.verifiedEventIds).toEqual([]);
  });

  it("V4-bis · la viva verifica con la cadena AVANZADA ⇒ se enriquece igual", () => {
    const out = buildDocumentChain(stored, {
      status: "verified",
      chainHead: "b".repeat(64),
      verifiedEventIds: ["evt-in", "evt-out", "evt-insp", "evt-pod"],
    });
    if (out?.status !== "verified") throw new Error("unreachable");
    expect(out.attestation.verifiedEventIds).toEqual(["evt-in", "evt-out", "evt-insp", "evt-pod"]);
    // El head y el instante del documento siguen siendo los de la decisión.
    expect(out.attestation.chainHead).toBe(HEAD);
    expect(out.attestation.attestedAt).toBe(DECIDED_AT);
  });

  it("fail-closed · la viva NO verifica ⇒ no se enriquece nada", () => {
    const out = buildDocumentChain(stored, {
      status: "invalid",
      chainHead: HEAD,
      verifiedEventIds: ["evt-x"],
    });
    if (out?.status !== "verified") throw new Error("unreachable");
    expect(out.attestation.verifiedEventIds).toEqual([]);
  });

  it("DIRECCIÓN · una almacenada NO verificada jamás se vuelve verificada", () => {
    const invalida: ChainVerification = {
      status: "unverifiable",
      verifiedAt: DECIDED_AT,
      error: "attestation_incomplete",
    };
    const out = buildDocumentChain(invalida, {
      status: "verified",
      chainHead: HEAD,
      verifiedEventIds: ["evt-in", "evt-out"],
    });
    expect(out).toBe(invalida);
  });
});

describe("V4 · capa 2 · el vínculo con la política (el rojo, ejecutable)", () => {
  const ctx = (chain: ChainVerification): CertificateContext => ({
    state: "RELEASED",
    caseClientId: "client-1",
    requesterClientId: "client-1",
    evidenceOk: true,
    evidenceEventIds: ["evt-in", "evt-out"],
    chain,
    assessment: null,
    decision: null,
    canonicalInspectionEvidenceIds: [],
    currentChainHead: HEAD,
    issuedAt: "2026-08-18T12:06:00.000Z",
  });

  it("ROJO · atestación verified con lista vacía ⇒ EVIDENCE_NOT_LINKED", () => {
    const r = evaluateCertificateEligibility(ctx(stored));
    expect(r.document).toBe("acta_inspeccion");
    expect(r.blockers).toContain("EVIDENCE_NOT_LINKED");
  });

  it("VERDE · la atestación enriquecida cubre ambos eventId ⇒ no dispara", () => {
    const enriched = buildDocumentChain(stored, {
      status: "verified",
      chainHead: HEAD,
      verifiedEventIds: ["evt-in", "evt-out", "evt-insp"],
    });
    if (enriched?.status !== "verified") throw new Error("unreachable");
    const r = evaluateCertificateEligibility(ctx(enriched));
    expect(r.blockers).not.toContain("EVIDENCE_NOT_LINKED");
  });
});

describe("V4 · capa 2 · normalización del adaptador de sesión", () => {
  function fakeDb(rpcData: unknown): CustodyDataClient {
    return {
      from: () => {
        throw new Error("no se consulta");
      },
      rpc: async (fn: string) => {
        expect(fn).toBe("custody_certificate_document_v2");
        return { data: rpcData, error: null };
      },
    } as unknown as CustodyDataClient;
  }

  it("normaliza la respuesta jsonb de 0258", async () => {
    const port = createSupabaseCustodyQueryPort(fakeDb({
      attestation: {
        status: "verified",
        chain_head: HEAD,
        events_checked: 4,
        attested_at: DECIDED_AT,
        verified_event_ids: ["evt-in", "evt-out"],
      },
      canonical_inspection_evidence_ids: ["ev-insp-1"],
    }));
    const doc = await port.selectCertificateDocument!("case-1");
    expect(doc).toEqual({
      attestation: {
        status: "verified",
        chainHead: HEAD,
        eventsChecked: 4,
        attestedAt: DECIDED_AT,
        verifiedEventIds: ["evt-in", "evt-out"],
      },
      canonicalInspectionEvidenceIds: ["ev-insp-1"],
    });
  });

  it("fail-closed · respuesta sin atestación ⇒ null", async () => {
    const port = createSupabaseCustodyQueryPort(fakeDb({ attestation: null }));
    expect(await port.selectCertificateDocument!("case-1")).toBeNull();
  });

  it("fail-closed · basura en las listas se filtra a strings no vacíos", async () => {
    const port = createSupabaseCustodyQueryPort(fakeDb({
      attestation: {
        status: "verified",
        chain_head: HEAD,
        events_checked: 4,
        attested_at: DECIDED_AT,
        verified_event_ids: ["evt-in", "", 7, null],
      },
      canonical_inspection_evidence_ids: "no-es-lista",
    }));
    const doc = await port.selectCertificateDocument!("case-1");
    expect(doc?.attestation.verifiedEventIds).toEqual(["evt-in"]);
    expect(doc?.canonicalInspectionEvidenceIds).toEqual([]);
  });
});
