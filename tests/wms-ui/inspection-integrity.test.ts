/**
 * R-4 · LOS BYTES DE LA INSPECCIÓN SE RE-VERIFICAN ANTES DEL CERTIFICADO.
 *
 * El par ingreso/egreso se re-descarga y se re-hashea al evaluar. La foto de
 * inspección humana no se re-hasheaba en ningún punto, y sin embargo es
 * condición necesaria para liberar y queda referida por el certificado. Como la
 * policy de UPDATE de Storage (0037_custody_storage.sql:86-92) tiene `using`
 * sin `with check` y habilita a los mismos roles que capturan, el objeto podía
 * reemplazarse después de registrado: el certificado terminaba atestiguando
 * bytes que ya no estaban, sin que ninguna ruta de código lo notara.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { verifyInspectionEvidenceIntegrity } from "@/lib/custody/productive-vision-evaluation";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);
const OTRO_PNG = Uint8Array.from([...PNG.slice(0, 32), 0x88]);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function fila(over: Record<string, unknown> = {}) {
  return {
    id: "ev-insp",
    physicalUnitId: "pu-1",
    stage: "despacho" as const,
    eventType: "inspeccion_humana" as unknown as "foto_egreso",
    bucket: "custody-evidence",
    path: "physical_unit/pu-1/despacho/obj.png",
    mimeType: "image/png",
    sizeBytes: PNG.byteLength,
    sha256: sha(PNG),
    redacted: false,
    ...over,
  };
}

/** Puerto de servidor mínimo: la fila registrada y los bytes que hay HOY. */
function puerto(row: ReturnType<typeof fila> | null, bytes: Uint8Array | null) {
  return {
    async loadEvidence() { return row; },
    async download() { return bytes; },
  };
}

describe("R-4 · la inspección íntegra pasa", () => {
  it("los bytes almacenados coinciden con el digest registrado", async () => {
    const r = await verifyInspectionEvidenceIntegrity(puerto(fila(), PNG), ["ev-insp"]);
    expect(r).toEqual({ ok: true });
  });

  it("sin evidencias que verificar no inventa un fallo", async () => {
    const r = await verifyInspectionEvidenceIntegrity(puerto(null, null), []);
    expect(r).toEqual({ ok: true });
  });
});

describe("R-4 · la sustitución del objeto se detecta y bloquea", () => {
  it("bytes reemplazados por otros ⇒ EVIDENCE_HASH_MISMATCH", async () => {
    // Mismo tamaño y mismo tipo: sólo cambia el contenido. Es exactamente el
    // ataque que la policy de UPDATE de Storage deja abierto.
    const r = await verifyInspectionEvidenceIntegrity(
      puerto(fila({ sizeBytes: OTRO_PNG.byteLength }), OTRO_PNG),
      ["ev-insp"],
    );
    expect(r).toEqual({ ok: false, evidenceId: "ev-insp", failure: "EVIDENCE_HASH_MISMATCH" });
  });

  it("objeto ausente en Storage ⇒ EVIDENCE_DOWNLOAD_FAILED", async () => {
    const r = await verifyInspectionEvidenceIntegrity(puerto(fila(), null), ["ev-insp"]);
    expect(r).toEqual({ ok: false, evidenceId: "ev-insp", failure: "EVIDENCE_DOWNLOAD_FAILED" });
  });

  it("evidencia redactada ⇒ EVIDENCE_REDACTED", async () => {
    const r = await verifyInspectionEvidenceIntegrity(
      puerto(fila({ redacted: true }), PNG),
      ["ev-insp"],
    );
    expect(r).toEqual({ ok: false, evidenceId: "ev-insp", failure: "EVIDENCE_REDACTED" });
  });

  it("tipo real distinto del declarado ⇒ EVIDENCE_MIME_MISMATCH", async () => {
    const r = await verifyInspectionEvidenceIntegrity(
      puerto(fila({ mimeType: "image/jpeg" }), PNG),
      ["ev-insp"],
    );
    expect(r).toEqual({ ok: false, evidenceId: "ev-insp", failure: "EVIDENCE_MIME_MISMATCH" });
  });

  it("tamaño que no coincide ⇒ EVIDENCE_SIZE_MISMATCH", async () => {
    const r = await verifyInspectionEvidenceIntegrity(
      puerto(fila({ sizeBytes: PNG.byteLength + 1 }), PNG),
      ["ev-insp"],
    );
    expect(r).toEqual({ ok: false, evidenceId: "ev-insp", failure: "EVIDENCE_SIZE_MISMATCH" });
  });

  it("la fila ya no existe ⇒ EVIDENCE_NOT_FOUND", async () => {
    const r = await verifyInspectionEvidenceIntegrity(puerto(null, PNG), ["ev-insp"]);
    expect(r).toEqual({ ok: false, evidenceId: "ev-insp", failure: "EVIDENCE_NOT_FOUND" });
  });
});

describe("R-4 · la decisión llama a la verificación antes de la RPC", () => {
  it("decideCustodyCaseAction verifica los bytes antes de decidir", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/app/(app)/wms/custody/actions.ts"),
      "utf8",
    );
    const fn = src.slice(src.indexOf("export async function decideCustodyCaseAction"));
    const posVerif = fn.indexOf("verifyInspectionEvidenceIntegrity");
    const posDecide = fn.indexOf("decideIntegrityCase");
    expect(posVerif).toBeGreaterThan(-1);
    expect(posDecide).toBeGreaterThan(-1);
    // El orden importa: verificar DESPUÉS de decidir no protege nada.
    expect(posVerif).toBeLessThan(posDecide);
  });
});
