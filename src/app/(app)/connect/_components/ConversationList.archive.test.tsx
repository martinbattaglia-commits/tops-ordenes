/**
 * @vitest-environment jsdom
 *
 * INC-01 · D-2 y D-3 — el archivado, por RENDER REAL.
 *
 * Par rojo→verde: contra el código previo estas pruebas fallan.
 *   D-2 · el error se pintaba como banner GLOBAL de la vista (una sola línea
 *         arriba de la lista), aunque la variable ya se llamaba `rowError`.
 *   D-3 · el control «Archivar» se ofrecía SIEMPRE habilitado, incluso a quien
 *         el servidor iba a rechazar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot, type Root } from "react-dom/client";

const H = vi.hoisted(() => ({ archivar: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/connect",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/components/Icon", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));
vi.mock("@/lib/connect/adapters/driving/inbox-actions", () => ({
  archiveInboxItemAction: H.archivar,
  listArchivedInboxAction: vi.fn(async () => ({ ok: true, items: [] })),
}));

import { ConversationList } from "./ConversationList";
import { ARCHIVE_BLOCK_MESSAGE } from "@/lib/connect/archive-policy";
import type { InboxItem } from "@/lib/connect/types";

const hilo = (id: string, over: Partial<InboxItem> = {}): InboxItem => ({
  conversationId: id, contextId: "ctx", kind: "whatsapp", title: `Hilo ${id}`,
  slug: null, topic: null, lastMessageAt: "2026-08-19T00:00:00.000Z", lastMessageSeq: 3,
  lastReadSeq: 3, unreadCount: 0, isFavorite: false, mutedUntil: null, archivedAt: null,
  ...over,
});

let host: HTMLDivElement;
let root: Root;

const fila = (id: string) =>
  document.body.querySelector<HTMLElement>(`[data-conversation-id="${id}"]`);
const errorDe = (id: string) =>
  fila(id)?.querySelector<HTMLElement>('[data-testid="archive-error"]') ?? null;
const botonDe = (id: string) =>
  [...(fila(id)?.querySelectorAll("button") ?? [])]
    .find((b) => (b.textContent ?? "").includes("Archivar")) ?? null;

beforeEach(() => {
  H.archivar.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("INC-01/D-2 · el error va anclado a la fila que falló", () => {
  beforeEach(() => {
    H.archivar.mockResolvedValue({ ok: false, message: ARCHIVE_BLOCK_MESSAGE.no_role });
    act(() => {
      root.render(<ConversationList items={[hilo("c-1"), hilo("c-2")]} />);
    });
  });

  it("pinta el error DENTRO de la fila que falló y en ninguna otra", async () => {
    await act(async () => { botonDe("c-1")?.click(); });
    expect(errorDe("c-1")?.textContent).toContain(ARCHIVE_BLOCK_MESSAGE.no_role);
    expect(errorDe("c-2")).toBeNull();
  });

  it("no lo pinta como banner global: el texto aparece una sola vez y dentro de la fila", async () => {
    await act(async () => { botonDe("c-1")?.click(); });
    const conElTexto = [...document.body.querySelectorAll("*")].filter(
      (n) => n.children.length === 0 && (n.textContent ?? "").includes(ARCHIVE_BLOCK_MESSAGE.no_role),
    );
    expect(conElTexto).toHaveLength(1);
    expect(fila("c-1")?.contains(conElTexto[0])).toBe(true);
  });

  it("el error de un hilo no bloquea ni deshabilita la acción de los otros hilos", async () => {
    await act(async () => { botonDe("c-1")?.click(); });
    const otro = botonDe("c-2");
    expect(otro?.getAttribute("aria-disabled")).toBeNull();
    await act(async () => { otro?.click(); });
    expect(H.archivar).toHaveBeenCalledTimes(2);
    expect(H.archivar).toHaveBeenLastCalledWith({ conversationId: "c-2" });
  });

  it("el mensaje de error NO está dentro del enlace: clickearlo no navega al hilo", async () => {
    await act(async () => { botonDe("c-1")?.click(); });
    const p = errorDe("c-1");
    expect(p).not.toBeNull();
    expect(p!.closest("a")).toBeNull();
  });

  it("reintentar limpia el error de esa fila y no toca el de la otra", async () => {
    await act(async () => { botonDe("c-1")?.click(); });
    await act(async () => { botonDe("c-2")?.click(); });
    expect(errorDe("c-1")?.textContent).toContain(ARCHIVE_BLOCK_MESSAGE.no_role);
    H.archivar.mockResolvedValue({ ok: true });
    await act(async () => { botonDe("c-1")?.click(); });
    expect(errorDe("c-1")).toBeNull();
    expect(errorDe("c-2")?.textContent).toContain(ARCHIVE_BLOCK_MESSAGE.no_role);
  });
});

describe("INC-01/D-3 · el control se ofrece alineado al permiso real", () => {
  it("sin permiso: se muestra deshabilitado", () => {
    act(() => {
      root.render(
        <ConversationList
          items={[hilo("c-9", {
            canArchive: false,
            archiveBlockedMessage: ARCHIVE_BLOCK_MESSAGE.no_role,
          })]}
        />,
      );
    });
    const b = botonDe("c-9");
    expect(b?.getAttribute("aria-disabled")).toBe("true");
    expect(b?.className).toContain("cursor-not-allowed");
  });

  // C4 1/2 · HIGH-2: el `title` colgaba de un <span> sin superficie propia envolviendo un
  // <button disabled>. Un control deshabilitado no despacha eventos de mouse ni entra al
  // orden de tabulación, así que la explicación no llegaba ni al mouse, ni al teclado, ni
  // al lector de pantalla: el gate preventivo era MENOS informativo que el mensaje que
  // vino a evitar. Se mide ALCANZABILIDAD, no la presencia de un atributo.
  it("sin permiso: la explicación es alcanzable por mouse, teclado y lector", () => {
    act(() => {
      root.render(
        <ConversationList
          items={[hilo("c-9", {
            canArchive: false,
            archiveBlockedMessage: ARCHIVE_BLOCK_MESSAGE.no_role,
          })]}
        />,
      );
    });
    const b = botonDe("c-9")!;
    // mouse: el tooltip cuelga del propio control, que sigue recibiendo eventos.
    expect(b.getAttribute("title")).toBe(ARCHIVE_BLOCK_MESSAGE.no_role);
    // teclado: no está fuera del orden de tabulación.
    expect(b.hasAttribute("disabled")).toBe(false);
    // lector de pantalla: el motivo está en el árbol de accesibilidad.
    const descId = b.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    const desc = fila("c-9")?.querySelector(`#${descId}`);
    expect(desc?.textContent).toBe(ARCHIVE_BLOCK_MESSAGE.no_role);
  });

  it("sin permiso: clickearlo no dispara la acción del servidor", async () => {
    act(() => {
      root.render(
        <ConversationList
          items={[hilo("c-9", {
            canArchive: false,
            archiveBlockedMessage: ARCHIVE_BLOCK_MESSAGE.entity_task_open,
          })]}
        />,
      );
    });
    await act(async () => { botonDe("c-9")?.click(); });
    expect(H.archivar).not.toHaveBeenCalled();
  });

  it("con permiso: aparece habilitado y archiva", async () => {
    H.archivar.mockResolvedValue({ ok: true });
    act(() => {
      root.render(<ConversationList items={[hilo("c-8", { canArchive: true })]} />);
    });
    const b = botonDe("c-8");
    expect(b?.getAttribute("aria-disabled")).toBeNull();
    await act(async () => { b?.click(); });
    expect(H.archivar).toHaveBeenCalledWith({ conversationId: "c-8" });
  });

  it("sin veredicto del servidor (demo/seeds) no se castiga al usuario: queda habilitado", () => {
    act(() => { root.render(<ConversationList items={[hilo("c-7")]} />); });
    expect(botonDe("c-7")?.getAttribute("aria-disabled")).toBeNull();
  });
});
