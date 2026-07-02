import { describe, it, expect } from "vitest";
import {
  availableActions, isAssignee, isReporter, isOpenStatus, severityRank,
  validateOpenInput, validateResolution, MAX_INCIDENT_TITLE,
  type IncidentViewer,
} from "./incident";
import type { Incident } from "../types";

function incident(over: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1", publicId: "INC-2026-0001", conversationId: "c-inc-1",
    titulo: "Avería montacargas", sector: "D4", ubicacion: null, tipoAveria: null,
    severidad: "alta", estado: "abierto",
    reportadoPor: "u-rep", asignadoA: null,
    slaDueAt: null, resueltoAt: null, resolucionText: null,
    createdAt: "2026-06-30T10:00:00.000Z", updatedAt: "2026-06-30T10:00:00.000Z",
    ...over,
  };
}

const admin: IncidentViewer = { userId: "u-admin", isIncidentAdmin: true };
const reporter: IncidentViewer = { userId: "u-rep", isIncidentAdmin: false };
const assignee: IncidentViewer = { userId: "u-asig", isIncidentAdmin: false };
const outsider: IncidentViewer = { userId: "u-otro", isIncidentAdmin: false };

describe("connect/domain/incident · roles", () => {
  it("isAssignee / isReporter son NULL-safe", () => {
    const i = incident({ asignadoA: null, reportadoPor: null });
    expect(isAssignee(i, { userId: null, isIncidentAdmin: false })).toBe(false);
    expect(isReporter(i, { userId: null, isIncidentAdmin: false })).toBe(false);
    expect(isAssignee(i, outsider)).toBe(false);
  });
});

describe("connect/domain/incident · availableActions (espejo de 0165)", () => {
  it("cerrado es terminal: sin acciones para nadie", () => {
    const i = incident({ estado: "cerrado", asignadoA: "u-asig" });
    expect(availableActions(i, admin)).toEqual([]);
    expect(availableActions(i, assignee)).toEqual([]);
    expect(availableActions(i, reporter)).toEqual([]);
  });

  it("abierto · asignado puede iniciar/resolver; NO cierre forzado", () => {
    const i = incident({ estado: "abierto", asignadoA: "u-asig" });
    const acts = availableActions(i, assignee);
    expect(acts).toContain("start");
    expect(acts).toContain("resolve");
    expect(acts).not.toContain("force_close");
    expect(acts).not.toContain("assign"); // asignar a terceros = solo admin
  });

  it("abierto · admin puede asignar, forzar cierre y trabajar", () => {
    const i = incident({ estado: "abierto" });
    const acts = availableActions(i, admin);
    expect(acts).toContain("assign");
    expect(acts).toContain("force_close");
    expect(acts).toContain("start");
  });

  it("abierto · un tercero solo puede auto-asignarse", () => {
    const i = incident({ estado: "abierto" });
    const acts = availableActions(i, outsider);
    expect(acts).toEqual(["assign_self"]);
  });

  it("en_progreso ↔ en_espera solo asignado/admin", () => {
    const enProgreso = incident({ estado: "en_progreso", asignadoA: "u-asig" });
    expect(availableActions(enProgreso, assignee)).toContain("hold");
    expect(availableActions(enProgreso, reporter)).not.toContain("hold");
    const enEspera = incident({ estado: "en_espera", asignadoA: "u-asig" });
    expect(availableActions(enEspera, assignee)).toContain("resume");
  });

  it("resuelto · reportante puede cerrar o reabrir, pero NO resolver/forzar", () => {
    const i = incident({ estado: "resuelto", asignadoA: "u-asig" });
    const acts = availableActions(i, reporter);
    expect(acts).toContain("close");
    expect(acts).toContain("reopen");
    expect(acts).not.toContain("resolve");
    expect(acts).not.toContain("force_close");
  });

  it("resuelto · un tercero no puede cerrar ni reabrir", () => {
    const i = incident({ estado: "resuelto", asignadoA: "u-asig" });
    const acts = availableActions(i, outsider);
    expect(acts).not.toContain("close");
    expect(acts).not.toContain("reopen");
  });

  it("set_severity solo asignado/admin en estados no terminales", () => {
    const i = incident({ estado: "en_progreso", asignadoA: "u-asig" });
    expect(availableActions(i, assignee)).toContain("set_severity");
    expect(availableActions(i, reporter)).not.toContain("set_severity");
  });
});

describe("connect/domain/incident · validaciones", () => {
  it("validateOpenInput exige título no vacío y severidad válida", () => {
    expect(validateOpenInput({ titulo: "   ", severidad: "media" }).ok).toBe(false);
    expect(validateOpenInput({ titulo: "x".repeat(MAX_INCIDENT_TITLE + 1), severidad: "media" }).ok).toBe(false);
    expect(validateOpenInput({ titulo: "Avería", severidad: "gravisima" }).ok).toBe(false);
    const v = validateOpenInput({ titulo: "  Avería  ", severidad: "critica" });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.titulo).toBe("Avería"); // trimmed
      expect(v.severidad).toBe("critica");
    }
  });

  it("validateResolution exige texto", () => {
    expect(validateResolution("  ").ok).toBe(false);
    const v = validateResolution("  Se reemplazó el fusible.  ");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.text).toBe("Se reemplazó el fusible.");
  });
});

describe("connect/domain/incident · orden y filtros", () => {
  it("severityRank ordena crítica primero", () => {
    expect(severityRank("critica")).toBeLessThan(severityRank("alta"));
    expect(severityRank("alta")).toBeLessThan(severityRank("media"));
    expect(severityRank("media")).toBeLessThan(severityRank("baja"));
  });

  it("isOpenStatus excluye resuelto/cerrado", () => {
    expect(isOpenStatus("abierto")).toBe(true);
    expect(isOpenStatus("en_espera")).toBe(true);
    expect(isOpenStatus("resuelto")).toBe(false);
    expect(isOpenStatus("cerrado")).toBe(false);
  });
});
