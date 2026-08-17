import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  adminFactory: vi.fn(),
  clientFactory: vi.fn(),
  rpc: vi.fn(),
  plan: vi.fn(),
  send: vi.fn(),
  buildPdf: vi.fn(),
  failureNotification: vi.fn(),
  revalidatePath: vi.fn(),
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: harness.revalidatePath }));
vi.mock("next/headers", () => ({ headers: () => ({ get: () => null }) }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: harness.adminFactory,
  createClient: harness.clientFactory,
}));
vi.mock("@/lib/env", () => ({
  env: {
    app: { demoMode: false, url: "https://nexus.example.test" },
    email: {
      depot: {
        magaldi: "depot-magaldi@example.test",
        lujan: "depot-lujan@example.test",
      },
      admin: {
        joseluis: "director@example.test",
        ruth: "billing@example.test",
      },
    },
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  clientKey: () => "test-client",
  rateLimit: () => ({ ok: true, remaining: 9, retryAfterMs: 0 }),
}));
vi.mock("@/lib/utils", () => ({
  dataUrlToBytes: () => ({ bytes: new Uint8Array([1]), contentType: "image/png" }),
  isUrgentOrder: () => false,
}));
vi.mock("@/lib/email", () => ({ sendOneOrderEmail: harness.send }));
vi.mock("@/lib/order-email", () => ({
  orderEmailPlan: harness.plan,
  dedupeOrderEmails: (plan: unknown[]) => plan,
  renderRoleHtml: () => "<p>test</p>",
  renderRoleText: () => "test",
}));
vi.mock("@/lib/email-failure", () => ({
  emailFailureNotification: harness.failureNotification,
}));
vi.mock("@/lib/pdf/build", () => ({ buildOrderPdf: harness.buildPdf }));
vi.mock("@/lib/mock-data", () => ({
  MOCK_ORDERS: [],
  MOCK_CLIENTS: [],
  MOCK_OPERATORS: [],
}));

import { createOrder } from "../app/(app)/orders/new/actions";
import {
  ORDER_EMAIL_FAILURE_CODE,
  ORDER_RECIPIENT_SAFE_ERROR,
} from "./order-recipient-boundary";
import type { CreateOrderInput } from "./validation/order";

const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TARIFF_VERSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CANONICAL_EMAIL = "Canonical.Client@Example.com";
const FORGED_EMAIL = "attacker@example.net";
const INTERNAL_DB_ERROR = "db-private.internal:6543 connection refused";

const canonicalIdentity = {
  id: CLIENT_ID,
  razon: "Cliente Canónico SA",
  cuit: "30-71234567-8",
  activo: true,
};

const canonicalFicha = {
  ...canonicalIdentity,
  domicilio: "Calle Ficticia 123",
  telefono: "",
  contacto: "Operaciones",
  email: CANONICAL_EMAIL,
  tags: [],
};

type Scenario = {
  identityData: typeof canonicalIdentity | null;
  identityError: { message: string } | null;
  contactData: (Omit<typeof canonicalFicha, "email"> & { email: unknown }) | null;
  contactError: { message: string } | null;
  contactThrows: boolean;
};

let scenario: Scenario;

function queryFor(table: string) {
  let selected = "";
  let eqColumn = "";
  let eqValue: unknown;
  let mutation = "";
  // Doble deliberadamente dinámico: reproduce la cadena fluida de Supabase.
  const builder: any = {};

  builder.select = (columns: string) => {
    selected = columns;
    return builder;
  };
  builder.eq = (column: string, value: unknown) => {
    eqColumn = column;
    eqValue = value;
    return builder;
  };
  builder.update = (values: Record<string, unknown>) => {
    mutation = "update";
    harness.updates.push({ table, values });
    return builder;
  };
  builder.insert = () => {
    mutation = "insert";
    return builder;
  };
  builder.maybeSingle = async () => {
    if (table === "clients" && selected.includes("activo")) {
      if (
        scenario.identityData &&
        eqColumn === "id" &&
        eqValue !== scenario.identityData.id
      ) {
        return { data: null, error: scenario.identityError };
      }
      return { data: scenario.identityData, error: scenario.identityError };
    }
    if (table === "operators") {
      return {
        data: { id: "op-1", full_name: "Operador", role: "operador", avatar: null, depot: "MAGALDI" },
        error: null,
      };
    }
    if (table === "email_sends" && mutation === "insert") {
      return { data: { id: "email-send-1" }, error: null };
    }
    return { data: null, error: null };
  };
  builder.single = async () => {
    if (scenario.contactThrows) throw new Error(INTERNAL_DB_ERROR);
    return { data: scenario.contactData, error: scenario.contactError };
  };
  builder.order = async () => ({
    data: [
      {
        id: "line-1",
        service_slug: "picking",
        label: "Picking",
        qty: 1,
        unit: "unidad",
        rate: 100,
        subtotal: 100,
        currency_snapshot: "ARS",
        line_sequence: 1,
      },
    ],
    error: null,
  });
  const awaitedResult =
    table === "email_sends" ? { data: [] as unknown[], error: null } : { data: null, error: null };
  builder.then = (
    onfulfilled?: (value: typeof awaitedResult) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(awaitedResult).then(onfulfilled, onrejected);

  return builder;
}

function makeAdmin() {
  return {
    from: (table: string) => queryFor(table),
    rpc: harness.rpc,
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://files.example.test/object" } }),
      }),
    },
  };
}

function validInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    pricing_version_id: TARIFF_VERSION_ID,
    client: {
      id: CLIENT_ID,
      razon: canonicalIdentity.razon,
      cuit: canonicalIdentity.cuit,
      domicilio: "Controlado por navegador",
      telefono: "",
      contacto: "",
      email: FORGED_EMAIL,
    },
    depot: "MAGALDI",
    operator_id: "op-1",
    services: [
      {
        service_slug: "picking",
        label: "Picking",
        qty: 1,
        unit: "unidad",
        rate: 100,
        subtotal: 100,
        pricing_kind: "catalog",
        pricing_status: "resolved",
        pricing_reason: "",
        second_trip_discount: false,
        surcharge: "none",
      },
    ],
    h_start: "08:00",
    h_end: "09:00",
    pallets: 0,
    units: 1,
    km: 0,
    observ: "",
    total: 100,
    signature: {
      signed_by: "Firmante Ficticio",
      signed_doc: null,
      data_url: "data:image/png;base64,AA==",
      hash: "0".repeat(64),
      geo_lat: null,
      geo_lng: null,
    },
    ...overrides,
  };
}

function serializedEvidence(result: unknown, consoleSpy: ReturnType<typeof vi.spyOn>) {
  return JSON.stringify({ result, logs: consoleSpy.mock.calls });
}

function expectNoEffects() {
  expect(harness.rpc.mock.calls.some(([name]) => name === "service_order_issue")).toBe(false);
  expect(harness.plan).not.toHaveBeenCalled();
  expect(harness.send).not.toHaveBeenCalled();
  expect(harness.buildPdf).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.updates.length = 0;
  scenario = {
    identityData: canonicalIdentity,
    identityError: null,
    contactData: canonicalFicha,
    contactError: null,
    contactThrows: false,
  };
  harness.rpc.mockImplementation((name: string) => {
    // `nexus_depot_manager_scope` (0246) se consume encadenando `.maybeSingle()`.
    // Devolver la promesa pelada dejaba a la acción lanzando TypeError, y el
    // catch de createOrder convertía cada caso de esta suite en el error
    // genérico, tapando justo los controles que acá se verifican.
    if (name === "nexus_depot_manager_scope") {
      return { maybeSingle: async () => ({ data: null, error: null }) };
    }
    if (name === "has_permission") return Promise.resolve({ data: true, error: null });
    if (name === "service_order_prepare_email_delivery") {
      return Promise.resolve({
        data: {
          attempt_key: "service-order/order-1/cliente",
          status: "queued",
          to_email: CANONICAL_EMAIL,
          provider_id: null,
        },
        error: null,
      });
    }
    if (name === "service_order_finalize_email_delivery") {
      return Promise.resolve({ data: 1, error: null });
    }
    return Promise.resolve({
      data: {
        id: "order-1",
        public_id: "OS-000001",
        short_id: 1,
        date: "2026-08-15T00:00:00.000Z",
        total: 100,
        tariff_version_id: null,
        currency: "ARS",
        signature_hash: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
      },
      error: null,
    });
  });
  harness.plan.mockReturnValue([]);
  harness.failureNotification.mockReturnValue({});
  harness.send.mockResolvedValue({ ok: true, id: "mail-1" });
  harness.buildPdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
  harness.adminFactory.mockReturnValue(makeAdmin());
  harness.clientFactory.mockReturnValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: harness.rpc,
  });
});

describe("PR66 · acción real · destinatario no controlable por navegador", () => {
  it("usa exclusivamente el email canónico exacto aunque el navegador falsifique email", async () => {
    const result = await createOrder(validInput());

    expect(result.ok).toBe(true);
    expect(harness.rpc.mock.calls.filter(([name]) => name === "service_order_issue")).toHaveLength(1);
    expect(harness.plan).toHaveBeenCalledTimes(1);
    expect(harness.plan.mock.calls[0]?.[1]).toBe(CANONICAL_EMAIL);
    expect(harness.plan.mock.calls[0]?.[1]).not.toBe(FORGED_EMAIL);
  });

  it.each([
    ["nombre", { razon: "Nombre manipulado" }],
    ["id", { id: OTHER_ID }],
    ["CUIT", { cuit: "30-99999999-9" }],
  ])("rechaza la manipulación de %s antes de cualquier efecto", async (_case, clientPatch) => {
    const input = validInput({
      client: { ...validInput().client, ...clientPatch, email: FORGED_EMAIL },
    });
    const result = await createOrder(input);

    expect(result.ok).toBe(false);
    expectNoEffects();
  });

  it.each([
    ["ausente", null, null, false],
    ["vacío", "", null, false],
    ["inválido", "no-es-email", null, false],
    ["CRLF", `${CANONICAL_EMAIL}\r\nBcc: ${FORGED_EMAIL}`, null, false],
    ["error DB", CANONICAL_EMAIL, { message: INTERNAL_DB_ERROR }, false],
    ["excepción DB", CANONICAL_EMAIL, null, true],
  ])(
    "email canónico %s detiene emisión, plan y envío con respuesta segura",
    async (_case, email, contactError, contactThrows) => {
      scenario.contactData = { ...canonicalFicha, email };
      scenario.contactError = contactError;
      scenario.contactThrows = contactThrows;
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const result = await createOrder(validInput());

      expect(result).toEqual({ ok: false, error: ORDER_RECIPIENT_SAFE_ERROR });
      expectNoEffects();
      const evidence = serializedEvidence(result, consoleSpy);
      expect(evidence).not.toContain(FORGED_EMAIL);
      expect(evidence).not.toContain(CANONICAL_EMAIL);
      expect(evidence).not.toContain(INTERNAL_DB_ERROR);
      consoleSpy.mockRestore();
    },
  );

  it("cliente inexistente no crea, planifica ni envía", async () => {
    scenario.identityData = null;
    const result = await createOrder(validInput());

    expect(result.ok).toBe(false);
    expectNoEffects();
  });

  it("deniega antes de construir o usar service_role", async () => {
    harness.rpc.mockImplementation(async (name: string) =>
      name === "has_permission"
        ? { data: false, error: null }
        : { data: null, error: null },
    );

    const result = await createOrder(validInput());

    expect(result).toEqual({
      ok: false,
      error: "No tenés permisos para crear y firmar órdenes de servicio.",
    });
    expect(harness.adminFactory).not.toHaveBeenCalled();
    expectNoEffects();
  });

  it("error del lookup de identidad no expone DB ni direcciones", async () => {
    scenario.identityError = { message: INTERNAL_DB_ERROR };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await createOrder(validInput());

    expect(result).toEqual({ ok: false, error: ORDER_RECIPIENT_SAFE_ERROR });
    expectNoEffects();
    const evidence = serializedEvidence(result, consoleSpy);
    expect(evidence).not.toContain(FORGED_EMAIL);
    expect(evidence).not.toContain(CANONICAL_EMAIL);
    expect(evidence).not.toContain(INTERNAL_DB_ERROR);
    consoleSpy.mockRestore();
  });

  it("redacta el error del proveedor antes de ledger, notificación y logs", async () => {
    harness.plan.mockReturnValue([
      {
        role: "cliente",
        to: CANONICAL_EMAIL,
        tag: "cliente",
        subject: "Comprobante",
      },
    ]);
    harness.send.mockResolvedValue({
      ok: false,
      error: `recipient ${CANONICAL_EMAIL} rejected by provider`,
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await createOrder(validInput());

    expect(result.ok).toBe(true);
    const finalize = harness.rpc.mock.calls.find(
      ([name, args]) => name === "service_order_finalize_email_delivery"
        && (args as { p_status?: string }).p_status === "failed",
    );
    expect((finalize?.[1] as { p_error_code?: string })?.p_error_code)
      .toBe(ORDER_EMAIL_FAILURE_CODE);
    expect(harness.failureNotification).toHaveBeenCalledWith(
      expect.objectContaining({ providerError: ORDER_EMAIL_FAILURE_CODE }),
    );
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(CANONICAL_EMAIL);
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(FORGED_EMAIL);
    consoleSpy.mockRestore();
  });

  it("una excepción del proveedor marca unknown, notifica y no imprime la dirección", async () => {
    harness.plan.mockReturnValue([
      {
        role: "cliente",
        to: CANONICAL_EMAIL,
        tag: "cliente",
        subject: "Comprobante",
      },
    ]);
    harness.send.mockRejectedValue(
      new Error(`recipient ${CANONICAL_EMAIL} rejected by provider`),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await createOrder(validInput());

    expect(result.ok).toBe(true);
    const finalize = harness.rpc.mock.calls.find(
      ([name, args]) => name === "service_order_finalize_email_delivery"
        && (args as { p_status?: string }).p_status === "unknown",
    );
    expect((finalize?.[1] as { p_error_code?: string })?.p_error_code)
      .toBe("ORDER_EMAIL_DELIVERY_UNKNOWN");
    expect(harness.failureNotification).toHaveBeenCalledWith(
      expect.objectContaining({ providerError: ORDER_EMAIL_FAILURE_CODE }),
    );
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(CANONICAL_EMAIL);
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(FORGED_EMAIL);
    consoleSpy.mockRestore();
  });
});
