// fix/f5-2 · Proyección read-only del organigrama institucional para el Copilot.
//
// FUENTE ÚNICA: src/lib/orgchart.ts — la MISMA que renderiza /organigrama y de la
// que deriva src/lib/org.ts. Acá NO se duplican datos: se APLANA la jerarquía a
// filas {name, role, area, detail} para poder citarla. Sin DB, sin RPC, sin
// service_role. Se EXCLUYEN emails y participación accionaria (regla PII / system
// prompt): el Copilot cita cargo y persona, nunca datos de contacto ni equity.

import {
  AREAS,
  ASAMBLEA,
  ASESORES_EXTERNOS,
  DIRECTOR,
  ENCARGADOS_OPERATIVOS,
  GERENCIA,
  PRESIDENTE,
  VICEPRESIDENTE,
} from "@/lib/orgchart";

export interface OrgRow {
  name: string;
  role: string;
  area: string;
  detail: string;
  // Compatibilidad con RawRow (Record<string, unknown>) que espera ToolSpec.resolve;
  // todos los campos del organigrama son strings.
  [key: string]: string;
}

const norm = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Aplana el organigrama a filas citables, en orden jerárquico (presidencia →
 *  dirección → gerencia → asamblea → áreas → encargados → asesores externos).
 *  NO incluye email ni equity. */
function allOrgRows(): OrgRow[] {
  const rows: OrgRow[] = [];
  rows.push({ name: PRESIDENTE.name, role: PRESIDENTE.title, area: "Dirección", detail: PRESIDENTE.detail ?? "" });
  rows.push({ name: VICEPRESIDENTE.name, role: VICEPRESIDENTE.title, area: "Dirección", detail: VICEPRESIDENTE.detail ?? "" });
  rows.push({ name: DIRECTOR.name, role: DIRECTOR.title, area: "Operaciones", detail: DIRECTOR.detail ?? "" });
  for (const g of GERENCIA) {
    rows.push({ name: g.name, role: g.title, area: "Gerencia", detail: g.detail ?? "" });
  }
  // Asamblea de accionistas: solo cargo, SIN equity ni capital (dato sensible).
  for (const a of ASAMBLEA) {
    rows.push({ name: a.name, role: a.title, area: "Asamblea de Accionistas", detail: "" });
  }
  for (const area of AREAS) {
    if (area.lead) {
      rows.push({ name: area.lead.name, role: area.lead.title, area: area.label, detail: area.lead.detail ?? area.scope });
    }
    for (const m of area.members ?? []) {
      rows.push({ name: m, role: area.label, area: area.label, detail: area.scope });
    }
    if (area.team) {
      for (const m of area.team.members) {
        rows.push({ name: m, role: area.team.label, area: area.label, detail: area.scope });
      }
    }
  }
  for (const e of ENCARGADOS_OPERATIVOS) {
    rows.push({ name: e.name, role: e.title, area: "Personal Operativo", detail: e.detail ?? "" });
    for (const m of e.team.members) {
      rows.push({ name: m, role: e.team.label, area: e.title, detail: e.detail ?? "" });
    }
  }
  for (const x of ASESORES_EXTERNOS) {
    rows.push({ name: x.name, role: x.area, area: "Asesores Externos", detail: x.detail });
  }
  return rows;
}

/** Devuelve filas del organigrama filtradas por `query` (nombre/cargo/área/detalle,
 *  normalizado sin acentos) y acotadas por `limit`. Sin query → estructura completa. */
export function resolveOrgChart(args: Record<string, unknown>): OrgRow[] {
  const query = typeof args.query === "string" ? norm(args.query).trim() : "";
  const limit = typeof args.limit === "number" ? args.limit : 30;
  let rows = allOrgRows();
  if (query) {
    rows = rows.filter((r) => norm(`${r.name} ${r.role} ${r.area} ${r.detail}`).includes(query));
  }
  return rows.slice(0, Math.max(1, Math.min(limit, 50)));
}
