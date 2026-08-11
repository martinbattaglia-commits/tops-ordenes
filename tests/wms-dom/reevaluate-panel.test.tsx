/**
 * WMS · DOM REAL del panel de re-evaluación.
 *
 * Render efectivo en jsdom y clicks reales: estados, doble clic, mensajes
 * sanitizados y la ausencia de cualquier control que libere o cuarentene.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { buttonByName, byText, click, render } from "./_render";

const reevalMock = vi.fn();
vi.mock("@/app/(app)/wms/custody/actions", () => ({
  reevaluateCustodyCaseAction: (...a: unknown[]) => reevalMock(...a),
}));

import { CaseReevaluatePanel } from "@/app/(app)/wms/custody/_components/CaseReevaluatePanel";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";

const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function view(over: Partial<CustodyCaseView> = {}): CustodyCaseView {
  return {
    caseId: CASE_ID,
    state: "REVIEW_REQUIRED",
    stateLabel: "Revisión humana",
    tone: "review",
    version: 3,
    scope: "shipment",
    entityId: "11111111-1111-4111-8111-111111111111",
    holdLabels: [],
    ai: { executed: true, verdictLabel: "Coincide con el ingreso", confidencePercent: 87, informativeOnly: true, note: "La IA informa y alerta. La decisión es humana.", failureLabel: null },
    referenceThreshold: null,
    release: { enabled: false, blockers: ["La cadena avanzó desde el análisis: volvé a evaluar el caso antes de liberar"] },
    quarantine: { enabled: true, blockers: [] },
    reevaluation: { analysis: "current", inFlight: false,
      enabled: true,
      required: true,
      blockers: [],
      reason: "La inspección humana agregó un eslabón a la cadena: el análisis quedó desactualizado",
    },
    inspection: { enabled: true, blockers: [], eligible: 1 },
    podPdfReady: false,
    podBlocked: true,
    podBlockedReason: "POD y despacho bloqueados hasta registrar la decisión humana",
    decision: null,
    createdAt: "2026-08-08T10:15:00.000Z",
    updatedAt: "2026-08-10T09:42:00.000Z",
    ...over,
  };
}

const estado = (c: HTMLElement) => c.querySelector("[data-estado]")?.getAttribute("data-estado");

beforeEach(() => {
  reevalMock.mockReset();
  reevalMock.mockResolvedValue({ ok: true, data: view({ reevaluation: { analysis: "current", inFlight: false, enabled: true, required: false, blockers: [], reason: null } }) });
});

describe("el botón aparece cuando la cadena avanzó", () => {
  it("muestra el motivo y ofrece «Volver a evaluar»", async () => {
    const { container, unmount } = await render(<CaseReevaluatePanel view={view()} />);
    expect(byText(container, /agregó un eslabón a la cadena/)).not.toBeNull();
    const btn = buttonByName(container, /Volver a evaluar/);
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(false);
    expect(estado(container)).toBe("pendiente");
    await unmount();
  });

  it("sin permiso el botón queda deshabilitado y se explica", async () => {
    const { container, unmount } = await render(
      <CaseReevaluatePanel
        view={view({ reevaluation: { analysis: "current", inFlight: false, enabled: false, required: true, blockers: ["No tenés permiso para decidir"], reason: "x" } })}
      />,
    );
    expect(buttonByName(container, /Volver a evaluar/)?.disabled).toBe(true);
    expect(byText(container, /No tenés permiso para decidir/)).not.toBeNull();
    await unmount();
  });

  it("un caso ya decidido no ofrece re-evaluar", async () => {
    const { container, unmount } = await render(
      <CaseReevaluatePanel
        view={view({
          decision: { kind: "release", label: "Liberado para despacho", decidedAt: "2026-08-10T12:00:00.000Z", actorRole: "admin", reason: "conforme" },
        })}
      />,
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
    await unmount();
  });

  it("NUNCA ofrece liberar ni cuarentenar: la IA no decide", async () => {
    const { container, unmount } = await render(<CaseReevaluatePanel view={view()} />);
    expect(container.textContent).not.toMatch(/Liberar|cuarentena/i);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    await unmount();
  });
});

describe("estados del ciclo", () => {
  it("pendiente → evaluando → evaluado", async () => {
    let terminar!: (v: unknown) => void;
    reevalMock.mockImplementation(() => new Promise((res) => { terminar = res; }));

    const { container, unmount } = await render(<CaseReevaluatePanel view={view()} />);
    await click(buttonByName(container, /Volver a evaluar/));
    expect(estado(container)).toBe("evaluando");
    expect(buttonByName(container, /Volver a evaluar/)?.getAttribute("aria-busy")).toBe("true");
    expect(buttonByName(container, /Volver a evaluar/)?.disabled).toBe(true);

    await click(buttonByName(container, /Volver a evaluar/)); // no debería sumar
    // La resolución dispara un update de estado: va dentro de `act` para no
    // observar el árbol a mitad de un render.
    await act(async () => { terminar({ ok: true, data: view() }); });

    expect(reevalMock).toHaveBeenCalledTimes(1);
    expect(estado(container)).toBe("evaluado");
    await unmount();
  });

  it("un fallo del servidor pasa a `fallo` con mensaje sanitizado", async () => {
    reevalMock.mockResolvedValue({ ok: false, error: "Ya hay una evaluación en curso para este caso" });
    const { container, unmount } = await render(<CaseReevaluatePanel view={view()} />);
    await click(buttonByName(container, /Volver a evaluar/));
    expect(estado(container)).toBe("fallo");
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/evaluación en curso/);
    const html = container.innerHTML;
    expect(html).not.toMatch(/custody-(evidence|pii|pod)|\b[0-9a-f]{64}\b|token=/);
    await unmount();
  });

  it("envía el caseId y la versión que la pantalla vio (CAS)", async () => {
    const { container, unmount } = await render(<CaseReevaluatePanel view={view({ version: 7 })} />);
    await click(buttonByName(container, /Volver a evaluar/));
    expect(reevalMock.mock.calls[0]).toEqual([CASE_ID, 7]);
    await unmount();
  });

  it("doble clic ejecuta la acción UNA sola vez", async () => {
    let terminar!: (v: unknown) => void;
    reevalMock.mockImplementation(() => new Promise((res) => { terminar = res; }));
    const { container, unmount } = await render(<CaseReevaluatePanel view={view()} />);
    const btn = buttonByName(container, /Volver a evaluar/);
    await click(btn); await click(btn); await click(btn);
    expect(reevalMock).toHaveBeenCalledTimes(1);
    await act(async () => { terminar({ ok: true, data: view() }); });
    await unmount();
  });
});

describe("estado del análisis y reserva en vuelo", () => {
  it("un caso SIN análisis ejecutado no dice «al día»", async () => {
    const { container, unmount } = await render(
      <CaseReevaluatePanel
        view={view({
          reevaluation: {
            enabled: true, required: false, analysis: "never",
            inFlight: false, blockers: [], reason: null,
          },
        })}
      />,
    );
    const p = container.querySelector("[data-analisis]");
    expect(p?.getAttribute("data-analisis")).toBe("never");
    expect(p?.textContent).toMatch(/todavía no se ejecutó/i);
    expect(container.textContent).not.toMatch(/al día/i);
    await unmount();
  });

  it("con el análisis vigente sí dice «al día»", async () => {
    const { container, unmount } = await render(
      <CaseReevaluatePanel
        view={view({
          reevaluation: {
            enabled: true, required: false, analysis: "current",
            inFlight: false, blockers: [], reason: null,
          },
        })}
      />,
    );
    expect(container.querySelector("[data-analisis]")?.textContent).toMatch(/al día/i);
    await unmount();
  });

  it("una evaluación EN CURSO deshabilita el botón y lo explica", async () => {
    const { container, unmount } = await render(
      <CaseReevaluatePanel
        view={view({
          reevaluation: {
            enabled: false, required: true, analysis: "stale", inFlight: true,
            blockers: ["Ya hay una evaluación en curso para este caso"],
            reason: "La inspección humana agregó un eslabón a la cadena: el análisis quedó desactualizado",
          },
        })}
      />,
    );
    expect(buttonByName(container, /Volver a evaluar/)?.disabled).toBe(true);
    expect(byText(container, /Ya hay una evaluación en curso/)).not.toBeNull();
    await unmount();
  });
});
