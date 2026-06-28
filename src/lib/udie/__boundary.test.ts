import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";

const PROBE = "src/lib/udie/core/__boundary_probe.ts";
function runBoundary(): number {
  try { execFileSync("node", ["scripts/udie-boundary.mjs"], { stdio: "pipe" }); return 0; }
  catch (e) { return (e as { status?: number }).status ?? 1; }
}

describe("AP-UDIE-1 boundary guard", () => {
  it("exits 0 on a clean udie tree", () => {
    expect(runBoundary()).toBe(0);
  });
  it("exits 1 when the Core imports a domain context", () => {
    mkdirSync("src/lib/udie/core", { recursive: true });
    writeFileSync(PROBE, 'import { Email } from "@/lib/prospeccion/domain/vo/email";\nexport const x = Email;\n');
    try { expect(runBoundary()).toBe(1); } finally { rmSync(PROBE, { force: true }); }
    expect(runBoundary()).toBe(0);
  });
});
