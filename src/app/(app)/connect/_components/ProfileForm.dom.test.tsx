/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UserProfile } from "@/lib/profile/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/Icon", () => ({ Icon: () => <span /> }));
vi.mock("@/components/voice/VoiceField", () => ({
  VoiceField: (p: { children?: unknown }) => <div>{p.children as never}</div>,
}));

const setPresenceAction = vi.fn(async () => ({ ok: true as const }));
const updateMyProfileAction = vi.fn(async () => ({ ok: true as const }));
const removeAvatarAction = vi.fn(async () => ({ ok: true as const }));

vi.mock("@/lib/profile/actions", () => ({
  setPresenceAction: (...a: unknown[]) => setPresenceAction(...(a as [])),
  updateMyProfileAction: (...a: unknown[]) => updateMyProfileAction(...(a as [])),
  removeAvatarAction: (...a: unknown[]) => removeAvatarAction(...(a as [])),
}));

import { ProfileForm } from "./ProfileForm";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

const PROFILE: UserProfile = {
  id: "user-1",
  fullName: "Martín Battaglia",
  email: "martin@topslogistica.com",
  role: "admin",
  avatarUrl: "https://ejemplo.com/avatar.jpg",
  initials: "MB",
  presence: "online",
  notifFreq: "instant",
  preferences: { theme: "dark", signature: "Saludos,\nMartín" },
};

describe("ProfileForm (P2)", () => {
  it("renderiza la información del usuario y su avatar", () => {
    act(() => {
      root.render(<ProfileForm profile={PROFILE} />);
    });
    expect(container.textContent).toContain("Martín Battaglia");
    expect(container.textContent).toContain("martin@topslogistica.com");
    expect(container.textContent).toContain("Subir foto");
    expect(container.textContent).toContain("Quitar foto");
  });

  it("al hacer clic en Quitar foto, invoca removeAvatarAction", async () => {
    act(() => {
      root.render(<ProfileForm profile={PROFILE} />);
    });
    const removeBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Quitar foto"),
    )!;
    expect(removeBtn).toBeDefined();

    await act(async () => {
      removeBtn.click();
    });

    expect(removeAvatarAction).toHaveBeenCalled();
  });

  it("permite guardar los cambios con onSave", async () => {
    act(() => {
      root.render(<ProfileForm profile={PROFILE} />);
    });
    const saveBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Guardar"),
    )!;

    await act(async () => {
      saveBtn.click();
    });

    expect(updateMyProfileAction).toHaveBeenCalled();
  });
});
