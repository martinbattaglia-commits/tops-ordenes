import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => state.token ? { value: state.token } : undefined }),
}));
vi.mock("@/app/auth/recovery/RecoveryLanding", () => ({ default: () => <div>RECOVERY_ACTION_AVAILABLE</div> }));

import RecoveryConfirmationPage from "@/app/auth/recovery/confirm/page";

beforeEach(() => { state.token = undefined; });

describe("RecoveryConfirmationPage", () => {
  it("una visita directa sin contexto no muestra la acción", () => {
    const html = renderToStaticMarkup(<RecoveryConfirmationPage />);
    expect(html).toContain("inválido");
    expect(html).not.toContain("RECOVERY_ACTION_AVAILABLE");
  });

  it("con token efímero presente renderiza el CTA de confirmación", () => {
    state.token = "synthetic";
    const html = renderToStaticMarkup(<RecoveryConfirmationPage />);
    expect(html).toContain("RECOVERY_ACTION_AVAILABLE");
  });
});
