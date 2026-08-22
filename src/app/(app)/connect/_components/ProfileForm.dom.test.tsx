/**
 * @vitest-environment jsdom
 *
 * Test DOM para ProfileForm (P2).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockUpdateAction = vi.fn().mockResolvedValue({ ok: true });
const mockRemoveAction = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@/lib/profile/actions", () => ({
  updateMyProfileAction: (raw: unknown) => mockUpdateAction(raw),
  removeAvatarAction: () => mockRemoveAction(),
}));

import { ProfileForm } from "./ProfileForm";
import type { UserProfile } from "@/lib/profile/types";

describe("ProfileForm DOM Tests", () => {
  let container: HTMLDivElement;
  let root: Root;

  const sampleProfile: UserProfile = {
    id: "user-123",
    fullName: "Martín Test",
    email: "martin@tops.com",
    role: "admin",
    avatarUrl: null,
    initials: "MT",
    presence: "online",
    notifFreq: "instant",
    preferences: { theme: "dark" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renderiza campos de perfil y fallback de iniciales", async () => {
    await act(async () => {
      root.render(<ProfileForm profile={sampleProfile} />);
    });

    expect(container.textContent).toContain("MT");
    expect(container.querySelector("#presence-select")).not.toBeNull();
    expect(container.querySelector("#notif-select")).not.toBeNull();
    expect(container.querySelector("#theme-select")).not.toBeNull();
  });

  it("permite cambiar presencia y enviar el formulario", async () => {
    const onSaved = vi.fn();
    await act(async () => {
      root.render(<ProfileForm profile={sampleProfile} onSaved={onSaved} />);
    });

    const presenceSelect = container.querySelector("#presence-select") as HTMLSelectElement;
    await act(async () => {
      presenceSelect.value = "busy";
      presenceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    await act(async () => {
      submitBtn.click();
    });

    expect(mockUpdateAction).toHaveBeenCalledWith(expect.objectContaining({
      notifFreq: "instant",
      preferences: expect.objectContaining({ theme: "dark" }),
    }));
  });

  it("permite quitar la foto de perfil invocando removeAvatarAction", async () => {
    const profileWithAvatar = {
      ...sampleProfile,
      avatarUrl: "https://storage.logisticatops.com/avatars/user-123.jpg",
    };
    await act(async () => {
      root.render(<ProfileForm profile={profileWithAvatar} />);
    });

    const removeBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Quitar"),
    );
    expect(removeBtn).toBeDefined();

    await act(async () => {
      removeBtn?.click();
    });

    expect(mockRemoveAction).toHaveBeenCalled();
  });
});
