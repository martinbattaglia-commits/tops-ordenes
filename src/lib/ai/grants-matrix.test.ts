// LINK-WA-002 · 0216 — guarda de la MATRIZ DE PRIVILEGIOS de las tablas de IA.
//
// ⚠️ ALCANCE HONESTO: este test NO consulta la base. No puede probar que producción
// esté endurecida —eso lo prueba el postcheck del Gate SQL contra el catálogo de
// Postgres (`supabase/tests/0216_ai_grants_hardening_VALIDATION.sql`)—. Lo que sí
// garantiza es que la migración `0216` **declare** la matriz aprobada y que nadie
// la afloje después sin romper la suite.
//
// 🔴 REESCRITO tras la revisión adversarial (hallazgo H-3). La versión anterior era
// bypasseable: ancoraba en la frase literal `on table`, y en SQL la palabra `TABLE`
// es OPCIONAL. Se verificó empíricamente que agregar al final del archivo
//   grant delete on public.ai_analysis_runs to authenticated;
// dejaba pasar los 18 tests. Ahora el análisis es por SENTENCIA, no por frase:
// se parsea TODO `grant`/`revoke` del archivo y se exige que el conjunto completo
// coincida con la matriz. Cualquier sentencia extra —con o sin `TABLE`, por tabla
// o por esquema— rompe el test.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATION = join(process.cwd(), "supabase/migrations/0216_ai_grants_hardening.sql");
const raw = readFileSync(MIGRATION, "utf8");

/** SQL sin comentarios: los comentarios NOMBRAN los privilegios prohibidos. */
const code = raw
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n")
  .toLowerCase();

const TABLAS = ["ai_suggestions", "ai_analysis_runs", "ai_budget_alerts"] as const;
type Tabla = (typeof TABLAS)[number];

// Matriz DEFINITIVA (resolución de Dirección · D-2, mínimo privilegio real):
// ninguna tabla de IA concede UPDATE a `authenticated`.
const MATRIZ: Record<Tabla, string[]> = {
  ai_suggestions: ["select", "insert"],
  ai_analysis_runs: ["select", "insert"],
  ai_budget_alerts: ["select", "insert"],
};

const PROHIBIDOS = ["update", "delete", "truncate", "trigger", "references"] as const;

interface Sentencia {
  tipo: "grant" | "revoke";
  privs: string[];
  objeto: string;   // texto del objeto tal cual aparece
  roles: string[];
  crudo: string;
}

/** Parsea TODA sentencia grant/revoke del archivo, con `TABLE` opcional. */
function parseSentencias(sql: string): Sentencia[] {
  const out: Sentencia[] = [];
  const re = /\b(grant|revoke)\s+([\s\S]*?)\s+on\s+([\s\S]*?)\s+(?:to|from)\s+([^;]*);/g;
  for (const m of sql.matchAll(re)) {
    out.push({
      tipo: m[1] as "grant" | "revoke",
      privs: m[2].split(",").map((s) => s.trim()).filter(Boolean),
      objeto: m[3].replace(/\btable\b/g, "").trim(),
      roles: m[4].split(",").map((s) => s.trim()).filter(Boolean),
      crudo: m[0].replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

const SENTENCIAS = parseSentencias(code);
const grants = SENTENCIAS.filter((s) => s.tipo === "grant");
const revokes = SENTENCIAS.filter((s) => s.tipo === "revoke");

describe("0216 · el archivo contiene EXACTAMENTE las sentencias esperadas", () => {
  it("nada más que 3 revokes y 3 grants: cualquier sentencia extra se detecta", () => {
    expect(revokes).toHaveLength(TABLAS.length);
    expect(grants).toHaveLength(TABLAS.length);
    expect(SENTENCIAS).toHaveLength(TABLAS.length * 2);
  });

  it("ninguna sentencia opera sobre un objeto que no sea una de las 3 tablas", () => {
    const permitidos = TABLAS.map((t) => `public.${t}`);
    for (const s of SENTENCIAS) {
      expect(permitidos, `objeto inesperado en: ${s.crudo}`).toContain(s.objeto);
    }
  });

  it("no hay grants por esquema ni ALTER DEFAULT PRIVILEGES (alcance de DB-PRIV-001)", () => {
    expect(code).not.toMatch(/\ball\s+tables\s+in\s+schema\b/);
    expect(code).not.toMatch(/\balter\s+default\s+privileges\b/);
    expect(code).not.toMatch(/\ball\s+(functions|sequences|routines)\s+in\s+schema\b/);
  });
});

describe("0216 · patrón REVOKE ALL → GRANT mínimo", () => {
  it.each(TABLAS)("%s: revoca ALL a authenticated, anon y public", (t) => {
    const r = revokes.find((s) => s.objeto === `public.${t}`);
    expect(r, `falta REVOKE sobre ${t}`).toBeDefined();
    expect(r!.privs).toEqual(["all"]);
    for (const rol of ["authenticated", "anon", "public"]) {
      expect(r!.roles, `${t}: el REVOKE no incluye ${rol}`).toContain(rol);
    }
  });

  it.each(TABLAS)("%s: concede exactamente la matriz aprobada, sólo a authenticated", (t) => {
    const g = grants.find((s) => s.objeto === `public.${t}`);
    expect(g, `falta GRANT sobre ${t}`).toBeDefined();
    expect([...g!.privs].sort()).toEqual([...MATRIZ[t]].sort());
    expect(g!.roles).toEqual(["authenticated"]);
  });

  it.each(TABLAS)("%s: el REVOKE precede al GRANT (si no, el grant se perdería)", (t) => {
    const iR = code.indexOf(`revoke`, 0);
    const posR = SENTENCIAS.findIndex((s) => s.tipo === "revoke" && s.objeto === `public.${t}`);
    const posG = SENTENCIAS.findIndex((s) => s.tipo === "grant" && s.objeto === `public.${t}`);
    expect(iR).toBeGreaterThanOrEqual(0);
    expect(posR).toBeGreaterThanOrEqual(0);
    expect(posG).toBeGreaterThan(posR);
  });
});

describe("0216 · privilegios PROHIBIDOS nunca se conceden", () => {
  it.each(PROHIBIDOS)("ningún GRANT incluye %s", (p) => {
    for (const g of grants) {
      expect(g.privs, `grant prohibido: ${g.crudo}`).not.toContain(p);
      expect(g.privs, `grant prohibido (all): ${g.crudo}`).not.toContain("all");
    }
  });

  it("anon no recibe NINGÚN grant", () => {
    for (const g of grants) expect(g.roles).not.toContain("anon");
  });

  it("service_role no se toca (la arquitectura vigente lo usa)", () => {
    for (const s of SENTENCIAS) expect(s.roles).not.toContain("service_role");
  });

  it("TRUNCATE no se deja a cargo de la RLS: se cierra por privilegio", () => {
    // La RLS no filtra TRUNCATE. La única contención posible es el privilegio.
    for (const t of TABLAS) {
      const r = revokes.find((s) => s.objeto === `public.${t}`);
      expect(r!.privs).toEqual(["all"]);
    }
  });
});

describe("0216 · no toca datos, estructura ni objetos de código", () => {
  it("cero DML", () => {
    expect(code).not.toMatch(/\b(insert\s+into|update\s+public|delete\s+from|truncate\s+table)\b/);
  });

  it("cero DDL de esquema, funciones, vistas o policies", () => {
    expect(code).not.toMatch(/\b(create|drop|alter)\s+(table|policy|index|type|view|function|trigger|schema|materialized)\b/);
    // `alter table ... enable row level security` tampoco: la RLS ya está puesta.
    expect(code).not.toMatch(/\brow\s+level\s+security\b/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La matriz contra las operaciones REALES del código.
// 🔴 Corregido tras H-2: distingue si la operación corre con la SESIÓN del usuario
// (`createClient`) o con SERVICE_ROLE (`createAdminClient`). Sólo las primeras
// justifican un grant a `authenticated`; las segundas no lo necesitan.
// ─────────────────────────────────────────────────────────────────────────────

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

describe("0216 · la matriz cubre lo que el código hace CON LA SESIÓN del usuario", () => {
  it.each(TABLAS)("%s: ninguna operación de sesión queda sin privilegio", (t) => {
    const permitidos = new Set(MATRIZ[t]);
    for (const u of usosEnCodigo(t).filter((x) => !x.serviceRole)) {
      // upsert con ignoreDuplicates ⇒ ON CONFLICT DO NOTHING ⇒ basta INSERT.
      const op = u.op === "upsert" ? "insert" : u.op;
      expect(permitidos.has(op), `${t}: ${u.archivo} ejecuta .${u.op}() con la sesión y 0215 no lo concede`).toBe(true);
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
    // Es la premisa de la que depende retirar UPDATE a `authenticated`. Si mañana
    // alguien mueve la decisión humana a la sesión, este test falla y obliga a
    // pasar por la migración explícita que Dirección exige (columnas delimitadas,
    // actor, timestamp, transición de estado, auditoría y pruebas de suplantación).
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
