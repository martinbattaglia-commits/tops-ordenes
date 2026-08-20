import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, render, type as typeInto } from "./_render";

const attachMock = vi.fn();
const generateMock = vi.fn();
const eventMock = vi.fn();
vi.mock("@/app/(app)/wms/custody/actions", () => ({
  attachEvidenceAction: (...args: unknown[]) => attachMock(...args),
  generatePodAction: (...args: unknown[]) => generateMock(...args),
  registerEventAction: (...args: unknown[]) => eventMock(...args),
}));

import { CustodyShipmentActions } from "@/app/(app)/wms/custody/_components/CustodyShipmentActions";

const SHIPMENT = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  attachMock.mockReset();
  generateMock.mockReset();
  eventMock.mockReset();
});

async function rendered() {
  return render(
    <CustodyShipmentActions
      shipmentId={SHIPMENT}
      podPresent={false}
      revalidate="/wms/despachos/pedido"
      podReadiness="delivered"
    />,
  );
}

describe("mutaciones de evidencia y POD", () => {
  it("conserva el archivo cuando el upload falla", async () => {
    attachMock.mockResolvedValue({ ok: false, error: "falló" });
    const { container, unmount } = await rendered();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["foto"], "entrega.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click([...container.querySelectorAll("button")].find((button) => /Adjuntar/.test(button.textContent ?? "")) ?? null);
    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(input.files?.[0]?.name).toBe("entrega.jpg");
    expect(container.textContent).toContain("falló");
    await unmount();
  });

  it("conserva datos ante error y descarta doble POD durante el await", async () => {
    let finish!: (result: unknown) => void;
    generateMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { container, unmount } = await rendered();
    const receiver = container.querySelector('input[name="receiver_name"]') as HTMLInputElement;
    const document = container.querySelector('input[name="receiver_document"]') as HTMLInputElement;
    await typeInto(receiver, "María Receptora");
    await typeInto(document, "12345678");
    const button = [...container.querySelectorAll("button")].find((node) => /Generar POD/.test(node.textContent ?? "")) as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);

    await act(async () => {
      finish({ ok: false, error: "POD rechazado" });
    });
    expect(receiver.value).toBe("María Receptora");
    expect(document.value).toBe("12345678");
    expect(container.textContent).toContain("POD rechazado");
    await unmount();
  });
});
