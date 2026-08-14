// Nexus Link · FASE B — el filtro previo del cliente.
//
// Lo que se prueba acá NO es seguridad: la decisión real la toma el servidor
// leyendo la firma binaria. Se prueba que el filtro sea ÚTIL —que ataje lo
// obvio antes de subir 25 MB— y, sobre todo, que sea más PERMISIVO que el
// servidor. Un filtro de cliente más estricto que el servidor rechazaría
// archivos legítimos sin que nadie pueda auditarlo desde el backend.

import { describe, expect, it } from "vitest";
import {
  ACCEPT_ATTR, CLIENT_LIMITS, extensionDe, formatBytes, precheckAttachment, tieneVistaPrevia,
} from "./client-precheck";
import { ATTACHMENT_LIMITS } from "./validate";

const archivo = (name: string, size = 1024) => ({ name, size });

describe("precheckAttachment · ataja lo obvio, sin pretender validar", () => {
  it("acepta las extensiones que el servidor puede aceptar", () => {
    for (const n of ["foto.jpg", "F.JPEG", "captura.png", "logo.webp", "anim.gif",
      "iphone.heic", "iphone.HEIF", "remito.pdf", "carta.docx", "planilla.xlsx", "charla.pptx"]) {
      expect(precheckAttachment(archivo(n)).ok).toBe(true);
    }
  });

  it("rechaza lo que ni vale la pena subir", () => {
    for (const n of ["virus.exe", "script.sh", "pagina.html", "vector.svg", "cosas.zip", "sin-extension"]) {
      expect(precheckAttachment(archivo(n)).ok).toBe(false);
    }
  });

  it("rechaza el archivo vacío y el que supera 25 MB", () => {
    expect(precheckAttachment(archivo("x.pdf", 0)).ok).toBe(false);
    const grande = precheckAttachment(archivo("x.pdf", CLIENT_LIMITS.maxBytes + 1));
    expect(grande.ok).toBe(false);
    if (!grande.ok) expect(grande.message).toMatch(/25 MB/);
  });

  it("aplica el tope propio de imagen sólo a imágenes", () => {
    const img = precheckAttachment(archivo("foto.jpg", CLIENT_LIMITS.maxImageBytes + 1));
    expect(img.ok).toBe(false);
    if (!img.ok) expect(img.message).toMatch(/10 MB/);
    // Un PDF del mismo tamaño pasa: el tope de imagen no le aplica.
    expect(precheckAttachment(archivo("doc.pdf", CLIENT_LIMITS.maxImageBytes + 1)).ok).toBe(true);
  });

  it("sus topes coinciden con los del servidor", () => {
    // Si divergen, el servidor gana; pero divergir en silencio sería un error
    // de mantenimiento y esta aserción lo delata en la corrida.
    expect(CLIENT_LIMITS.maxBytes).toBe(ATTACHMENT_LIMITS.maxBytes);
    expect(CLIENT_LIMITS.maxImageBytes).toBe(ATTACHMENT_LIMITS.maxImageBytes);
  });
});

describe("vista previa", () => {
  it("HEIC no se previsualiza: ningún navegador lo pinta", () => {
    expect(tieneVistaPrevia("iphone.heic", "image/heic")).toBe(false);
    expect(tieneVistaPrevia("iphone.heif", "image/heif")).toBe(false);
  });

  it("las imágenes que el navegador sí pinta llevan miniatura", () => {
    expect(tieneVistaPrevia("foto.jpg", "image/jpeg")).toBe(true);
    expect(tieneVistaPrevia("captura.png", "image/png")).toBe(true);
  });

  it("un documento no lleva miniatura aunque mienta el MIME", () => {
    expect(tieneVistaPrevia("remito.pdf", "image/png")).toBe(false);
  });
});

describe("presentación", () => {
  it("extensionDe devuelve la última, en minúscula", () => {
    expect(extensionDe("Remito Nº 42.PDF")).toBe("pdf");
    expect(extensionDe("factura.pdf.exe")).toBe("exe");
    expect(extensionDe("sinpunto")).toBe("");
  });

  it("formatBytes es legible en las tres escalas", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("el accept del input no ofrece nada que el filtro rechace", () => {
    for (const ext of ACCEPT_ATTR.split(",")) {
      expect(precheckAttachment(archivo(`archivo${ext}`)).ok).toBe(true);
    }
  });
});
