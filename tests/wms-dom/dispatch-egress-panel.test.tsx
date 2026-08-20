import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, render } from "./_render";

const registerMock = vi.fn();
vi.mock("@/app/(app)/wms/despachos/actions", () => ({
  registerDispatchEgressAction: (...args: unknown[]) => registerMock(...args),
}));

import { DispatchEgressPanel } from "@/app/(app)/wms/despachos/_components/DispatchEgressPanel";

const ORDER = "11111111-1111-4111-8111-111111111111";
const UNIT_A = "22222222-2222-4222-8222-222222222222";
const UNIT_B = "33333333-3333-4333-8333-333333333333";

function units() {
  return [UNIT_A, UNIT_B].map((id, index) => ({
    physicalUnitId: id,
    unitPublicId: `CPU-${index + 1}`,
    sku: `SKU-${index + 1}`,
    caseId: `44444444-4444-4444-8444-44444444444${index}`,
    casePublicId: `CINT-${index + 1}`,
    hasIngressPhoto: true,
    hasEgressPhoto: false,
    blockers: ["Falta foto de egreso"],
    dispatchAllowed: false,
  }));
}

async function setFile(input: HTMLInputElement, name: string): Promise<void> {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([name], name, { type: "image/jpeg" })],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  registerMock.mockReset();
});

describe("uploads de egreso concurrentes", () => {
  it("un doble click de la misma CPU no libera el indicador del primer vuelo", async () => {
    let finish!: (value: unknown) => void;
    registerMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { container, unmount } = await render(
      <DispatchEgressPanel orderId={ORDER} units={units()} allAllowed={false} status="required" />,
    );
    const row = container.querySelector(`[data-unit="CPU-1"]`) as HTMLElement;
    await setFile(row.querySelector("input") as HTMLInputElement, "a.jpg");
    const button = row.querySelector("button[aria-busy]") as HTMLButtonElement;

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(row.querySelector('button[aria-busy="true"]')).not.toBeNull();
    await act(async () => { finish({ ok: true }); });
    expect(row.querySelector('button[aria-busy="true"]')).toBeNull();
    await unmount();
  });

  it("mantiene el estado en vuelo por CPU y no libera B cuando termina A", async () => {
    const resolvers = new Map<string, (value: unknown) => void>();
    registerMock.mockImplementation((...args: unknown[]) => {
      const form = args.find((value) => value && typeof (value as FormData).get === "function") as FormData | undefined;
      if (!form) throw new Error(`FormData de egreso ausente; args=${args.length}:${args.map((value) => typeof value).join(",")}`);
      const unitId = String(form.get("entity_id"));
      return new Promise((resolve) => resolvers.set(unitId, resolve));
    });
    const { container, unmount } = await render(
      <DispatchEgressPanel orderId={ORDER} units={units()} allAllowed={false} status="required" />,
    );
    const rows = [...container.querySelectorAll("[data-unit]")] as HTMLElement[];
    await setFile(rows[0].querySelector("input") as HTMLInputElement, "a.jpg");
    await setFile(rows[1].querySelector("input") as HTMLInputElement, "b.jpg");
    await click(rows[0].querySelector("button[aria-busy]"));
    await click(rows[1].querySelector("button[aria-busy]"));

    expect(registerMock).toHaveBeenCalledTimes(2);
    expect(rows[0].querySelector('button[aria-busy="true"]')).not.toBeNull();
    expect(rows[1].querySelector('button[aria-busy="true"]')).not.toBeNull();

    await act(async () => {
      resolvers.get(UNIT_A)?.({ ok: true });
    });
    expect(rows[0].querySelector('button[aria-busy="true"]')).toBeNull();
    expect(rows[1].querySelector('button[aria-busy="true"]')).not.toBeNull();

    await act(async () => {
      resolvers.get(UNIT_B)?.({ ok: true });
    });
    expect(rows[1].querySelector('button[aria-busy="true"]')).toBeNull();
    await unmount();
  });

  it("no ofrece una captura imposible después de confirmar el despacho", async () => {
    const { container, unmount } = await render(
      <DispatchEgressPanel
        orderId={ORDER}
        units={units()}
        allAllowed={false}
        status="required"
        captureAllowed={false}
      />,
    );

    expect(container.textContent).toContain("primero revertí el despacho");
    expect(container.querySelector("input[type=file]")).toBeNull();
    expect(container.querySelector("[data-slot-form=egreso]")).toBeNull();
    expect(registerMock).not.toHaveBeenCalled();
    await unmount();
  });
});
