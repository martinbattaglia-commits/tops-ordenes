/**
 * @vitest-environment jsdom
 *
 * Test DOM de Regresión y Seguridad para ProfileForm (P2 / HIGH 2).
 * Cubre: Presencia instantánea, Firma con VoiceField, Notificaciones, Tema y ciclo de vida de Object URLs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockSetPresenceAction = vi.fn().mockResolvedValue({ ok: true });
const mockUpdateAction = vi.fn().mockResolvedValue({ ok: true });
const mockRemoveAction = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@/lib/profile/actions", () => ({
  setPresenceAction: (raw: unknown) => mockSetPresenceAction(raw),
  updateMyProfileAction: (raw: unknown) => mockUpdateAction(raw),
  removeAvatarAction: () => mockRemoveAction(),
}));

vi.mock("@/components/voice/VoiceField", () => ({
  VoiceField: ({ children }: { children: React.ReactNode }) => <div data-testid="voice-field">{children}</div>,
}));

vi.mock("@/components/Icon", () => ({
  Icon: () => <span data-testid="icon" />,
}));

import { ProfileForm } from "./ProfileForm";
import type { UserProfile } from "@/lib/profile/types";

describe("ProfileForm DOM Regression & Safety Tests", () => {
  let container: HTMLDivElement;
  let root: Root;

  const sampleProfile: UserProfile = {
    id: "user-123",
    fullName: "Martín Battaglia",
    email: "martin@tops.com",
    role: "admin",
    avatarUrl: "https://storage.logisticatops.com/avatars/user-123.jpg",
    initials: "MB",
    presence: "online",
    notifFreq: "instant",
    preferences: { theme: "dark", signature: "Saludos cordiales,\nMartín" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Mock de ObjectURL
    globalThis.URL.createObjectURL = vi.fn(() => "blob:http://localhost/test-blob-uuid");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renderiza todos los componentes de perfil, presencia, firma, notificaciones y tema", async () => {
    await act(async () => {
      root.render(<ProfileForm profile={sampleProfile} />);
    });

    expect(container.textContent).toContain("Martín Battaglia");
    expect(container.textContent).toContain("martin@tops.com");
    expect(container.querySelector("#presence-select")).not.toBeNull();
    expect(container.querySelector("#notif-select")).not.toBeNull();
    expect(container.querySelector("#signature-input")).not.toBeNull();
    expect(container.querySelector("#theme-select")).not.toBeNull();
    expect(container.querySelector('[data-testid="voice-field"]')).not.toBeNull();
  });

  it("actualiza presencia instantáneamente mediante setPresenceAction sin esperar guardar formulario", async () => {
    await act(async () => {
      root.render(<ProfileForm profile={sampleProfile} />);
    });

    const presenceSelect = container.querySelector("#presence-select") as HTMLSelectElement;
    await act(async () => {
      presenceSelect.value = "busy";
      presenceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mockSetPresenceAction).toHaveBeenCalledWith({ status: "busy" });
    expect(container.textContent).toContain("Presencia actualizada.");
  });

  it("guarda firma, tema y notificaciones mediante updateMyProfileAction", async () => {
    const onSaved = vi.fn();
    await act(async () => {
      root.render(<ProfileForm profile={sampleProfile} onSaved={onSaved} />);
    });

    const sigTextarea = container.querySelector("#signature-input") as HTMLTextAreaElement;
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      descriptor?.set?.call(sigTextarea, "Nueva firma corporativa");
      sigTextarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const saveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Guardar"),
    );

    await act(async () => {
      saveBtn?.click();
    });

    expect(mockUpdateAction).toHaveBeenCalledWith(expect.objectContaining({
      notifFreq: "instant",
      preferences: expect.objectContaining({
        signature: "Nueva firma corporativa",
        theme: "dark",
      }),
    }));
  });

  it("maneja ciclo de vida de Object URL: crea preview local y revoca al desmontar", async () => {
    await act(async () => {
      root.render(<ProfileForm profile={sampleProfile} />);
    });

    const fileInput = container.querySelector("#avatar-upload") as HTMLInputElement;
    const dummyFile = new File(["test image bytes"], "avatar.png", { type: "image/png" });

    await act(async () => {
      Object.defineProperty(fileInput, "files", { value: [dummyFile] });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(dummyFile);
    expect(container.textContent).toContain("Vista previa local cargada.");

    // Al desmontar se revoca la URL
    act(() => {
      root.unmount();
    });
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/test-blob-uuid");
  });

  it("quitar foto invoca removeAvatarAction y limpia vista previa", async () => {
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
    expect(container.textContent).toContain("Foto de perfil eliminada.");
  });

  it("muestra errores accesibles con role='alert' y aria-live='assertive'", async () => {
    mockSetPresenceAction.mockResolvedValueOnce({ ok: false, message: "Error al actualizar presencia" });
    await act(async () => {
      root.render(<ProfileForm profile={sampleProfile} />);
    });

    const presenceSelect = container.querySelector("#presence-select") as HTMLSelectElement;
    await act(async () => {
      presenceSelect.value = "busy";
      presenceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const alertEl = container.querySelector('[role="alert"]');
    expect(alertEl).not.toBeNull();
    expect(alertEl?.getAttribute("aria-live")).toBe("assertive");
    expect(alertEl?.textContent).toContain("Error al actualizar presencia");
  });
});
