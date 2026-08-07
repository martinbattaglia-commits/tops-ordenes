import { describe, expect, it } from "vitest";
import { parseWaExport } from "./parser";

// LINK-WA-002 F1a · fixtures de los dos formatos reales de export (es-AR).

const IOS = [
  "[26/7/26, 14:30:12] Los mensajes y las llamadas están cifrados de extremo a extremo.",
  "[26/7/26, 14:31:00] Juan Pérez: Hola, ¿tenés stock del pallet 120x100?",
  "[26/7/26, 14:32:05] TOPS Comercial: Sí Juan, tenemos.",
  "Te paso el detalle:",
  "- 120x100 · 300 unidades",
  "[26/7/26, 14:33:10] Juan Pérez: ‎imagen omitida",
  "[26/7/26, 14:35:00] Juan Pérez: Perfecto, mandame cotización",
].join("\n");

const ANDROID = [
  "26/7/26 09:15 - Los mensajes y las llamadas están cifrados de extremo a extremo.",
  "26/7/26 09:16 - María López: Buen día! Necesito retirar mañana",
  "26/7/26 09:17 - TOPS Comercial: Buen día María, ¿a qué hora?",
  "26/07/2026, 2:30 p. m. - María López: A las 14 hs",
  "26/7/26 14:31 - María López: IMG-20260726-WA0001.jpg (archivo adjunto)",
].join("\n");

describe("wa-import/parser · iOS", () => {
  it("parsea mensajes, descarta sistema y multimedia, preserva multilínea", () => {
    const r = parseWaExport(IOS);
    expect(r.messages).toHaveLength(3);
    expect(r.skippedSystem).toBe(1);
    expect(r.skippedMedia).toBe(1);
    expect(r.unparsedLines).toBe(0);
    expect(r.messages[1].text).toContain("Te paso el detalle:");
    expect(r.messages[1].text).toContain("- 120x100 · 300 unidades");
  });
  it("autores con conteo, ordenados por volumen", () => {
    const r = parseWaExport(IOS);
    expect(r.authors).toEqual([
      { name: "Juan Pérez", count: 2 },
      { name: "TOPS Comercial", count: 1 },
    ]);
  });
  it("timestamps ART→UTC correctos y rango first/last", () => {
    const r = parseWaExport(IOS);
    expect(r.messages[0].ts).toBe("2026-07-26T17:31:00.000Z"); // 14:31 ART = 17:31Z
    expect(r.firstTs).toBe(r.messages[0].ts);
    expect(r.lastTs).toBe(r.messages[2].ts);
  });
});

describe("wa-import/parser · Android", () => {
  it("parsea formato con guión, 12h a. m./p. m. y adjuntos", () => {
    const r = parseWaExport(ANDROID);
    expect(r.messages).toHaveLength(3);
    expect(r.skippedSystem).toBe(1);
    expect(r.skippedMedia).toBe(1);
    // "2:30 p. m." → 14:30 ART → 17:30Z
    expect(r.messages[2].ts).toBe("2026-07-26T17:30:00.000Z");
  });
});

describe("wa-import/parser · robustez", () => {
  it("nunca lanza: basura se cuenta como unparsed", () => {
    const r = parseWaExport("esto no es un export\n???\n");
    expect(r.messages).toHaveLength(0);
    expect(r.unparsedLines).toBe(2);
  });
  it("export vacío → resultado vacío coherente", () => {
    const r = parseWaExport("");
    expect(r.messages).toHaveLength(0);
    expect(r.firstTs).toBeNull();
  });
  it("autor con dos puntos en el texto no rompe el split", () => {
    const r = parseWaExport("[1/7/26, 10:00:00] Ana: Total: $1.500.000");
    expect(r.messages[0].author).toBe("Ana");
    expect(r.messages[0].text).toBe("Total: $1.500.000");
  });
});
