// INC-01 · el espejo preventivo (D-3) y la clasificación de causas (D-1), medidos
// contra las condiciones REALES de las dos RPC de prod:
//
//   connect_archive_entity_thread — tarea en ('completada','cancelada') o incidente
//     'cerrado', y además admin | connect.task_admin/incident_admin | asignado | creador
//     (incidente: reportado_por | asignado_a).
//   connect_archive_conversation  — rechaza al principal de depósito y exige
//     admin | member_role in ('owner','moderator').

import { describe, it, expect } from "vitest";
import {
  ARCHIVE_BLOCK_MESSAGE, archiveFailureMessage, evaluateArchiveCapability,
  type ArchiveFacts,
} from "./archive-policy";

const YO = "u-cynthia";

const base: ArchiveFacts = {
  isAdmin: false, isTaskAdmin: false, isIncidentAdmin: false, isDepotManager: false,
  profileId: YO, memberRole: null, entity: null,
};
const f = (over: Partial<ArchiveFacts> = {}): ArchiveFacts => ({ ...base, ...over });

const tarea = (estado: string, over: Record<string, string | null> = {}) =>
  ({ kind: "task", estado, asignadoA: null, creadoPor: null, ...over }) as ArchiveFacts["entity"];
const incidencia = (estado: string, over: Record<string, string | null> = {}) =>
  ({ kind: "incident", estado, reportadoPor: null, asignadoA: null, ...over }) as ArchiveFacts["entity"];

describe("INC-01/D-3 · hilo de WhatsApp (sin tarea ni incidencia)", () => {
  it("responsable comercial sin rol en el hilo → NO puede, y la causa es el rol", () => {
    const v = evaluateArchiveCapability(f());
    expect(v).toEqual({
      can: false, reason: "no_role", message: ARCHIVE_BLOCK_MESSAGE.no_role,
    });
  });

  it("owner y moderator sí pueden por la vía manual", () => {
    expect(evaluateArchiveCapability(f({ memberRole: "owner" }))).toEqual({ can: true });
    expect(evaluateArchiveCapability(f({ memberRole: "moderator" }))).toEqual({ can: true });
  });

  it("member simple no puede — la RPC sólo acepta owner/moderator", () => {
    expect(evaluateArchiveCapability(f({ memberRole: "member" })).can).toBe(false);
  });

  it("admin puede", () => {
    expect(evaluateArchiveCapability(f({ isAdmin: true }))).toEqual({ can: true });
  });

  it("el principal de depósito es rechazado ANTES de mirar el rol", () => {
    const v = evaluateArchiveCapability(f({ isDepotManager: true, memberRole: "owner" }));
    expect(v).toEqual({
      can: false, reason: "depot_manager_blocked",
      message: ARCHIVE_BLOCK_MESSAGE.depot_manager_blocked,
    });
  });
});

describe("INC-01/D-3 · hilo de TAREA", () => {
  it("tarea abierta → no puede, y la causa es la tarea (no el rol)", () => {
    const v = evaluateArchiveCapability(f({ entity: tarea("en_progreso") }));
    expect(v).toEqual({
      can: false, reason: "entity_task_open", message: ARCHIVE_BLOCK_MESSAGE.entity_task_open,
    });
  });

  // C4 1/2 · HIGH-1: el espejo cortaba en la vía de entidad y nunca reproducía la caída
  // a la manual. Las dos RPC son una DISYUNCIÓN: `connect_archive_conversation` no mira
  // el estado de la entidad, sólo el rol. Con la tarea ABIERTA, un admin/owner/moderator
  // igual archiva — y la UI se lo deshabilitaba.
  it("tarea abierta + admin → PUEDE: la vía manual no mira el estado de la entidad", () => {
    expect(evaluateArchiveCapability(f({ entity: tarea("en_progreso"), isAdmin: true })))
      .toEqual({ can: true });
  });

  it("tarea abierta + owner/moderator del hilo → PUEDE por la vía manual", () => {
    for (const rol of ["owner", "moderator"]) {
      expect(evaluateArchiveCapability(f({ entity: tarea("pendiente"), memberRole: rol })))
        .toEqual({ can: true });
    }
  });

  it("incidencia abierta + moderator → PUEDE por la vía manual", () => {
    expect(evaluateArchiveCapability(f({ entity: incidencia("abierto"), memberRole: "moderator" })))
      .toEqual({ can: true });
  });

  it("tarea abierta + principal de depósito → NO puede, y la causa es el depósito", () => {
    const v = evaluateArchiveCapability(
      f({ entity: tarea("en_progreso"), isDepotManager: true, memberRole: "owner" }),
    );
    expect((v as { reason: string }).reason).toBe("depot_manager_blocked");
  });

  it("tarea abierta gana sobre la falta de rol: se informa la puerta que puede abrir", () => {
    const v = evaluateArchiveCapability(f({ entity: tarea("pendiente"), memberRole: "member" }));
    expect(v.can).toBe(false);
    expect((v as { reason: string }).reason).toBe("entity_task_open");
  });

  it("tarea terminada y soy el asignado → puedo, aunque NO sea administrador", () => {
    for (const estado of ["completada", "cancelada"]) {
      expect(
        evaluateArchiveCapability(f({ entity: tarea(estado, { asignadoA: YO }) })),
      ).toEqual({ can: true });
    }
  });

  it("tarea terminada y soy el creador → puedo", () => {
    expect(
      evaluateArchiveCapability(f({ entity: tarea("completada", { creadoPor: YO }) })),
    ).toEqual({ can: true });
  });

  it("tarea terminada con connect.task_admin → puedo", () => {
    expect(
      evaluateArchiveCapability(f({ entity: tarea("completada"), isTaskAdmin: true })),
    ).toEqual({ can: true });
  });

  it("tarea terminada pero ajena → cae a la vía manual y falta el rol", () => {
    const v = evaluateArchiveCapability(f({ entity: tarea("completada", { asignadoA: "otro" }) }));
    expect(v).toEqual({
      can: false, reason: "no_role", message: ARCHIVE_BLOCK_MESSAGE.no_role,
    });
  });

  it("tarea terminada y ajena, pero soy moderator del hilo → puedo por la vía manual", () => {
    expect(
      evaluateArchiveCapability(
        f({ entity: tarea("completada", { asignadoA: "otro" }), memberRole: "moderator" }),
      ),
    ).toEqual({ can: true });
  });
});

describe("INC-01/D-3 · hilo de INCIDENCIA", () => {
  it("incidencia abierta → causa propia, no la de la tarea", () => {
    const v = evaluateArchiveCapability(f({ entity: incidencia("abierto") }));
    expect(v).toEqual({
      can: false, reason: "entity_incident_open",
      message: ARCHIVE_BLOCK_MESSAGE.entity_incident_open,
    });
  });

  it("incidencia cerrada y soy quien la reportó → puedo", () => {
    expect(
      evaluateArchiveCapability(f({ entity: incidencia("cerrado", { reportadoPor: YO }) })),
    ).toEqual({ can: true });
  });

  it("incidencia cerrada y soy el asignado → puedo", () => {
    expect(
      evaluateArchiveCapability(f({ entity: incidencia("cerrado", { asignadoA: YO }) })),
    ).toEqual({ can: true });
  });

  it("connect.task_admin NO habilita incidencias, y viceversa", () => {
    expect(
      evaluateArchiveCapability(f({ entity: incidencia("cerrado"), isTaskAdmin: true })).can,
    ).toBe(false);
    expect(
      evaluateArchiveCapability(f({ entity: tarea("completada"), isIncidentAdmin: true })).can,
    ).toBe(false);
  });
});

describe("INC-01 · fail-closed y calidad del mensaje", () => {
  it("sin sesión resuelta no se habilita el control", () => {
    expect(
      evaluateArchiveCapability(f({ entity: tarea("completada", { asignadoA: YO }), profileId: null })).can,
    ).toBe(false);
  });

  it("estado desconocido de la entidad no se toma por terminal", () => {
    expect(evaluateArchiveCapability(f({ entity: tarea("") })).can).toBe(false);
    expect(evaluateArchiveCapability(f({ entity: incidencia("") })).can).toBe(false);
  });

  it("todo mensaje es accionable: dice qué hacer, no sólo qué no se puede", () => {
    // Se mide el CONTRATO (hay una instrucción en imperativo dirigida a la persona),
    // no una lista de palabras copiada de las propias constantes.
    // Sin `\b`: en JS el borde de palabra no aplica tras una vocal acentuada.
    const imperativo = /(cerrala|cancelala|pedí|probá|volvé|avisá)/i;
    for (const [reason, msg] of Object.entries(ARCHIVE_BLOCK_MESSAGE)) {
      expect(msg, reason).toMatch(imperativo);
      expect(msg, reason).not.toMatch(/ y además /i);
      // Una causa por mensaje: ninguno nombra a la vez la entidad y el rol.
      const nombraEntidad = /(tarea|incidencia)/i.test(msg);
      const nombraRol = /(administrador|moderador)/i.test(msg);
      expect(nombraEntidad && nombraRol, reason).toBe(false);
    }
  });

  it("la sesión caída tiene su propia causa, no se confunde con falta de rol", () => {
    const { reason, message } = archiveFailureMessage(
      { code: "42501", message: "sesión requerida" },
      { code: "42501", message: "sin permiso para archivar" },
    );
    expect(reason).toBe("session_expired");
    expect(message).toBe(ARCHIVE_BLOCK_MESSAGE.session_expired);
  });

  it("un error inclasificable no queda mudo ni vuelca el motor", () => {
    const { reason, message } = archiveFailureMessage(
      { code: "XX000", message: "boom interno del motor" },
      { code: "XX000", message: "boom interno del motor" },
    );
    expect(reason).toBe("unknown");
    expect(message).toBe(ARCHIVE_BLOCK_MESSAGE.unknown);
    expect(message).not.toContain("boom");
  });
});
