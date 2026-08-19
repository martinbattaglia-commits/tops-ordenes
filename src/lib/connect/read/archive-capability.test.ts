// INC-01 · la capa que ALIMENTA el espejo de D-3.
//
// La aritmética del permiso vive en `archive-policy.test.ts`. Acá se mide lo que sólo
// puede fallar en este archivo y de forma silenciosa: los nombres de columna, el orden
// «tarea primero, incidencia sólo si no hay tarea», y la degradación — que un hecho
// faltante NO se convierta en un veredicto falso (hallazgo MEDIUM-1 de la C4 1/2).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ARCHIVE_BLOCK_MESSAGE } from "../archive-policy";
import type { InboxItem } from "../types";

vi.mock("@/lib/env", () => ({ env: { app: { demoMode: false, needsSupabase: false } } }));

type Res = { data: unknown[] | null; error: unknown };

const estado = {
  escalares: {} as Record<string, { data: unknown; error: unknown }>,
  tablas: {} as Record<string, Res>,
  columnas: {} as Record<string, string>,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-yo" } } }) },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      const clave = args?.p_slug ? `${fn}:${args.p_slug}` : fn;
      return estado.escalares[clave] ?? { data: false, error: null };
    },
    from: (tabla: string) => ({
      select: (cols: string) => {
        estado.columnas[tabla] = cols;
        const salida = estado.tablas[tabla] ?? { data: [], error: null };
        const thenable = {
          eq: () => Promise.resolve(salida),
          then: (r: (v: Res) => unknown) => Promise.resolve(salida).then(r),
        };
        return { in: () => thenable };
      },
    }),
  }),
}));

const { annotateArchiveCapability } = await import("./archive-capability");

const hilo = (id: string): InboxItem => ({
  conversationId: id, contextId: "ctx", kind: "whatsapp", title: id, slug: null, topic: null,
  lastMessageAt: null, lastMessageSeq: null, lastReadSeq: 0, unreadCount: 0,
  isFavorite: false, mutedUntil: null, archivedAt: null,
});

const OK = { data: true, error: null };
const NO = { data: false, error: null };

beforeEach(() => {
  estado.escalares = {
    is_admin: NO,
    "has_permission:connect.task_admin": NO,
    "has_permission:connect.incident_admin": NO,
    nexus_is_depot_manager_principal: NO,
  };
  estado.tablas = {
    connect_tasks: { data: [], error: null },
    connect_incidents: { data: [], error: null },
    connect_participants: { data: [], error: null },
  };
  estado.columnas = {};
});

describe("annotateArchiveCapability · el veredicto llega del servidor", () => {
  it("hilo de WhatsApp sin rol → deshabilitado, con la causa del rol", async () => {
    const [it0] = await annotateArchiveCapability([hilo("c-1")]);
    expect(it0.canArchive).toBe(false);
    expect(it0.archiveBlockedMessage).toBe(ARCHIVE_BLOCK_MESSAGE.no_role);
  });

  it("owner del hilo → habilitado y sin mensaje", async () => {
    estado.tablas.connect_participants = {
      data: [{ conversation_id: "c-1", member_role: "owner" }], error: null,
    };
    const [it0] = await annotateArchiveCapability([hilo("c-1")]);
    expect(it0.canArchive).toBe(true);
    expect(it0.archiveBlockedMessage).toBeNull();
  });

  it("lee las columnas que la base realmente tiene", async () => {
    await annotateArchiveCapability([hilo("c-1")]);
    expect(estado.columnas.connect_tasks).toBe(
      "conversation_id, estado, asignado_a, creado_por",
    );
    expect(estado.columnas.connect_incidents).toBe(
      "conversation_id, estado, reportado_por, asignado_a",
    );
    expect(estado.columnas.connect_participants).toBe("conversation_id, member_role");
  });

  it("mapea la TAREA con sus columnas: asignado terminal → habilitado", async () => {
    estado.tablas.connect_tasks = {
      data: [{
        conversation_id: "c-1", estado: "completada",
        asignado_a: "u-yo", creado_por: "otro",
      }],
      error: null,
    };
    const [it0] = await annotateArchiveCapability([hilo("c-1")]);
    expect(it0.canArchive).toBe(true);
  });

  it("mapea la INCIDENCIA con sus columnas: quien la reportó y está cerrada → habilitado", async () => {
    estado.tablas.connect_incidents = {
      data: [{
        conversation_id: "c-1", estado: "cerrado",
        reportado_por: "u-yo", asignado_a: null,
      }],
      error: null,
    };
    const [it0] = await annotateArchiveCapability([hilo("c-1")]);
    expect(it0.canArchive).toBe(true);
  });

  it("si el hilo tiene tarea E incidencia, manda la tarea — igual que el motor", async () => {
    estado.tablas.connect_tasks = {
      data: [{ conversation_id: "c-1", estado: "pendiente", asignado_a: null, creado_por: null }],
      error: null,
    };
    estado.tablas.connect_incidents = {
      data: [{ conversation_id: "c-1", estado: "cerrado", reportado_por: "u-yo", asignado_a: null }],
      error: null,
    };
    const [it0] = await annotateArchiveCapability([hilo("c-1")]);
    expect(it0.archiveBlockedMessage).toBe(ARCHIVE_BLOCK_MESSAGE.entity_task_open);
  });
});

describe("annotateArchiveCapability · sin el hecho no hay veredicto", () => {
  it("un escalar caído NO se hace pasar por false: la bandeja sale sin anotar", async () => {
    estado.escalares.is_admin = { data: null, error: { message: "boom" } };
    const [it0] = await annotateArchiveCapability([hilo("c-1")]);
    expect(it0.canArchive).toBeUndefined();
    expect(it0.archiveBlockedMessage).toBeUndefined();
  });

  it("una lectura de tabla caída deja la bandeja sin anotar", async () => {
    estado.tablas.connect_participants = { data: null, error: { message: "boom" } };
    const [it0] = await annotateArchiveCapability([hilo("c-1")]);
    expect(it0.canArchive).toBeUndefined();
  });

  it("por encima del tope, los hilos excedentes salen sin veredicto y la bandeja entera vuelve", async () => {
    const muchos = Array.from({ length: 205 }, (_, i) => hilo(`c-${i}`));
    const salida = await annotateArchiveCapability(muchos);
    expect(salida).toHaveLength(205);
    expect(salida[0].canArchive).toBe(false);
    expect(salida[199].canArchive).toBe(false);
    expect(salida[200].canArchive).toBeUndefined();
    expect(salida[204].canArchive).toBeUndefined();
  });

  it("bandeja vacía no consulta nada", async () => {
    expect(await annotateArchiveCapability([])).toEqual([]);
    expect(estado.columnas).toEqual({});
  });
});
