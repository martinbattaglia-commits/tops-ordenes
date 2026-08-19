/**
 * @vitest-environment jsdom
 *
 * HOTFIX-02 · la campanita tampoco puede fallar en silencio.
 *
 * `markAllRead` invocaba la RPC y descartaba TANTO el error COMO el recuento
 * de filas que devuelve PostgreSQL: si la marcación no escribía nada, el rojo
 * seguía encendido sin una sola palabra para el operador.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot, type Root } from "react-dom/client";

const S = vi.hoisted(() => ({
  respuestaRpc: { data: 0 as number | null, error: null as { message: string } | null },
  contadores: { red_system_count: 3, green_whatsapp_count: 0, yellow_internal_count: 0 },
}));

vi.mock("@/lib/supabase/realtime", () => ({ useRealtimeTable: () => {} }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    rpc: async () => S.respuestaRpc,
    from: (tabla: string) =>
      tabla === "v_link_notification_badges"
        ? { select: () => ({ maybeSingle: async () => ({ data: S.contadores, error: null }) }) }
        : { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) },
  }),
}));

import { NotificationsBell } from "./NotificationsBell";

let host: HTMLDivElement; let root: Root;

async function montarYAbrir() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<NotificationsBell />); });
  await act(async () => { await Promise.resolve(); });
  const campana = host.querySelector("button")!;
  await act(async () => { campana.click(); });
}

const botonMarcar = () =>
  Array.from(host.querySelectorAll("button")).find((b) => /Marcar todas leídas/.test(b.textContent ?? ""));

beforeEach(() => {
  S.respuestaRpc = { data: 0, error: null };
  S.contadores = { red_system_count: 3, green_whatsapp_count: 0, yellow_internal_count: 0 };
});
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });

describe("NotificationsBell · marcación masiva sin éxito silencioso", () => {
  it("avisa cuando la base no marcó ninguna fila", async () => {
    await montarYAbrir();
    await act(async () => { botonMarcar()!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toMatch(/No se marcó ninguna notificación/i);
  });

  it("avisa cuando PostgreSQL devuelve error", async () => {
    S.respuestaRpc = { data: null, error: { message: "sesión no autenticada" } };
    await montarYAbrir();
    await act(async () => { botonMarcar()!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toMatch(/no pudimos marcarlas|sesión/i);
  });

  it("no muestra ningún error cuando la marcación sí escribió", async () => {
    S.respuestaRpc = { data: 3, error: null };
    await montarYAbrir();
    await act(async () => { botonMarcar()!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).not.toMatch(/No se marcó ninguna notificación/i);
  });
});
