/**
 * WMS UI/E2E · DOM REAL del panel de decisión.
 *
 * Render efectivo con `react-dom/client` sobre jsdom, clicks reales y
 * aserciones sobre el DOM resultante. Nada de regex sobre el archivo fuente.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buttonByName, byText, click, render, type } from "./_render";

const decideMock = vi.fn();
vi.mock("@/app/(app)/wms/custody/actions", () => ({
  decideCustodyCaseAction: (...args: unknown[]) => decideMock(...args),
}));

import { CaseDecisionPanel } from "@/app/(app)/wms/custody/_components/CaseDecisionPanel";
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
    ai: {
      executed: true,
      verdictLabel: "Coincide con el ingreso",
      confidencePercent: 87,
      informativeOnly: true,
      note: "La IA informa y alerta. La decisión es humana.",
      failureLabel: null,
    },
    referenceThreshold: null,
    release: { enabled: true, blockers: [] },
    quarantine: { enabled: true, blockers: [] },
    reevaluation: { analysis: "current", inFlight: false, enabled: true, required: false, blockers: [], reason: null },
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

beforeEach(() => {
  decideMock.mockReset();
  decideMock.mockResolvedValue({ ok: true, data: view() });
});

describe("motivo obligatorio", () => {
  it("con el motivo vacío ambos botones están deshabilitados en el DOM", async () => {
    const { container, unmount } = await render(<CaseDecisionPanel view={view()} />);
    const liberar = buttonByName(container, /Liberar para despacho/);
    const cuarentena = buttonByName(container, /Enviar a cuarentena/);
    expect(liberar?.disabled).toBe(true);
    expect(cuarentena?.disabled).toBe(true);
    expect(liberar?.getAttribute("aria-disabled")).toBe("true");
    await unmount();
  });

  it("un motivo corto no habilita nada; uno suficiente sí", async () => {
    const { container, unmount } = await render(<CaseDecisionPanel view={view()} />);
    const motivo = container.querySelector("#decision-reason");
    await type(motivo, "corto");
    expect(buttonByName(container, /Liberar/)?.disabled).toBe(true);

    await type(motivo, "inspección física conforme");
    expect(buttonByName(container, /Liberar/)?.disabled).toBe(false);
    await unmount();
  });
});

describe("liberar y cuarentena disparan la acción con el CAS de versión", () => {
  it("liberar envía caseId, versión, decisión y motivo", async () => {
    const { container, unmount } = await render(<CaseDecisionPanel view={view()} />);
    await type(container.querySelector("#decision-reason"), "inspección física conforme");
    await click(buttonByName(container, /Liberar para despacho/));

    expect(decideMock).toHaveBeenCalledTimes(1);
    // EXACTO, no `toMatchObject`: la aserción laxa dejaba pasar un payload al
    // que le faltaban campos, y así fue como la evidencia de inspección se
    // perdió sin que ninguna prueba se enterara. Si aparece o desaparece un
    // campo, esto se rompe.
    expect(decideMock.mock.calls[0][0]).toEqual({
      caseId: CASE_ID,
      expectedVersion: 3,
      decision: "release",
      reason: "inspección física conforme",
      observations: null,
    });
    await unmount();
  });

  it("el navegador NO manda evidencias de inspección: las deriva el servidor", async () => {
    const { container, unmount } = await render(<CaseDecisionPanel view={view()} />);
    await type(container.querySelector("#decision-reason"), "inspección física conforme");
    await click(buttonByName(container, /Liberar para despacho/));

    const payload = decideMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("inspectionEvidenceIds");
    expect(Object.keys(payload).sort()).toEqual(
      ["caseId", "decision", "expectedVersion", "observations", "reason"].sort(),
    );
    await unmount();
  });

  it("cuarentena envía la decisión correcta", async () => {
    const { container, unmount } = await render(<CaseDecisionPanel view={view()} />);
    await type(container.querySelector("#decision-reason"), "diferencias visibles en la esquina");
    await click(buttonByName(container, /Enviar a cuarentena/));
    expect(decideMock.mock.calls[0][0].decision).toBe("quarantine");
    await unmount();
  });
});

describe("doble clic", () => {
  it("dos clicks seguidos ejecutan la acción UNA sola vez", async () => {
    let liberar!: (v: unknown) => void;
    decideMock.mockImplementation(() => new Promise((res) => { liberar = res; }));

    const { container, unmount } = await render(<CaseDecisionPanel view={view()} />);
    await type(container.querySelector("#decision-reason"), "inspección física conforme");
    const btn = buttonByName(container, /Liberar para despacho/);

    await click(btn);           // primer clic: queda en vuelo
    await click(btn);           // doble clic
    await click(btn);           // y un tercero, por las dudas

    expect(decideMock).toHaveBeenCalledTimes(1);

    liberar({ ok: true, data: view() });
    await unmount();
  });

  it("mientras la acción está en vuelo el botón queda deshabilitado", async () => {
    decideMock.mockImplementation(() => new Promise(() => {}));
    const { container, unmount } = await render(<CaseDecisionPanel view={view()} />);
    await type(container.querySelector("#decision-reason"), "inspección física conforme");
    await click(buttonByName(container, /Liberar para despacho/));
    expect(buttonByName(container, /Liberar para despacho/)?.disabled).toBe(true);
    await unmount();
  });
});

describe("RBAC y errores sanitizados", () => {
  it("sin permiso de liberación el botón está deshabilitado y se explica por qué", async () => {
    const { container, unmount } = await render(
      <CaseDecisionPanel
        view={view({
          release: { enabled: false, blockers: ["La liberación está reservada a Dirección (admin)"] },
        })}
      />,
    );
    await type(container.querySelector("#decision-reason"), "inspección física conforme");
    expect(buttonByName(container, /Liberar para despacho/)?.disabled).toBe(true);
    expect(byText(container, /reservada a Dirección/)).not.toBeNull();
    // Cuarentena sigue disponible para el rol operativo.
    expect(buttonByName(container, /Enviar a cuarentena/)?.disabled).toBe(false);
    await unmount();
  });

  it("un error del servidor se muestra con role=alert y sin internals", async () => {
    decideMock.mockResolvedValue({ ok: false, error: "Otra persona decidió primero: recargá el caso" });
    const { container, unmount } = await render(<CaseDecisionPanel view={view()} />);
    await type(container.querySelector("#decision-reason"), "inspección física conforme");
    await click(buttonByName(container, /Liberar para despacho/));

    const alerta = container.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain("Otra persona decidió primero");
    const html = container.innerHTML;
    expect(html).not.toMatch(/custody-(evidence|pii|pod)/);
    expect(html).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(html).not.toMatch(/token=|storage\/v1|eyJ[A-Za-z0-9_-]{6,}\./);
    await unmount();
  });

  it("un caso ya decidido muestra la decisión y NO ofrece botones", async () => {
    const { container, unmount } = await render(
      <CaseDecisionPanel
        view={view({
          state: "RELEASED",
          decision: {
            kind: "release",
            label: "Liberado para despacho",
            decidedAt: "2026-08-10T12:00:00.000Z",
            actorRole: "admin",
            reason: "inspección conforme",
          },
        })}
      />,
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(byText(container, /Liberado para despacho/)).not.toBeNull();
    await unmount();
  });
});

describe("accesibilidad", () => {
  it("la sección tiene nombre accesible y el motivo está etiquetado y es requerido", async () => {
    const { container, unmount } = await render(<CaseDecisionPanel view={view()} />);
    const section = container.querySelector("section");
    const labelledBy = section?.getAttribute("aria-labelledby");
    expect(labelledBy).toBe("decision-title");
    expect(container.querySelector(`#${labelledBy}`)?.textContent).toMatch(/Decisión del inspector/);

    const motivo = container.querySelector("#decision-reason") as HTMLTextAreaElement;
    expect(motivo.getAttribute("aria-required")).toBe("true");
    expect(container.querySelector('label[for="decision-reason"]')?.textContent).toMatch(/Motivo/);
    expect(container.querySelector(`#${motivo.getAttribute("aria-describedby")}`)?.textContent)
      .toMatch(/mínimo 10 caracteres/);
    await unmount();
  });
});
