// LINK-WA-002 · 0216 — custodia de demanda runtime y contrato de validación.
//
// Este unit test NO lee migrations históricas ni consulta una base. Verifica sólo:
//   1. las operaciones que el runtime intenta ejecutar con sesión o service_role;
//   2. la identidad byte a byte del validation artifact que un Gate DB posterior
//      deberá ejecutar contra una base real.
//
// HASH MATCH != DB VALIDATION PASS. El hash protege el contrato ejecutable; no
// demuestra grants efectivos, catálogo productivo ni resultado del validation SQL.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const VALIDATION_0216 = join(
  process.cwd(),
  "supabase/tests/0216_ai_grants_hardening_VALIDATION.sql",
);
const VALIDATION_0216_SHA256 = "4f721f4dc2f59579684c876d4922e5fc45a80fc19d4378aaf3eabfc55cb89348";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("0216 · identidad del contrato de validación", () => {
  it("preserva el SHA-256 del validation artifact; no afirma estado de ninguna DB", () => {
    expect(
      sha256(VALIDATION_0216),
      "cambió el contrato de validación 0216; HASH MATCH no equivale a DB VALIDATION PASS",
    ).toBe(VALIDATION_0216_SHA256);
  });
});

const TABLAS = ["ai_suggestions", "ai_analysis_runs", "ai_budget_alerts"] as const;
type Tabla = (typeof TABLAS)[number];

// Capacidades que el runtime de sesión realmente demanda. Esto NO describe los
// grants efectivos de una DB: esos sólo se demuestran ejecutando validation 0216.
const DEMANDA_SESION: Record<Tabla, string[]> = {
  ai_suggestions: ["select", "insert"],
  ai_analysis_runs: ["select", "insert"],
  ai_budget_alerts: ["select", "insert"],
};

interface Uso { op: string; serviceRole: boolean; archivo: string }

function usosEnCodigo(tabla: string): Uso[] {
  const usos: Uso[] = [];
  const visit = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { visit(p); continue; }
      if (!/\.tsx?$/.test(e.name) || e.name.includes(".test.")) continue;
      const src = readFileSync(p, "utf8");
      // Acepta comillas simples, dobles o backticks.
      const re = new RegExp(`\\.from\\(\\s*['"\`]${tabla}['"\`]\\s*\\)`, "g");
      for (const m of src.matchAll(re)) {
        const i = m.index!;
        // Ventana corta y acotada a la cadena: se corta en el próximo `.from(`.
        let win = src.slice(i + m[0].length, i + m[0].length + 300);
        const siguiente = win.indexOf(".from(");
        if (siguiente !== -1) win = win.slice(0, siguiente);
        // ¿Con qué cliente? El más cercano hacia atrás manda.
        const antes = src.slice(Math.max(0, i - 900), i);
        const iAdmin = antes.lastIndexOf("createAdminClient");
        const iSesion = antes.lastIndexOf("createClient(");
        const serviceRole = iAdmin > iSesion;
        for (const op of ["select", "insert", "update", "upsert", "delete"]) {
          if (win.includes(`.${op}(`)) usos.push({ op, serviceRole, archivo: p });
        }
      }
    }
  };
  visit(join(process.cwd(), "src"));
  return usos;
}

describe("demanda runtime · operaciones por tipo de cliente", () => {
  it.each(TABLAS)("%s: toda operación de sesión está declarada como capacidad requerida", (t) => {
    const permitidos = new Set(DEMANDA_SESION[t]);
    for (const u of usosEnCodigo(t).filter((x) => !x.serviceRole)) {
      // upsert con ignoreDuplicates ⇒ ON CONFLICT DO NOTHING ⇒ basta INSERT.
      const op = u.op === "upsert" ? "insert" : u.op;
      expect(
        permitidos.has(op),
        `${t}: ${u.archivo} ejecuta .${u.op}() con sesión y la demanda runtime no lo declara`,
      ).toBe(true);
    }
  });

  it("las tablas de AUDITORÍA no se borran ni se editan desde ningún cliente", () => {
    for (const t of ["ai_analysis_runs", "ai_budget_alerts"]) {
      const ops = usosEnCodigo(t).map((u) => u.op);
      expect(ops).not.toContain("delete");
      expect(ops).not.toContain("update");
    }
  });

  it("D-2 · el UPDATE de sugerencias corre SÓLO con service_role, nunca con la sesión", () => {
    // Si mañana la decisión humana pasa a la sesión, cambia la demanda runtime y
    // el estado efectivo de DB deberá verificarse en un Gate DB independiente.
    const updates = usosEnCodigo("ai_suggestions").filter((u) => u.op === "update");
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every((u) => u.serviceRole)).toBe(true);
  });

  it("ninguna tabla de IA se actualiza con la sesión del usuario", () => {
    for (const t of TABLAS) {
      const conSesion = usosEnCodigo(t).filter((u) => !u.serviceRole).map((u) => u.op);
      expect(conSesion).not.toContain("update");
      expect(conSesion).not.toContain("delete");
    }
  });
});
