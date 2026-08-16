/**
 * REMEDIACIÓN CONSOLIDADA · DOM REAL del panel de INSPECCIÓN HUMANA.
 *
 * Esta superficie no existía, y su ausencia era el defecto: la evidencia de
 * inspección es condición necesaria para liberar y no había pantalla que la
 * registrara. Se prueba sobre el DOM montado, con clics y archivos reales.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buttonByName, byText, click, render } from "./_render";

const registerMock = vi.fn();
vi.mock("@/app/(app)/wms/custody/actions", () => ({
  registerHumanInspectionAction: (...a: unknown[]) => registerMock(...a),
}));

import { CaseInspectionPanel } from "@/app/(app)/wms/custody/_components/CaseInspectionPanel";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";

const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIPMENT = "11111111-1111-4111-8111-111111111111";

function view(over: Partial<CustodyCaseView> = {}): CustodyCaseView {
  return {
    caseId: CASE_ID,
    state: "REVIEW_REQUIRED",
    stateLabel: "Revisión humana",
    tone: "review",
    version: 3,
    scope: "shipment",
    entityId: SHIPMENT,
    holdLabels: [],
    ai: {
      executed: true,
      verdictLabel: "Coincide con el ingreso",
      confidencePercent: 87,
      informativeOnly: true,
      note: "La IA informa y alerta. La decisión es humana.",
      failureLabel: null,
    },
    identity: {
      clientLabel: "Laboratorio Fénix S.A.",
      clientFromReception: false,
      casePublicId: "CINT-2026-000451",
      unitPublicId: "CPU-2026-000123",
      sku: "MUEBLE-DEMO-01",
      quantity: 1,
      lotNumber: null,
      receptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      receptionPublicId: "REC-2026-0088",
    },
    release: { enabled: false, blockers: [] },
    quarantine: { enabled: true, blockers: [] },
    reevaluation: { enabled: true, required: false, analysis: "current", inFlight: false, blockers: [], reason: null },
    inspection: { enabled: true, blockers: [], eligible: 0 },
    podPdfReady: false,
    podBlocked: true,
    podBlockedReason: "POD y despacho bloqueados hasta registrar la decisión humana",
    decision: null,
    createdAt: "2026-08-08T10:15:00.000Z",
    updatedAt: "2026-08-10T09:42:00.000Z",
    ...over,
  };
}

/** Selecciona un archivo como lo haría el usuario: jsdom no trae DataTransfer. */
async function elegirFoto(container: HTMLElement, nombre = "inspeccion.jpg") {
  const input = container.querySelector("#inspeccion-foto") as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], nombre, { type: "image/jpeg" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  const { act } = await import("react");
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return file;
}

beforeEach(() => {
  registerMock.mockReset();
  registerMock.mockResolvedValue({ ok: true, data: { evidence_id: "e1", event_public_id: "p1" } });
});

describe("registro de la fotografía", () => {
  it("sin archivo elegido el botón está deshabilitado", async () => {
    const { container, unmount } = await render(<CaseInspectionPanel view={view()} />);
    expect(buttonByName(container, /Registrar inspección/)?.disabled).toBe(true);
    await unmount();
  });

  it("con la foto elegida se registra, y el SERVIDOR fija etapa, tipo y soporte", async () => {
    const { container, unmount } = await render(<CaseInspectionPanel view={view()} />);
    await elegirFoto(container);
    await click(buttonByName(container, /Registrar inspección/));

    expect(registerMock).toHaveBeenCalledTimes(1);
    const form = registerMock.mock.calls[0][0] as FormData;
    expect(form.get("scope")).toBe("shipment");
    expect(form.get("entity_id")).toBe(SHIPMENT);
    expect(form.get("file")).toBeInstanceOf(File);
    // El formulario NO puede elegir la semántica: eso lo impone la acción.
    expect(form.get("stage")).toBeNull();
    expect(form.get("event_type")).toBeNull();
    expect(form.get("kind")).toBeNull();
    // Ni actor, ni sesión, ni tenant, ni digest.
    for (const prohibido of ["actor", "session_id", "client_id", "sha256", "chain_head", "verdict"]) {
      expect(form.get(prohibido)).toBeNull();
    }
    await unmount();
  });

  it("tras registrar, dice que hay que volver a evaluar", async () => {
    const { container, unmount } = await render(<CaseInspectionPanel view={view()} />);
    await elegirFoto(container);
    await click(buttonByName(container, /Registrar inspección/));
    expect(byText(container, /volvé a evaluar/i)).not.toBeNull();
    expect(container.querySelector("[data-estado]")?.getAttribute("data-estado")).toBe("registrada");
    await unmount();
  });

  it("doble clic registra UNA sola vez", async () => {
    let liberar!: (v: unknown) => void;
    registerMock.mockImplementation(() => new Promise((res) => { liberar = res; }));
    const { container, unmount } = await render(<CaseInspectionPanel view={view()} />);
    await elegirFoto(container);
    const btn = buttonByName(container, /Registrar inspección/);
    await click(btn);
    await click(btn);
    await click(btn);
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(buttonByName(container, /Registrar inspección/)?.getAttribute("aria-busy")).toBe("true");
    liberar({ ok: true, data: { evidence_id: "e1", event_public_id: "p1" } });
    await unmount();
  });
});

describe("estados de compensación traducidos, sin internals", () => {
  it("reconciliation_required se explica y pide NO repetir la foto", async () => {
    registerMock.mockResolvedValue({ ok: false, error: "reconciliation_required" });
    const { container, unmount } = await render(<CaseInspectionPanel view={view()} />);
    await elegirFoto(container);
    await click(buttonByName(container, /Registrar inspección/));

    const alerta = container.querySelector('[role="alert"]');
    expect(alerta?.textContent).toMatch(/no la vuelvas a sacar/i);
    expect(alerta?.textContent).not.toMatch(/reconciliation_required/);
    await unmount();
  });

  it("cleanup_required invita a reintentar", async () => {
    registerMock.mockResolvedValue({ ok: false, error: "cleanup_required" });
    const { container, unmount } = await render(<CaseInspectionPanel view={view()} />);
    await elegirFoto(container);
    await click(buttonByName(container, /Registrar inspección/));
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/volvé a intentar/i);
    await unmount();
  });

  it("ningún estado filtra bucket, digest, token ni ubicación", async () => {
    registerMock.mockResolvedValue({ ok: false, error: "reconciliation_required" });
    const { container, unmount } = await render(<CaseInspectionPanel view={view()} />);
    await elegirFoto(container);
    await click(buttonByName(container, /Registrar inspección/));
    const html = container.innerHTML;
    expect(html).not.toMatch(/custody-(evidence|pii|pod)/);
    expect(html).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(html).not.toMatch(/token=|storage\/v1|eyJ[A-Za-z0-9_-]{6,}\./);
    await unmount();
  });
});

describe("RBAC, estado del caso y accesibilidad", () => {
  it("sin permiso de captura el botón está deshabilitado y se explica", async () => {
    const { container, unmount } = await render(
      <CaseInspectionPanel
        view={view({
          inspection: {
            enabled: false,
            blockers: ["No tenés permiso para registrar evidencia"],
            eligible: 0,
          },
        })}
      />,
    );
    await elegirFoto(container);
    expect(buttonByName(container, /Registrar inspección/)?.disabled).toBe(true);
    expect(byText(container, /No tenés permiso para registrar evidencia/)).not.toBeNull();
    expect(registerMock).not.toHaveBeenCalled();
    await unmount();
  });

  it("un caso ya decidido no ofrece registrar nada", async () => {
    const { container, unmount } = await render(
      <CaseInspectionPanel
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
    expect(container.querySelector("input")).toBeNull();
    await unmount();
  });

  it("cuando ya hay inspección admisible lo dice, y el panel NO decide", async () => {
    const { container, unmount } = await render(
      <CaseInspectionPanel view={view({ inspection: { enabled: true, blockers: [], eligible: 1 } })} />,
    );
    expect(byText(container, /1 inspección admisible/)).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/Liberar|cuarentena/i);
    await unmount();
  });

  it("el campo está etiquetado, es requerido y sólo acepta imágenes", async () => {
    const { container, unmount } = await render(<CaseInspectionPanel view={view()} />);
    const input = container.querySelector("#inspeccion-foto") as HTMLInputElement;
    expect(input.getAttribute("type")).toBe("file");
    expect(input.getAttribute("accept")).toBe("image/*");
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(container.querySelector('label[for="inspeccion-foto"]')?.textContent)
      .toMatch(/Fotografía de la inspección/);
    const section = container.querySelector("section");
    expect(section?.getAttribute("aria-labelledby")).toBe("inspeccion-title");
    await unmount();
  });
});

describe("los tres estados de la evidencia, que NO son dos", () => {
  it("sin foto: pide sacarla", async () => {
    const { container, unmount } = await render(
      <CaseInspectionPanel view={view({ inspection: { enabled: true, blockers: [], eligible: 0 } })} />,
    );
    expect(byText(container, /Sacá la fotografía/)).not.toBeNull();
    await unmount();
  });

  it("registrada pero con el análisis viejo: NO vuelve a pedir la foto", async () => {
    const { container, unmount } = await render(
      <CaseInspectionPanel
        view={view({
          inspection: { enabled: true, blockers: [], eligible: 0 },
          reevaluation: {
            enabled: true, required: true, analysis: "stale", inFlight: false, blockers: [],
            reason: "La inspección humana agregó un eslabón a la cadena: el análisis quedó desactualizado",
          },
        })}
      />,
    );
    expect(byText(container, /Inspección registrada: volvé a evaluar/)).not.toBeNull();
    expect(byText(container, /Sacá la fotografía/)).toBeNull();
    await unmount();
  });

  it("admitida: lo dice y no pide nada más", async () => {
    const { container, unmount } = await render(
      <CaseInspectionPanel view={view({ inspection: { enabled: true, blockers: [], eligible: 1 } })} />,
    );
    expect(byText(container, /admitida para decidir/)).not.toBeNull();
    expect(byText(container, /Sacá la fotografía/)).toBeNull();
    await unmount();
  });
});
