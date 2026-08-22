import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_EMOJIS } from "@/lib/connect/domain/reactions";

describe("Nexus Link · frontera cliente/Server Actions de reacciones", () => {
  it("mantiene el catálogo iterable fuera del módulo use server", () => {
    expect(SUPPORTED_EMOJIS).toEqual(["👍", "❤️", "😂", "😮", "😢", "🙏"]);

    const actionSource = readFileSync(
      new URL("./adapters/driving/reaction-actions.ts", import.meta.url),
      "utf8",
    );
    const clientSource = readFileSync(
      new URL("../../app/(app)/connect/_components/ThreadView.tsx", import.meta.url),
      "utf8",
    );

    expect(actionSource).toMatch(/^"use server";/);
    expect(actionSource).not.toMatch(/export\s+const\s+SUPPORTED_EMOJIS/);
    expect(clientSource).toContain(
      'import { SUPPORTED_EMOJIS } from "@/lib/connect/domain/reactions";',
    );
    expect(clientSource).not.toMatch(
      /import\s*\{[^}]*SUPPORTED_EMOJIS[^}]*\}\s*from\s+"@\/lib\/connect\/adapters\/driving\/reaction-actions"/s,
    );
  });
});
