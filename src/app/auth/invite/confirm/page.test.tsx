import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => state.token ? { value: state.token } : undefined }),
}));
vi.mock("../InviteLanding", () => ({ default: () => <div>INVITE_ACTION_AVAILABLE</div> }));

import InviteConfirmationPage from "./page";

beforeEach(() => { state.token = undefined; });

describe("InviteConfirmationPage", () => {
  it("una visita directa sin contexto no muestra la acción", () => {
    const html = renderToStaticMarkup(<InviteConfirmationPage />);
    expect(html).toContain("inválido");
    expect(html).not.toContain("INVITE_ACTION_AVAILABLE");
  });

  it("un contexto HttpOnly válido habilita la acción invite", () => {
    state.token = "synthetic-invite";
    const html = renderToStaticMarkup(<InviteConfirmationPage />);
    expect(html).toContain("INVITE_ACTION_AVAILABLE");
  });
});
