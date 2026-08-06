import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("P3-N3 official-runner reachability", () => {
  it("reaches and executes the operational-composition discriminants", () => {
    if (process.env.P3_N3_REACHABILITY_CHILD === "1") return;
    const result = spawnSync(
      resolve(process.cwd(), "node_modules/.bin/vitest"),
      ["run", "src/lib/p3-n3-wms-inventory-composition.test.ts", "--config", "vitest.config.ts"],
      {
        cwd: process.cwd(),
        env: { ...process.env, P3_N3_REACHABILITY_CHILD: "1" },
        encoding: "utf8",
      },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
