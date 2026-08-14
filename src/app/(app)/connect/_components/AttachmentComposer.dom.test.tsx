/**
 * @vitest-environment jsdom
 *
 * NEXUS LINK · FASE B — `AttachmentComposer` por RENDER REAL.
 *
 * Misma infraestructura que `ThreadView.dom.test.tsx`: React 18.3 con `act` y
 * `react-dom/client`, sin librería de consultas. Las fronteras —server actions
 * y Storage— son dobles; el componente es el productivo.
 *
 * Lo que interesa demostrar no es que se dibujen chips, sino la SEMÁNTICA DE
 * IDENTIDAD del envío, que es donde un error le llega al cliente:
 *
 *   · el MENSAJE se identifica por `client_msg_id`, uno por lote;
 *   · cada SUBIDA por su `storage_path`, uno por archivo;
 *   · cada ADJUNTO por su propia fila.
 *
 * Si esas tres se confundieran, el segundo archivo parecería un replay del
 * primero, o reintentar publicaría un mensaje duplicado que en WhatsApp no se
 * puede retirar.
 *
 * Esta suite cubre la mitad de cliente —qué argumentos salen y en qué orden—.
 * La mitad de servidor —que un `client_msg_id` repetido produzca UN mensaje y
 * que dos subidas distintas cuelguen ambas de él— se demuestra contra
 * PostgreSQL real en `tests/db/t-link-b2-01-upload-lifecycle.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom no implementa ObjectURL; el componente lo usa para las miniaturas.
const revocadas: string[] = [];
URL.createObjectURL = vi.fn(() => `blob:preview-${revocadas.length}`);
URL.revokeObjectURL = vi.fn((u: string) => { revocadas.push(u); });

const prepare = vi.fn();
const finalize = vi.fn();
const subir = vi.fn();

vi.mock("@/lib/connect/adapters/driving/attachment-actions", () => ({
  prepareAttachmentUploadAction: (a: unknown) => prepare(a),
  finalizeAttachmentAction: (a: unknown) => finalize(a),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: subir }) } }),
}));

import { AttachmentComposer } from "./AttachmentComposer";

let host: HTMLDivElement;
let root: Root;

const montar = async (props: Partial<Parameters<typeof AttachmentComposer>[0]> = {}) => {
  await act(async () => {
    root.render(
      <AttachmentComposer conversationId="11111111-1111-4111-8111-111111111111" {...props} />,
    );
  });
};

/** Simula la selección de archivos en el input oculto. */
const elegir = async (...archivos: File[]) => {
  const input = host.querySelector<HTMLInputElement>('[data-testid="attachment-input"]')!;
  Object.defineProperty(input, "files", { value: archivos, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const botonPorTexto = (t: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(t));

const archivo = (name: string, type = "application/pdf", size = 1024) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // Cada `prepare` devuelve un path PROPIO, como hace el servidor: es lo que
  // permite distinguir «segundo archivo» de «replay del primero».
  let n = 0;
  prepare.mockReset().mockImplementation(async () => ({
    ok: true, path: `conv/files/u${++n}`, token: `tok${n}`,
  }));
  finalize.mockReset().mockResolvedValue({
    ok: true, messageId: "m1", attachmentId: "a1", fileName: "remito.pdf",
  });
  subir.mockReset().mockResolvedValue({ error: null });
  revocadas.length = 0;
  vi.spyOn(crypto, "randomUUID");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("selección y presentación", () => {
  it("muestra nombre y tamaño del archivo elegido", async () => {
    await montar();
    await elegir(archivo("remito.pdf", "application/pdf", 2048));
    expect(host.textContent).toContain("remito.pdf");
    expect(host.textContent).toContain("2 KB");
  });

  it("rechaza sin subir lo que el filtro previo no admite", async () => {
    await montar();
    await elegir(archivo("virus.exe", "application/octet-stream"));
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/Sólo se aceptan/);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("una imagen lleva miniatura; un PDF no", async () => {
    await montar();
    await elegir(archivo("foto.jpg", "image/jpeg"));
    expect(host.querySelector("img")).not.toBeNull();
    await act(async () => { botonPorTexto("✕")?.click(); });
    await elegir(archivo("remito.pdf"));
    expect(host.querySelector("img")).toBeNull();
  });

  it("quitar un archivo lo saca de la cola y libera su miniatura", async () => {
    await montar();
    await elegir(archivo("foto.jpg", "image/jpeg"));
    await act(async () => { botonPorTexto("✕")?.click(); });
    expect(host.textContent).not.toContain("foto.jpg");
    expect(revocadas.length).toBe(1);
  });

  it("no admite más archivos que el tope y lo dice", async () => {
    await montar();
    await elegir(...Array.from({ length: 7 }, (_, n) => archivo(`doc${n}.pdf`)));
    expect(host.querySelectorAll("li")).toHaveLength(5);
    expect(host.textContent).toMatch(/hasta 5 archivos/);
  });
});

describe("envío", () => {
  it("sube y finaliza, en ese orden y con el path que dio el servidor", async () => {
    await montar();
    await elegir(archivo("remito.pdf"));
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    expect(prepare).toHaveBeenCalledWith({
      conversationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(subir).toHaveBeenCalledWith("conv/files/u1", "tok1", expect.anything(), expect.anything());
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({
      path: "conv/files/u1", fileName: "remito.pdf",
    }));
  });

  it("el pie viaja SIEMPRE: el servidor lo publica una sola vez", async () => {
    // Mandarlo sólo con el primer archivo perdería el texto si ese archivo
    // fallara. La unicidad la garantiza el get-or-create del servidor, no el
    // cliente omitiéndolo.
    await montar({ caption: "Remito de hoy" });
    await elegir(archivo("a.pdf"), archivo("b.pdf"));
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    const cuerpos = finalize.mock.calls.map((c) => (c[0] as { body: unknown }).body);
    expect(cuerpos).toEqual(["Remito de hoy", "Remito de hoy"]);
  });

  it("un doble clic NO envía dos veces", async () => {
    // El envío queda suspendido para que el segundo clic caiga mientras el
    // primero sigue en vuelo, que es exactamente el caso real.
    let liberar: (v: unknown) => void = () => {};
    subir.mockImplementation(() => new Promise((r) => { liberar = r; }));
    await montar();
    await elegir(archivo("remito.pdf"));
    const boton = botonPorTexto("Enviar")!;
    await act(async () => { boton.click(); boton.click(); });
    await act(async () => { liberar({ error: null }); });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});

describe("fallo y reintento", () => {
  it("un fallo deja el archivo en la cola, con su error y su reintento", async () => {
    finalize.mockResolvedValue({ ok: false, message: "La subida ya no está disponible." });
    await montar();
    await elegir(archivo("remito.pdf"));
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    expect(host.textContent).toContain("remito.pdf");
    expect(host.textContent).toContain("La subida ya no está disponible.");
    expect(botonPorTexto("Reintentar")).toBeDefined();
  });

  it("el REINTENTO conserva el client_msg_id: reintentar no puede duplicar", async () => {
    finalize.mockResolvedValueOnce({ ok: false, message: "Red caída." });
    await montar();
    await elegir(archivo("remito.pdf"));
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    await act(async () => { botonPorTexto("Reintentar")?.click(); });
    expect(finalize).toHaveBeenCalledTimes(2);
    const [uno, dos] = finalize.mock.calls.map((c) => (c[0] as { clientMsgId: string }).clientMsgId);
    expect(uno).toBe(dos);
  });

  it("un fallo de subida no llega a finalizar", async () => {
    subir.mockResolvedValue({ error: { message: "sin conexión" } });
    await montar();
    await elegir(archivo("remito.pdf"));
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    expect(finalize).not.toHaveBeenCalled();
    expect(host.textContent).toContain("sin conexión");
  });

  it("si prepare deniega, no se sube nada", async () => {
    prepare.mockResolvedValue({ ok: false, message: "No tenés acceso a este canal." });
    await montar();
    await elegir(archivo("remito.pdf"));
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    expect(subir).not.toHaveBeenCalled();
    expect(host.textContent).toContain("No tenés acceso a este canal.");
  });
});

// ═══════════════ identidad: mensaje ≠ subida ≠ adjunto ═══════════════════

const idsDeMensaje = () =>
  finalize.mock.calls.map((c) => (c[0] as { clientMsgId: string }).clientMsgId);
const pathsDeSubida = () =>
  finalize.mock.calls.map((c) => (c[0] as { path: string }).path);

describe("un mensaje lógico, varios adjuntos", () => {
  it("los cinco archivos comparten UN client_msg_id y estrenan CINCO subidas", async () => {
    await montar();
    await elegir(...Array.from({ length: 5 }, (_, n) => archivo(`doc${n}.pdf`)));
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    expect(finalize).toHaveBeenCalledTimes(5);
    expect(new Set(idsDeMensaje()).size).toBe(1);   // un mensaje
    expect(new Set(pathsDeSubida()).size).toBe(5);  // cinco subidas
  });

  it("declara el tamaño del lote, para que el mensaje se rotule bien", async () => {
    await montar();
    await elegir(archivo("a.pdf"), archivo("b.pdf"), archivo("c.pdf"));
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    for (const c of finalize.mock.calls) {
      expect((c[0] as { attachmentCount: number }).attachmentCount).toBe(3);
    }
  });

  it("un segundo archivo NO es un replay del primero: mismo mensaje, subida propia", async () => {
    await montar();
    await elegir(archivo("a.pdf"));
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    // Se agrega otro mientras el chip del primero todavía vive ⇒ mismo mensaje.
    await elegir(archivo("b.pdf"));
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    const ids = idsDeMensaje();
    expect(ids[0]).toBe(ids[1]);
    expect(pathsDeSubida()[0]).not.toBe(pathsDeSubida()[1]);
  });

  it("vaciada la cola, el envío siguiente es un mensaje NUEVO", async () => {
    vi.useFakeTimers();
    try {
      await montar();
      await elegir(archivo("a.pdf"));
      await act(async () => { botonPorTexto("Enviar")?.click(); });
      // El chip enviado se retira solo; con la cola vacía se acuña otro lote.
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      await elegir(archivo("b.pdf"));
      await act(async () => { botonPorTexto("Enviar")?.click(); });
      const ids = idsDeMensaje();
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reintentar un adjunto NO estrena mensaje: conserva el client_msg_id del lote", async () => {
    finalize.mockResolvedValueOnce({ ok: false, message: "Red caída." });
    await montar();
    await elegir(archivo("a.pdf"), archivo("b.pdf"));
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    await act(async () => { botonPorTexto("Reintentar")?.click(); });
    expect(new Set(idsDeMensaje()).size).toBe(1);
    // Pero el reintento estrena una SUBIDA nueva: el objeto anterior quedó
    // reclamado y no se puede volver a finalizar sobre él.
    expect(new Set(pathsDeSubida()).size).toBe(finalize.mock.calls.length);
  });

  it("un archivo inválido no publica en silencio: el resto sale y el fallo se ve", async () => {
    finalize.mockImplementation(async (a: unknown) => {
      const arg = a as { fileName: string };
      return arg.fileName === "malo.pdf"
        ? { ok: false, message: "Tipo de archivo no permitido." }
        : { ok: true, messageId: "m1", attachmentId: "a1", fileName: arg.fileName };
    });
    await montar();
    await elegir(archivo("bueno.pdf"), archivo("malo.pdf"));
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    // El bueno viajó…
    expect(finalize).toHaveBeenCalledTimes(2);
    // …y el malo queda a la vista, con su causa y su reintento.
    expect(host.textContent).toContain("malo.pdf");
    expect(host.textContent).toContain("Tipo de archivo no permitido.");
    expect(botonPorTexto("Reintentar")).toBeDefined();
  });

  it("cancelar un archivo no cancela los demás", async () => {
    await montar();
    await elegir(archivo("a.pdf"), archivo("b.pdf"), archivo("c.pdf"));
    const quitar = [...host.querySelectorAll("button")]
      .filter((b) => b.getAttribute("aria-label")?.startsWith("Quitar"));
    await act(async () => { quitar[1].click(); }); // se va b.pdf
    await act(async () => { botonPorTexto("Enviar")?.click(); });
    const enviados = finalize.mock.calls.map((c) => (c[0] as { fileName: string }).fileName);
    expect(enviados).toEqual(["a.pdf", "c.pdf"]);
  });
});
