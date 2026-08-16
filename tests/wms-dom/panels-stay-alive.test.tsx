/**
 * S1-3 · LOS BOTONES QUE MORÍAN.
 *
 * Tres paneles ponían su estado en «ocupado» ANTES de llamar al guard de un
 * solo vuelo y hacían `if (!res) return;` sin restaurarlo. Cuando el guard
 * descarta una segunda pulsación devuelve `null`, y ese `return` temprano
 * dejaba el panel ocupado PARA SIEMPRE: el botón quedaba muerto y la única
 * salida era recargar la página.
 *
 *   · `PhysicalCapturePanel` — el `finally` limpiaba `enCurso`, no `estado`
 *   · `CaseInspectionPanel`  — sin `finally`
 *   · `CaseReevaluatePanel`  — sin `finally`
 *
 * `CaseDecisionPanel` lo hacía bien con `finally { setSubmitting(false) }`. Ese
 * es el patrón que se copió (I6), no uno nuevo.
 *
 * La prueba del mandato es literal: dos pulsaciones seguidas y el botón sigue
 * vivo. Sin el `finally`, la segunda pulsación lo apaga y no vuelve.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buttonByName, click, render } from "./_render";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";

const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UNIT = "11111111-1111-4111-8111-111111111111";

const ingresoMock = vi.fn();
const egresoMock = vi.fn();
const inspeccionMock = vi.fn();
const reevaluarMock = vi.fn();

vi.mock("@/app/(app)/wms/custody/actions", () => ({
  registerPhysicalIngressAction: (...a: unknown[]) => ingresoMock(...a),
  registerPhysicalEgressAction: (...a: unknown[]) => egresoMock(...a),
  registerHumanInspectionAction: (...a: unknown[]) => inspeccionMock(...a),
  reevaluateCustodyCaseAction: (...a: unknown[]) => reevaluarMock(...a),
}));

import { PhysicalCapturePanel } from "@/app/(app)/wms/custody/_components/PhysicalCapturePanel";
import { CaseInspectionPanel } from "@/app/(app)/wms/custody/_components/CaseInspectionPanel";
import { CaseReevaluatePanel } from "@/app/(app)/wms/custody/_components/CaseReevaluatePanel";

function view(over: Partial<CustodyCaseView> = {}): CustodyCaseView {
  return {
    caseId: CASE_ID,
    state: "REVIEW_REQUIRED",
    stateLabel: "Revisión humana",
    tone: "review",
    version: 3,
    scope: "physical_unit",
    entityId: UNIT,
    identity: {
      clientLabel: "Laboratorio Fénix S.A.",
      clientFromReception: false,
      casePublicId: "CINT-2026-000451",
      unitPublicId: "CPU-2026-000123",
      sku: "MUEBLE-DEMO-01",
      quantity: 1,
      lotNumber: null,
      receptionId: null,
      receptionPublicId: null,
    },
    holdLabels: [],
    ai: {
      executed: true,
      verdictLabel: "Coincide con el ingreso",
      confidencePercent: 87,
      informativeOnly: true,
      note: "La IA informa y alerta. La decisión es humana.",
      failureLabel: null,
    },
    release: { enabled: false, blockers: [] },
    quarantine: { enabled: true, blockers: [] },
    reevaluation: {
      analysis: "current", inFlight: false, enabled: true,
      required: false, blockers: [], reason: null,
    },
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

/** Elige un archivo en el input indicado, como haría el operario. */
async function elegirArchivo(container: HTMLElement, id: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`input ${id} inexistente`);
  const file = new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  const { act } = await import("react");
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  // La acción resuelve OK. Lo que se ejercita es el guard de un solo vuelo:
  // la SEGUNDA pulsación se descarta y devuelve `null` al llamador.
  const ok = { ok: true as const, data: { evidence_id: "e", event_public_id: "p" } };
  ingresoMock.mockReset().mockResolvedValue(ok);
  egresoMock.mockReset().mockResolvedValue(ok);
  inspeccionMock.mockReset().mockResolvedValue(ok);
  reevaluarMock.mockReset().mockResolvedValue({ ok: true, data: view() });
});

describe("S1-3 · el panel de captura física sobrevive al doble clic", () => {
  it("dos pulsaciones seguidas y el botón de ingreso sigue vivo", async () => {
    const { container, unmount } = await render(
      <PhysicalCapturePanel view={view()} tieneIngreso={false} tieneEgreso={false} />,
    );
    await elegirArchivo(container, "captura-foto-ingreso");
    const btn = buttonByName(container, /Registrar ingreso/) as HTMLButtonElement;

    await click(btn);
    await click(btn); // el guard descarta ésta y devuelve null

    const vivo = buttonByName(container, /Registrar ingreso/) as HTMLButtonElement;
    // El slot ya se registró, así que el botón queda deshabilitado por HABERSE
    // registrado, no por quedar colgado en «subiendo». Lo que se afirma es que
    // el panel salió del estado ocupado.
    expect(container.querySelector("[data-estado]")?.getAttribute("data-estado"))
      .not.toBe("subiendo");
    expect(vivo.getAttribute("aria-busy")).not.toBe("true");
    await unmount();
  });
});

describe("S1-3 · el panel de inspección sobrevive al doble clic", () => {
  it("dos pulsaciones seguidas y el botón sigue vivo", async () => {
    const { container, unmount } = await render(<CaseInspectionPanel view={view()} />);
    await elegirArchivo(container, "inspeccion-foto");
    const btn = buttonByName(container, /Registrar inspección/) as HTMLButtonElement;

    await click(btn);
    await click(btn);

    expect(container.querySelector("[data-estado]")?.getAttribute("data-estado"))
      .not.toBe("subiendo");
    await unmount();
  });
});

describe("S1-3 · el panel de re-evaluación sobrevive al doble clic", () => {
  it("dos pulsaciones seguidas y el botón sigue habilitado", async () => {
    const { container, unmount } = await render(<CaseReevaluatePanel view={view()} />);
    const btn = buttonByName(container, /Volver a evaluar/) as HTMLButtonElement;

    await click(btn);
    await click(btn);

    const vivo = buttonByName(container, /Volver a evaluar/) as HTMLButtonElement;
    // Éste es el caso más claro: nada cambió el estado del caso, así que el
    // botón TIENE que volver a estar disponible. Sin el `finally` quedaba
    // deshabilitado para siempre.
    expect(vivo.hasAttribute("disabled")).toBe(false);
    expect(container.querySelector("[data-estado]")?.getAttribute("data-estado"))
      .not.toBe("evaluando");
    await unmount();
  });
});

describe("S1-3 · una pulsación DESCARTADA no deja el panel ocupado", () => {
  it("el clic que el guard descarta no strandea el panel de re-evaluación", async () => {
    // El guard sólo descarta llamadas CONCURRENTES, así que hay que dejar la
    // primera en vuelo de verdad: con un `await` secuencial la segunda no se
    // descarta nunca y el camino `if (!res) return;` no se ejercita.
    let resolver: ((v: unknown) => void) | null = null;
    reevaluarMock.mockReset().mockImplementation(
      () => new Promise((r) => { resolver = r as (v: unknown) => void; }),
    );

    const { container, unmount } = await render(<CaseReevaluatePanel view={view()} />);
    const btn = buttonByName(container, /Volver a evaluar/) as HTMLButtonElement;

    const { act } = await import("react");
    // Dos pulsaciones SIN esperar la primera: la segunda entra con la clave en
    // vuelo y el guard la descarta devolviendo `undefined`.
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    // La primera termina y libera la clave.
    await act(async () => {
      resolver?.({ ok: true, data: view() });
    });

    expect(reevaluarMock).toHaveBeenCalledTimes(1);
    const vivo = buttonByName(container, /Volver a evaluar/) as HTMLButtonElement;
    expect(container.querySelector("[data-estado]")?.getAttribute("data-estado"))
      .not.toBe("evaluando");
    expect(vivo.hasAttribute("disabled")).toBe(false);
    await unmount();
  });
});

describe("S1-3 · la habilitación de captura es una CONJUNCIÓN con el permiso", () => {
  it("sin permiso de captura NO se puede capturar, aunque falten las dos fotos", async () => {
    // Éste es el defecto exacto: con `||`, la ausencia de foto habilitaba el
    // panel y el permiso NUNCA llegaba a evaluarse.
    const sinPermiso = view({
      inspection: { enabled: false, blockers: ["No tenés permiso para registrar evidencia"], eligible: 0 },
    });
    const { container, unmount } = await render(
      <PhysicalCapturePanel view={sinPermiso} tieneIngreso={false} tieneEgreso={false} />,
    );
    const btn = buttonByName(container, /Registrar ingreso/) as HTMLButtonElement;
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(container.textContent).toMatch(/No tenés permiso para registrar evidencia/);
    await unmount();
  });

  it("con permiso y el slot vacío SÍ se puede, y el slot lleno se apaga solo", async () => {
    const { container, unmount } = await render(
      <PhysicalCapturePanel view={view()} tieneIngreso={true} tieneEgreso={false} />,
    );
    // Ingreso ya registrado → su botón se apaga y DICE POR QUÉ (§7.5).
    expect((buttonByName(container, /Registrar ingreso/) as HTMLButtonElement).hasAttribute("disabled")).toBe(true);
    expect(container.textContent).toMatch(/Ya está registrada/);
    // Egreso pendiente → su input sigue habilitado.
    const inputEgreso = container.querySelector<HTMLInputElement>("#captura-foto-egreso");
    expect(inputEgreso?.hasAttribute("disabled")).toBe(false);
    await unmount();
  });

  it("hay UN input por slot: registrar el ingreso como egreso es imposible (§7.5)", async () => {
    const { container, unmount } = await render(
      <PhysicalCapturePanel view={view()} tieneIngreso={false} tieneEgreso={false} />,
    );
    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs).toHaveLength(2);
    expect(container.querySelector("#captura-foto-ingreso")).not.toBeNull();
    expect(container.querySelector("#captura-foto-egreso")).not.toBeNull();
    await unmount();
  });
});
