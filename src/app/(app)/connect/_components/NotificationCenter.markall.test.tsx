/**
 * @vitest-environment jsdom
 *
 * HOTFIX-02 · el control «Marcar todas leídas», por RENDER REAL.
 *
 * La bandeja mezcla dos cosas distintas: avisos persistidos (`notification`) y
 * conversaciones con mensajes sin leer (`conversation`), que son filas
 * DERIVADAS del inbox y no tienen estado propio que la acción pueda escribir.
 * El botón se habilitaba con cualquiera de las dos, así que con sólo
 * conversaciones pendientes prometía una marcación que la base nunca iba a
 * registrar: el operador clickeaba y no cambiaba nada.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot, type Root } from "react-dom/client";

const H = vi.hoisted(() => ({ markAll: vi.fn(async () => ({ ok: true as const, marcadas: 1 })) }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/supabase/realtime", () => ({ useRealtimeTable: () => {} }));
vi.mock("./MemberSearch", () => ({ MemberSearch: () => null }));
vi.mock("@/lib/notifications/actions", () => ({
  markAllNotificationsReadAction: H.markAll,
  markNotificationReadAction: vi.fn(),
  snoozeNotificationAction: vi.fn(),
  delegateNotificationAction: vi.fn(),
  setNotificationPriorityAction: vi.fn(),
}));

import { NotificationCenter } from "./NotificationCenter";
import type { NotificationItem } from "@/lib/notifications/types";

const aviso = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: "n-1", source: "notification", priority: "normal", kind: "system",
  title: "Aviso del sistema", message: null, href: "/connect",
  createdAt: "2026-08-18T12:00:00.000Z", read: false, ...over,
});
const conversacion = (id: string): NotificationItem => ({
  id: `conv:${id}`, source: "conversation", priority: "normal", kind: "message",
  title: "Depósito Magaldi", message: "3 mensajes sin leer", href: `/connect/c/${id}`,
  createdAt: "2026-08-18T12:00:00.000Z", read: false,
});

describe("NotificationCenter · el botón de marcación masiva no promete lo que no puede", () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); H.markAll.mockClear(); });

  const boton = () =>
    Array.from(host.querySelectorAll("button")).find((b) => /Marcar todas leídas/.test(b.textContent ?? ""))!;

  it("queda deshabilitado cuando lo único pendiente son conversaciones", async () => {
    await act(async () => {
      root.render(<NotificationCenter items={[aviso({ read: true }), conversacion("c-1"), conversacion("c-2")]} />);
    });
    const b = boton();
    expect(b).toBeTruthy();
    expect(b.disabled).toBe(true);
    expect(b.title).toMatch(/conversaci/i);
  });

  it("se habilita cuando hay un aviso realmente marcable", async () => {
    await act(async () => {
      root.render(<NotificationCenter items={[aviso(), conversacion("c-1")]} />);
    });
    expect(boton().disabled).toBe(false);
  });

  it("muestra el error visible que devuelve la acción, sin éxito silencioso", async () => {
    H.markAll.mockResolvedValueOnce({ ok: false, message: "No se marcó ninguna notificación como leída. Actualizá la página y volvé a intentarlo." } as never);
    await act(async () => { root.render(<NotificationCenter items={[aviso()]} />); });
    await act(async () => { boton().click(); });
    expect(host.textContent).toContain("No se marcó ninguna notificación como leída.");
  });
});

/**
 * M-N1 · `items` es UNA PÁGINA: `listNotificationCenter()` trae los 50 avisos
 * más recientes. Cuando ninguno de esa página queda pendiente, la pantalla
 * afirmaba «No hay avisos pendientes» — una afirmación sobre TODO el conjunto
 * sacada de una página. Un aviso sin leer más viejo que esos 50 la desmiente.
 */
describe("NotificationCenter · no afirma más de lo que la vista mide", () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  const boton = () =>
    Array.from(host.querySelectorAll("button")).find((b) => /Marcar todas leídas/.test(b.textContent ?? ""))!;

  it("acota a la vista lo que dice cuando la página no tiene pendientes", async () => {
    await act(async () => {
      root.render(<NotificationCenter items={[aviso({ read: true }), conversacion("c-1")]} />);
    });
    expect(boton().title).toMatch(/en esta vista/i);
    expect(boton().title).not.toMatch(/^No hay avisos pendientes\./);
    expect(host.textContent).toMatch(/en esta vista/i);
  });

  it("no arrastra la salvedad cuando sí hay un aviso marcable", async () => {
    await act(async () => { root.render(<NotificationCenter items={[aviso()]} />); });
    expect(boton().title).toMatch(/Marcar leído el aviso pendiente/);
    expect(host.textContent).not.toMatch(/en esta vista/i);
  });
});
