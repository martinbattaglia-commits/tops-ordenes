/**
 * @vitest-environment jsdom
 *
 * H-1 · el adjunto SE VE, por RENDER REAL.
 *
 * La afirmación que estas pruebas sostienen es exactamente la que fallaba en
 * producción: un mensaje con archivo tenía que poder ABRIRSE del otro lado.
 * Antes de este componente, el hilo pintaba el texto `📎 foto.png` y nada más
 * —sin imagen, sin enlace, sin descarga—, así que la prueba de que el arreglo
 * existe es que el DOM contenga la imagen o el control de descarga, no que una
 * función devuelva ok.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getUrl = vi.fn();
vi.mock("@/lib/connect/adapters/driving/attachment-actions", () => ({
  getAttachmentUrlAction: (a: unknown) => getUrl(a),
}));
// El reproductor arrastra su propia server action (`server-only`), que en jsdom
// no se puede cargar. Se dobla el módulo, no el componente: el reproductor real
// se ejerce en `ThreadView.dom.test.tsx`.
vi.mock("@/lib/connect/adapters/driving/audio-actions", () => ({
  getAudioUrlAction: async () => ({ ok: false, message: "no usado" }),
}));
vi.mock("@/components/Icon", () => ({ Icon: () => <span /> }));

import { MessageAttachments } from "./MessageAttachments";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getUrl.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const adjunto = (over: Partial<Parameters<typeof MessageAttachments>[0]["attachments"][number]> = {}) => ({
  id: "att-1", fileName: "foto.png", mimeType: "image/png", fileSize: 2048,
  scanStatus: "clean", ...over,
});

async function render(attachments: ReturnType<typeof adjunto>[]) {
  await act(async () => {
    root.render(<MessageAttachments attachments={attachments} />);
  });
}

describe("H-1 · una imagen se previsualiza con la URL firmada", () => {
  it("pide la URL al portón y la pinta en un <img>", async () => {
    getUrl.mockResolvedValue({ ok: true, url: "https://signed.example/foto.png" });
    await render([adjunto()]);

    expect(getUrl).toHaveBeenCalledWith({ attachmentId: "att-1" });
    const img = host.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://signed.example/foto.png");
    // El nombre viaja como texto alternativo: el adjunto se nombra sin ver.
    expect(img!.getAttribute("alt")).toBe("foto.png");
  });

  it("mientras resuelve, dice que está cargando", async () => {
    let liberar: (v: unknown) => void = () => {};
    getUrl.mockReturnValue(new Promise((res) => { liberar = res; }));
    await render([adjunto()]);
    expect(host.textContent).toMatch(/Cargando imagen/i);
    await act(async () => { liberar({ ok: true, url: "https://signed.example/x.png" }); });
  });
});

describe("H-1 · el fallo se muestra CON su causa, no como silencio", () => {
  it("el mensaje del portón y la clase tipada llegan al DOM", async () => {
    getUrl.mockResolvedValue({
      ok: false,
      message: "No tenés acceso a esta conversación o a este canal.",
      cause: { kind: "no_access", stage: "signed_url", sqlstate: "42501" },
    });
    await render([adjunto()]);

    expect(host.textContent).toContain("No tenés acceso a esta conversación o a este canal.");
    // La clase permite que un reporte de soporte diga QUÉ falló.
    expect(host.textContent).toContain("no_access");
    // Y no se muestra una imagen rota en su lugar.
    expect(host.querySelector("img")).toBeNull();
  });
});

describe("H-1 · lo que no se previsualiza, se descarga", () => {
  it("un PDF ofrece descarga con nombre y tamaño, y resuelve la URL al pedirla", async () => {
    getUrl.mockResolvedValue({ ok: true, url: "https://signed.example/remito.pdf" });
    await render([adjunto({
      id: "att-2", fileName: "remito.pdf", mimeType: "application/pdf", fileSize: 1048576,
    })]);

    // Nombre y tamaño, antes de tocar nada.
    expect(host.textContent).toContain("remito.pdf");
    expect(host.textContent).toContain("1 MB");
    // El portón NO se llamó todavía: la descarga es on-demand.
    expect(getUrl).not.toHaveBeenCalled();

    const boton = host.querySelector("button")!;
    await act(async () => { boton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const link = host.querySelector("a[download]") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://signed.example/remito.pdf");
    expect(link!.getAttribute("download")).toBe("remito.pdf");
  });

  it("un adjunto sin verificar NO se previsualiza aunque sea imagen, y lo dice", async () => {
    await render([adjunto({ scanStatus: "pending" })]);
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toMatch(/Sin verificación de contenido/i);
    expect(getUrl).not.toHaveBeenCalled();
  });
});

describe("H-1 · varios adjuntos del mismo mensaje", () => {
  it("los cinco se listan, cada uno con su propia identidad", async () => {
    getUrl.mockResolvedValue({ ok: true, url: "https://signed.example/x" });
    await render([
      adjunto({ id: "a", fileName: "1.png" }),
      adjunto({ id: "b", fileName: "2.png" }),
      adjunto({ id: "c", fileName: "d.pdf", mimeType: "application/pdf" }),
    ]);
    expect(host.querySelectorAll("li")).toHaveLength(3);
    // Cada imagen pidió SU url; el PDF no pidió ninguna.
    expect(getUrl.mock.calls.map((c) => (c[0] as { attachmentId: string }).attachmentId).sort())
      .toEqual(["a", "b"]);
  });
});
