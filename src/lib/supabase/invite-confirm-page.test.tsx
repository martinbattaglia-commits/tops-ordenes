import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => state.token ? { value: state.token } : undefined }),
}));
vi.mock("@/app/auth/invite/InviteLanding", () => ({ default: () => <div>INVITE_ACTION_AVAILABLE</div> }));

import InviteConfirmationPage from "@/app/auth/invite/confirm/page";

beforeEach(() => { state.token = undefined; });

describe("InviteConfirmationPage", () => {
  it("una visita directa sin contexto no muestra la acción", () => {
    const html = renderToStaticMarkup(<InviteConfirmationPage />);
    expect(html).toContain("inválido");
    expect(html).not.toContain("INVITE_ACTION_AVAILABLE");
  });

  it("con token efímero presente renderiza el CTA de aceptación", () => {
    state.token = "synthetic";
    const html = renderToStaticMarkup(<InviteConfirmationPage />);
    expect(html).toContain("INVITE_ACTION_AVAILABLE");
  });
});
