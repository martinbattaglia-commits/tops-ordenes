import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
  }),
}));

import { GET } from "./route";

const makeRequest = (query: string) =>
  new NextRequest(`https://nexus.logisticatops.com/api/auth/callback?${query}`);

beforeEach(() => {
  mocks.exchangeCodeForSession.mockReset();
});

describe("GET /api/auth/callback", () => {
  it("canjea un code de login y llega al destino interno", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(makeRequest("code=pkce-code&next=%2Forders"));
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(response.headers.get("location")).toBe(
      "https://nexus.logisticatops.com/orders",
    );
  });

  it("no marca magic link y rechaza un next externo", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(makeRequest("code=pkce-code&next=https%3A%2F%2Fevil.example"));
    expect(response.headers.get("location")).toBe("https://nexus.logisticatops.com/dashboard");
  });

  it("9. no convierte un grant genérico en recovery y redirige a /dashboard si next es /auth/reset-password", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(makeRequest("code=magic&next=%2Fauth%2Freset-password"));
    expect(response.headers.get("location")).toBe(
      "https://nexus.logisticatops.com/dashboard",
    );
  });

  it("un callback inválido vuelve a login sin propagar el code", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("sensitive detail") });
    const response = await GET(makeRequest("code=used&next=%2Fauth%2Freset-password"));
    expect(response.headers.get("location")).toBe(
      "https://nexus.logisticatops.com/login?error=callback_failed",
    );
    expect(response.headers.get("location")).not.toContain("used");
  });
});
