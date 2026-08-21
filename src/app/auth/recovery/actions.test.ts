import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getSession: vi.fn(),
  cookieSet: vi.fn(),
  tokenHash: "synthetic-hash" as string | undefined,
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: () => (mocks.tokenHash ? { value: mocks.tokenHash } : undefined),
    set: mocks.cookieSet,
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      verifyOtp: mocks.verifyOtp,
      getSession: mocks.getSession,
    },
  }),
}));

import { confirmPasswordRecovery } from "./actions";
import { verifyAuthTransitionToken } from "@/lib/supabase/auth-recovery";

const TEST_SECRET = "test-auth-transition-secret-minimum-32-chars-entropy-key";
const testUser = { id: "user-1", email: "despachos-lujan@logisticatops.com" };
const testSession = { id: "session-recovery-1234", user: testUser };

beforeEach(() => {
  process.env.AUTH_TRANSITION_SECRET = TEST_SECRET;
  mocks.verifyOtp.mockReset();
  mocks.getSession.mockReset();
  mocks.cookieSet.mockReset();
  mocks.tokenHash = "synthetic-hash";
});

describe("confirmPasswordRecovery", () => {
  it("consume el token sólo tras la acción humana explícita y emite token ligado a userId + sessionId", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: testUser, session: testSession }, error: null });
    const result = await confirmPasswordRecovery();
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "synthetic-hash",
      type: "recovery",
    });

    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "nexus-password-recovery",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "lax" }),
    );

    const emittedToken = mocks.cookieSet.mock.calls.find((call) => call[0] === "nexus-password-recovery")?.[1];
    const verified = await verifyAuthTransitionToken(emittedToken, "recovery", {
      userId: testUser.id,
      sessionId: testSession.id,
      email: testUser.email,
    });
    expect(verified.valid).toBe(true);
    expect(result).toEqual({ ok: true });
  });

  it("exige el token efímero HttpOnly", async () => {
    mocks.tokenHash = undefined;
    const result = await confirmPasswordRecovery();
    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("clasifica token usado o vencido sin filtrar el detalle", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: null, error: new Error("One-time token not found") });
    const result = await confirmPasswordRecovery();
    expect(result).toEqual({ ok: false, error: "expired" });
    expect(JSON.stringify(result)).not.toContain("synthetic-hash");
  });

  it("clasifica excepciones de red sin exponer detalle", async () => {
    mocks.verifyOtp.mockRejectedValue(new Error("provider internal detail"));
    expect(await confirmPasswordRecovery()).toEqual({ ok: false, error: "network" });
  });
});
