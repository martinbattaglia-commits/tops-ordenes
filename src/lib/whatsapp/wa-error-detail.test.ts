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

  it("C4/MEDIUM-2 · el recorte NO parte un carácter multibyte", () => {
    // 498 ASCII + un emoji (2 unidades UTF-16). Un slice por unidades corta el
    // par sustituto a la mitad: queda un high surrogate suelto que el round-trip
    // por UTF-8 vuelve U+FFFD y que PostgreSQL rechaza con 22P02 —«Unicode low
    // surrogate must follow a high surrogate»—. El status no se aplicaría, el
    // evento quedaría sin procesar y volvería el bucle de reproceso: el mismo
    // que este expediente acaba de pagar, reintroducido por el módulo que
    // existe para mejorar la trazabilidad.
    const casi = "x".repeat(498) + "💥" + "relleno posterior";
    const r = extractWaErrorDetail([{ code: 1, error_data: { details: casi } }])!;
    // Ninguna unidad de par sustituto puede quedar suelta en los bordes.
    const ultima = r.charCodeAt(r.length - 1);
    const esAltaSuelta = ultima >= 0xd800 && ultima <= 0xdbff;
    expect(esAltaSuelta).toBe(false);
    // Y el resultado es UTF-8 válido de ida y vuelta, sin U+FFFD inventados.
    const vuelta = new TextDecoder().decode(new TextEncoder().encode(r));
    expect(vuelta).toBe(r);
    expect(r).not.toContain("\uFFFD");
  });

  it("C4/MEDIUM-2 · un texto de puros emojis también respeta el tope sin romperse", () => {
    const emojis = "🎙️".repeat(400);
    const r = extractWaErrorDetail([{ code: 1, error_data: { details: emojis } }])!;
    const vuelta = new TextDecoder().decode(new TextEncoder().encode(r));
    expect(vuelta).toBe(r);
  });

  it("el texto real de Meta pasa entero: no se recorta lo que sirve", () => {
    const r = extractWaErrorDetail([errorReal])!;
    expect(r).toBe(errorReal.error_data.details);
  });
});
