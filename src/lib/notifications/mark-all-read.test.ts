/**
 * HOTFIX-02 · «Marcar todas como leídas» no puede declarar éxito sin conocer
 * las FILAS AFECTADAS en la base.
 *
 * `connect_notif_mark_all_read` devuelve `integer`: la cantidad de avisos que
 * realmente quedaron leídos. La acción descartaba ese número y respondía
 * `{ ok: true }` aunque hubiera marcado CERO — un éxito silencioso que el
 * operador leía como "el botón no hace nada".
 *
 * Estas pruebas miden el contrato contra el valor que devuelve PostgreSQL, no
 * contra el estado de la UI.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(async () => ({ data: { user: { id: "u-1" } } })),
  hayCliente: true,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => (H.hayCliente ? { rpc: H.rpc, auth: { getUser: H.getUser } } : null),
}));

import { markAllNotificationsReadAction } from "./actions";

describe("markAllNotificationsReadAction · filas afectadas en base", () => {
  beforeEach(() => {
    H.rpc.mockReset();
    H.hayCliente = true;
  });

  it("informa cuántas notificaciones quedaron leídas", async () => {
    H.rpc.mockResolvedValue({ data: 27, error: null });
    const r = await markAllNotificationsReadAction();
    expect(r).toEqual({ ok: true, marcadas: 27 });
    expect(H.rpc).toHaveBeenCalledWith("connect_notif_mark_all_read");
  });

  it("no declara éxito cuando la base no marcó ninguna fila", async () => {
    H.rpc.mockResolvedValue({ data: 0, error: null });
    const r = await markAllNotificationsReadAction();
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toMatch(/ninguna/i);
  });

  it("no declara éxito cuando la base no devuelve un recuento", async () => {
    H.rpc.mockResolvedValue({ data: null, error: null });
    const r = await markAllNotificationsReadAction();
    expect(r.ok).toBe(false);
  });

  it("propaga el error de PostgreSQL sin inventar éxito", async () => {
    H.rpc.mockResolvedValue({ data: null, error: { message: "sesión no autenticada" } });
    const r = await markAllNotificationsReadAction();
    expect(r).toEqual({ ok: false, message: "Tu sesión venció. Volvé a iniciar sesión." });
  });
});
