import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inviteUserByEmail: vi.fn(),
  profileUpsert: vi.fn(),
  auditInsert: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: () => ({ get: () => "192.0.2.1" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { app: { demoMode: false, url: "https://nexus.logisticatops.com" } } }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "client", rateLimit: () => ({ ok: true }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "admin-1", email: "admin@example.com" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "admin" } }) }) }) }),
  }),
  createAdminClient: () => ({
    auth: { admin: { inviteUserByEmail: mocks.inviteUserByEmail } },
    from: (table: string) => table === "profiles"
      ? { upsert: mocks.profileUpsert }
      : { insert: mocks.auditInsert },
  }),
}));

import { inviteUser } from "./actions";

beforeEach(() => {
  mocks.inviteUserByEmail.mockReset();
  mocks.profileUpsert.mockReset();
  mocks.auditInsert.mockReset();
  mocks.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "invited-1" } }, error: null });
  mocks.profileUpsert.mockResolvedValue({ error: null });
  mocks.auditInsert.mockResolvedValue({ error: null });
});

describe("inviteUser · separación de flujo e invariantes", () => {
  it("preasigna identidad/rol y dirige únicamente a /auth/invite", async () => {
    const result = await inviteUser({ email: "persona@example.com", full_name: "Persona Invitada", role: "supervisor" });
    expect(result).toEqual({ ok: true });
    expect(mocks.inviteUserByEmail).toHaveBeenCalledWith("persona@example.com", {
      data: { full_name: "Persona Invitada", role: "supervisor", invited_by: "admin@example.com" },
      redirectTo: "https://nexus.logisticatops.com/auth/invite",
    });
    expect(mocks.profileUpsert).toHaveBeenCalledWith({
      id: "invited-1",
      email: "persona@example.com",
      full_name: "Persona Invitada",
      role: "supervisor",
    });
  });

  it("un usuario existente o rechazo Auth no altera perfil ni RBAC", async () => {
    mocks.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: new Error("User already registered"),
    });
    const result = await inviteUser({
      email: "existente@example.com",
      full_name: "Usuario Existente",
      role: "admin",
    });
    expect(result.ok).toBe(false);
    expect(mocks.profileUpsert).not.toHaveBeenCalled();
    expect(mocks.auditInsert).not.toHaveBeenCalled();
  });
});
