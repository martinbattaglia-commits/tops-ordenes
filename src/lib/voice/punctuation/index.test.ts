import { describe, expect, it, vi } from "vitest";
import { resolvePunctuator } from "./index";
import type { VoiceEngine } from "../types";

function engineWith(providesPunctuation: boolean): VoiceEngine {
  return {
    id: "fake",
    capabilities: {
      partialResults: true,
      requiresMediaStream: false,
      providesPunctuation,
      locales: "any",
    },
    isAvailable: () => true,
    start: async () => {},
    stop: async () => {},
    abort: () => {},
  };
}

describe("resolvePunctuator", () => {
  it("'none' devuelve el texto sin tocar", async () => {
    const p = resolvePunctuator("none", engineWith(false));
    expect(p.id).toBe("none");
    expect(await p.apply("el punto de encuentro")).toBe("el punto de encuentro");
  });

  it("'commands' interpreta los comandos", async () => {
    const p = resolvePunctuator("commands", engineWith(false));
    expect(await p.apply("hola nueva línea mundo")).toBe("hola \n mundo");
  });

  it("'provider' confía en el motor cuando éste puntúa", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = resolvePunctuator("provider", engineWith(true));
    expect(await p.apply("Hola. Mundo.")).toBe("Hola. Mundo.");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("'provider' degrada a identidad y avisa si el motor no puntúa", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = resolvePunctuator("provider", engineWith(false));
    expect(await p.apply("hola mundo")).toBe("hola mundo");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("'ai' lanza un Error común, no un VoiceError", () => {
    expect(() => resolvePunctuator("ai", engineWith(false))).toThrowError(
      /no está implementada en Nexus Voice v1/,
    );
  });
});
