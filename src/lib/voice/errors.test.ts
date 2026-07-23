import { describe, expect, it } from "vitest";
import {
  isAbortError,
  toVoiceError,
  VoiceError,
  VoicePermissionDeniedError,
  VoiceRecognitionError,
} from "./errors";

describe("isAbortError", () => {
  it("detecta { error: 'aborted' }", () => {
    expect(isAbortError({ error: "aborted" })).toBe(true);
  });

  it("detecta { name: 'AbortError' }", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("detecta ambos: error='aborted' y name='AbortError'", () => {
    expect(isAbortError({ error: "aborted", name: "AbortError" })).toBe(true);
  });

  it("devuelve false para null", () => {
    expect(isAbortError(null)).toBe(false);
  });

  it("devuelve false para undefined", () => {
    expect(isAbortError(undefined)).toBe(false);
  });

  it("devuelve false para strings", () => {
    expect(isAbortError("aborted")).toBe(false);
  });

  it("devuelve false para números", () => {
    expect(isAbortError(123)).toBe(false);
  });

  it("devuelve false para objetos sin propiedades relevantes", () => {
    expect(isAbortError({ foo: "bar" })).toBe(false);
  });

  it("devuelve false si error !== 'aborted'", () => {
    expect(isAbortError({ error: "something-else" })).toBe(false);
  });

  it("devuelve false si name !== 'AbortError'", () => {
    expect(isAbortError({ name: "NotAllowedError" })).toBe(false);
  });

  it("nunca pasa isAbortError a toVoiceError: el aborto debe filtrarse antes", () => {
    // Esta es la garantía del invariante: si un aborto llega a toVoiceError,
    // se clasifica como VoiceRecognitionError (error espurio).
    const abort = { error: "aborted" } as unknown;
    expect(isAbortError(abort)).toBe(true);
    // Si llegara a toVoiceError, sería un bug de la capa que lo consume:
    const result = toVoiceError(abort);
    expect(result).toBeInstanceOf(VoiceRecognitionError);
    expect(result.code).toBe("recognition");
  });
});

describe("toVoiceError", () => {
  it("mapea el permiso denegado", () => {
    expect(toVoiceError({ name: "NotAllowedError" })).toBeInstanceOf(
      VoicePermissionDeniedError,
    );
    expect(toVoiceError({ error: "not-allowed" })).toBeInstanceOf(
      VoicePermissionDeniedError,
    );
  });

  it("mapea los errores del reconocedor con su código", () => {
    expect(toVoiceError({ error: "network" })).toMatchObject({ code: "network" });
    expect(toVoiceError({ error: "no-speech" })).toMatchObject({ code: "no-speech" });
    expect(toVoiceError({ error: "audio-capture" })).toMatchObject({
      code: "no-microphone",
    });
  });

  it("cae en 'recognition' ante algo desconocido", () => {
    expect(toVoiceError(new Error("qué sé yo"))).toMatchObject({ code: "recognition" });
  });

  it("devuelve tal cual un VoiceError que ya lo era", () => {
    const original = new VoicePermissionDeniedError();
    expect(toVoiceError(original)).toBe(original);
  });

  it("preserva instanceof en las subclases (target ES2022)", () => {
    const err = new VoiceRecognitionError("network", "x");
    expect(err).toBeInstanceOf(VoiceRecognitionError);
    expect(err).toBeInstanceOf(VoiceError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("VoiceRecognitionError");
  });
});
