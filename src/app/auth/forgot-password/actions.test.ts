import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: () => ({
    get: (name: string) => {
      if (name === "x-forwarded-for") return "192.0.2.10";
      if (name === "x-forwarded-host") return "evil.example";
      if (name === "host") return "evil.example";
      return null;
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  env: {
    app: { demoMode: false, url: "https://nexus.logisticatops.com" },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  clientKey: () => "client",
  rateLimit: () => ({ ok: true, retryAfterMs: 0 }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { resetPasswordForEmail: mocks.resetPasswordForEmail },
  }),
}));

import { sendPasswordResetLink } from "./actions";

beforeEach(() => {
  mocks.resetPasswordForEmail.mockReset();
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe("sendPasswordResetLink", () => {
  it("genera recovery con endpoint dedicado desde configuración controlada", async () => {
    const result = await sendPasswordResetLink({ email: "persona@example.com" });
    expect(result).toEqual({ ok: true });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("persona@example.com", {
      redirectTo: "https://nexus.logisticatops.com/auth/recovery",
    });
  });

  it("ignora Host y X-Forwarded-Host no confiables", async () => {
    await sendPasswordResetLink({ email: "persona@example.com" });
    expect(JSON.stringify(mocks.resetPasswordForEmail.mock.calls)).not.toContain("evil.example");
  });

  it("rechaza input inválido sin llamar a Supabase", async () => {
    const result = await sendPasswordResetLink({ email: "no-es-email" });
    expect(result).toEqual({ ok: false, error: "Email inválido." });
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("16. responde indistinguiblemente ok: true si el email no existe (anti-enumeración)", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: new Error("User not found") });
    const result = await sendPasswordResetLink({ email: "inexistente@example.com" });
    expect(result).toEqual({ ok: true });
  });
});
