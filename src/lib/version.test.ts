import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { getVersion, getPublicVersion } from "./version";

/**
 * version.ts lee BUILD_* (server-only) inyectadas en build. En test las
 * simulamos por process.env. Verifica:
 *  - getVersion(): completo (admin) incl. SHA completo + branch.
 *  - getPublicVersion(): mínimo, SIN SHA completo ni branch (no filtra infra).
 */
const KEYS = ["BUILD_COMMIT_SHA", "BUILD_BRANCH", "BUILD_DATE", "BUILD_ID", "BUILD_CONTEXT"];

describe("versión / trazabilidad de build", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("getVersion() expone TODO (admin): SHA completo, shortSha y branch", () => {
    process.env.BUILD_COMMIT_SHA = "a1dcb6acd701f8f4842f89285e06f55e518e9e4e";
    process.env.BUILD_BRANCH = "feat/conciliacion-oc";
    process.env.BUILD_DATE = "2026-06-28T08:24:09Z";
    process.env.BUILD_ID = "a1dcb6a";
    process.env.BUILD_CONTEXT = "production";

    const v = getVersion();
    expect(v.commitSha).toBe("a1dcb6acd701f8f4842f89285e06f55e518e9e4e");
    expect(v.shortSha).toBe("a1dcb6a");
    expect(v.branch).toBe("feat/conciliacion-oc");
    expect(v.buildDate).toBe("2026-06-28T08:24:09Z");
    expect(v.buildId).toBe("a1dcb6a");
    expect(v.environment).toBe("production");
  });

  it("getPublicVersion() expone SOLO el mínimo y NO filtra SHA completo ni branch", () => {
    process.env.BUILD_COMMIT_SHA = "a1dcb6acd701f8f4842f89285e06f55e518e9e4e";
    process.env.BUILD_BRANCH = "feat/conciliacion-oc";
    process.env.BUILD_DATE = "2026-06-28T08:24:09Z";
    process.env.BUILD_CONTEXT = "production";

    const pub = getPublicVersion();
    expect(pub).toEqual({
      version: "a1dcb6a", // SHA corto, no el completo
      builtAt: "2026-06-28T08:24:09Z",
      environment: "production",
    });
    // Garantía de no-fuga: ni el SHA completo ni la branch están en el payload.
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain("a1dcb6acd701f8f4842f89285e06f55e518e9e4e");
    expect(serialized).not.toContain("feat/conciliacion-oc");
    expect(Object.keys(pub)).toEqual(["version", "builtAt", "environment"]);
  });

  it("cae a 'unknown' sin romper cuando faltan las variables", () => {
    const v = getVersion();
    expect(v.commitSha).toBe("unknown");
    expect(v.shortSha).toBe("unknown");
    expect(v.branch).toBe("unknown");
    expect(getPublicVersion().version).toBe("unknown");
  });
});
