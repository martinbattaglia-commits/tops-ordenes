import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: {} as Record<string, string | undefined>,
  cookieSet: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (mocks.cookies[name] === undefined ? undefined : { value: mocks.cookies[name] }),
    set: mocks.cookieSet,
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: mocks.getUser,
      getSession: mocks.getSession,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  }),
}));

import { completePasswordReset } from "./actions";
import { createAuthTransitionToken } from "@/lib/supabase/auth-recovery";

const TEST_SECRET = "test-auth-transition-secret-minimum-32-chars-entropy-key";
const user1 = { id: "user-1", email: "despachos-lujan@logisticatops.com" };
const user2 = { id: "user-2", email: "otro@logisticatops.com" };
const session1 = "session-merino-1111";
const session2 = "session-merino-2222";

beforeEach(async () => {
  process.env.AUTH_TRANSITION_SECRET = TEST_SECRET;
  const token = await createAuthTransitionToken({
    purpose: "recovery",
    userId: user1.id,
    sessionId: session1,
    userEmail: user1.email,
  });
  mocks.cookies = { "nexus-password-recovery": token };
  mocks.cookieSet.mockReset();
  mocks.getUser.mockReset();
  mocks.getSession.mockReset();
  mocks.updateUser.mockReset();
  mocks.signOut.mockReset();
  mocks.getUser.mockResolvedValue({ data: { user: user1 }, error: null });
  mocks.getSession.mockResolvedValue({ data: { session: { id: session1, user: user1 } }, error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});

describe("completePasswordReset", () => {
  it("exige token de recovery válido firmado con Web Crypto además de sesión Auth", async () => {
    mocks.cookies = {};
    const result = await completePasswordReset({
      password: "password-segura",
      confirmation: "password-segura",
    });
    expect(result.ok).toBe(false);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("rechaza session swapping entre usuarios (token de user-1 con sesión activa de user-2)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: user2 }, error: null });
    mocks.getSession.mockResolvedValue({ data: { session: { id: "session-user-2", user: user2 } }, error: null });
    const result = await completePasswordReset({
      password: "password-segura",
      confirmation: "password-segura",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no es válida o expiró");
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith(expect.objectContaining({ maxAge: 0 }));
  });

  it("rechaza session swapping del MISMO usuario con distinto session_id", async () => {
    // Mismo usuario user-1 pero session-2 en sesión activa
    mocks.getUser.mockResolvedValue({ data: { user: user1 }, error: null });
    mocks.getSession.mockResolvedValue({ data: { session: { id: session2, user: user1 } }, error: null });

    const result = await completePasswordReset({
      password: "password-segura",
      confirmation: "password-segura",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no es válida o expiró");
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith(expect.objectContaining({ maxAge: 0 }));
  });

  it("acepta una sesión invite firmada con mismo userId y sessionId", async () => {
    const inviteToken = await createAuthTransitionToken({
      purpose: "invite",
      userId: user1.id,
      sessionId: session1,
      userEmail: user1.email,
    });
    mocks.cookies = { "nexus-password-invite": inviteToken };
    const result = await completePasswordReset({
      password: "password-segura",
      confirmation: "password-segura",
    });
    expect(result).toEqual({ ok: true });
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "password-segura" });
  });

  it("rechaza marcadores simultáneos para impedir confusión de propósito", async () => {
    const recToken = await createAuthTransitionToken({
      purpose: "recovery",
      userId: user1.id,
      sessionId: session1,
      userEmail: user1.email,
    });
    const invToken = await createAuthTransitionToken({
      purpose: "invite",
      userId: user1.id,
      sessionId: session1,
      userEmail: user1.email,
    });
    mocks.cookies = {
      "nexus-password-recovery": recToken,
      "nexus-password-invite": invToken,
    };
    const result = await completePasswordReset({
      password: "password-segura",
      confirmation: "password-segura",
    });
    expect(result.ok).toBe(false);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("actualiza, cierra sólo la sesión local y limpia el marcador", async () => {
    const result = await completePasswordReset({
      password: "password-segura",
      confirmation: "password-segura",
    });
    expect(result).toEqual({ ok: true });
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "password-segura" });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "nexus-password-recovery",
        value: "",
        maxAge: 0,
        path: "/auth/reset-password",
      }),
    );
  });

  it("no actualiza con contraseñas distintas", async () => {
    const result = await completePasswordReset({
      password: "password-segura",
      confirmation: "password-diferente",
    });
    expect(result.error).toContain("no coinciden");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("sanitiza el error de política sin devolver detalle del proveedor", async () => {
    mocks.updateUser.mockResolvedValue({ error: new Error("Password policy violated: secret rule") });
    const result = await completePasswordReset({
      password: "password-segura",
      confirmation: "password-segura",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("política de seguridad");
    expect(result.error).not.toContain("secret rule");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("no declara éxito si la contraseña cambió pero falla el logout", async () => {
    mocks.signOut.mockResolvedValue({ error: new Error("network detail") });
    const result = await completePasswordReset({
      password: "password-segura",
      confirmation: "password-segura",
    });
    expect(result.ok).toBe(false);
    expect(result.passwordUpdated).toBe(true);
    expect(result.error).not.toContain("network detail");
    expect(mocks.cookieSet).toHaveBeenCalledWith(expect.objectContaining({ maxAge: 0 }));
  });

  it("R1: POST sin usuario en sesión no ejecuta updateUser y purga cookies", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await completePasswordReset({
      password: "password-segura",
      confirmation: "password-segura",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("venció");
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith(expect.objectContaining({ maxAge: 0 }));
  });

  it("R1: POST sin sessionId en sesión no ejecuta updateUser y purga cookies", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await completePasswordReset({
      password: "password-segura",
      confirmation: "password-segura",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("venció");
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith(expect.objectContaining({ maxAge: 0 }));
  });
});
