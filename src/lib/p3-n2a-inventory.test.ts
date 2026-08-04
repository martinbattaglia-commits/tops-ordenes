import { describe, expect, it, vi } from "vitest";
import { createApiKeyM2mAuthenticator } from "./wms/inventory/auth";
import { INVENTORY_PERMISSION, type InventoryRepositoryPage } from "./wms/inventory/contract";
import { createInventoryHandler, type InventoryHandlerDependencies } from "./wms/inventory/handler";
import type { InventoryScopeResolver } from "./wms/inventory/ports";
import { parseInventoryQuery } from "./wms/inventory/query";
import { executeInventoryQuery } from "./wms/inventory/service";

const CORRELATION_ID = "123e4567-e89b-42d3-a456-426614174000";

const row = {
  clientId: "client-internal-17",
  businessUnit: "ANMAT" as const,
  sku: "SKU-001",
  description: "Producto regulado",
  lotNumber: "LOT-9",
  date: "2027-12-31",
  availableQuantity: 8,
  reservedQuantity: 2,
  location: { kind: "external_label" as const, value: "Pasillo A" },
  status: "Disponible" as const,
};

const page = (overrides: Partial<InventoryRepositoryPage> = {}): InventoryRepositoryPage => ({
  rows: [row],
  rowsEvaluated: 1,
  total: 1,
  summary: { totalSkus: 1, byBusinessUnit: { ANMAT: 1, GENERAL: 0, CORPORATE: 0, unresolved: 0 } },
  updatedAt: "2026-08-04T12:00:00.000Z",
  ...overrides,
});

const buildHarness = (overrides: Partial<InventoryHandlerDependencies> = {}) => {
  const audits: unknown[] = [];
  const observations: unknown[] = [];
  const repositoryQuery = vi.fn(async () => page());
  const dependencies: InventoryHandlerDependencies = {
    authenticator: {
      authenticate: vi.fn(async () => ({
        kind: "authenticated" as const,
        principal: { id: "machine-internal-1", permissions: [INVENTORY_PERMISSION] },
      })),
    },
    scopeResolver: {
      resolve: vi.fn(async () => ({
        clientId: "client-internal-17",
        businessUnits: ["ANMAT" as const],
      })),
    },
    repository: { query: repositoryQuery },
    rateLimit: { consume: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) },
    audit: { record: vi.fn(async (event) => void audits.push(event)) },
    observer: { emit: vi.fn(async (event) => void observations.push(event)) },
    now: () => new Date("2026-08-04T12:00:01.000Z"),
    createCorrelationId: () => CORRELATION_ID,
    ...overrides,
  };
  return {
    dependencies,
    repositoryQuery,
    audits,
    observations,
    handler: createInventoryHandler(dependencies),
  };
};

const request = (query = "", headers: Record<string, string> = {}) =>
  new Request(`https://internal.test/api/internal/wms/inventory${query}`, {
    headers: { authorization: "Bearer test-secret", ...headers },
  });

const bodyOf = async (response: Response) => response.json() as Promise<Record<string, any>>;

describe("P3-N2A strict query contract", () => {
  it("rejects an unknown parameter", () => {
    expect(() => parseInventoryQuery(new URLSearchParams("tenant=1"))).toThrowError("invalid_input");
  });

  it("rejects the deferred category parameter even when empty", () => {
    expect(() => parseInventoryQuery(new URLSearchParams("category="))).toThrowError("invalid_input");
  });

  it("rejects duplicate parameters", () => {
    expect(() => parseInventoryQuery(new URLSearchParams("page=1&page=1"))).toThrowError("invalid_input");
  });

  it.each(["page=0", "page=-1", "page=1.5", "pageSize=0", "pageSize=101"])(
    "rejects invalid pagination %s without clamping",
    (raw) => expect(() => parseInventoryQuery(new URLSearchParams(raw))).toThrowError("invalid_input"),
  );

  it("accepts only exact enum literals and supplies documented defaults", () => {
    expect(() => parseInventoryQuery(new URLSearchParams("line=anmat"))).toThrowError("invalid_input");
    expect(parseInventoryQuery(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: 50,
      sort: "sku:asc",
    });
  });

  it("normalizes and bounds search", () => {
    expect(parseInventoryQuery(new URLSearchParams("search=%20ABC%20")).search).toBe("ABC");
    expect(() => parseInventoryQuery(new URLSearchParams(`search=${"a".repeat(121)}`))).toThrowError(
      "invalid_input",
    );
  });
});

describe("P3-N2A M2M authentication and authorization", () => {
  const auth = createApiKeyM2mAuthenticator(
    [
      {
        id: "nexus-os",
        secret: "correct-secret",
        permissions: [INVENTORY_PERMISSION],
        expiresAt: "2026-08-04T13:00:00.000Z",
      },
    ],
    () => new Date("2026-08-04T12:00:00.000Z"),
  );

  it("accepts an exact, live server credential", async () => {
    await expect(auth.authenticate("Bearer correct-secret")).resolves.toMatchObject({
      kind: "authenticated",
      principal: { id: "nexus-os", permissions: [INVENTORY_PERMISSION] },
    });
  });

  it.each([null, "Bearer wrong-secret", "bearer correct-secret"])(
    "rejects a missing or invalid server credential",
    async (authorization) => {
      await expect(auth.authenticate(authorization)).resolves.toEqual({ kind: "unauthenticated" });
    },
  );

  it("rejects an expired credential", async () => {
    const expired = createApiKeyM2mAuthenticator(
      [{ id: "old", secret: "old-secret", permissions: [INVENTORY_PERMISSION], expiresAt: "2026-08-04T11:00:00.000Z" }],
      () => new Date("2026-08-04T12:00:00.000Z"),
    );
    await expect(expired.authenticate("Bearer old-secret")).resolves.toEqual({ kind: "unauthenticated" });
  });

  it("fails closed on missing credential configuration", async () => {
    await expect(createApiKeyM2mAuthenticator([]).authenticate(null)).resolves.toEqual({
      kind: "configuration_error",
    });
  });

  it("does not treat a frontend session cookie as M2M authentication", async () => {
    const harness = buildHarness({
      authenticator: { authenticate: vi.fn(async () => ({ kind: "unauthenticated" as const })) },
    });
    const response = await harness.handler(
      new Request("https://internal.test/api/internal/wms/inventory", {
        headers: { cookie: "sb-access-token=frontend-session" },
      }),
    );
    expect(response.status).toBe(401);
    expect(harness.repositoryQuery).not.toHaveBeenCalled();
  });

  it("requires the exact wms.inventory.read permission", async () => {
    const harness = buildHarness({
      authenticator: {
        authenticate: vi.fn(async () => ({
          kind: "authenticated" as const,
          principal: { id: "machine", permissions: ["wms.inventory.write"] },
        })),
      },
    });
    expect((await harness.handler(request())).status).toBe(403);
    expect(harness.repositoryQuery).not.toHaveBeenCalled();
  });
});

describe("P3-N2A scope, completeness and projection", () => {
  it("passes both client and explicit business-unit scope to the repository", async () => {
    const harness = buildHarness();
    expect((await harness.handler(request())).status).toBe(200);
    expect(harness.repositoryQuery).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "client-internal-17", businessUnits: ["ANMAT"] }),
    );
  });

  it("provides authenticated request context to the injected canonical-scope resolver", async () => {
    let resolverInput: Parameters<InventoryScopeResolver["resolve"]>[0] | undefined;
    const resolve = vi.fn(async (input: Parameters<InventoryScopeResolver["resolve"]>[0]) => {
      resolverInput = input;
      return {
      clientId: "client-internal-17",
      businessUnits: ["ANMAT" as const],
      };
    });
    const harness = buildHarness({ scopeResolver: { resolve } });
    expect((await harness.handler(request("", { "x-internal-scope-assertion": "opaque" }))).status).toBe(200);
    expect(resolverInput?.headers).toBeInstanceOf(Headers);
    expect(resolverInput?.headers.get("x-internal-scope-assertion")).toBe("opaque");
  });

  it("denies an unresolved scope", async () => {
    const harness = buildHarness({ scopeResolver: { resolve: vi.fn(async () => null) } });
    expect((await harness.handler(request())).status).toBe(403);
    expect(harness.repositoryQuery).not.toHaveBeenCalled();
  });

  it("denies an empty business-unit scope", async () => {
    const harness = buildHarness({
      scopeResolver: { resolve: vi.fn(async () => ({ clientId: "client-internal-17", businessUnits: [] })) },
    });
    expect((await harness.handler(request())).status).toBe(403);
    expect(harness.repositoryQuery).not.toHaveBeenCalled();
  });

  it("denies a requested line outside the authorized business units", async () => {
    const harness = buildHarness();
    expect((await harness.handler(request("?line=CARGAS_GENERALES"))).status).toBe(403);
    expect(harness.repositoryQuery).not.toHaveBeenCalled();
  });

  it("rejects the complete response on a cross-client row", async () => {
    const harness = buildHarness({ repository: { query: vi.fn(async () => page({ rows: [{ ...row, clientId: "another-client" }] })) } });
    const response = await harness.handler(request());
    expect(response.status).toBe(502);
    expect(await bodyOf(response)).not.toHaveProperty("data");
  });

  it("rejects the complete response on a cross-business-unit row", async () => {
    const harness = buildHarness({
      repository: {
        query: vi.fn(async () => page({
          rows: [{ ...row, businessUnit: "GENERAL" as const }],
          summary: { totalSkus: 1, byBusinessUnit: { ANMAT: 0, GENERAL: 1, CORPORATE: 0, unresolved: 0 } },
        })),
      },
    });
    const response = await harness.handler(request());
    expect(response.status).toBe(502);
    expect(await bodyOf(response)).not.toHaveProperty("data");
  });

  it.each([
    {
      name: "CORPORATE",
      businessUnit: "CORPORATE" as const,
      counts: { ANMAT: 0, GENERAL: 0, CORPORATE: 1, unresolved: 0 },
    },
    {
      name: "NULL",
      businessUnit: null,
      counts: { ANMAT: 0, GENERAL: 0, CORPORATE: 0, unresolved: 1 },
    },
    {
      name: "multi-BU",
      businessUnit: ["ANMAT", "GENERAL"] as const,
      counts: { ANMAT: 0, GENERAL: 0, CORPORATE: 0, unresolved: 1 },
    },
  ])("classifies $name as a whole-set integrity failure", async ({ businessUnit, counts }) => {
    const harness = buildHarness({
      repository: {
        query: vi.fn(async () => page({
          rows: [{ ...row, businessUnit }],
          summary: { totalSkus: 1, byBusinessUnit: counts },
        })),
      },
    });
    const response = await harness.handler(request());
    expect(response.status).toBe(502);
    const body = await bodyOf(response);
    expect(body.error.code).toBe("nexus_data_integrity_error");
    expect(body).not.toHaveProperty("data");
  });

  it("rejects a short or partial page", async () => {
    const harness = buildHarness({ repository: { query: vi.fn(async () => page({ rows: [], rowsEvaluated: 0 })) } });
    const response = await harness.handler(request());
    expect(response.status).toBe(502);
    expect((await bodyOf(response)).error.code).toBe("nexus_data_integrity_error");
  });

  it("rejects all data when one row is structurally invalid", async () => {
    const harness = buildHarness({
      repository: { query: vi.fn(async () => page({ rows: [{ ...row, availableQuantity: -1 }] })) },
    });
    const response = await harness.handler(request());
    expect(response.status).toBe(502);
    expect(await bodyOf(response)).not.toHaveProperty("data");
  });

  it("never discards one invalid row to return the valid remainder", async () => {
    const second = { ...row, sku: "SKU-002", lotNumber: "LOT-10", availableQuantity: -1 };
    const harness = buildHarness({
      repository: {
        query: vi.fn(async () => page({
          rows: [row, second],
          rowsEvaluated: 2,
          total: 2,
          summary: { totalSkus: 2, byBusinessUnit: { ANMAT: 2, GENERAL: 0, CORPORATE: 0, unresolved: 0 } },
        })),
      },
    });
    const response = await harness.handler(request());
    expect(response.status).toBe(502);
    expect(await bodyOf(response)).not.toHaveProperty("data");
  });

  it("returns a genuine complete empty result without a demo fallback", async () => {
    const repository = { query: vi.fn(async () => page({
      rows: [], rowsEvaluated: 0, total: 0,
      summary: { totalSkus: 0, byBusinessUnit: { ANMAT: 0, GENERAL: 0, CORPORATE: 0, unresolved: 0 } },
    })) };
    const result = await executeInventoryQuery({
      repository,
      scope: { clientId: "client-internal-17", businessUnits: ["ANMAT"] },
      query: { page: 1, pageSize: 50, sort: "sku:asc" },
    });
    expect(result.data.items).toEqual([]);
    expect(result.data.sourceStatus).toBe("live");
  });

  it("maps the public DTO exhaustively and never leaks forbidden source fields", async () => {
    const source = { ...row, cuit: "30-secret", internalPosition: "RACK-9", companyId: "internal-company" };
    const harness = buildHarness({ repository: { query: vi.fn(async () => page({ rows: [source] })) } });
    const response = await harness.handler(request());
    const body = await bodyOf(response);
    expect(response.status).toBe(200);
    expect(body.data.items[0]).toEqual({
      id: expect.any(String), sku: "SKU-001", description: "Producto regulado", category: null,
      line: "REGULADO_ANMAT", lotNumber: "LOT-9", date: "2027-12-31",
      dateSemantics: "expiration", totalQuantity: 10, availableQuantity: 8,
      reservedQuantity: 2, unitOfMeasure: null, location: "Pasillo A", status: "Disponible",
    });
    expect(JSON.stringify(body)).not.toContain("30-secret");
    expect(JSON.stringify(body)).not.toContain("RACK-9");
    expect(JSON.stringify(body)).not.toContain("client-internal-17");
  });

  it("rejects a raw physical location string without external-label provenance", async () => {
    const harness = buildHarness({
      repository: {
        query: vi.fn(async () => page({ rows: [{ ...row, location: "WH-2/F1/R9/P4" as any }] })),
      },
    });
    const response = await harness.handler(request());
    expect(response.status).toBe(502);
    expect(JSON.stringify(await bodyOf(response))).not.toContain("WH-2");
  });

  it("maps repository failures to a safe availability error", async () => {
    const harness = buildHarness({ repository: { query: vi.fn(async () => { throw new Error("db password=secret"); }) } });
    const response = await harness.handler(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await bodyOf(response))).not.toContain("password");
  });

  it("sanitizes an unexpected adapter exception", async () => {
    const harness = buildHarness({
      scopeResolver: { resolve: vi.fn(async () => { throw new Error("secret topology at 10.0.0.7"); }) },
    });
    const response = await harness.handler(request());
    const body = await bodyOf(response);
    expect(response.status).toBe(500);
    expect(body.error).toEqual({ code: "internal_error", message: "Internal error" });
    expect(JSON.stringify(body)).not.toContain("10.0.0.7");
  });
});

describe("P3-N2A warnings, audit, rate limit and observations", () => {
  it("accepts only the two authorized warnings when counts match source gaps", async () => {
    const harness = buildHarness({
      repository: { query: vi.fn(async () => page({
        rows: [{ ...row, location: { kind: "unavailable" as const } }], updatedAt: null,
        warnings: [{ code: "location_unavailable", count: 1 }, { code: "updated_at_unavailable", count: 1 }],
      })) },
    });
    const response = await harness.handler(request());
    expect(response.status).toBe(200);
    expect((await bodyOf(response)).data.warnings).toEqual([
      { code: "location_unavailable", count: 1 },
      { code: "updated_at_unavailable", count: 1 },
    ]);
  });

  it("rejects an unauthorized warning code", async () => {
    const harness = buildHarness({ repository: { query: vi.fn(async () => page({ warnings: [{ code: "partial_data", count: 1 }] })) } });
    expect((await harness.handler(request())).status).toBe(502);
  });

  it("rejects a missing authorized warning for a real gap", async () => {
    const harness = buildHarness({ repository: { query: vi.fn(async () => page({ rows: [{ ...row, location: { kind: "unavailable" as const } }] })) } });
    expect((await harness.handler(request())).status).toBe(502);
  });

  it("returns zero data when the authoritative audit fails", async () => {
    const harness = buildHarness({ audit: { record: vi.fn(async () => { throw new Error("audit down"); }) } });
    const response = await harness.handler(request());
    expect(response.status).toBe(503);
    const body = await bodyOf(response);
    expect(body.error.code).toBe("audit_unavailable");
    expect(body).not.toHaveProperty("data");
  });

  it("rate-limits before repository access and publishes Retry-After", async () => {
    const harness = buildHarness({
      rateLimit: { consume: vi.fn(async () => ({ allowed: false, retryAfterMs: 1_500 })) },
    });
    const response = await harness.handler(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(harness.repositoryQuery).not.toHaveBeenCalled();
  });

  it("fails closed when the rate-limit port is unavailable", async () => {
    const harness = buildHarness({ rateLimit: { consume: vi.fn(async () => { throw new Error("down"); }) } });
    expect((await harness.handler(request())).status).toBe(503);
    expect(harness.repositoryQuery).not.toHaveBeenCalled();
  });

  it("emits sanitized audit and observation records", async () => {
    const harness = buildHarness();
    const response = await harness.handler(request("", { "x-correlation-id": CORRELATION_ID }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const serialized = JSON.stringify([...harness.audits, ...harness.observations]);
    expect(serialized).not.toContain("client-internal-17");
    expect(serialized).not.toContain("machine-internal-1");
    expect(serialized).not.toContain("test-secret");
    expect(harness.audits).toEqual([
      expect.objectContaining({ outcome: "success", rowsEvaluated: 1, rowsReturned: 1, integrityResult: "complete" }),
    ]);
  });

  it("rejects a caller-supplied malformed correlation id", async () => {
    const harness = buildHarness();
    const response = await harness.handler(request("", { "x-correlation-id": "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(harness.repositoryQuery).not.toHaveBeenCalled();
  });
});
