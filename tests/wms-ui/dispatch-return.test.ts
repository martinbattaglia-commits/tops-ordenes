import { describe, expect, it } from "vitest";
import { custodyDispatchReturn } from "@/lib/custody/dispatch-return";

const ORDER = "a1111111-1111-4111-8111-111111111111";

describe("retorno CINT -> despacho", () => {
  it("acepta exclusivamente el UUID canónico y construye la ruta internamente", () => {
    expect(custodyDispatchReturn(ORDER)).toEqual({
      orderId: ORDER,
      href: `/wms/despachos/${ORDER}`,
      label: "Volver al despacho",
    });
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    `/wms/despachos/${ORDER}`,
    `${ORDER}\n`,
    ORDER.toUpperCase(),
    "../despachos",
    "",
    null,
    undefined,
  ])("rechaza URL/path/valor no canónico %#", (value) => {
    expect(custodyDispatchReturn(value)).toEqual({
      orderId: null,
      href: "/wms/custody",
      label: "Volver a Custodia",
    });
  });
});
