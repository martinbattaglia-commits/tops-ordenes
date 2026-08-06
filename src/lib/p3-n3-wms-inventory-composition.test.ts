import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInventoryRequestHandler,
  handleInventoryRequest,
  readInventoryRuntimeConfiguration,
  type InventoryOperationalPorts,
  type InventoryRuntimeConfiguration,
} from "./wms/inventory/composition";
import {
  INVENTORY_MAX_RESPONSE_BYTES,
  INVENTORY_PERMISSION,
  type InventoryRepositoryPage,
  type InventoryRepositoryQuery,
} from "./wms/inventory/contract";
import type { InventoryAuditEvent } from "./wms/inventory/ports";
import {
  createSupabaseInventoryAuditPort,
  createSupabaseInventoryRateLimitPort,
  createSupabaseInventoryRepository,
} from "./wms/inventory/supabase-ports";

const CORRELATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const CLIENT_ID = "51f418dc-8b82-4f6b-a9c6-595570e87290";
const ATTACKER_CLIENT_ID = "5a802505-1326-4a89-9df6-19a614e10061";
const SECRET = "p3-n3-test-secret-never-log";
const P3_N2_MAX_RESPONSE_BYTES = 1_048_576;

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
  maxSourceRows: 100,
  ...overrides,
});

const row = {
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
};

const page = (overrides: Partial<InventoryRepositoryPage> = {}): InventoryRepositoryPage => ({
  rows: [row],
  rowsEvaluated: 1,
  total: 1,
  summary: {
    totalSkus: 1,
    byBusinessUnit: { ANMAT: 1, GENERAL: 0, CORPORATE: 0, unresolved: 0 },
  },
  updatedAt: "2026-08-05T12:00:00.000Z",
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

const configuredHandler = (
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

const bodyOf = async (response: Response) => response.json() as Promise<Record<string, any>>;

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

const p3N2ConnectorAccepts = (body: string, contentType: string | null): boolean =>
  contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json" &&
  utf8ByteLength(body) > 0 &&
  utf8ByteLength(body) <= P3_N2_MAX_RESPONSE_BYTES;

const responseForDescription = async (
  description: string,
  audit: InventoryOperationalPorts["audit"] = { record: vi.fn(async () => undefined) },
): Promise<Response> => configuredHandler(operationalPorts({
  repository: {
    query: vi.fn(async () => page({ rows: [{ ...row, description }] })),
  },
  audit,
}))(request());

const asciiDescriptionForResponseBytes = async (targetBytes: number): Promise<string> => {
  const probe = await responseForDescription("x");
  expect(probe.status).toBe(200);
  const fixedBytes = utf8ByteLength(await probe.text()) - 1;
  const descriptionBytes = targetBytes - fixedBytes;
  if (descriptionBytes < 1) throw new Error("response-size target is below fixed envelope size");
  return "x".repeat(descriptionBytes);
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/wms/inventory/composition");
});

describe("P3-N3 operational composition and canonical binding", () => {
  it("builds a configured request composition with the exact v1 envelope", async () => {
    const response = await configuredHandler()(request());
    const body = await bodyOf(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe(CORRELATION_ID);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(body).sort()).toEqual(["data", "meta"]);
    expect(body.meta).toEqual({ correlationId: CORRELATION_ID, apiVersion: "v1" });
    expect(body.data).toEqual({
      items: [
        {
          id: expect.any(String),
          sku: "SKU-001",
          description: "Producto regulado",
          category: null,
          line: "REGULADO_ANMAT",
          lotNumber: "LOT-9",
          date: "2027-12-31",
          dateSemantics: "expiration",
          totalQuantity: 10,
          availableQuantity: 8,
          reservedQuantity: 2,
          unitOfMeasure: null,
          location: "WH·F1·S1·Z1·R1·P1",
          status: "Disponible",
        },
      ],
      pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
      summary: { totalSkus: 1, byLine: { CARGAS_GENERALES: 0, REGULADO_ANMAT: 1 } },
      updatedAt: "2026-08-05T12:00:00.000Z",
      sourceStatus: "live",
      warnings: [],
    });
  });

  it("uses X-12 fallback for absent configuration and for any missing port", async () => {
    const absent = createInventoryRequestHandler({ loadConfiguration: () => null });
    const incomplete = createInventoryRequestHandler({
      loadConfiguration: () => configuration(),
      createPorts: async () => ({ repository: { query: vi.fn() } } as unknown as InventoryOperationalPorts),
      createCorrelationId: () => CORRELATION_ID,
    });

    for (const handler of [absent, incomplete]) {
      const response = await handler(request());
      expect(response.status).toBe(503);
      expect((await bodyOf(response)).error).toEqual({
        code: "nexus_unavailable",
        message: "Inventory service unavailable",
      });
    }
  });

  it("does not construct operational ports when configuration is absent", async () => {
    const createPorts = vi.fn(async () => operationalPorts());
    const handler = createInventoryRequestHandler({
      loadConfiguration: () => null,
      createPorts,
      createCorrelationId: () => CORRELATION_ID,
    });

    const response = await handler(request());
    expect(response.status).toBe(503);
    expect((await bodyOf(response)).error.code).toBe("nexus_unavailable");
    expect(createPorts).not.toHaveBeenCalled();
  });

  it.each(["repository", "rateLimit", "audit"] as const)(
    "requires the %s port before running any operational dependency",
    async (missing) => {
      const repository = { query: vi.fn(async () => page()) };
      const rateLimit = { consume: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
      const audit = { record: vi.fn(async () => undefined) };
      const candidate: Partial<InventoryOperationalPorts> = { repository, rateLimit, audit };
      delete candidate[missing];
      const handler = createInventoryRequestHandler({
        loadConfiguration: () => configuration(),
        createPorts: async () => candidate as InventoryOperationalPorts,
        createCorrelationId: () => CORRELATION_ID,
      });

      const response = await handler(request());
      expect(response.status).toBe(503);
      expect((await bodyOf(response)).error.code).toBe("nexus_unavailable");
      expect(repository.query).not.toHaveBeenCalled();
      expect(rateLimit.consume).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it("does not perform external work during module import or unconfigured fallback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    vi.resetModules();
    const imported = await import("./wms/inventory/composition");
    const response = await imported.createInventoryRequestHandler({
      loadConfiguration: () => null,
      createCorrelationId: () => CORRELATION_ID,
    })(request());

    expect(response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid authentication and the absence of the exact permission", async () => {
    expect((await configuredHandler()(request("", { authorization: "Bearer wrong" }))).status).toBe(401);
    const noPermission = configuration({
      bindings: [{ ...configuration().bindings[0], permissions: ["wms.inventory.write"] }],
    });
    expect((await configuredHandler(operationalPorts(), noPermission)(request())).status).toBe(403);
  });

  it("resolves only the canonical client_id bound to the authenticated principal", async () => {
    const query = vi.fn(async () => page());
    const response = await configuredHandler(operationalPorts({ repository: { query } }))(
      request("", {
        "x-client-id": ATTACKER_CLIENT_ID,
        "x-client-name": "Cliente impostor",
        "x-tenant": "attacker",
      }),
    );

    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ clientId: CLIENT_ID }));
    expect(query).not.toHaveBeenCalledWith(expect.objectContaining({ clientId: ATTACKER_CLIENT_ID }));
  });

  it("ignores forged identity in cookies as well as caller-controlled headers", async () => {
    const query = vi.fn(async () => page());
    const response = await configuredHandler(operationalPorts({ repository: { query } }))(
      request("", {
        cookie: `client_id=${ATTACKER_CLIENT_ID}; tenant=attacker; company=attacker`,
        "x-client-id": ATTACKER_CLIENT_ID,
        "x-forwarded-client-id": ATTACKER_CLIENT_ID,
      }),
    );

    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      clientId: CLIENT_ID,
      businessUnits: ["ANMAT", "GENERAL"],
    }));
    expect(query).not.toHaveBeenCalledWith(expect.objectContaining({ clientId: ATTACKER_CLIENT_ID }));
  });

  it.each(["client_id", "client_name", "tenant", "company"])(
    "rejects caller authority parameter %s before repository access",
    async (name) => {
      const query = vi.fn(async () => page());
      const response = await configuredHandler(operationalPorts({ repository: { query } }))(
        request(`?${name}=attacker`),
      );
      expect(response.status).toBe(400);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("passes the complete closed filter and pagination set to the repository", async () => {
    const query = vi.fn(async () =>
      page({ rows: [], rowsEvaluated: 0, total: 0, summary: {
        totalSkus: 0,
        byBusinessUnit: { ANMAT: 0, GENERAL: 0, CORPORATE: 0, unresolved: 0 },
      } }),
    );
    const response = await configuredHandler(operationalPorts({ repository: { query } }))(
      request("?search=ABC&line=REGULADO_ANMAT&status=Disponible&page=3&pageSize=7&sort=date%3Aasc"),
    );
    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledWith({
      search: "ABC",
      line: "REGULADO_ANMAT",
      status: "Disponible",
      page: 3,
      pageSize: 7,
      sort: "date:asc",
      clientId: CLIENT_ID,
      businessUnits: ["ANMAT", "GENERAL"],
    });
  });

  it("returns a genuine empty result without demo data", async () => {
    const empty = page({
      rows: [],
      rowsEvaluated: 0,
      total: 0,
      summary: {
        totalSkus: 0,
        byBusinessUnit: { ANMAT: 0, GENERAL: 0, CORPORATE: 0, unresolved: 0 },
      },
    });
    const response = await configuredHandler(
      operationalPorts({ repository: { query: vi.fn(async () => empty) } }),
    )(request());
    expect(response.status).toBe(200);
    expect((await bodyOf(response)).data).toMatchObject({
      items: [],
      pagination: { total: 0, totalPages: 0 },
      summary: { totalSkus: 0 },
    });
  });

  it("fails closed on port, network and timeout errors without reflecting internals", async () => {
    for (const internal of [
      "postgres password=real-secret host=10.0.0.9",
      "fetch ECONNRESET https://private-topology",
      "inventory_port_timeout service-role-secret",
    ]) {
      const response = await configuredHandler(
        operationalPorts({ repository: { query: vi.fn(async () => { throw new Error(internal); }) } }),
      )(request());
      const serialized = JSON.stringify(await bodyOf(response));
      expect(response.status).toBe(503);
      expect(serialized).not.toContain(internal);
      expect(serialized).not.toContain("password");
      expect(serialized).not.toContain("10.0.0.9");
    }
  });

  it("fails closed when port construction throws and reflects no provider detail", async () => {
    const internal = "service-role-secret postgres://private-topology";
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const handler = createInventoryRequestHandler({
      loadConfiguration: () => configuration(),
      createPorts: vi.fn(async () => { throw new Error(internal); }),
      createCorrelationId: () => CORRELATION_ID,
    });

    const response = await handler(request());
    const serialized = JSON.stringify(await bodyOf(response));
    expect(response.status).toBe(503);
    expect(serialized).not.toContain(internal);
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("private-topology");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("treats audit failure as authoritative and never returns repository data", async () => {
    const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode");
    let measuredBeforeAudit = false;
    const audit = {
      record: vi.fn(async () => {
        measuredBeforeAudit = encodeSpy.mock.calls.length > 0;
        throw new Error("audit password=secret private-host");
      }),
    };
    const response = await configuredHandler(operationalPorts({ audit }))(request());
    const body = await bodyOf(response);
    encodeSpy.mockRestore();

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: "audit_unavailable",
      message: "Audit service unavailable",
    });
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("private-host");
    expect(body.data).toBeUndefined();
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(measuredBeforeAudit).toBe(true);
  });

  it("never logs a credential or a private adapter error", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const response = await configuredHandler(
      operationalPorts({ repository: { query: vi.fn(async () => { throw new Error(SECRET); }) } }),
    )(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await bodyOf(response))).not.toContain(SECRET);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("creates isolated ports per request and recovers on the next request", async () => {
    let creation = 0;
    const createPorts = vi.fn(async () => {
      creation += 1;
      return creation === 1
        ? operationalPorts({ repository: { query: vi.fn(async () => { throw new Error("down"); }) } })
        : operationalPorts();
    });
    const handler = createInventoryRequestHandler({
      loadConfiguration: () => configuration(),
      createPorts,
      createCorrelationId: () => CORRELATION_ID,
    });

    expect((await handler(request())).status).toBe(503);
    expect((await handler(request())).status).toBe(200);
    expect(createPorts).toHaveBeenCalledTimes(2);
  });

  it("recovers when configuration becomes complete without retaining a failed singleton", async () => {
    let attempt = 0;
    const handler = createInventoryRequestHandler({
      loadConfiguration: () => (++attempt === 1 ? null : configuration()),
      createPorts: async () => operationalPorts(),
      createCorrelationId: () => CORRELATION_ID,
    });
    expect((await handler(request())).status).toBe(503);
    expect((await handler(request())).status).toBe(200);
  });
});

describe("P3-N3 response-size producer custody", () => {
  it.each([
    P3_N2_MAX_RESPONSE_BYTES - 1,
    P3_N2_MAX_RESPONSE_BYTES,
  ])("allows a complete P3-N2-compatible body of exactly %i UTF-8 bytes", async (targetBytes) => {
    expect(INVENTORY_MAX_RESPONSE_BYTES).toBe(P3_N2_MAX_RESPONSE_BYTES);
    const description = await asciiDescriptionForResponseBytes(targetBytes);
    const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode");
    const stringifySpy = vi.spyOn(JSON, "stringify");
    let auditedAfterMeasurement = false;
    const audit = {
      record: vi.fn(async (event: InventoryAuditEvent) => {
        const serialized = stringifySpy.mock.results.find(({ type }) => type === "return")?.value;
        auditedAfterMeasurement = typeof serialized === "string" && encodeSpy.mock.calls
          .some(([measured]) => measured === serialized);
        expect(event.outcome).toBe("success");
        expect(event.status).toBe(200);
      }),
    };

    const response = await responseForDescription(description, audit);
    const sent = await response.text();
    const serializedBodies = stringifySpy.mock.results
      .filter(({ type }) => type === "return")
      .map(({ value }) => value);
    const measuredBodies = encodeSpy.mock.calls.map(([value]) => value);
    stringifySpy.mockRestore();
    encodeSpy.mockRestore();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(utf8ByteLength(sent)).toBe(targetBytes);
    expect(serializedBodies).toEqual([sent]);
    expect(measuredBodies).toContain(sent);
    expect(auditedAfterMeasurement).toBe(true);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sent)).toMatchObject({
      data: {
        items: [{ description }],
        pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
        summary: { totalSkus: 1 },
      },
      meta: { correlationId: CORRELATION_ID, apiVersion: "v1" },
    });
  });

  it("rejects the first excess byte with no inventory and no successful audit", async () => {
    const description = await asciiDescriptionForResponseBytes(
      P3_N2_MAX_RESPONSE_BYTES + 1,
    );
    const audit = { record: vi.fn(async () => undefined) };
    const response = await responseForDescription(description, audit);
    const sent = await response.text();
    const body = JSON.parse(sent) as Record<string, any>;

    expect(response.status).toBe(502);
    expect(utf8ByteLength(sent)).toBeLessThanOrEqual(P3_N2_MAX_RESPONSE_BYTES);
    expect(body.error).toEqual({
      code: "nexus_bad_response",
      message: "Invalid inventory response",
    });
    expect(body.data).toBeUndefined();
    expect(sent).not.toContain(description.slice(0, 128));
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "nexus_bad_response",
      status: 502,
      rowsEvaluated: 0,
      rowsReturned: 0,
      integrityResult: "failed",
    }));
    expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("measures multibyte UTF-8 bytes instead of JavaScript string length", async () => {
    const probe = await responseForDescription("á");
    expect(probe.status).toBe(200);
    const probeBody = await probe.text();
    const fixedBytes = utf8ByteLength(probeBody) - utf8ByteLength("á");
    const fixedCodeUnits = probeBody.length - "á".length;
    const units = Math.floor((P3_N2_MAX_RESPONSE_BYTES - fixedBytes) / 2) + 1;
    const description = "á".repeat(units);
    const candidateBytes = fixedBytes + utf8ByteLength(description);
    const candidateCodeUnits = fixedCodeUnits + description.length;
    const audit = { record: vi.fn(async () => undefined) };

    expect(candidateBytes).toBeGreaterThan(P3_N2_MAX_RESPONSE_BYTES);
    expect(candidateCodeUnits).toBeLessThanOrEqual(P3_N2_MAX_RESPONSE_BYTES);
    const response = await responseForDescription(description, audit);
    const body = await bodyOf(response);
    expect(response.status).toBe(502);
    expect(body.error.code).toBe("nexus_bad_response");
    expect(body.data).toBeUndefined();
    expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("matches the independent P3-N2 connector custody at and above its byte boundary", async () => {
    const description = await asciiDescriptionForResponseBytes(P3_N2_MAX_RESPONSE_BYTES);
    const response = await responseForDescription(description);
    const maximumBody = await response.text();
    const mutatedEnvelope = JSON.parse(maximumBody) as Record<string, any>;
    mutatedEnvelope.data.items[0].description += "x";
    const firstExcessBody = JSON.stringify(mutatedEnvelope);

    expect(response.status).toBe(200);
    expect(utf8ByteLength(maximumBody)).toBe(P3_N2_MAX_RESPONSE_BYTES);
    expect(utf8ByteLength(firstExcessBody)).toBe(P3_N2_MAX_RESPONSE_BYTES + 1);
    expect(p3N2ConnectorAccepts(maximumBody, response.headers.get("content-type"))).toBe(true);
    expect(p3N2ConnectorAccepts(firstExcessBody, response.headers.get("content-type"))).toBe(false);
  });
});

describe("P3-N3 configuration validation", () => {
  const environment = (bindings: unknown): NodeJS.ProcessEnv => ({
    NODE_ENV: "test",
    WMS_INVENTORY_OPERATIONAL_ENABLED: "1",
    WMS_INVENTORY_M2M_BINDINGS_JSON: JSON.stringify(bindings),
  });

  it("accepts only complete, unambiguous server-side bindings", () => {
    const binding = configuration().bindings[0];
    expect(readInventoryRuntimeConfiguration(environment([binding]))).toMatchObject({
      bindings: [{ id: "nexus-os", clientId: CLIENT_ID, businessUnits: ["ANMAT", "GENERAL"] }],
    });
    expect(readInventoryRuntimeConfiguration({ NODE_ENV: "test" })).toBeNull();
    expect(readInventoryRuntimeConfiguration(environment([]))).toBeNull();
    expect(readInventoryRuntimeConfiguration(environment([{ ...binding, clientId: "" }]))).toBeNull();
    expect(readInventoryRuntimeConfiguration(environment([binding, binding]))).toBeNull();
    expect(
      readInventoryRuntimeConfiguration(
        environment([binding, { ...binding, id: "second", clientId: ATTACKER_CLIENT_ID }]),
      ),
    ).toBeNull();
  });

  it.each([undefined, "", "0", "true", "yes", "-1", "01"])(
    "keeps runtime dormant unless the operational flag is exactly 1 (%s)",
    (enabled) => {
      const source = environment([configuration().bindings[0]]);
      if (enabled === undefined) delete source.WMS_INVENTORY_OPERATIONAL_ENABLED;
      else source.WMS_INVENTORY_OPERATIONAL_ENABLED = enabled;
      expect(readInventoryRuntimeConfiguration(source)).toBeNull();
    },
  );

  it("rejects malformed and every ambiguous binding dimension", () => {
    const binding = configuration().bindings[0];
    expect(readInventoryRuntimeConfiguration({
      NODE_ENV: "test",
      WMS_INVENTORY_OPERATIONAL_ENABLED: "1",
      WMS_INVENTORY_M2M_BINDINGS_JSON: "{not-json",
    })).toBeNull();
    expect(readInventoryRuntimeConfiguration(environment([
      binding,
      { ...binding, secret: "distinct-secret", clientId: ATTACKER_CLIENT_ID },
    ]))).toBeNull();
    expect(readInventoryRuntimeConfiguration(environment([
      binding,
      { ...binding, id: "distinct-id", clientId: ATTACKER_CLIENT_ID },
    ]))).toBeNull();
    expect(readInventoryRuntimeConfiguration(environment([
      { ...binding, businessUnits: ["ANMAT", "ANMAT"] },
    ]))).toBeNull();
    expect(readInventoryRuntimeConfiguration(environment([
      { ...binding, businessUnits: ["ANMAT", "CORPORATE"] },
    ]))).toBeNull();
  });

  it("rejects client_id, client_name, tenant or company fields as configuration authority", () => {
    const binding = configuration().bindings[0];
    for (const extra of [
      { client_id: ATTACKER_CLIENT_ID },
      { client_name: "descriptive" },
      { tenant: "free-form" },
      { company: "free-form" },
    ]) {
      expect(readInventoryRuntimeConfiguration(environment([{ ...binding, ...extra }]))).toBeNull();
    }
  });
});

type FakeResult = { data?: unknown; error: unknown; count?: number | null };

class FakeQuery implements PromiseLike<FakeResult> {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  private result: FakeResult;

  constructor(
    result: FakeResult,
    private readonly insertResult: FakeResult = { error: null },
    private readonly neverResolve = false,
  ) {
    this.result = result;
  }

  select(...args: unknown[]) { this.calls.push({ method: "select", args }); return this; }
  eq(...args: unknown[]) { this.calls.push({ method: "eq", args }); return this; }
  in(...args: unknown[]) { this.calls.push({ method: "in", args }); return this; }
  limit(...args: unknown[]) { this.calls.push({ method: "limit", args }); return this; }
  gte(...args: unknown[]) { this.calls.push({ method: "gte", args }); return this; }
  contains(...args: unknown[]) { this.calls.push({ method: "contains", args }); return this; }
  abortSignal(...args: unknown[]) { this.calls.push({ method: "abortSignal", args }); return this; }
  insert(...args: unknown[]) {
    this.calls.push({ method: "insert", args });
    this.result = this.insertResult;
    return this;
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (this.neverResolve) return new Promise<FakeResult>(() => undefined).then(onfulfilled, onrejected);
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class FakeSupabase {
  readonly queries: Array<{ table: string; query: FakeQuery }> = [];

  constructor(
    private readonly inventoryResult: FakeResult,
    private readonly auditSelectResult: FakeResult = { count: 0, error: null },
    private readonly auditInsertResult: FakeResult = { error: null },
    private readonly neverResolve = false,
  ) {}

  from(table: string): FakeQuery {
    const query = new FakeQuery(
      table === "inventory_items" ? this.inventoryResult : this.auditSelectResult,
      this.auditInsertResult,
      this.neverResolve,
    );
    this.queries.push({ table, query });
    return query;
  }
}

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

const asClient = (fake: FakeSupabase) => fake as unknown as SupabaseClient;

describe("P3-N3 Supabase ports through injected doubles only", () => {
  it("binds canonical client and BU filters server-side, then preserves FEFO", async () => {
    const fake = new FakeSupabase({ data: [sourceRow()], error: null });
    const repository = createSupabaseInventoryRepository(asClient(fake), configuration());
    const result = await repository.query({
      clientId: CLIENT_ID,
      businessUnits: ["ANMAT"],
      page: 1,
      pageSize: 50,
      sort: "date:asc",
    });

    expect(result.rows[0]).toMatchObject({ lotNumber: "FEFO", date: "2027-01-15" });
    const calls = fake.queries[0].query.calls;
    expect(calls).toContainEqual({ method: "eq", args: ["client_id", CLIENT_ID] });
    expect(calls).toContainEqual({ method: "in", args: ["business_unit", ["ANMAT"]] });
    expect(JSON.stringify(calls)).not.toContain("client_name");
  });

  it("always constrains the source query to the complete authorized business-unit set", async () => {
    const fake = new FakeSupabase({ data: [sourceRow()], error: null });
    const repository = createSupabaseInventoryRepository(asClient(fake), configuration());
    await repository.query({
      clientId: CLIENT_ID,
      businessUnits: ["ANMAT", "GENERAL"],
      page: 1,
      pageSize: 50,
      sort: "sku:asc",
    });

    const calls = fake.queries[0].query.calls;
    expect(calls).toContainEqual({
      method: "in",
      args: ["business_unit", ["ANMAT", "GENERAL"]],
    });
  });

  it("implements search, line, status, sort and pagination for ANMAT/GENERAL", async () => {
    const general = sourceRow({
      business_unit: "GENERAL",
      sku: "GEN-002",
      description: "Garantía general",
      stock_available: 0,
      stock_reserved: 5,
      lots: [{ lot_number: "G-1", expiration_date: "2029-06-30", quantity: 5, active: true }],
    });
    const anmatSecond = sourceRow({
      sku: "ANM-002",
      stock_available: 3,
      stock_reserved: 0,
      lots: [{ lot_number: "A-2", expiration_date: "2026-01-01", quantity: 3, active: true }],
    });
    const fake = new FakeSupabase({ data: [sourceRow(), general, anmatSecond], error: null });
    const repository = createSupabaseInventoryRepository(asClient(fake), configuration());

    const filtered = await repository.query({
      clientId: CLIENT_ID,
      businessUnits: ["ANMAT", "GENERAL"],
      search: "garantía",
      line: "CARGAS_GENERALES",
      status: "Reservado",
      page: 1,
      pageSize: 1,
      sort: "available:desc",
    });
    expect(filtered.rows).toEqual([expect.objectContaining({ sku: "GEN-002", status: "Reservado" })]);
    expect(filtered.summary.byBusinessUnit).toEqual({
      ANMAT: 0,
      GENERAL: 1,
      CORPORATE: 0,
      unresolved: 0,
    });

    const paged = await repository.query({
      clientId: CLIENT_ID,
      businessUnits: ["ANMAT", "GENERAL"],
      page: 2,
      pageSize: 1,
      sort: "date:asc",
    });
    expect(paged.total).toBe(3);
    expect(paged.rows).toHaveLength(1);
    expect(paged.rows[0].lotNumber).toBe("FEFO");
  });

  it("preserves CORPORATE contamination for X-10 whole-set rejection", async () => {
    const fake = new FakeSupabase({ data: [sourceRow({ business_unit: "CORPORATE" })], error: null });
    const repository = createSupabaseInventoryRepository(asClient(fake), configuration());
    const response = await configuredHandler(operationalPorts({ repository }))(request());
    expect(response.status).toBe(502);
    expect((await bodyOf(response)).error.code).toBe("nexus_data_integrity_error");
  });

  it("preserves X-09 independent row revalidation even with an authorized summary", async () => {
    const repository = {
      query: vi.fn(async () => page({ rows: [{ ...row, clientId: ATTACKER_CLIENT_ID }] })),
    };
    const response = await configuredHandler(operationalPorts({ repository }))(request());
    expect(response.status).toBe(502);
    expect((await bodyOf(response)).error.code).toBe("nexus_data_integrity_error");
  });

  it("fails closed on quantitative inconsistency rather than returning partial data", async () => {
    const fake = new FakeSupabase({
      data: [sourceRow({ stock_available: 99, stock_reserved: 0 })],
      error: null,
    });
    const repository = createSupabaseInventoryRepository(asClient(fake), configuration());
    await expect(repository.query({
      clientId: CLIENT_ID,
      businessUnits: ["ANMAT"],
      page: 1,
      pageSize: 50,
      sort: "sku:asc",
    })).rejects.toThrow("inventory_repository_invalid_row");
  });

  it("times out and aborts a non-responsive source, then maps it safely at the endpoint", async () => {
    const fake = new FakeSupabase({ data: [], error: null }, undefined, undefined, true);
    const repository = createSupabaseInventoryRepository(asClient(fake), {
      timeoutMs: 5,
      maxSourceRows: 100,
    });
    let guard: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      configuredHandler(operationalPorts({ repository }))(request()).then((response) => ({
        kind: "response" as const,
        response,
      })),
      new Promise<{ kind: "hung" }>((resolve) => {
        guard = setTimeout(() => resolve({ kind: "hung" }), 75);
      }),
    ]);
    if (guard) clearTimeout(guard);

    expect(outcome.kind).toBe("response");
    if (outcome.kind !== "response") throw new Error("timeout mutant left the request pending");
    const response = outcome.response;
    expect(response.status).toBe(503);
    expect(JSON.stringify(await bodyOf(response))).not.toContain("inventory_port_timeout");
    const abortCall = fake.queries[0].query.calls.find(({ method }) => method === "abortSignal");
    expect(abortCall).toBeDefined();
    expect((abortCall?.args[0] as AbortSignal).aborted).toBe(true);
  });

  it.each([
    { message: "relation inventory_lots does not exist", code: "42P01" },
    { message: "table inventory_items is not exposed", code: "PGRST205" },
  ])("does not convert a missing table or relation into an empty 200", async (providerError) => {
    const fake = new FakeSupabase({ data: [], error: providerError });
    const repository = createSupabaseInventoryRepository(asClient(fake), configuration());
    const response = await configuredHandler(operationalPorts({ repository }))(request());
    const body = await bodyOf(response);

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("nexus_unavailable");
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(providerError.message);
    expect(JSON.stringify(body)).not.toContain(providerError.code);
  });

  it("uses deterministic tie-breaks so equal values cannot drift across pages", async () => {
    const tied = (sku: string, lotNumber: string) => sourceRow({
      sku,
      stock_available: 8,
      stock_reserved: 2,
      lots: [{ lot_number: lotNumber, expiration_date: "2027-01-15", quantity: 10, active: true }],
    });
    const ordered = [tied("SKU-B", "LOT-B"), tied("SKU-A", "LOT-A"), tied("SKU-C", "LOT-C")];
    const reversed = [...ordered].reverse();
    const pageSkus = async (records: unknown[]) => {
      const repository = createSupabaseInventoryRepository(
        asClient(new FakeSupabase({ data: records, error: null })),
        configuration(),
      );
      const result: string[] = [];
      for (const pageNumber of [1, 2, 3]) {
        const current = await repository.query({
          clientId: CLIENT_ID,
          businessUnits: ["ANMAT"],
          page: pageNumber,
          pageSize: 1,
          sort: "available:asc",
        });
        result.push(current.rows[0].sku);
      }
      return result;
    };

    await expect(pageSkus(ordered)).resolves.toEqual(["SKU-A", "SKU-B", "SKU-C"]);
    await expect(pageSkus(reversed)).resolves.toEqual(["SKU-A", "SKU-B", "SKU-C"]);
  });

  it("uses the authoritative audit journal as a request-isolated rate-limit source", async () => {
    const fake = new FakeSupabase({ data: [], error: null }, { count: 60, error: null });
    const rateLimit = createSupabaseInventoryRateLimitPort(asClient(fake), configuration(), () =>
      new Date("2026-08-05T12:00:00.000Z"),
    );
    await expect(rateLimit.consume({ actorFingerprint: "actor-hash", scopeFingerprint: "scope-hash" }))
      .resolves.toEqual({ allowed: false, retryAfterMs: 60_000 });
    const calls = fake.queries[0].query.calls;
    expect(calls).toContainEqual({
      method: "contains",
      args: ["payload", { actor_fingerprint: "actor-hash", scope_fingerprint: "scope-hash" }],
    });
  });

  it("writes only sanitized fingerprints and operational counts to audit", async () => {
    const fake = new FakeSupabase({ data: [], error: null });
    const audit = createSupabaseInventoryAuditPort(asClient(fake), 1_000);
    const event: InventoryAuditEvent = {
      correlationId: CORRELATION_ID,
      actorFingerprint: "actor-hash",
      scopeFingerprint: "scope-hash",
      outcome: "success",
      status: 200,
      rowsEvaluated: 1,
      rowsReturned: 1,
      integrityResult: "complete",
      occurredAt: "2026-08-05T12:00:00.000Z",
    };
    await audit.record(event);
    const serialized = JSON.stringify(fake.queries[0].query.calls);
    expect(serialized).toContain("actor-hash");
    expect(serialized).toContain("scope-hash");
    expect(serialized).not.toContain(CLIENT_ID);
    expect(serialized).not.toContain(SECRET);
  });
});

describe("P3-N3 discriminating mutants and live CONTROL", () => {
  it("MUTANT client-id-from-caller is killed by canonical binding", async () => {
    const observed: InventoryRepositoryQuery[] = [];
    const handler = configuredHandler(operationalPorts({
      repository: { query: vi.fn(async (input) => { observed.push(input); return page(); }) },
    }));
    expect((await handler(request("", { "x-client-id": ATTACKER_CLIENT_ID }))).status).toBe(200);
    expect(observed[0].clientId).toBe(CLIENT_ID);
    expect(observed[0].clientId).not.toBe(ATTACKER_CLIENT_ID);
  });

  it("MUTANT summary-only validation is killed by X-09 row validation", async () => {
    const response = await configuredHandler(operationalPorts({
      repository: { query: vi.fn(async () => page({ rows: [{ ...row, clientId: ATTACKER_CLIENT_ID }] })) },
    }))(request());
    expect(response.status).toBe(502);
  });

  it("MUTANT missing exact permission is killed before all operational ports", async () => {
    const repository = { query: vi.fn(async () => page()) };
    const denied = configuration({
      bindings: [{ ...configuration().bindings[0], permissions: ["wms.inventory.read.all"] }],
    });
    expect((await configuredHandler(operationalPorts({ repository }), denied)(request())).status).toBe(403);
    expect(repository.query).not.toHaveBeenCalled();
  });

  it("CONTROL benign observer substitution remains live and preserves output", async () => {
    const left = await configuredHandler(operationalPorts({ observer: { emit() {} } }))(request());
    const right = await configuredHandler(
      operationalPorts({ observer: { emit: vi.fn(async () => undefined) } }),
    )(request());
    expect(left.status).toBe(200);
    expect(await left.json()).toEqual(await right.json());
  });
});

describe("P3-N3 route reachability and dormant real environment", () => {
  it("routes GET through the operational composition entrypoint", async () => {
    const sentinel = new Response("reachable", { status: 207 });
    const entrypoint = vi.fn(async () => sentinel);
    vi.resetModules();
    vi.doMock("@/lib/wms/inventory/composition", () => ({ handleInventoryRequest: entrypoint }));
    const { GET } = await import("../app/api/internal/wms/inventory/route");
    const incoming = request();
    expect(await GET(incoming)).toBe(sentinel);
    expect(entrypoint).toHaveBeenCalledWith(incoming);
  });

  it("keeps the real route fail-closed while runtime provisioning is absent", async () => {
    const keys = [
      "WMS_INVENTORY_OPERATIONAL_ENABLED",
      "WMS_INVENTORY_M2M_BINDINGS_JSON",
    ] as const;
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    try {
      const response = await handleInventoryRequest(request());
      expect(response.status).toBe(503);
      expect((await bodyOf(response)).error.code).toBe("nexus_unavailable");
    } finally {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});
