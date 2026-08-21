import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => state.token ? { value: state.token } : undefined }),
}));
vi.mock("../RecoveryLanding", () => ({ default: () => <div>RECOVERY_ACTION_AVAILABLE</div> }));

import RecoveryConfirmationPage from "./page";

beforeEach(() => { state.token = undefined; });

describe("RecoveryConfirmationPage", () => {
  it("una visita directa sin contexto no muestra la acción", () => {
    const html = renderToStaticMarkup(<RecoveryConfirmationPage />);
    expect(html).toContain("inválido");
    expect(html).not.toContain("RECOVERY_ACTION_AVAILABLE");
  });

  it("un contexto HttpOnly válido habilita la acción humana", () => {
    state.token = "synthetic-recovery";
    const html = renderToStaticMarkup(<RecoveryConfirmationPage />);
    expect(html).toContain("RECOVERY_ACTION_AVAILABLE");
  });
});
