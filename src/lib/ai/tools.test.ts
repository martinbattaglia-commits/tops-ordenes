// F5.2-lite · Tests estructurales del catálogo: read-only garantizado por
// construcción (D-F5-2), args validados, sin service_role en el módulo.

import { existsSync, readFileSync, readdirSync } from "node:fs";
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
import { METADATA_CARD_ENTITY_TYPES, NO_EVIDENCE } from "./guardrails";

describe("catálogo cerrado read-only", () => {
  it("todas las tools declaradas existen y ninguna extra", () => {
    expect(Object.keys(TOOLS).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("ningún nombre de tool ni RPC sugiere escritura (denylist estructural)", () => {
    for (const [name, spec] of Object.entries(TOOLS)) {
      for (const verb of WRITE_VERBS_DENYLIST) {
        expect(name.toLowerCase()).not.toContain(verb);
        expect((spec.rpc ?? "").toLowerCase()).not.toContain(verb);
      }
    }
  });

  it("solo invoca RPCs del namespace ai_* o connect_search (allowlist)", () => {
    for (const spec of Object.values(TOOLS)) {
      // Tools LOCALES (resolve) leen datos estáticos del repo (p.ej. organigrama):
      // no tocan DB ni RPC → quedan fuera de la allowlist de RPC.
      if (spec.resolve) {
        expect(spec.rpc).toBeUndefined();
        continue;
      }
      expect(
        spec.rpc!.startsWith("ai_") || spec.rpc === "connect_search"
      ).toBe(true);
    }
  });

  it("las tools locales (resolve) NO usan service_role ni tocan Supabase", () => {
    // El test estructural 'sin service_role' cubre todo src/lib/ai; acá afirmamos
    // además que la tool local expone un resolver puro (datos del repo).
    expect(typeof TOOLS.organization_overview.resolve).toBe("function");
    expect(TOOLS.organization_overview.rpc).toBeUndefined();
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

  // P1b (fix/f5-2): `limit` es un tope de resultados, no un arg semántico. Un
  // límite fuera de rango del modelo (Gemini mandó limit>50 → crash real en prod)
  // se CLAMPEA a [1,50], no rompe el turno. La RPC ya re-clampa igual.
  it("clampa limit fuera de rango en vez de tirar (no crashea el turno)", () => {
    const hi = validateToolCall({ tool: "incidents_overview", args: { limit: 100 } });
    expect(hi.limit).toBe(50);
    const lo = validateToolCall({ tool: "tasks_overview", args: { scope: "abiertas", limit: -3 } });
    expect(lo.limit).toBe(1);
    // válido dentro de rango: intacto.
    const ok = validateToolCall({ tool: "incidents_overview", args: { limit: 12 } });
    expect(ok.limit).toBe(12);
  });

  it("args SEMÁNTICOS fuera de rango siguen siendo error duro (no se clampan)", () => {
    // hours/dias tienen significado para la pregunta del usuario → error, no clamp.
    expect(() =>
      validateToolCall({ tool: "ops_digest", args: { hours: 10000 } })
    ).toThrow(ToolArgsError);
    expect(() =>
      validateToolCall({ tool: "tasks_overview", args: { scope: "todas" } })
    ).toThrow(ToolArgsError);
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
  it("compliance_documento/caso → /anmat (Compliance Cockpit; /compliance NO existe → 404)", () => {
    // Fix source-link (fix/f5-2): el módulo Compliance vive en /anmat, no en /compliance.
    expect(entityUrl("compliance_documento", "MAG-04#abc")).toBe("/anmat");
    expect(entityUrl("compliance_caso", "CASO-1")).toBe("/anmat");
  });
  it("incidente y tarea se mantienen", () => {
    expect(entityUrl("connect_incident", "INC-2026-0001")).toBe("/connect/incidentes");
    expect(entityUrl("connect_task", "TSK-2026-0002")).toBe("/connect/tareas");
  });
  it("entity_type CONOCIDO sin public_id → ruta del MÓDULO (chip clickeable, no 404)", () => {
    // Regresión chips (fix/f5-2): ai_compliance_pending devuelve ref=null en prod
    // (15/15 documentos) → exigir publicId dejaba url=null → chip sin link. Todos
    // los deep-links actuales son a nivel MÓDULO: el entityType alcanza.
    expect(entityUrl("contrato", null)).toBe("/comercial/contratos");
    expect(entityUrl("compliance_documento", null)).toBe("/anmat");
    expect(entityUrl("compliance_caso", null)).toBe("/anmat");
    expect(entityUrl("customer_invoice", null)).toBe("/billing");
    expect(entityUrl("supplier_invoice", null)).toBe("/compras/facturas");
    expect(entityUrl("purchase_order", null)).toBe("/compras/ordenes");
    expect(entityUrl("supplier", null)).toBe("/compras/proveedores");
    expect(entityUrl("connect_incident", null)).toBe("/connect/incidentes");
    expect(entityUrl("connect_task", null)).toBe("/connect/tareas");
  });
  it("entity_type DESCONOCIDO → null (nunca inventa URL; el chip queda sin link)", () => {
    expect(entityUrl("cliente", "x")).toBeNull();
    expect(entityUrl("cliente", null)).toBeNull();
    expect(entityUrl("banco", null)).toBeNull();
  });
  it("compliance_pending con ref NULL (caso real prod) → chip con url /anmat", () => {
    const chunk = TOOLS.compliance_pending.rowToChunk({
      kind: "documento",
      ref: null,
      titulo: "Incendio · Póliza",
      estado: "vencido",
    });
    expect(chunk.url).toBe("/anmat");
    expect(chunk.publicId).toBeNull();
  });
});

describe("F5.1-b.0.1 · tools documentales nuevas", () => {
  it("contracts_overview: defaults de toRpcArgs (grano contrato)", () => {
    expect(TOOLS.contracts_overview.toRpcArgs({})).toEqual({
      p_mode: "todos",
      p_dias: 90,
      p_query: null,
      p_limit: 30,
    });
    expect(
      TOOLS.contracts_overview.toRpcArgs({
        mode: "por_vencer",
        dias: 30,
        query: "ANMAT",
        limit: 10,
      })
    ).toEqual({ p_mode: "por_vencer", p_dias: 30, p_query: "ANMAT", p_limit: 10 });
  });

  it("contracts_overview: rowToChunk marca ficha 'contrato' + deep-link + marcador", () => {
    const chunk = TOOLS.contracts_overview.rowToChunk({
      public_id: "CTR-2024-014",
      razon_social: "Distribuidora Ficticia SRL",
      tipo: "locacion",
      estado: "vigente",
      fecha_firma: "2024-03-10",
      fecha_fin: "2026-09-30",
      detalle: "Contrato · locacion · vence 2026-09-30",
    });
    expect(chunk.entityType).toBe("contrato"); // bajo el guard metadata-vs-contenido
    expect(chunk.url).toBe("/comercial/contratos");
    expect(chunk.excerpt).toContain("[ficha metadata]");
    expect(chunk.date).toBe("2026-09-30");
  });

  it("docs_browse: defaults + preserva entity_type documental de la ficha", () => {
    expect(TOOLS.docs_browse.toRpcArgs({})).toEqual({
      p_tipo: null,
      p_query: null,
      p_limit: 30,
    });
    const chunk = TOOLS.docs_browse.rowToChunk({
      entity_type: "compliance_documento",
      entity_id: "x",
      public_id: "MAG-04#abc",
      title: "Habilitación municipal",
      excerpt: "[ficha metadata] ...",
      entity_date: "2026-08-15T03:00:00Z",
    });
    expect(chunk.entityType).toBe("compliance_documento");
    expect(chunk.url).toBe("/anmat");
  });

  it("las 2 tools nuevas usan RPC ai_* de solo lectura (allowlist/denylist)", () => {
    for (const name of ["contracts_overview", "docs_browse"] as const) {
      const spec = TOOLS[name];
      expect(spec.rpc!.startsWith("ai_")).toBe(true);
      for (const verb of WRITE_VERBS_DENYLIST) {
        expect(name).not.toContain(verb);
        expect(spec.rpc).not.toContain(verb);
      }
    }
  });
});

// ── P2 (fix/f5-2): dominios que antes NO tenían tool (facturas/OC/proveedores) ─
describe("P2 · deep-links de facturas/OC/proveedores (entityUrl)", () => {
  it("mapea los nuevos entity_types a rutas internas reales", () => {
    expect(entityUrl("customer_invoice", "A 2-21")).toBe("/billing");
    expect(entityUrl("supplier_invoice", "FC A 00345")).toBe("/compras/facturas");
    expect(entityUrl("purchase_order", "OC-2026-0371")).toBe("/compras/ordenes");
    expect(entityUrl("supplier", "PROV#abc")).toBe("/compras/proveedores");
  });
  it("sin public_id → ruta del módulo (link a nivel módulo, no 404)", () => {
    expect(entityUrl("customer_invoice", null)).toBe("/billing");
    expect(entityUrl("purchase_order", null)).toBe("/compras/ordenes");
  });
  it("los nuevos entity_types NO son fichas de metadata documental (no bajo el guard)", () => {
    // facturas/OC/proveedores son registros estructurados (como incidentes/tareas),
    // NO documentos — el guard metadata-vs-contenido no debe tocarlos.
    for (const t of ["customer_invoice", "supplier_invoice", "purchase_order", "supplier"]) {
      expect(METADATA_CARD_ENTITY_TYPES.has(t)).toBe(false);
    }
  });
});

// ── Anti-404 (fix/f5-2): todo deep-link debe resolver a una page.tsx REAL. Este
// test habría atrapado el bug de compliance → /compliance (ruta inexistente). ─────
describe("deep-links resuelven a rutas reales del App Router (anti-404)", () => {
  const APP = join(process.cwd(), "src", "app", "(app)");
  const routeFileExists = (url: string | null): boolean =>
    !!url && existsSync(join(APP, ...url.replace(/^\//, "").split("/"), "page.tsx"));

  it("cada entity_type conocido mapea a una page.tsx existente (no 404)", () => {
    const cases: Array<[string, string]> = [
      ["connect_incident", "INC-2026-0001"],
      ["connect_task", "TSK-2026-0002"],
      ["compliance_documento", "MAG-04#abc"],
      ["compliance_caso", "CASO-1"],
      ["contrato", "CTR#abc"],
      ["customer_invoice", "A 2-21"],
      ["supplier_invoice", "FC 00345"],
      ["purchase_order", "OC-2026-0371"],
      ["supplier", "PROV#abc"],
      ["organization_member", "org-pres"],
    ];
    for (const [et, pid] of cases) {
      const url = entityUrl(et, pid);
      expect(url, `${et} sin URL`).not.toBeNull();
      expect(routeFileExists(url), `${et} → ${url} no existe como page.tsx`).toBe(true);
    }
  });

  it("URLs hardcodeadas en tools resuelven a rutas reales (compliance_pending)", () => {
    // compliance_pending es la tool que responde "documentos de compliance pendientes":
    // su chip debe ir a una ruta real (era /compliance = 404).
    const chunk = TOOLS.compliance_pending.rowToChunk({
      kind: "documento",
      ref: "MAG-04",
      titulo: "Habilitación municipal",
      estado: "por_vencer",
    });
    expect(chunk.entityType).toBe("compliance_documento");
    expect(routeFileExists(chunk.url), `compliance_pending → ${chunk.url}`).toBe(true);
  });
});

describe("P2 · customer_invoices_overview", () => {
  it("defaults + mapeo de args", () => {
    expect(TOOLS.customer_invoices_overview.toRpcArgs({})).toEqual({
      p_mode: "recientes",
      p_query: null,
      p_limit: 30,
    });
    expect(
      TOOLS.customer_invoices_overview.toRpcArgs({ mode: "ultima", query: "ACME", limit: 5 })
    ).toEqual({ p_mode: "ultima", p_query: "ACME", p_limit: 5 });
  });
  it("rowToChunk: factura emitida con fuente /billing", () => {
    const chunk = TOOLS.customer_invoices_overview.rowToChunk({
      public_id: "FACTURA_A 2-21",
      razon_social: "ACME SA",
      total: "2118710.00",
      fecha: "2026-07-01",
      estado: "AUTORIZADO_ARCA",
      detalle: "Factura · cliente ACME SA · total ARS 2.118.710,00 · AUTORIZADO_ARCA",
    });
    expect(chunk.entityType).toBe("customer_invoice");
    expect(chunk.url).toBe("/billing");
    expect(chunk.publicId).toBe("FACTURA_A 2-21");
    expect(chunk.date).toBe("2026-07-01");
    expect(chunk.title.toLowerCase()).toContain("acme");
  });
});

describe("P2 · supplier_invoices_overview", () => {
  it("defaults + mapeo de args", () => {
    expect(TOOLS.supplier_invoices_overview.toRpcArgs({})).toEqual({
      p_mode: "recientes",
      p_query: null,
      p_limit: 30,
    });
    expect(
      TOOLS.supplier_invoices_overview.toRpcArgs({ mode: "pendientes_aprobacion", limit: 10 })
    ).toEqual({ p_mode: "pendientes_aprobacion", p_query: null, p_limit: 10 });
  });
  it("rowToChunk: factura de proveedor con fuente /compras/facturas", () => {
    const chunk = TOOLS.supplier_invoices_overview.rowToChunk({
      public_id: "FACTURA_A 00345",
      proveedor: "Proveedor Ficticio SRL",
      total: "12100.00",
      fecha: "2026-06-28",
      estado: "pendiente",
      detalle: "Factura de proveedor · Proveedor Ficticio SRL · total ARS 12.100,00 · cargada",
    });
    expect(chunk.entityType).toBe("supplier_invoice");
    expect(chunk.url).toBe("/compras/facturas");
    expect(chunk.date).toBe("2026-06-28");
  });
});

describe("P2 · purchase_orders_overview", () => {
  it("defaults + mapeo de args", () => {
    expect(TOOLS.purchase_orders_overview.toRpcArgs({})).toEqual({
      p_mode: "recientes",
      p_query: null,
      p_limit: 30,
    });
    expect(TOOLS.purchase_orders_overview.toRpcArgs({ mode: "ultima" })).toEqual({
      p_mode: "ultima",
      p_query: null,
      p_limit: 30,
    });
  });
  it("rowToChunk: OC con fuente /compras/ordenes", () => {
    const chunk = TOOLS.purchase_orders_overview.rowToChunk({
      public_id: "OC-2026-0371",
      proveedor: "Proveedor Ficticio SRL",
      total: "45000.00",
      fecha: "2026-07-06",
      estado: "firmada",
      detalle: "Orden de compra · Proveedor Ficticio SRL · total ARS 45.000,00 · firmada",
    });
    expect(chunk.entityType).toBe("purchase_order");
    expect(chunk.url).toBe("/compras/ordenes");
    expect(chunk.publicId).toBe("OC-2026-0371");
    expect(chunk.date).toBe("2026-07-06");
  });
});

describe("P2 · suppliers_overview", () => {
  it("defaults + mapeo de args", () => {
    expect(TOOLS.suppliers_overview.toRpcArgs({})).toEqual({ p_query: null, p_limit: 15 });
    expect(TOOLS.suppliers_overview.toRpcArgs({ query: "ACME", limit: 5 })).toEqual({
      p_query: "ACME",
      p_limit: 5,
    });
  });
  it("rowToChunk: proveedor con fuente /compras/proveedores", () => {
    const chunk = TOOLS.suppliers_overview.rowToChunk({
      public_id: "PROV#abc12345",
      razon: "Proveedor Ficticio SRL",
      categoria: "insumos",
      detalle: "Proveedor · insumos · activo",
    });
    expect(chunk.entityType).toBe("supplier");
    expect(chunk.url).toBe("/compras/proveedores");
    expect(chunk.title.toLowerCase()).toContain("proveedor ficticio");
  });
});

// ── Organigrama (fix/f5-2): cobertura del módulo institucional ───────────────
describe("organization_overview · organigrama institucional", () => {
  it("es una tool LOCAL (resolve desde orgchart.ts, sin RPC)", () => {
    expect(typeof TOOLS.organization_overview.resolve).toBe("function");
    expect(TOOLS.organization_overview.rpc).toBeUndefined();
    // el resolver responde al presidente
    const rows = TOOLS.organization_overview.resolve!({ query: "presidente" });
    expect(rows.some((r) => /battaglia/i.test(String(r.name)))).toBe(true);
  });

  it("toRpcArgs pasa query/limit (aunque no haya RPC, mantiene contrato)", () => {
    expect(TOOLS.organization_overview.toRpcArgs({})).toEqual({ query: null, limit: 30 });
    expect(TOOLS.organization_overview.toRpcArgs({ query: "comercial", limit: 5 })).toEqual({
      query: "comercial",
      limit: 5,
    });
  });

  it("rowToChunk: miembro con fuente /organigrama, sin PII", () => {
    const chunk = TOOLS.organization_overview.rowToChunk({
      name: "Martín F. Battaglia",
      role: "Presidente · CEO",
      area: "Dirección",
      detail: "Estrategia · Finanzas",
    });
    expect(chunk.entityType).toBe("organization_member");
    expect(chunk.url).toBe("/organigrama");
    expect(chunk.title).toContain("Battaglia");
    expect(chunk.excerpt.toLowerCase()).toContain("presidente");
    expect(chunk.excerpt).not.toMatch(/@/); // sin emails
  });

  it("entityUrl(organization_member) → /organigrama incluso sin public_id", () => {
    expect(entityUrl("organization_member", null)).toBe("/organigrama");
    expect(entityUrl("organigrama", "x")).toBe("/organigrama");
  });
});

// ── Analytics (fix/f5-2): agregados determinísticos — SQL calcula, el modelo narra ─
describe("analytics · billing_summary / bank_balances / supplier_spend", () => {
  it("billing_summary: defaults + entityType billing_periodo → /billing", () => {
    expect(TOOLS.billing_summary.toRpcArgs({})).toEqual({ p_mode: "ultimo_mes", p_meses: 3 });
    const chunk = TOOLS.billing_summary.rowToChunk({
      periodo: "2026-06",
      total: "126229317.50",
      cantidad: 18,
      desde: "2026-06-01",
      hasta: "2026-06-30",
      detalle: "Facturación 2026-06 · ARS 126,229,317.50 · 18 facturas",
    });
    expect(chunk.entityType).toBe("billing_periodo");
    expect(chunk.url).toBe("/billing");
    expect(chunk.title).toContain("2026-06");
  });

  it("bank_balances_overview: defaults + entityType bank_balance → /tesoreria/bancos", () => {
    expect(TOOLS.bank_balances_overview.toRpcArgs({})).toEqual({ p_query: null, p_limit: 15 });
    expect(TOOLS.bank_balances_overview.toRpcArgs({ query: "santander" })).toEqual({
      p_query: "santander",
      p_limit: 15,
    });
    const chunk = TOOLS.bank_balances_overview.rowToChunk({
      bank_name: "Banco Ficticio",
      account_name: "Cta corriente",
      balance: "56751532.00",
      detalle: "Banco Ficticio · saldo ARS 56,751,532.00",
    });
    expect(chunk.entityType).toBe("bank_balance");
    expect(chunk.url).toBe("/tesoreria/bancos");
  });

  it("supplier_spend_overview: defaults + url según base (gasto→facturas, compromiso→ordenes)", () => {
    expect(TOOLS.supplier_spend_overview.toRpcArgs({})).toEqual({
      p_base: "gasto",
      p_periodo: "todo",
      p_limit: 10,
    });
    const gasto = TOOLS.supplier_spend_overview.rowToChunk({
      proveedor: "Proveedor Ficticio SA",
      total: "11000000.00",
      cantidad: 2,
      periodo: "todo",
      base: "gasto",
      detalle: "Gasto · Proveedor Ficticio SA · ARS 11,000,000.00 · 2 facturas",
    });
    expect(gasto.entityType).toBe("supplier_spend");
    expect(gasto.url).toBe("/compras/facturas");
    const compromiso = TOOLS.supplier_spend_overview.rowToChunk({
      proveedor: "Proveedor Ficticio SA",
      total: "579870471.00",
      cantidad: 3,
      periodo: "todo",
      base: "compromiso",
      detalle: "Compromiso · OC firmadas",
    });
    expect(compromiso.url).toBe("/compras/ordenes");
  });

  it("las 3 tools analíticas son ai_* read-only (allowlist/denylist)", () => {
    for (const name of ["billing_summary", "bank_balances_overview", "supplier_spend_overview"] as const) {
      const spec = TOOLS[name];
      expect(spec.rpc!.startsWith("ai_")).toBe(true);
      for (const verb of WRITE_VERBS_DENYLIST) {
        expect(name.toLowerCase()).not.toContain(verb);
        expect(spec.rpc!.toLowerCase()).not.toContain(verb);
      }
    }
  });
});

// ── Catálogo de secciones de Nexus (fix/f5-2): navegación consultable ─────────
describe("nexus_sections_overview · catálogo de secciones", () => {
  it("es tool LOCAL (resolve, sin RPC) y encuentra secciones por palabra clave", () => {
    expect(typeof TOOLS.nexus_sections_overview.resolve).toBe("function");
    expect(TOOLS.nexus_sections_overview.rpc).toBeUndefined();
    const oc = TOOLS.nexus_sections_overview.resolve!({ query: "ordenes de compra" });
    expect(oc.length).toBeGreaterThan(0);
    expect(String(oc[0].route)).toBe("/compras/ordenes");
    const track = TOOLS.nexus_sections_overview.resolve!({ query: "tracking" });
    expect(track.some((r) => String(r.route).includes("tracking"))).toBe(true);
  });

  it("sin query devuelve el mapa de secciones (varias)", () => {
    expect(TOOLS.nexus_sections_overview.resolve!({}).length).toBeGreaterThan(10);
  });

  it("rowToChunk: usa la ruta de la fila (cada sección linkea a SU página real)", () => {
    const chunk = TOOLS.nexus_sections_overview.rowToChunk({
      label: "Órdenes de compra",
      section: "Compras · Proveedores",
      route: "/compras/ordenes",
      detalle: "Sección Compras · Órdenes de compra",
    });
    expect(chunk.entityType).toBe("nexus_section");
    expect(chunk.url).toBe("/compras/ordenes");
  });

  it("anti-404: TODAS las rutas del catálogo resuelven a una page.tsx real", () => {
    const APP = join(process.cwd(), "src", "app", "(app)");
    for (const row of TOOLS.nexus_sections_overview.resolve!({ limit: 50 })) {
      const url = String(row.route);
      const ok = existsSync(join(APP, ...url.replace(/^\//, "").split("/"), "page.tsx"));
      expect(ok, `sección '${row.label}' → ${url} no existe como page.tsx`).toBe(true);
    }
  });
});

describe("P2 · las 4 tools nuevas son ai_* read-only", () => {
  it("allowlist ai_* + denylist de verbos de escritura", () => {
    for (const name of [
      "customer_invoices_overview",
      "supplier_invoices_overview",
      "purchase_orders_overview",
      "suppliers_overview",
    ] as const) {
      const spec = TOOLS[name];
      expect(spec.rpc!.startsWith("ai_")).toBe(true);
      for (const verb of WRITE_VERBS_DENYLIST) {
        expect(name.toLowerCase()).not.toContain(verb);
        expect(spec.rpc!.toLowerCase()).not.toContain(verb);
      }
    }
  });
});
