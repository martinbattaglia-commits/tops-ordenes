import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  signOut: vi.fn(),
  cookieSet: vi.fn(),
  cookies: {} as Record<string, string>,
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (mocks.cookies[name] ? { value: mocks.cookies[name] } : undefined),
    set: mocks.cookieSet,
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signInWithOtp: mocks.signInWithOtp,
      signOut: mocks.signOut,
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  env: {
    app: { demoMode: false, url: "https://nexus.logisticatops.com" },
  },
}));

import { signIn, sendMagicLink, signOut } from "./actions";

beforeEach(() => {
  mocks.signInWithPassword.mockReset();
  mocks.signInWithOtp.mockReset();
  mocks.signOut.mockReset();
  mocks.cookieSet.mockReset();
  mocks.cookies = {
    "nexus-password-recovery": "recovery-token-val",
    "nexus-password-invite": "invite-token-val",
  };
});

describe("login/actions · R2 y R3 Purga efectiva y sanitización", () => {
  it("1. login normal exitoso del mismo usuario purga marcadores transicionales", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: "u-1" }, session: {} }, error: null });
    const result = await signIn({ email: "despachos-lujan@logisticatops.com", password: "password123" });
    expect(result.ok).toBe(true);
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "nexus-password-recovery",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "nexus-password-invite",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });

  it("2. login normal exitoso de otro usuario purga marcadores transicionales", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: "u-2" }, session: {} }, error: null });
    const result = await signIn({ email: "otro@logisticatops.com", password: "password123" });
    expect(result.ok).toBe(true);
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "nexus-password-recovery",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });

  it("3. login fallido no expone datos internos del proveedor", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: null,
      error: new Error("invalid_grant: invalid login credentials with secret internal trace"),
    });
    const result = await signIn({ email: "despachos-lujan@logisticatops.com", password: "wrong" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Credenciales inválidas");
    expect(result.error).not.toContain("secret internal trace");
    expect(result.error).not.toContain("invalid_grant");
  });

  it("4. magic link fallido sanitiza el error sin exponer internals", async () => {
    mocks.signInWithOtp.mockResolvedValue({
      error: new Error("over_email_send_rate_limit: internal db trace 12345"),
    });
    const result = await sendMagicLink({ email: "despachos-lujan@logisticatops.com" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Demasiados intentos");
    expect(result.error).not.toContain("12345");
  });

  it("5. logout purga marcadores transicionales", async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    await signOut();
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "nexus-password-recovery",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "nexus-password-invite",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });
});
