// El detalle que Meta manda con cada fallo, MEDIDO contra payloads reales.
//
// Caso de producción, textual, recibido el 2026-08-17 y otra vez el 2026-08-19:
//   "Audio file uploaded with mimetype as audio/mp4, however on processing it
//    is of type application/octet-stream. Please choose a different file."
// Ese texto era la causa raíz del incidente y estuvo guardado en
// `wa_inbound_events` los dos días. El sistema conservaba sólo el código 131053
// —genérico— y por eso hicieron falta dos hipótesis erradas y bajar el binario
// de producción para llegar a lo que el proveedor ya había dicho.

import { describe, it, expect } from "vitest";
import { extractWaErrorDetail } from "./wa-error-detail";

const errorReal = {
  code: 131053,
  title: "Media upload error",
  message: "Media upload error",
  error_data: {
    details:
      "Audio file uploaded with mimetype as audio/mp4, however on processing it is of type application/octet-stream. Please choose a different file.",
  },
};

describe("el detalle del proveedor se conserva", () => {
  it("prefiere `error_data.details`, que es lo único específico", () => {
    expect(extractWaErrorDetail([errorReal])).toContain("application/octet-stream");
  });

  it("sin details, cae al título — que al menos distingue una familia de otra", () => {
    expect(extractWaErrorDetail([{ code: 131047, title: "Re-engagement message" }]))
      .toBe("Re-engagement message");
  });

  it("sin details ni título, usa el mensaje", () => {
    expect(extractWaErrorDetail([{ code: 1, message: "algo" }])).toBe("algo");
  });

  it("sin errores no inventa nada", () => {
    expect(extractWaErrorDetail([])).toBeNull();
    expect(extractWaErrorDetail(undefined)).toBeNull();
    expect(extractWaErrorDetail([{ code: 1 }])).toBeNull();
  });

  it("no explota con basura", () => {
    expect(extractWaErrorDetail("no es un arreglo" as never)).toBeNull();
    expect(extractWaErrorDetail([null, 3] as never)).toBeNull();
  });
});

describe("el detalle NO puede convertirse en una fuga", () => {
  it("un teléfono dentro del texto se redacta", () => {
    // La columna es consultable y el evento del que sale contiene datos de un
    // tercero. Que Meta no haya mandado nunca un teléfono acá no es garantía.
    const r = extractWaErrorDetail([{
      code: 1, error_data: { details: "Failed for +5491131079124 at 10:00" },
    }])!;
    expect(r).not.toContain("+5491131079124");
    expect(r).toContain("[tel]");
  });

  it("se recorta: es un diagnóstico, no un volcado", () => {
    const largo = "x".repeat(2000);
    const r = extractWaErrorDetail([{ code: 1, error_data: { details: largo } }])!;
    expect(r.length).toBeLessThanOrEqual(500);
  });

  it("el texto real de Meta pasa entero: no se recorta lo que sirve", () => {
    const r = extractWaErrorDetail([errorReal])!;
    expect(r).toBe(errorReal.error_data.details);
  });
});
