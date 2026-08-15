// Nexus Link · FASE B — Autorización de la ficha de contacto de WhatsApp.
//
// El objeto de esta suite NO es el formato del número: es QUIÉN lo recibe. Cada
// caso interroga la frontera desde el lado del atacante, no desde el del
// usuario legítimo, y la afirmación central es de INDISTINGUIBILIDAD: quien no
// puede ver el hilo obtiene exactamente la misma respuesta que si el hilo no
// existiera.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const estado = {
  /** Lo que la RLS deja salir. `null` = la fila no llegó (no existe o no la ve). */
  fila: null as { kind: string; title: string | null; contextId: string | null } | null,
  /** `nexus_link_can('nexus_link.whatsapp.read')`. */
  capacidad: false,
  /** Ids con los que se consultó la base, para probar que no se consultó de más. */
  consultas: [] as string[],
};

vi.mock("@/lib/supabase/server", () => ({ createClient: () => null }));
vi.mock("@/lib/rbac/nexus-link", () => ({
  canChannel: async () => estado.capacidad,
}));

const { resolverFichaAutorizada, getWaContact } = await import("./wa-contact");

const HILO = "11111111-2222-3333-4444-555555555555";
const TEL = "+5491131079124";

const port = {
  async leerConversacion(id: string) {
    estado.consultas.push(id);
    return estado.fila;
  },
  async puedeLeerWhatsapp() {
    return estado.capacidad;
  },
};

beforeEach(() => {
  estado.fila = null;
  estado.capacidad = false;
  estado.consultas = [];
});

describe("a · el usuario AUTORIZADO ve nombre y número", () => {
  it("devuelve la ficha completa del hilo de WhatsApp", async () => {
    estado.fila = { kind: "whatsapp", title: "Royal Packs", contextId: `wa:${TEL}` };
    estado.capacidad = true;
    expect(await resolverFichaAutorizada(HILO, port)).toEqual({
      nombre: "Royal Packs",
      e164: TEL,
      legible: "+54 9 11 3107-9124",
    });
  });
});

describe("b · sin capacidad de WhatsApp no llega NADA", () => {
  it("con la fila en la mano pero sin capacidad, la ficha no se arma", async () => {
    // Escenario deliberadamente peor que el real: se simula que la RLS fallara y
    // dejara pasar la fila. Ni así sale el teléfono.
    estado.fila = { kind: "whatsapp", title: "Royal Packs", contextId: `wa:${TEL}` };
    estado.capacidad = false;
    expect(await resolverFichaAutorizada(HILO, port)).toBeNull();
  });

  it("el caso REAL: la RLS no devuelve la fila y no hay nada que autorizar", async () => {
    estado.fila = null;
    estado.capacidad = false;
    expect(await resolverFichaAutorizada(HILO, port)).toBeNull();
  });

  it("el teléfono NO aparece en la respuesta bajo ninguna forma", async () => {
    estado.fila = { kind: "whatsapp", title: TEL, contextId: `wa:${TEL}` };
    estado.capacidad = false;
    const r = await resolverFichaAutorizada(HILO, port);
    expect(JSON.stringify(r ?? null)).not.toContain("3107");
  });
});

describe("c · conocer el UUID no habilita nada", () => {
  it("hilo inexistente y hilo prohibido son INDISTINGUIBLES", async () => {
    estado.capacidad = false;

    estado.fila = null; // no existe
    const inexistente = await resolverFichaAutorizada(HILO, port);

    estado.fila = { kind: "whatsapp", title: "Royal Packs", contextId: `wa:${TEL}` }; // existe, prohibido
    const prohibido = await resolverFichaAutorizada(HILO, port);

    expect(inexistente).toBeNull();
    expect(prohibido).toBeNull();
    expect(prohibido).toEqual(inexistente); // misma respuesta exacta
  });

  it("no hay excepción que distinga los casos: ninguna rama lanza", async () => {
    estado.capacidad = false;
    for (const fila of [
      null,
      { kind: "whatsapp", title: "X", contextId: `wa:${TEL}` },
      { kind: "dm", title: "X", contextId: "CTX-2026-000001" },
    ]) {
      estado.fila = fila;
      await expect(resolverFichaAutorizada(HILO, port)).resolves.toBeNull();
    }
  });
});

describe("d · el chat interno sigue funcionando y no muestra ficha", () => {
  it("un hilo interno no produce ficha ni siquiera con capacidad de WhatsApp", async () => {
    estado.capacidad = true;
    for (const kind of ["dm", "group", "channel", "erp", "incident", "ai"]) {
      estado.fila = { kind, title: "Equipo", contextId: "CTX-2026-000001" };
      expect(await resolverFichaAutorizada(HILO, port), kind).toBeNull();
    }
  });

  it("un hilo interno NO gasta la comprobación de capacidad de WhatsApp", async () => {
    // Si la pidiera, el chat interno quedaría acoplado a un permiso que no
    // necesita: un encargado de depósito no tiene esa capacidad y su chat debe
    // seguir andando igual.
    estado.capacidad = true;
    estado.fila = { kind: "dm", title: "Equipo", contextId: "CTX-2026-000001" };
    const espia = vi.fn(async () => true);
    expect(
      await resolverFichaAutorizada(HILO, { ...port, puedeLeerWhatsapp: espia }),
    ).toBeNull();
    expect(espia).not.toHaveBeenCalled();
  });
});

describe("e · número ausente o inválido: la ficha existe y lo declara", () => {
  it("sin context_id devuelve ficha con e164 nulo, no null", async () => {
    estado.fila = { kind: "whatsapp", title: "Contacto viejo", contextId: null };
    estado.capacidad = true;
    expect(await resolverFichaAutorizada(HILO, port))
      .toEqual({ nombre: "Contacto viejo", e164: null, legible: null });
  });

  it("con un context_id corrupto tampoco se rompe ni se inventa", async () => {
    estado.fila = { kind: "whatsapp", title: "Contacto raro", contextId: "wa:???" };
    estado.capacidad = true;
    const r = await resolverFichaAutorizada(HILO, port);
    expect(r).toMatchObject({ e164: null, legible: null });
    expect(r?.nombre).toBe("Contacto raro");
  });
});

describe("g · el número no se escapa por los bordes", () => {
  it("sin cliente de Supabase la ficha es null y no toca la capacidad", async () => {
    // `createClient` está mockeado a null: es el entorno sin base. Ahí no hay
    // dato personal que servir y tampoco se consulta el permiso.
    estado.capacidad = true;
    expect(await getWaContact(HILO)).toBeNull();
  });

  it("no se registra nada en consola en ninguna rama", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    estado.capacidad = true;
    estado.fila = { kind: "whatsapp", title: "Royal Packs", contextId: `wa:${TEL}` };
    await resolverFichaAutorizada(HILO, port);
    estado.capacidad = false;
    await resolverFichaAutorizada(HILO, port);
    estado.fila = null;
    await resolverFichaAutorizada(HILO, port);
    for (const espia of [err, warn, log]) expect(espia).not.toHaveBeenCalled();
    err.mockRestore(); warn.mockRestore(); log.mockRestore();
  });

  it("se consulta la conversación UNA sola vez por resolución", async () => {
    estado.capacidad = true;
    estado.fila = { kind: "whatsapp", title: "Royal Packs", contextId: `wa:${TEL}` };
    await resolverFichaAutorizada(HILO, port);
    expect(estado.consultas).toEqual([HILO]);
  });
});
