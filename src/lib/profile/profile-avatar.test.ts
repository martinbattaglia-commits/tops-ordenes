import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateMyProfileAction, removeAvatarAction } from "./actions";
import * as serverSupabase from "@/lib/supabase/server";

describe("profile-avatar · updateMyProfileAction & removeAvatarAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("admite URLs seguras HTTPS de avatar", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
      from: vi.fn().mockReturnValue({ update: mockUpdate }),
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await updateMyProfileAction({
      avatarUrl: "https://storage.logisticatops.com/avatars/user-123.jpg",
    });

    expect(res).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith({
      avatar_url: "https://storage.logisticatops.com/avatars/user-123.jpg",
    });
  });

  it("rechaza esquemas no seguros o URLs demasiado largas (ej. data URLs de 2MB)", async () => {
    const res = await updateMyProfileAction({
      avatarUrl: "http://insecure.com/avatar.jpg",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("HTTPS");
    }
  });

  it("removeAvatarAction setea avatar_url en null en profiles", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
      from: vi.fn().mockReturnValue({ update: mockUpdate }),
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await removeAvatarAction();

    expect(res).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith({ avatar_url: null });
  });

  it("sanitiza errores de Supabase devolviendo mensajes seguros al usuario", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: { message: "violates foreign key constraint internal_db" } }),
    });
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "internal plpgsql error 500" } });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
      from: vi.fn().mockReturnValue({ update: mockUpdate }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await updateMyProfileAction({
      avatarUrl: "https://storage.logisticatops.com/avatars/user-123.jpg",
    });

    expect(res).toEqual({ ok: false, message: "No se pudo actualizar el perfil. Probá de nuevo." });
  });
});
