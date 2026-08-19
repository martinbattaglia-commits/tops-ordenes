/**
 * @vitest-environment jsdom
 *
 * HOTFIX-01 · el alta de una OC con PRECIO PENDIENTE, por RENDER REAL del
 * wizard productivo.
 *
 * ─── POR QUÉ ESTA PRUEBA VIVE ACÁ Y NO JUNTO AL COMPONENTE ────────────────
 * `vitest.config.ts` —el config que corre el CI— no colecciona `.test.tsx`
 * bajo `src/app/**\/compras`, y el gate T-C1-05 del expediente de Custodia
 * («los configs vanilla y de unidad no fueron tocados por esta rama») prohíbe
 * a CUALQUIER rama editar ese archivo. Se elige entonces una ruta que el CI ya
 * colecciona (`src/lib/compras/**\/*.test.ts`) y se escribe el árbol con
 * `createElement` en vez de JSX, que es lo único que cambia.
 *
 * Se miden dos cosas sobre el componente que se despliega:
 *
 *  1. que una línea marcada «Pendiente» con su motivo AVANCE de Productos a
 *     Firma y llegue al submit con `price = null` y `subtotal = null` — el
 *     contrato de `wizard-validation.ts`, que este expediente no toca;
 *
 *  2. que NINGÚN alta que no quedó persistida termine en una navegación a la
 *     ficha de la OC. `createPurchaseOrderAction` devuelve, en modo demo, un
 *     `public_id` sintético de una orden que no existe; empujar el router a
 *     `/compras/ordenes/<ese id>` aterriza en el `notFound()` de
 *     `ordenes/[publicId]/page.tsx` — un 404 producido por un guardado que
 *     nunca ocurrió, con el borrador perdido. El aviso va EN el formulario y
 *     lo cargado se conserva.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement, type ReactNode } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot, type Root } from "react-dom/client";

const H = vi.hoisted(() => ({ push: vi.fn(), crear: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: H.push, refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/app/(app)/compras/nueva/actions", () => ({ createPurchaseOrderAction: H.crear }));
vi.mock("@/components/compras/PdfPreview", () => ({ PdfPreview: () => null }));
vi.mock("@/components/voice/VoiceField", () => ({
  VoiceField: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/compras/SignaturePad", () => ({
  SignaturePad: ({ onChange }: { onChange: (hasInk: boolean) => void }) =>
    createElement("button", { type: "button", onClick: () => onChange(true) }, "FIRMAR-DE-PRUEBA"),
}));

import { NewPoWizard } from "@/app/(app)/compras/nueva/NewPoWizard";

const vendors = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    razon: "Proveedor SA",
    cuit: "30123456789",
    domicilio: "Calle 1",
    telefono: "111",
    contacto: "Ana",
    email: "prov@x.com",
    categoria: "Insumos",
    cond_pago: "30 días",
    tags: [],
    active: true,
    created_at: "2026-08-18T12:00:00.000Z",
  },
] as never;

let host: HTMLDivElement;
let root: Root;

function boton(re: RegExp) {
  return Array.from(host.querySelectorAll("button")).find((b) => re.test(b.textContent ?? ""));
}
function escribir(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, valor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Lleva el wizard hasta el submit con UNA línea de precio pendiente y motivo. */
async function emitirOcConPrecioPendiente() {
  await act(async () => {
    root.render(createElement(NewPoWizard, { vendors, products: [] as never }));
  });

  const busqueda = Array.from(host.querySelectorAll("input")).find((i) => i.type === "search")!;
  await act(async () => escribir(busqueda, "Proveedor"));
  await act(async () => { boton(/Proveedor SA/)!.click(); });
  await act(async () => { boton(/Continuar/)!.click(); });
  await act(async () => { boton(/Continuar/)!.click(); });

  const label = Array.from(host.querySelectorAll("input")).find((i) =>
    i.placeholder?.includes("catálogo"),
  )!;
  await act(async () => escribir(label, "Bidón 20L"));

  const motivo = Array.from(host.querySelectorAll("input")).find((i) =>
    i.getAttribute("aria-label")?.startsWith("Motivo de precio"),
  )!;
  await act(async () => escribir(motivo, "No llegó la cotización"));

  await act(async () => { boton(/Continuar/)!.click(); });
  await act(async () => { boton(/FIRMAR-DE-PRUEBA/)!.click(); });
  await act(async () => { boton(/Confirmar, firmar y enviar/)!.click(); });
  await act(async () => { await Promise.resolve(); });
}

const OC_PERSISTIDA = {
  ok: true,
  id: "11111111-1111-4111-8111-111111111111",
  public_id: "OC-2026-0025",
  persisted: true,
};

beforeEach(() => {
  H.push.mockReset();
  H.crear.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

describe("alta de OC con precio pendiente", () => {
  it("avanza hasta el submit con precio y subtotal en NULL", async () => {
    H.crear.mockResolvedValue(OC_PERSISTIDA);
    await emitirOcConPrecioPendiente();

    expect(H.crear).toHaveBeenCalledTimes(1);
    const enviado = H.crear.mock.calls[0][0] as {
      items: Array<{
        price: number | null;
        subtotal: number | null;
        price_state: string;
        price_reason: string | null;
      }>;
    };
    expect(enviado.items).toHaveLength(1);
    expect(enviado.items[0].price_state).toBe("pending");
    expect(enviado.items[0].price).toBeNull();
    expect(enviado.items[0].subtotal).toBeNull();
    expect(enviado.items[0].price_reason).toBe("No llegó la cotización");
  });

  it("navega a la ficha sólo cuando la OC quedó persistida", async () => {
    H.crear.mockResolvedValue(OC_PERSISTIDA);
    await emitirOcConPrecioPendiente();
    expect(H.push).toHaveBeenCalledWith("/compras/ordenes/OC-2026-0025?just_created=1");
  });

  it("un alta NO persistida no deriva en 404: avisa en el formulario y conserva lo cargado", async () => {
    // Exactamente lo que devuelve la rama de demo de `createPurchaseOrderAction`:
    // ok, con un public_id sintético de una orden que no existe en la base.
    H.crear.mockResolvedValue({ ok: true, id: "demo-4821", public_id: "OC-2026-4821", persisted: false });
    await emitirOcConPrecioPendiente();

    expect(H.push).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/modo demostración/i);
    expect(host.textContent).toMatch(/no quedó guardada/i);

    // El borrador sigue vivo: se vuelve a Productos por el stepper y el motivo
    // cargado sigue ahí.
    const pasoProductos = Array.from(host.querySelectorAll("button")).find((b) =>
      /Productos$/.test((b.textContent ?? "").trim()),
    )!;
    expect(pasoProductos, "no se encontró el paso Productos en el stepper").toBeTruthy();
    await act(async () => { pasoProductos.click(); });
    const motivo = Array.from(host.querySelectorAll("input")).find((i) =>
      i.getAttribute("aria-label")?.startsWith("Motivo de precio"),
    );
    expect(motivo?.value).toBe("No llegó la cotización");
  });

  it("una OC emitida con número inesperado NO invita a reintentar", async () => {
    // C4 1/2 · M-1: acá la orden EXISTE, firmada y notificada. Un mensaje que
    // dijera "no quedó guardada, reintentá" produciría una segunda OC y un
    // segundo correo al proveedor.
    H.crear.mockResolvedValue({ ok: true, id: "11111111-1111-4111-8111-111111111111", public_id: "OC-25", persisted: true });
    await emitirOcConPrecioPendiente();

    expect(H.push).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/no la vuelvas a emitir/i);
    expect(host.textContent).not.toMatch(/no quedó guardada/i);
  });

  it("un error de guardado se muestra en el formulario, sin navegar", async () => {
    H.crear.mockResolvedValue({
      ok: false,
      error: "No pudimos emitir la orden de compra de forma atómica. Reintentá en unos minutos.",
    });
    await emitirOcConPrecioPendiente();
    expect(H.push).not.toHaveBeenCalled();
    expect(host.textContent).toContain("No pudimos emitir la orden de compra de forma atómica.");
  });
});
