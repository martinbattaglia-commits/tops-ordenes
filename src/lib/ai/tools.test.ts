// F5.2-lite · Tests estructurales del catálogo: read-only garantizado por
// construcción (D-F5-2), args validados, sin service_role en el módulo.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TOOLS,
  TOOL_INPUT_SCHEMAS,
  WRITE_VERBS_DENYLIST,
  entityUrl,
  toProviderTools,
} from "./tools";
import { TOOL_NAMES } from "./types";
import { validateToolCall, ToolArgsError } from "./data";
import { SYSTEM_PROMPT } from "./prompts/system.v1";
import { NO_EVIDENCE } from "./guardrails";

describe("catálogo cerrado read-only", () => {
  it("todas las tools declaradas existen y ninguna extra", () => {
    expect(Object.keys(TOOLS).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("ningún nombre de tool ni RPC sugiere escritura (denylist estructural)", () => {
    for (const [name, spec] of Object.entries(TOOLS)) {
      for (const verb of WRITE_VERBS_DENYLIST) {
        expect(name.toLowerCase()).not.toContain(verb);
        expect(spec.rpc.toLowerCase()).not.toContain(verb);
      }
    }
  });

  it("solo invoca RPCs del namespace ai_* o connect_search (allowlist)", () => {
    for (const spec of Object.values(TOOLS)) {
      expect(
        spec.rpc.startsWith("ai_") || spec.rpc === "connect_search"
      ).toBe(true);
    }
  });
});

describe("schemas JSON para el provider real (paridad con el catálogo)", () => {
  it("todas las tools tienen input_schema con additionalProperties:false", () => {
    for (const name of Object.keys(TOOLS)) {
      const schema = TOOL_INPUT_SCHEMAS[name as keyof typeof TOOL_INPUT_SCHEMAS];
      expect(schema, name).toBeDefined();
      expect(schema.type, name).toBe("object");
      expect(schema.additionalProperties, name).toBe(false);
      expect(Array.isArray(schema.required), name).toBe(true);
    }
  });
  it("toProviderTools produce una entrada por tool con descripción", () => {
    const tools = toProviderTools();
    expect(tools).toHaveLength(Object.keys(TOOLS).length);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(10);
    }
  });
});

describe("validación de args (zod antes de la RPC)", () => {
  it("rechaza tool desconocida", () => {
    expect(() =>
      validateToolCall({ tool: "drop_tables" as never, args: {} })
    ).toThrow(ToolArgsError);
  });
  it("rechaza args fuera de schema", () => {
    expect(() =>
      validateToolCall({ tool: "search_knowledge", args: { query: "x" } })
    ).toThrow(ToolArgsError); // query < 2 chars
    expect(() =>
      validateToolCall({ tool: "tasks_overview", args: { scope: "todas" } })
    ).toThrow(ToolArgsError);
    expect(() =>
      validateToolCall({ tool: "ops_digest", args: { hours: 10000 } })
    ).toThrow(ToolArgsError);
  });
  it("acepta args válidos y aplica defaults en toRpcArgs", () => {
    const args = validateToolCall({
      tool: "incidents_overview",
      args: { severidades: ["critica"] },
    });
    const rpcArgs = TOOLS.incidents_overview.toRpcArgs(args);
    expect(rpcArgs).toMatchObject({ p_severidades: ["critica"], p_limit: 30 });
  });
});

describe("sin service_role en el módulo ai (retrieval = sesión del usuario)", () => {
  it("ningún archivo de src/lib/ai importa createAdminClient ni la key", () => {
    const dir = join(process.cwd(), "src", "lib", "ai");
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]
      );
    const files = walk(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts")
    );
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toContain("createAdminClient");
      expect(src, f).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });
});

describe("system prompt", () => {
  it("contiene la frase exacta de no-evidencia (una sola fuente de verdad)", () => {
    expect(SYSTEM_PROMPT).toContain(NO_EVIDENCE);
  });
  it("declara el contenido de nexus_source como datos, no instrucciones", () => {
    expect(SYSTEM_PROMPT).toContain("nexus_source");
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("no instrucciones");
  });
  it("declara la regla de fichas de metadata (F5.1-b.0 · D5)", () => {
    expect(SYSTEM_PROMPT).toContain("[ficha metadata]");
  });
});

describe("entityUrl — deep-links (F5.1-b.0 · D6 / A5)", () => {
  it("contrato → /comercial/contratos (branch nuevo)", () => {
    expect(entityUrl("contrato", "CTR#abc123")).toBe("/comercial/contratos");
    expect(entityUrl("contract", "X")).toBe("/comercial/contratos");
  });
  it("compliance_documento → /compliance (regresión, sigue mapeando)", () => {
    expect(entityUrl("compliance_documento", "MAG-04#abc")).toBe("/compliance");
  });
  it("incidente y tarea se mantienen", () => {
    expect(entityUrl("connect_incident", "INC-2026-0001")).toBe("/connect/incidentes");
    expect(entityUrl("connect_task", "TSK-2026-0002")).toBe("/connect/tareas");
  });
  it("sin public_id → null (nunca inventa URL)", () => {
    expect(entityUrl("contrato", null)).toBeNull();
  });
  it("entity_type desconocido → null", () => {
    expect(entityUrl("cliente", "x")).toBeNull();
  });
});
