// Nexus Link · FASE B — controles adversariales de validación de adjuntos.
//
// El principio bajo prueba: la extensión y el MIME declarados no deciden nada.
// Decide la firma binaria, y sólo contra una lista blanca.

import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_LIMITS, hasForbiddenExtension, normalizeFileName,
  sniffAttachment, validateAttachment,
} from "./validate";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);
const WEBP = new Uint8Array([0x52,0x49,0x46,0x46, 0,0,0,0, 0x57,0x45,0x42,0x50, ...new Array(8).fill(0)]);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04);
const ELF = bytes(0x7f, 0x45, 0x4c, 0x46);           // ejecutable Linux
const MZ = bytes(0x4d, 0x5a, 0x90, 0x00);            // ejecutable Windows
const SVG = new Uint8Array([...Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\">")]);
const HTML = new Uint8Array([...Buffer.from("<!DOCTYPE html><script>alert(1)</script>")]);

describe("sniffAttachment · sólo lista blanca por firma real", () => {
  it("reconoce las imágenes soportadas", () => {
    expect(sniffAttachment(JPG)?.mime).toBe("image/jpeg");
    expect(sniffAttachment(PNG)?.mime).toBe("image/png");
    expect(sniffAttachment(WEBP)?.mime).toBe("image/webp");
  });

  it("reconoce PDF y contenedores OOXML", () => {
    expect(sniffAttachment(PDF)?.family).toBe("document");
    expect(sniffAttachment(ZIP)?.family).toBe("document");
  });

  it("rechaza ejecutables aunque el nombre diga otra cosa", () => {
    expect(sniffAttachment(ELF)).toBeNull();
    expect(sniffAttachment(MZ)).toBeNull();
  });

  it("rechaza SVG y HTML: son contenido activo, no adjuntos inertes", () => {
    expect(sniffAttachment(SVG)).toBeNull();
    expect(sniffAttachment(HTML)).toBeNull();
  });

  it("rechaza lo demasiado corto para tener firma", () => {
    expect(sniffAttachment(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("validateAttachment · el MIME declarado no decide", () => {
  it("un ejecutable renombrado a .pdf se rechaza por su contenido", () => {
    const r = validateAttachment(MZ, "factura.pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/contenido real/);
  });

  it("un PDF real con nombre .exe se rechaza por el nombre", () => {
    // Doble barrera: la firma es válida, pero el nombre declara un ejecutable.
    const r = validateAttachment(PDF, "informe.exe");
    expect(r.ok).toBe(false);
  });

  it("doble extensión encubierta: factura.pdf.exe se rechaza", () => {
    expect(hasForbiddenExtension("factura.pdf.exe")).toBe(true);
    expect(validateAttachment(PDF, "factura.pdf.exe").ok).toBe(false);
  });

  it("archivo vacío se rechaza", () => {
    const r = validateAttachment(new Uint8Array([]), "x.pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/vac/i);
  });

  it("supera el tope general de 25 MB", () => {
    const grande = new Uint8Array(ATTACHMENT_LIMITS.maxBytes + 1);
    grande.set([0x25, 0x50, 0x44, 0x46]);
    expect(validateAttachment(grande, "x.pdf").ok).toBe(false);
  });

  it("una imagen supera su tope propio de 10 MB aunque no llegue al general", () => {
    const img = new Uint8Array(ATTACHMENT_LIMITS.maxImageBytes + 1);
    img.set([0xff, 0xd8, 0xff, 0xe0]);
    const r = validateAttachment(img, "foto.jpg");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/10 MB/);
  });

  it("acepta lo legítimo y devuelve el nombre normalizado", () => {
    const r = validateAttachment(JPG, "Remito Nº 42.jpg");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sniffed.mime).toBe("image/jpeg");
      expect(r.fileName).toBe("Remito Nº 42.jpg");
    }
  });
});

describe("normalizeFileName · saneo sin depender de él para la ruta", () => {
  it("descarta componentes de ruta y traversal", () => {
    expect(normalizeFileName("../../etc/passwd", "pdf")).toBe("passwd");
    expect(normalizeFileName("C:\\Windows\\system32\\cmd", "pdf")).toBe("cmd");
    expect(normalizeFileName("a/b/c/informe.pdf", "pdf")).toBe("informe.pdf");
  });

  it("colapsa puntos consecutivos y no deja punto inicial", () => {
    expect(normalizeFileName("...oculto.pdf", "pdf")).toBe("oculto.pdf");
    expect(normalizeFileName("raro..nombre.pdf", "pdf")).toBe("raro.nombre.pdf");
  });

  it("reemplaza caracteres extraños y quita control chars", () => {
    expect(normalizeFileName("re\u0000mi\u001fto<>|.pdf", "pdf")).toBe("remito___.pdf");
  });

  it("un nombre vacío o inservible cae en un nombre por defecto", () => {
    expect(normalizeFileName("", "png")).toBe("adjunto.png");
    expect(normalizeFileName("   ", "pdf")).toBe("adjunto.pdf");
    expect(normalizeFileName(null, "jpg")).toBe("adjunto.jpg");
  });

  it("recorta al máximo declarado", () => {
    const largo = "a".repeat(400) + ".pdf";
    expect(normalizeFileName(largo, "pdf").length).toBe(ATTACHMENT_LIMITS.maxFileNameLength);
  });

  it("conserva acentos y ñ: son nombres reales de la operación", () => {
    expect(normalizeFileName("Guía de despacho ñandú.pdf", "pdf")).toBe("Guía de despacho ñandú.pdf");
  });
});
