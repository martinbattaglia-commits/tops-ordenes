/**
 * P3-N4 · Cierre de las deudas previas a la activación detectadas por el
 * Commit Guardian y el Release Guardian de P3-N3.
 *
 * N4-1 desborde de filas de origen · N4-2 unidades de negocio vacías ·
 * N4-3 determinismo FEFO · N4-4 límite global de respuesta · N4-5 coste de
 * construcción de puertos por request.
 *
 * 🔴 Todo secreto de este archivo es un canario evidente. Ninguna prueba toca
 * Supabase, el WMS ni la red: los puertos entran siempre por inyección.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  createInventoryRequestHandler,
  readInventoryRuntimeConfiguration,
  type InventoryOperationalPorts,
  type InventoryRuntimeConfiguration,
} from "./wms/inventory/composition";
import {
  INVENTORY_MAX_RESPONSE_BYTES,
  INVENTORY_PERMISSION,
  type InventoryRepositoryPage,
} from "./wms/inventory/contract";
import { createInventoryHandler } from "./wms/inventory/handler";
import { createSupabaseInventoryRepository } from "./wms/inventory/supabase-ports";

// ---------------------------------------------------------------------------
// Material de prueba
// ---------------------------------------------------------------------------

const CORRELATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const CLIENT_ID = "51f418dc-8b82-4f6b-a9c6-595570e87290";
const SECRET = "p3-n4-canary-secret-never-real";
const MAX_SOURCE_ROWS = 25;

const utf8 = (value: string): number => new TextEncoder().encode(value).byteLength;

const configuration = (
  overrides: Partial<InventoryRuntimeConfiguration> = {},
): InventoryRuntimeConfiguration => ({
  bindings: [
    {
      id: "nexus-os",
      secret: SECRET,
      permissions: [INVENTORY_PERMISSION],
      clientId: CLIENT_ID,
      businessUnits: ["ANMAT", "GENERAL"],
    },
  ],
  timeoutMs: 1_000,
  rateLimit: 60,
  rateWindowMs: 60_000,
  maxSourceRows: MAX_SOURCE_ROWS,
  ...overrides,
});

const repositoryRow = (overrides: Record<string, unknown> = {}) => ({
  clientId: CLIENT_ID,
  businessUnit: "ANMAT" as const,
  sku: "SKU-001",
  description: "Producto regulado",
  lotNumber: "LOT-9",
  date: "2027-12-31",
  availableQuantity: 8,
  reservedQuantity: 2,
  location: { kind: "external_label" as const, value: "WH·F1·S1·Z1·R1·P1" },
  status: "Disponible" as const,
  ...overrides,
});

const page = (overrides: Partial<InventoryRepositoryPage> = {}): InventoryRepositoryPage => ({
  rows: [repositoryRow()],
  rowsEvaluated: 1,
  total: 1,
  summary: { totalSkus: 1, byBusinessUnit: { ANMAT: 1, GENERAL: 0, CORPORATE: 0, unresolved: 0 } },
  updatedAt: "2026-08-05T12:00:00.000Z",
  warnings: [{ code: "location_unavailable" as const, count: 0 }].filter(() => false),
  ...overrides,
});

const operationalPorts = (
  overrides: Partial<InventoryOperationalPorts> = {},
): InventoryOperationalPorts => ({
  repository: { query: vi.fn(async () => page()) },
  rateLimit: { consume: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) },
  audit: { record: vi.fn(async () => undefined) },
  observer: { emit: vi.fn(async () => undefined) },
  ...overrides,
});

const handlerWith = (
  ports: InventoryOperationalPorts = operationalPorts(),
  config: InventoryRuntimeConfiguration = configuration(),
) =>
  createInventoryRequestHandler({
    loadConfiguration: () => config,
    createPorts: vi.fn(async () => ports),
    now: () => new Date("2026-08-05T12:00:00.000Z"),
    createCorrelationId: () => CORRELATION_ID,
  });

const request = (query = "", headers: Record<string, string> = {}) =>
  new Request(`https://internal.test/api/internal/wms/inventory${query}`, {
    headers: { authorization: `Bearer ${SECRET}`, ...headers },
  });

// ---------------------------------------------------------------------------
// Doble del cliente Supabase — sin red, sin credenciales
// ---------------------------------------------------------------------------

interface FakeResult { data?: unknown; error?: unknown; count?: number }

class FakeQuery {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  constructor(private readonly result: FakeResult) {}
  select(...args: unknown[]) { this.calls.push({ method: "select", args }); return this; }
  eq(...args: unknown[]) { this.calls.push({ method: "eq", args }); return this; }
  in(...args: unknown[]) { this.calls.push({ method: "in", args }); return this; }
  limit(...args: unknown[]) { this.calls.push({ method: "limit", args }); return this; }
  gte(...args: unknown[]) { this.calls.push({ method: "gte", args }); return this; }
  abortSignal(...args: unknown[]) { this.calls.push({ method: "abortSignal", args }); return this; }
  then<A = FakeResult, B = never>(
    onfulfilled?: ((value: FakeResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class FakeSupabase {
  readonly queries: Array<{ table: string; query: FakeQuery }> = [];
  constructor(private readonly result: FakeResult) {}
  from(table: string): FakeQuery {
    const query = new FakeQuery(this.result);
    this.queries.push({ table, query });
    return query;
  }
}

const asClient = (fake: FakeSupabase) => fake as unknown as SupabaseClient;

const position = {
  code: "P1",
  rack: { code: "R1", zone: { code: "Z1", sector: { code: "S1", floor: {
    code: "F1", warehouse: { code: "WH" },
  } } } },
};

const sourceRow = (overrides: Record<string, unknown> = {}) => ({
  client_id: CLIENT_ID,
  business_unit: "ANMAT",
  sku: "SKU-001",
  description: "Producto regulado",
  stock_available: "8.000",
  stock_reserved: "2.000",
  lots: [
    { lot_number: "LATE", expiration_date: "2028-12-31", quantity: "4.000", active: true },
    { lot_number: "FEFO", expiration_date: "2027-01-15", quantity: "6.000", active: true },
  ],
  position,
  ...overrides,
});

const sourceRows = (count: number) =>
  Array.from({ length: count }, (_, i) => sourceRow({ sku: `SKU-${String(i).padStart(4, "0")}` }));

const repositoryQuery = {
  clientId: CLIENT_ID,
  businessUnits: ["ANMAT"] as const,
  page: 1,
  pageSize: 50,
  sort: "sku:asc" as const,
};

// ===========================================================================
// N4-1 · Desborde de filas de origen
// ===========================================================================

describe("P3-N4-1 · desborde de filas de origen", () => {
  const repositoryFor = (rows: number) => {
    const fake = new FakeSupabase({ data: sourceRows(rows), error: null });
    return {
      fake,
      repository: createSupabaseInventoryRepository(asClient(fake), {
        timeoutMs: 1_000,
        maxSourceRows: MAX_SOURCE_ROWS,
      }),
    };
  };

  it("🔴 pide UNA fila sonda adicional para poder DETECTAR el desborde", async () => {
    const { fake, repository } = repositoryFor(1);
    await repository.query({ ...repositoryQuery, businessUnits: ["ANMAT"] });
    expect(fake.queries[0]?.query.calls).toContainEqual({
      method: "limit",
      args: [MAX_SOURCE_ROWS + 1],
    });
  });

  it("acepta exactamente maxSourceRows: el tope es inclusivo", async () => {
    const { repository } = repositoryFor(MAX_SOURCE_ROWS);
    const result = await repository.query({ ...repositoryQuery, businessUnits: ["ANMAT"] });
    expect(result.total).toBe(MAX_SOURCE_ROWS);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("🔴 rechaza maxSourceRows + 1 por completo: ni una fila, ni una respuesta parcial", async () => {
    const { repository } = repositoryFor(MAX_SOURCE_ROWS + 1);
    await expect(repository.query({ ...repositoryQuery, businessUnits: ["ANMAT"] })).rejects.toThrow();
  });

  it("🔴 el desborde llega al cliente como 503 sin datos y SIN auditoría exitosa", async () => {
    const fake = new FakeSupabase({ data: sourceRows(MAX_SOURCE_ROWS + 1), error: null });
    const repository = createSupabaseInventoryRepository(asClient(fake), {
      timeoutMs: 1_000,
      maxSourceRows: MAX_SOURCE_ROWS,
    });
    const audits: unknown[] = [];
    const ports = operationalPorts({
      repository,
      audit: { record: vi.fn(async (event) => { audits.push(event); }) },
    });

    const response = await handlerWith(ports)(request());
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("nexus_unavailable");
    // Cero truncamiento: no hay `data`, ni filas parciales, ni paginación.
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("SKU-");
    // Cero auditoría exitosa.
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ outcome: "nexus_unavailable", rowsReturned: 0, rowsEvaluated: 0 });
  });
});

// ===========================================================================
// N4-2 · Unidades de negocio vacías
// ===========================================================================

describe("P3-N4-2 · unidades de negocio inválidas en el binding", () => {
  const source = (businessUnits: unknown) => ({
    WMS_INVENTORY_OPERATIONAL_ENABLED: "1",
    WMS_INVENTORY_M2M_BINDINGS_JSON: JSON.stringify([
      {
        id: "nexus-os",
        secret: SECRET,
        permissions: [INVENTORY_PERMISSION],
        clientId: CLIENT_ID,
        businessUnits,
      },
    ]),
  }) as unknown as NodeJS.ProcessEnv;

  it("🔴 rechaza businessUnits vacío en la frontera más temprana: no hay configuración", () => {
    expect(readInventoryRuntimeConfiguration(source([]))).toBeNull();
  });

  it("rechaza unidades duplicadas, desconocidas y mezclas inválidas", () => {
    expect(readInventoryRuntimeConfiguration(source(["ANMAT", "ANMAT"]))).toBeNull();
    expect(readInventoryRuntimeConfiguration(source(["CORPORATE"]))).toBeNull();
    expect(readInventoryRuntimeConfiguration(source(["ANMAT", "DESCONOCIDA"]))).toBeNull();
    expect(readInventoryRuntimeConfiguration(source("ANMAT"))).toBeNull();
    expect(readInventoryRuntimeConfiguration(source([""]))).toBeNull();
  });

  it("acepta el conjunto válido: la prueba anterior no es vacua", () => {
    expect(readInventoryRuntimeConfiguration(source(["ANMAT", "GENERAL"]))).not.toBeNull();
  });

  it("🔴 con binding vacío NO se consulta repositorio ni rate limiter", async () => {
    const ports = operationalPorts();
    const handler = createInventoryRequestHandler({
      loadConfiguration: () => readInventoryRuntimeConfiguration(source([])),
      createPorts: vi.fn(async () => ports),
      createCorrelationId: () => CORRELATION_ID,
    });

    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(ports.repository.query).not.toHaveBeenCalled();
    expect(ports.rateLimit.consume).not.toHaveBeenCalled();
  });

  it("🔴 ningún dato del caller completa un binding vacío", async () => {
    const handler = createInventoryRequestHandler({
      loadConfiguration: () => readInventoryRuntimeConfiguration(source([])),
      createPorts: vi.fn(async () => operationalPorts()),
      createCorrelationId: () => CORRELATION_ID,
    });

    for (const attempt of [
      "?line=REGULADO_ANMAT",
      "?businessUnits=ANMAT",
      "?businessUnit=ANMAT",
    ]) {
      const response = await handler(request(attempt, { "x-business-unit": "ANMAT" }));
      expect(response.status).not.toBe(200);
      expect(await response.text()).not.toContain("SKU-");
    }
  });

  it("🔴 la SEGUNDA barrera sigue viva: assertValidScope rechaza un scope vacío", async () => {
    const ports = operationalPorts();
    const handler = createInventoryHandler({
      authenticator: {
        async authenticate() {
          return { kind: "authenticated", principal: { id: "nexus-os", permissions: [INVENTORY_PERMISSION] } };
        },
      },
      // Resolutor degradado que se salta parseBinding: la defensa en profundidad
      // debe seguir deteniéndolo aunque la primera frontera fuese burlada.
      scopeResolver: { async resolve() { return { clientId: CLIENT_ID, businessUnits: [] }; } },
      repository: ports.repository,
      rateLimit: ports.rateLimit,
      audit: ports.audit,
      // `observer` es opcional en los puertos operativos y obligatorio en el
      // handler: el typecheck lo detecta aunque las suites pasen, porque vitest
      // hace type-stripping y no comprueba tipos.
      observer: ports.observer ?? { emit() {} },
      createCorrelationId: () => CORRELATION_ID,
    });

    const response = await handler(request());
    expect(response.status).toBe(403);
    expect(ports.repository.query).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// N4-3 · Determinismo FEFO
// ===========================================================================

describe("P3-N4-3 · determinismo del orden FEFO", () => {
  const PORTS_SOURCE = fileURLToPath(new URL("./wms/inventory/supabase-ports.ts", import.meta.url));

  it("🔴 la selección de lotes no depende del ICU: cero localeCompare en el módulo", () => {
    const source = readFileSync(PORTS_SOURCE, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(source).not.toContain("localeCompare");
  });

  it("🔴 desempata lotes por punto de código, no por colación local", async () => {
    // Con `localeCompare('es')`, «á» precede a «b». Por punto de código,
    // U+00E1 va DESPUÉS de U+0062. Misma fecha ⇒ el lote elegido difiere y la
    // prueba distingue un comparador del otro.
    const fake = new FakeSupabase({
      data: [sourceRow({
        lots: [
          { lot_number: "LOT-á", expiration_date: "2027-01-15", quantity: "5.000", active: true },
          { lot_number: "LOT-b", expiration_date: "2027-01-15", quantity: "5.000", active: true },
        ],
      })],
      error: null,
    });
    const repository = createSupabaseInventoryRepository(asClient(fake), {
      timeoutMs: 1_000,
      maxSourceRows: MAX_SOURCE_ROWS,
    });

    const result = await repository.query({ ...repositoryQuery, businessUnits: ["ANMAT"] });
    expect(result.rows[0]?.lotNumber).toBe("LOT-b");
  });

  it("la fecha manda sobre el lote: FEFO real", async () => {
    const fake = new FakeSupabase({
      data: [sourceRow({
        lots: [
          { lot_number: "AAA", expiration_date: "2029-01-01", quantity: "5.000", active: true },
          { lot_number: "ZZZ", expiration_date: "2027-01-15", quantity: "5.000", active: true },
        ],
      })],
      error: null,
    });
    const repository = createSupabaseInventoryRepository(asClient(fake), {
      timeoutMs: 1_000,
      maxSourceRows: MAX_SOURCE_ROWS,
    });

    const result = await repository.query({ ...repositoryQuery, businessUnits: ["ANMAT"] });
    expect(result.rows[0]).toMatchObject({ lotNumber: "ZZZ", date: "2027-01-15" });
  });
});

// ===========================================================================
// N4-4 · Límite global de respuesta
// ===========================================================================

describe("P3-N4-4 · ninguna respuesta supera 1.048.576 bytes UTF-8", () => {
  /** Construye una descripción ASCII que lleva el cuerpo a exactamente `target` bytes. */
  const pageWithResponseBytes = async (target: number, filler = "A"): Promise<InventoryRepositoryPage> => {
    const measure = async (length: number): Promise<number> => {
      const ports = operationalPorts({
        repository: { query: vi.fn(async () => page({ rows: [repositoryRow({ description: filler.repeat(length) })] })) },
      });
      return utf8(await (await handlerWith(ports)(request())).text());
    };
    const unit = utf8(filler);
    const base = await measure(1);
    const needed = Math.max(1, Math.round((target - base) / unit) + 1);
    let length = needed;
    for (let i = 0; i < 6; i += 1) {
      const got = await measure(length);
      if (got === target) break;
      length += Math.round((target - got) / unit);
      if (length < 1) { length = 1; break; }
    }
    return page({ rows: [repositoryRow({ description: filler.repeat(length) })] });
  };

  const respond = async (source: InventoryRepositoryPage, headers: Record<string, string> = {}) => {
    const audits: any[] = [];
    const ports = operationalPorts({
      repository: { query: vi.fn(async () => source) },
      audit: { record: vi.fn(async (e) => { audits.push(e); }) },
    });
    const response = await handlerWith(ports)(request("", headers));
    const text = await response.text();
    return { response, text, bytes: utf8(text), audits };
  };

  it("MAX − 1 se entrega", async () => {
    const { response, bytes } = await respond(await pageWithResponseBytes(INVENTORY_MAX_RESPONSE_BYTES - 1));
    expect(bytes).toBe(INVENTORY_MAX_RESPONSE_BYTES - 1);
    expect(response.status).toBe(200);
  });

  it("MAX exacto se entrega: el tope es inclusivo", async () => {
    const { response, bytes } = await respond(await pageWithResponseBytes(INVENTORY_MAX_RESPONSE_BYTES));
    expect(bytes).toBe(INVENTORY_MAX_RESPONSE_BYTES);
    expect(response.status).toBe(200);
  });

  it("🔴 MAX + 1 se rechaza entero, sin truncar", async () => {
    const { response, text, bytes, audits } = await respond(
      await pageWithResponseBytes(INVENTORY_MAX_RESPONSE_BYTES + 1),
    );
    expect(response.status).toBe(502);
    expect(bytes).toBeLessThanOrEqual(INVENTORY_MAX_RESPONSE_BYTES);
    expect(JSON.parse(text).error.code).toBe("nexus_bad_response");
    expect(JSON.parse(text).data).toBeUndefined();
    // 🔴 La auditoría exitosa sólo puede ocurrir tras validar el cuerpo.
    expect(audits[0]).toMatchObject({ outcome: "nexus_bad_response", rowsReturned: 0 });
  });

  it("🔴 multibyte: caben las unidades UTF-16 pero no los bytes ⇒ rechazo", async () => {
    // «€» ocupa 3 bytes y 1 unidad UTF-16: un control que midiera `.length`
    // dejaría pasar un cuerpo de casi 3 MiB.
    const source = await pageWithResponseBytes(INVENTORY_MAX_RESPONSE_BYTES + 3, "€");
    const { response, bytes } = await respond(source);
    expect(response.status).toBe(502);
    expect(bytes).toBeLessThanOrEqual(INVENTORY_MAX_RESPONSE_BYTES);
  });

  it("🔴 un x-correlation-id gigante NO puede inflar la respuesta de error", async () => {
    const huge = "x".repeat(2 * INVENTORY_MAX_RESPONSE_BYTES);
    const { response, text, bytes } = await respond(page(), { "x-correlation-id": huge });
    expect(response.status).toBe(400);
    expect(bytes).toBeLessThanOrEqual(INVENTORY_MAX_RESPONSE_BYTES);
    expect(text).not.toContain("xxxxxxxxxx");
    expect(response.headers.get("x-correlation-id")?.length ?? 0).toBeLessThanOrEqual(36);
  });

  it("🔴 lo mismo con contenido multibyte en la cabecera", async () => {
    // Una cabecera HTTP es una ByteString: no admite «€» (U+20AC). Pero «ÿ»
    // (U+00FF) sí viaja y ocupa DOS bytes en UTF-8 con una sola unidad UTF-16,
    // así que la divergencia bytes↔unidades —la que un control basado en
    // `.length` no vería— sigue siendo alcanzable desde el llamante.
    const huge = "ÿ".repeat(INVENTORY_MAX_RESPONSE_BYTES);
    expect(utf8(huge)).toBeGreaterThan(INVENTORY_MAX_RESPONSE_BYTES);
    expect(huge.length).toBeLessThanOrEqual(INVENTORY_MAX_RESPONSE_BYTES);

    const { response, bytes, text } = await respond(page(), { "x-correlation-id": huge });
    expect(response.status).toBe(400);
    expect(bytes).toBeLessThanOrEqual(INVENTORY_MAX_RESPONSE_BYTES);
    expect(text).not.toContain("ÿÿÿÿÿ");
  });

  it("un correlationId válido se sigue reflejando", async () => {
    const { text, response } = await respond(page(), { "x-correlation-id": CORRELATION_ID });
    expect(response.status).toBe(200);
    expect(JSON.parse(text).meta.correlationId).toBe(CORRELATION_ID);
  });

  it("serialización única: lo medido es exactamente lo enviado", async () => {
    const source = await pageWithResponseBytes(INVENTORY_MAX_RESPONSE_BYTES - 1);
    const first = await respond(source);
    const second = await respond(source);
    expect(first.text).toBe(second.text);
    expect(first.bytes).toBe(utf8(first.text));
  });
});

// ===========================================================================
// N4-5 · Coste y aislamiento de los puertos por request
// ===========================================================================

describe("P3-N4-5 · puertos por request: medición y aislamiento", () => {
  it("construye los puertos exactamente una vez por request", async () => {
    const createPorts = vi.fn(async () => operationalPorts());
    const handler = createInventoryRequestHandler({
      loadConfiguration: () => configuration(),
      createPorts,
      createCorrelationId: () => CORRELATION_ID,
    });

    await handler(request());
    await handler(request());
    expect(createPorts).toHaveBeenCalledTimes(2);
  });

  it("🔴 dos requests con credenciales distintas no comparten scope", async () => {
    const seen: string[] = [];
    const config = configuration({
      bindings: [
        { id: "a", secret: "canary-secret-a", permissions: [INVENTORY_PERMISSION], clientId: CLIENT_ID, businessUnits: ["ANMAT"] },
        { id: "b", secret: "canary-secret-b", permissions: [INVENTORY_PERMISSION], clientId: "9d1b6c30-6a5a-4a1e-9d0a-4a2a51f0f001", businessUnits: ["GENERAL"] },
      ],
    });
    const ports = operationalPorts({
      repository: { query: vi.fn(async (q: any) => { seen.push(q.clientId); return page({ rows: [], rowsEvaluated: 0, total: 0, summary: { totalSkus: 0, byBusinessUnit: { ANMAT: 0, GENERAL: 0, CORPORATE: 0, unresolved: 0 } } }); }) },
    });
    const handler = createInventoryRequestHandler({
      loadConfiguration: () => config,
      createPorts: vi.fn(async () => ports),
      createCorrelationId: () => CORRELATION_ID,
    });

    const req = (secret: string) =>
      new Request("https://internal.test/api/internal/wms/inventory", {
        headers: { authorization: `Bearer ${secret}` },
      });

    await handler(req("canary-secret-a"));
    await handler(req("canary-secret-b"));
    expect(seen).toEqual([CLIENT_ID, "9d1b6c30-6a5a-4a1e-9d0a-4a2a51f0f001"]);
  });

  it("🔴 el módulo no abre conexiones ni lee entorno durante la importación", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./wms/inventory/composition.ts", import.meta.url)),
      "utf8",
    );
    // La configuración entra por parámetro; `process.env` sólo como valor por
    // omisión de una función, nunca evaluado en el cuerpo del módulo.
    expect(source).not.toMatch(/^const .*=.*process\.env/m);
    expect(source).not.toMatch(/^\s*createAdminClient\(\)/m);
  });
});
