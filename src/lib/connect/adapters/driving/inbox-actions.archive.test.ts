// INC-01 · D-1 — el mensaje de archivado nombra UNA causa, la real.
//
// Par rojo→verde: contra el código previo estas pruebas fallan, porque
// `archiveInboxItemAction` descartaba `first.error` y `fallback.error` y devolvía
// una cadena fija que nombraba las dos causas a la vez.
//
// Los errores que se inyectan son los que las RPC levantan DE VERDAD en prod
// (medidos sobre arsksytgdnzukbmfgkju, no supuestos):
//   connect_archive_entity_thread → 23514 tarea/incidente no terminal
//                                 → 02000 el hilo no es de una entidad (caso WhatsApp)
//                                 → 42501 entidad terminal pero sin vínculo
//   connect_archive_conversation  → 42501 no sos owner/moderator/admin

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ARCHIVE_BLOCK_MESSAGE } from "@/lib/connect/archive-policy";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { app: { demoMode: false, needsSupabase: false } } }));
vi.mock("@/lib/rbac/guard", () => ({ canAccess: vi.fn(async () => true) }));
vi.mock("@/lib/rbac/internal-chat", () => ({ canReadInternalChat: vi.fn(async () => true) }));
vi.mock("../../read/inbox-data", () => ({ listInbox: vi.fn(async () => []) }));

type Err = { code: string; message: string } | null;
let entityError: Err;
let manualError: Err;
let llamadas: string[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-cynthia" } } }) },
    rpc: async (name: string) => {
      llamadas.push(name);
      if (name === "connect_archive_entity_thread") return { error: entityError };
      if (name === "connect_archive_conversation") return { error: manualError };
      return { error: null };
    },
  }),
}));

const { archiveInboxItemAction } = await import("./inbox-actions");

const HILO = { conversationId: "c-1" };

const SIN_ENTIDAD: Err = {
  code: "02000",
  message: "la conversación no está vinculada a una tarea o incidente",
};
const TAREA_ABIERTA: Err = { code: "23514", message: "la tarea no está en estado terminal" };
const INCIDENTE_ABIERTO: Err = { code: "23514", message: "el incidente no está cerrado" };
const SIN_ROL: Err = { code: "42501", message: "sin permiso para archivar" };
const DEPOSITO: Err = { code: "42501", message: "no autorizado" };

beforeEach(() => {
  entityError = null;
  manualError = null;
  llamadas = [];
});

async function fallo() {
  const r = await archiveInboxItemAction(HILO);
  expect(r.ok).toBe(false);
  return (r as { ok: false; message: string }).message;
}

describe("INC-01/D-1 · una causa por mensaje", () => {
  it("hilo de WhatsApp (sin entidad) y sin rol → habla del rol, NO de una tarea inexistente", async () => {
    entityError = SIN_ENTIDAD;
    manualError = SIN_ROL;
    const msg = await fallo();
    expect(msg).toBe(ARCHIVE_BLOCK_MESSAGE.no_role);
    // El defecto exacto que vio Cynthia: se le nombraba una tarea que no existe.
    expect(msg.toLowerCase()).not.toContain("tarea");
    expect(msg.toLowerCase()).not.toContain("incidencia");
  });

  it("tarea todavía abierta → habla de la tarea y ofrece el camino, sin mencionar el rol", async () => {
    entityError = TAREA_ABIERTA;
    manualError = SIN_ROL;
    const msg = await fallo();
    expect(msg).toBe(ARCHIVE_BLOCK_MESSAGE.entity_task_open);
    expect(msg.toLowerCase()).not.toContain("administrador");
    expect(msg.toLowerCase()).toContain("cerrala");
  });

  it("incidencia todavía abierta → habla de la incidencia, no de la tarea", async () => {
    entityError = INCIDENTE_ABIERTO;
    manualError = SIN_ROL;
    const msg = await fallo();
    expect(msg).toBe(ARCHIVE_BLOCK_MESSAGE.entity_incident_open);
    expect(msg.toLowerCase()).not.toContain("tarea");
  });

  it("principal de depósito rechazado → su propia causa, no «no sos administrador»", async () => {
    entityError = SIN_ENTIDAD;
    manualError = DEPOSITO;
    const msg = await fallo();
    expect(msg).toBe(ARCHIVE_BLOCK_MESSAGE.depot_manager_blocked);
  });

  it("nunca vuelca el texto crudo del motor a la pantalla", async () => {
    for (const [e, m] of [
      [SIN_ENTIDAD, SIN_ROL],
      [TAREA_ABIERTA, SIN_ROL],
      [INCIDENTE_ABIERTO, SIN_ROL],
    ] as const) {
      entityError = e;
      manualError = m;
      const msg = await fallo();
      expect(msg).not.toContain(e.message);
      expect(msg).not.toContain(m.message);
      expect(msg).not.toMatch(/\b(02000|23514|42501)\b/);
    }
  });
});

describe("INC-01/D-1 · las compuertas del servidor siguen mandando (invariancia)", () => {
  it("entidad terminada y usuario NO admin → archiva por la vía de entidad, sin tocar la manual", async () => {
    entityError = null;
    const r = await archiveInboxItemAction(HILO);
    expect(r.ok).toBe(true);
    expect(llamadas).toEqual(["connect_archive_entity_thread"]);
  });

  it("admin sobre hilo sin entidad → archiva por la vía manual", async () => {
    entityError = SIN_ENTIDAD;
    manualError = null;
    const r = await archiveInboxItemAction(HILO);
    expect(r.ok).toBe(true);
    expect(llamadas).toEqual([
      "connect_archive_entity_thread",
      "connect_archive_conversation",
    ]);
  });
});
