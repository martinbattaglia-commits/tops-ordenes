import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, render, type as typeInto } from "./_render";

const levelMock = vi.fn();
const createMock = vi.fn();
const captureMock = vi.fn();

vi.mock("@/app/(app)/wms/recepciones/actions", () => ({
  custodyClientLevelAction: (...args: unknown[]) => levelMock(...args),
  createReceptionFull: (...args: unknown[]) => createMock(...args),
  createConfirmAndCaptureAction: (...args: unknown[]) => captureMock(...args),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn() }),
}));

import { NewReceptionForm } from "@/app/(app)/wms/recepciones/nueva/NewReceptionForm";

const CLIENT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_B = "22222222-2222-4222-8222-222222222222";

async function selectClient(container: HTMLElement, value: string): Promise<void> {
  const select = container.querySelector("select") as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function fieldControl(
  container: HTMLElement,
  label: RegExp,
  selector: "input" | "select" = "input",
): HTMLInputElement | HTMLSelectElement {
  const wrapper = [...container.querySelectorAll("label")].find((node) =>
    label.test(node.querySelector(":scope > span")?.textContent ?? ""),
  );
  const control = wrapper?.querySelector(selector);
  if (!control) throw new Error(`campo ausente: ${label}`);
  return control as HTMLInputElement | HTMLSelectElement;
}

async function changeSelect(select: HTMLSelectElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function fillValidLine(container: HTMLElement): Promise<void> {
  await typeInto(fieldControl(container, /^SKU \*$/), "SKU-1");
  await typeInto(fieldControl(container, /^Descripción \*$/), "Producto");
  await typeInto(fieldControl(container, /^Cantidad \*$/), "1");
  await changeSelect(fieldControl(container, /^Posición destino \*$/, "select") as HTMLSelectElement, "position");
}

async function setFile(input: HTMLInputElement, file: File): Promise<void> {
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((node) =>
    /Crear recepción|Confirmar recepción|Guardando/.test(node.textContent ?? ""),
  );
  if (!button) throw new Error("botón de recepción ausente");
  return button;
}

beforeEach(() => {
  levelMock.mockReset();
  createMock.mockReset().mockResolvedValue({ ok: true, id: "reception" });
  captureMock.mockReset().mockResolvedValue({ ok: false, error: "no usado" });
  pushMock.mockReset();
});

describe("nivel de custodia visible y fail-closed", () => {
  it("loading y error mantienen submit/checkbox deshabilitados", async () => {
    let resolveLevel!: (value: unknown) => void;
    levelMock.mockImplementation(() => new Promise((resolve) => { resolveLevel = resolve; }));
    const { container, unmount } = await render(
      <NewReceptionForm
        positions={[{ id: "position", full_code: "WH·P1", status: "disponible" }]}
        clients={[{ id: CLIENT_A, razon: "Cliente A" }]}
      />,
    );

    await fillValidLine(container);
    await selectClient(container, CLIENT_A);
    expect(container.textContent).toContain("Verificando el nivel contratado");
    expect(submitButton(container).disabled).toBe(true);
    expect((container.querySelector('[data-custodia="reforzada"]') as HTMLInputElement).disabled).toBe(true);

    await act(async () => { resolveLevel({ ok: false, error: "caído" }); });
    expect(container.textContent).toContain("El ingreso queda bloqueado");
    expect(submitButton(container).disabled).toBe(true);
    expect((container.querySelector('[data-custodia="reforzada"]') as HTMLInputElement).disabled).toBe(true);
    await unmount();
  });

  it("al cambiar de cliente borra sincrónicamente el nivel anterior", async () => {
    let resolveB!: (value: unknown) => void;
    levelMock
      .mockResolvedValueOnce({ ok: true, data: 2 })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
    const { container, unmount } = await render(
      <NewReceptionForm
        positions={[{ id: "position", full_code: "WH·P1", status: "disponible" }]}
        clients={[
          { id: CLIENT_A, razon: "Cliente A" },
          { id: CLIENT_B, razon: "Cliente B" },
        ]}
      />,
    );

    await fillValidLine(container);
    await selectClient(container, CLIENT_A);
    expect(container.textContent).toContain("custodia reforzada contratada");
    expect((container.querySelector('[data-custodia="reforzada"]') as HTMLInputElement).checked).toBe(true);

    await selectClient(container, CLIENT_B);
    expect(container.textContent).toContain("Verificando el nivel contratado");
    expect((container.querySelector('[data-custodia="reforzada"]') as HTMLInputElement).checked).toBe(false);
    expect(submitButton(container).disabled).toBe(true);

    await act(async () => { resolveB({ ok: true, data: 1 }); });
    expect(container.textContent).toContain("no la tiene contratada");
    expect(submitButton(container).disabled).toBe(false);
    await unmount();
  });

  it("una respuesta tardía del cliente anterior no pisa el nivel vigente", async () => {
    let resolveA!: (value: unknown) => void;
    let resolveB!: (value: unknown) => void;
    levelMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
    const { container, unmount } = await render(
      <NewReceptionForm
        positions={[{ id: "position", full_code: "WH·P1", status: "disponible" }]}
        clients={[
          { id: CLIENT_A, razon: "Cliente A" },
          { id: CLIENT_B, razon: "Cliente B" },
        ]}
      />,
    );
    await fillValidLine(container);
    await selectClient(container, CLIENT_A);
    await selectClient(container, CLIENT_B);
    await act(async () => { resolveB({ ok: true, data: 1 }); });
    expect(container.textContent).toContain("no la tiene contratada");
    expect(submitButton(container).disabled).toBe(false);

    await act(async () => { resolveA({ ok: true, data: 2 }); });
    expect(container.textContent).toContain("no la tiene contratada");
    expect(container.textContent).not.toContain("custodia reforzada contratada");
    expect(submitButton(container).disabled).toBe(false);
    await unmount();
  });

  it("N2 marca cada foto como requerida; N1 la conserva opcional", async () => {
    levelMock.mockResolvedValueOnce({ ok: true, data: 2 });
    const n2 = await render(
      <NewReceptionForm
        positions={[{ id: "position", full_code: "WH·P1", status: "disponible" }]}
        clients={[{ id: CLIENT_A, razon: "Cliente A" }]}
      />,
    );
    await selectClient(n2.container, CLIENT_A);
    await fillValidLine(n2.container);
    const n2File = n2.container.querySelector('[data-foto-ingreso="0"]') as HTMLInputElement;
    expect(n2File.required).toBe(true);
    expect(n2File.getAttribute("aria-required")).toBe("true");
    expect(n2.container.textContent).toContain("Obligatoria para nivel 2");
    expect(submitButton(n2.container).disabled).toBe(true);
    await setFile(n2File, new File(["foto"], "n2.png", { type: "image/png" }));
    expect(submitButton(n2.container).disabled).toBe(false);
    await n2.unmount();

    levelMock.mockResolvedValueOnce({ ok: true, data: 1 });
    const n1 = await render(
      <NewReceptionForm
        positions={[{ id: "position", full_code: "WH·P1", status: "disponible" }]}
        clients={[{ id: CLIENT_A, razon: "Cliente A" }]}
      />,
    );
    await selectClient(n1.container, CLIENT_A);
    await fillValidLine(n1.container);
    const n1File = n1.container.querySelector('[data-foto-ingreso="0"]') as HTMLInputElement;
    expect(n1File.required).toBe(false);
    expect(n1.container.textContent).toContain("Opcional para nivel 1");
    expect(submitButton(n1.container).disabled).toBe(false);
    await n1.unmount();
  });

  it("mantiene la foto ligada a su fila al quitar otra línea", async () => {
    levelMock.mockResolvedValue({ ok: true, data: 2 });
    const { container, unmount } = await render(
      <NewReceptionForm
        positions={[{ id: "position", full_code: "WH·P1", status: "disponible" }]}
        clients={[{ id: CLIENT_A, razon: "Cliente A" }]}
      />,
    );
    await selectClient(container, CLIENT_A);
    await click([...container.querySelectorAll("button")].find((button) => /Agregar ítem/.test(button.textContent ?? "")) ?? null);
    const files = [...container.querySelectorAll('[data-foto-ingreso]')] as HTMLInputElement[];
    const first = new File(["a"], "fila-a.png", { type: "image/png" });
    const second = new File(["b"], "fila-b.png", { type: "image/png" });
    await setFile(files[0], first);
    await setFile(files[1], second);

    const firstRow = files[0].closest(".rounded-lg");
    await click(
      [...(firstRow?.querySelectorAll("button") ?? [])].find((button) => /Quitar/.test(button.textContent ?? "")) ?? null,
    );
    const remaining = container.querySelector('[data-foto-ingreso="0"]') as HTMLInputElement;
    expect(remaining.files?.[0]?.name).toBe("fila-b.png");
    expect(remaining.closest(".rounded-lg")?.textContent).toContain("Lista. Se liga a la unidad");
    await unmount();
  });

  it("mantiene el submit deshabilitado durante el await y descarta doble envío", async () => {
    levelMock.mockResolvedValue({ ok: true, data: 2 });
    let finish!: (value: unknown) => void;
    captureMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { container, unmount } = await render(
      <NewReceptionForm
        positions={[{ id: "position", full_code: "WH·P1", status: "disponible" }]}
        clients={[{ id: CLIENT_A, razon: "Cliente A" }]}
      />,
    );
    await fillValidLine(container);
    await selectClient(container, CLIENT_A);
    await setFile(
      container.querySelector('[data-foto-ingreso="0"]') as HTMLInputElement,
      new File(["foto"], "n2.png", { type: "image/png" }),
    );
    const button = submitButton(container);
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(submitButton(container).disabled).toBe(true);
    expect(submitButton(container).textContent).toContain("Guardando");

    await act(async () => {
      finish({
        ok: true,
        data: {
          receptionId: "r",
          units: [{
            physicalUnitId: "33333333-3333-4333-8333-333333333333",
            receptionItemId: "44444444-4444-4444-8444-444444444444",
            unitPublicId: "CPU-2026-0001",
            sku: "SKU-1",
            quantity: 1,
            lotNumber: null,
            custodyLevel: 2,
            caseId: "55555555-5555-4555-8555-555555555555",
            casePublicId: "CINT-2026-0001",
            caseState: "PENDING_EVIDENCE",
            hasIngressPhoto: true,
            qrDataUrl: "data:image/png;base64,AA==",
            qrUrl: "/c/opaque-fixture",
          }],
          fotosPendientes: [],
        },
      });
    });
    const result = container.querySelector('[data-resultado="custodia"]');
    expect(result).not.toBeNull();
    expect(result?.textContent).toContain("CPU-2026-0001");
    expect(result?.textContent).toContain("CINT-2026-0001");
    expect(result?.textContent).toContain("Imprimir");
    expect(result?.querySelector('[data-qr-cpu="33333333-3333-4333-8333-333333333333"] img')).not.toBeNull();
    expect(result?.querySelector('a[href="/wms/custody/55555555-5555-4555-8555-555555555555"]')).not.toBeNull();
    await unmount();
  });
});
