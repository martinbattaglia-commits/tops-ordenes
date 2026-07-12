import { describe, expect, it } from "vitest";
import { BuildFlagSource, isVoiceEnabled } from "./config";
import type { VoiceConfigSource } from "./config";

const source = (id: string, enabled: boolean): VoiceConfigSource => ({
  id,
  isEnabled: () => enabled,
});

describe("BuildFlagSource", () => {
  it('habilita solo con "1" o "true"', () => {
    expect(new BuildFlagSource("1").isEnabled()).toBe(true);
    expect(new BuildFlagSource("true").isEnabled()).toBe(true);
    expect(new BuildFlagSource("0").isEnabled()).toBe(false);
    expect(new BuildFlagSource("").isEnabled()).toBe(false);
    expect(new BuildFlagSource(undefined).isEnabled()).toBe(false);
  });
});

describe("isVoiceEnabled", () => {
  it("compone con AND: todas las fuentes deben habilitar", () => {
    expect(isVoiceEnabled([source("a", true), source("b", true)])).toBe(true);
    expect(isVoiceEnabled([source("a", true), source("b", false)])).toBe(false);
    expect(isVoiceEnabled([source("a", false), source("b", true)])).toBe(false);
  });

  it("sin fuentes está deshabilitado (fail-closed)", () => {
    expect(isVoiceEnabled([])).toBe(false);
  });

  it("una fuente futura solo puede restringir, nunca sobrescribir el flag de build", () => {
    const build = new BuildFlagSource("0");
    expect(isVoiceEnabled([build, source("org", true)])).toBe(false);
  });
});
