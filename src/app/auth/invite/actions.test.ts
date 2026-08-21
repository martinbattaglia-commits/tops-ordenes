import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getSession: vi.fn(),
  cookieSet: vi.fn(),
  tokenHash: "synthetic-invite" as string | undefined,
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

import { confirmInvitation } from "./actions";
import { verifyAuthTransitionToken } from "@/lib/supabase/auth-recovery";

const TEST_SECRET = "test-auth-transition-secret-minimum-32-chars-entropy-key";
const testUser = { id: "user-invite-1", email: "invitado@logisticatops.com" };
const testSession = { id: "session-invite-5678", user: testUser };

beforeEach(() => {
  process.env.AUTH_TRANSITION_SECRET = TEST_SECRET;
  mocks.verifyOtp.mockReset();
  mocks.getSession.mockReset();
  mocks.cookieSet.mockReset();
  mocks.tokenHash = "synthetic-invite";
});

describe("confirmInvitation", () => {
  it("verifica invite, no recovery, y emite token firmado de invite ligado a sessionId", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: testUser, session: testSession }, error: null });
    expect(await confirmInvitation()).toEqual({ ok: true });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "synthetic-invite",
      type: "invite",
    });

    const emittedToken = mocks.cookieSet.mock.calls.find((call) => call[0] === "nexus-password-invite")?.[1];
    const verifiedInvite = await verifyAuthTransitionToken(emittedToken, "invite", {
      userId: testUser.id,
      sessionId: testSession.id,
      email: testUser.email,
    });
    expect(verifiedInvite.valid).toBe(true);

    const verifiedRecovery = await verifyAuthTransitionToken(emittedToken, "recovery", {
      userId: testUser.id,
      sessionId: testSession.id,
      email: testUser.email,
    });
    expect(verifiedRecovery.valid).toBe(false);
  });

  it("sin contexto efímero no consume ni crea sesión", async () => {
    mocks.tokenHash = undefined;
    expect(await confirmInvitation()).toEqual({ ok: false, error: "invalid" });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("rechaza invitación vencida o reutilizada con error sanitizado", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: null, error: new Error("One-time token not found: secret") });
    const result = await confirmInvitation();
    expect(result).toEqual({ ok: false, error: "expired" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
