// SCOPE B · la traducción de errores del pipeline de media, MEDIDA.
//
// El defecto que estas pruebas cierran es el mismo que ya costó tres hotfixes:
// el error real destruido y reemplazado por un string genérico. Acá se exige
// lo contrario — cada condición que la base sabe distinguir llega distinguible
// al operador Y al log.

import { describe, it, expect } from "vitest";
import { classifyMediaFailure } from "./media-outcome";

describe("SCOPE B · cada causa de la base tiene su propio veredicto", () => {
  it("42501 «Sin sesión.» ⇒ no_session", () => {
    const r = classifyMediaFailure({ code: "42501", message: "Sin sesión." }, "upload_begin");
    expect(r.kind).toBe("no_session");
    expect(r.retryable).toBe(false);
  });

  it("42501 de acceso al hilo ⇒ no_access, y NO se confunde con no_session", () => {
    const r = classifyMediaFailure(
      { code: "42501", message: "No tenés acceso a esta conversación." },
      "upload_begin",
    );
    expect(r.kind).toBe("no_access");
    expect(r.userMessage).not.toBe(
      classifyMediaFailure({ code: "42501", message: "Sin sesión." }, "upload_begin").userMessage,
    );
  });

  it("insufficient_privilege del portón de firma ⇒ no_access", () => {
    const r = classifyMediaFailure(
      { code: "42501", message: "no autorizado" },
      "signed_url",
    );
    expect(r.kind).toBe("no_access");
  });

  it("22023 ⇒ bucket_rejected, condición propia y no accionable por el operador", () => {
    const r = classifyMediaFailure({ code: "22023", message: "Bucket no admitido." }, "upload_begin");
    expect(r.kind).toBe("bucket_rejected");
    expect(r.retryable).toBe(false);
  });

  it("no_data_found ⇒ attachment_missing", () => {
    const r = classifyMediaFailure(
      { code: "02000", message: "adjunto inexistente" },
      "signed_url",
    );
    expect(r.kind).toBe("attachment_missing");
  });

  it("PGRST202 ⇒ rpc_missing: contrato app↔base roto, jamás «no se pudo»", () => {
    const r = classifyMediaFailure(
      { code: "PGRST202", message: "Could not find the function public.connect_upload_begin" },
      "upload_begin",
    );
    expect(r.kind).toBe("rpc_missing");
    expect(r.retryable).toBe(false);
    expect(r.userMessage).toMatch(/soporte|técnic/i);
  });

  it("PGRST116 (varias filas donde se esperaba una) ⇒ ambiguous_row", () => {
    const r = classifyMediaFailure(
      { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
      "signed_url",
    );
    expect(r.kind).toBe("ambiguous_row");
  });

  it("un fallo de red ⇒ transient y SÍ es reintentable", () => {
    const r = classifyMediaFailure({ message: "fetch failed" }, "upload_begin");
    expect(r.kind).toBe("transient");
    expect(r.retryable).toBe(true);
  });

  it("objeto ausente en storage ⇒ storage_object_missing", () => {
    const r = classifyMediaFailure({ message: "Object not found", statusCode: "404" }, "download");
    expect(r.kind).toBe("storage_object_missing");
  });

  it("lo desconocido se declara desconocido, no se disfraza", () => {
    const r = classifyMediaFailure({ code: "XX000", message: "boom" }, "download");
    expect(r.kind).toBe("unknown");
  });
});

describe("SCOPE B · el log conserva la causa real; el mensaje al operador no filtra", () => {
  it("el log lleva sqlstate, mensaje y etapa", () => {
    const r = classifyMediaFailure(
      { code: "42501", message: "No tenés acceso a esta conversación.", details: "d", hint: "h" },
      "claim_finalize",
    );
    expect(r.log).toMatchObject({
      kind: "no_access",
      stage: "claim_finalize",
      sqlstate: "42501",
      message: "No tenés acceso a esta conversación.",
      details: "d",
      hint: "h",
    });
  });

  it("ninguna causa produce el string genérico que borraba el diagnóstico", () => {
    const casos = [
      { code: "42501", message: "Sin sesión." },
      { code: "22023", message: "Bucket no admitido." },
      { code: "PGRST202", message: "no function" },
      { message: "fetch failed" },
      { code: "XX000", message: "boom" },
    ];
    const mensajes = casos.map((c) => classifyMediaFailure(c, "upload_begin").userMessage);
    for (const m of mensajes) expect(m).not.toBe("No se pudo preparar la subida.");
    // Y son distinguibles entre sí: cinco causas, cinco mensajes.
    expect(new Set(mensajes).size).toBe(casos.length);
  });

  it("una ausencia de error también se clasifica (no se asume éxito)", () => {
    const r = classifyMediaFailure(null, "upload_begin");
    expect(r.kind).toBe("empty_result");
    expect(r.retryable).toBe(false);
  });
});

describe("SCOPE B · la causa cruza al cliente SIN texto del motor (gate H2)", () => {
  it("el diagnóstico es cerrado: clase, etapa y código; nada más", () => {
    const r = classifyMediaFailure(
      { code: "42501", message: "No tenés acceso a esta conversación.", details: "ruta interna", hint: "h" },
      "signed_url",
    );
    expect(r.diagnostic).toEqual({ kind: "no_access", stage: "signed_url", sqlstate: "42501" });
    // El texto del motor NO viaja: podría llevar rutas o configuración.
    expect(JSON.stringify(r.diagnostic)).not.toContain("ruta interna");
    expect(JSON.stringify(r.diagnostic)).not.toContain("h");
  });

  it("dos causas distintas producen diagnósticos distintos en la misma etapa", () => {
    const a = classifyMediaFailure({ code: "42501", message: "Sin sesión." }, "upload_begin");
    const b = classifyMediaFailure({ code: "22023", message: "Bucket no admitido." }, "upload_begin");
    expect(a.diagnostic).not.toEqual(b.diagnostic);
  });
});

describe("SCOPE B · el veredicto del claim se nombra, no se colapsa", () => {
  it("denied y already_finalized no son el mismo desenlace", () => {
    const denied = classifyMediaFailure({ code: "CLAIM_DENIED", message: "denied" }, "claim_finalize");
    expect(denied.kind).toBe("upload_not_claimable");
    expect(denied.retryable).toBe(false);
  });
});
