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
  items: [] as Array<Record<string, unknown>>,
  rpcs: [] as string[],
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: S.push }) }));
vi.mock("@/lib/supabase/realtime", () => ({ useRealtimeTable: () => {} }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    rpc: async (name: string) => { S.rpcs.push(name); return S.respuestaRpc; },
    from: (tabla: string) =>
      tabla === "v_link_notification_badges"
        ? { select: () => ({ maybeSingle: async () => ({ data: S.contadores, error: null }) }) }
        : { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: S.items, error: null }) }) }) }) },
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
  S.items = [];
  S.rpcs.length = 0;
  S.push.mockClear();
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
    expect(host.textContent).toContain("Tu sesión venció. Volvé a iniciar sesión.");
  });

  it("cuando la marcación escribió, recarga y el rojo se apaga", async () => {
    S.respuestaRpc = { data: 3, error: null };
    await montarYAbrir();
    expect(host.textContent).toMatch(/^3/);
    // La base ya quedó sin pendientes: la recarga tiene que traer el cero.
    S.contadores = { red_system_count: 0, green_whatsapp_count: 0, yellow_internal_count: 0 };
    await act(async () => { botonMarcar()!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).not.toMatch(/No se marcó ninguna notificación/i);
    // El badge rojo dejó de renderizarse: `load()` corrió de verdad.
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("con el rojo ya en cero explica que verde y amarillo son mensajes", async () => {
    S.contadores = { red_system_count: 0, green_whatsapp_count: 4, yellow_internal_count: 2 };
    await montarYAbrir();
    expect(botonMarcar()).toBeUndefined();
    expect(host.textContent).toMatch(/se apagan al abrir cada conversación/i);
  });
});

describe("NotificationsBell · abrir registra lectura antes de navegar", () => {
  it("marca el aviso individual, recarga y recién después abre su destino", async () => {
    S.respuestaRpc = { data: null, error: null };
    S.items = [{
      id: "11111111-1111-4111-8111-111111111111",
      kind: "system",
      title: "Aviso pendiente",
      message: "Detalle",
      entity: "order",
      entity_id: "22222222-2222-4222-8222-222222222222",
      is_read: false,
      created_at: "2026-08-20T12:00:00.000Z",
    }];
    await montarYAbrir();
    const link = Array.from(host.querySelectorAll("a"))
      .find((a) => a.textContent?.includes("Aviso pendiente"))!;
    await act(async () => { link.click(); await Promise.resolve(); });
    expect(S.rpcs).toContain("connect_notif_mark_read");
    expect(S.push).toHaveBeenCalledTimes(1);
  });
});
