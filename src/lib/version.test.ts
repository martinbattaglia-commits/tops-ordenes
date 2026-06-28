import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { getVersion } from "./version";

/**
 * version.ts lee NEXT_PUBLIC_* inyectadas en build. En test las simulamos por
 * process.env. Verifica derivación de shortSha y fallbacks robustos.
 */
const KEYS = [
  "NEXT_PUBLIC_COMMIT_SHA",
  "NEXT_PUBLIC_BRANCH",
  "NEXT_PUBLIC_BUILD_DATE",
  "NEXT_PUBLIC_BUILD_ID",
  "NEXT_PUBLIC_DEPLOY_CONTEXT",
];

describe("getVersion (trazabilidad de build)", () => {
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

  it("expone todos los campos a partir de las NEXT_PUBLIC_*", () => {
    process.env.NEXT_PUBLIC_COMMIT_SHA = "a1dcb6acd701f8f4842f89285e06f55e518e9e4e";
    process.env.NEXT_PUBLIC_BRANCH = "feat/conciliacion-oc";
    process.env.NEXT_PUBLIC_BUILD_DATE = "2026-06-28T08:24:09Z";
    process.env.NEXT_PUBLIC_BUILD_ID = "a1dcb6a";
    process.env.NEXT_PUBLIC_DEPLOY_CONTEXT = "production";

    const v = getVersion();
    expect(v.commitSha).toBe("a1dcb6acd701f8f4842f89285e06f55e518e9e4e");
    expect(v.shortSha).toBe("a1dcb6a"); // derivado de los primeros 7
    expect(v.branch).toBe("feat/conciliacion-oc");
    expect(v.buildDate).toBe("2026-06-28T08:24:09Z");
    expect(v.buildId).toBe("a1dcb6a");
    expect(v.environment).toBe("production");
  });

  it("cae a 'unknown' sin romper cuando faltan las variables", () => {
    const v = getVersion();
    expect(v.commitSha).toBe("unknown");
    expect(v.shortSha).toBe("unknown");
    expect(v.branch).toBe("unknown");
    expect(v.buildId).toBe("unknown");
    // environment cae a NODE_ENV (vitest lo setea en "test")
    expect(v.environment).toBeTruthy();
  });
});
