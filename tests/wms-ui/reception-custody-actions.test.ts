import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error stub inyectado por alias en vitest.wms-ui.config.ts
import { __setAdminClient, __setSessionClient } from "@/lib/supabase/server";
import {
  confirmReceptionAction,
  createConfirmAndCaptureAction,
  createReceptionFull,
  receptionCustodyUnitsAction,
} from "@/app/(app)/wms/recepciones/actions";

const { attachMock } = vi.hoisted(() => ({ attachMock: vi.fn() }));
vi.mock("@/lib/custody/physical-ingress", () => ({
  attachPhysicalEvidence: (...args: unknown[]) => attachMock(...args),
}));

const CLIENT = "11111111-1111-4111-8111-111111111111";
const RECEPTION = "22222222-2222-4222-8222-222222222222";
const POSITION = "33333333-3333-4333-8333-333333333333";
const OPERATION = "99999999-9999-4999-8999-999999999999";

const PNG_1X1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

function payload(reforzada = false, lines = 2) {
  return {
    header: {
      client_id: CLIENT,
      business_unit: "GENERAL" as const,
      custody_reforzada: reforzada,
    },
    items: Array.from({ length: lines }, (_, index) => ({
      sku: `SKU-${index + 1}`,
      description: `Producto ${index + 1}`,
      quantity: 1,
      position_id: POSITION,
    })),
  };
}

function formFor(input: ReturnType<typeof payload>, photos: Array<File | null>): FormData {
  const form = new FormData();
  form.set("idempotency_key", OPERATION);
  form.set("payload", JSON.stringify(input));
  photos.forEach((photo, index) => {
    if (photo) form.set(`foto-${index}`, photo);
  });
  return form;
}

function png(name: string): File {
  return new File([PNG_1X1], name, { type: "image/png" });
}

function session(options: {
  level?: unknown;
  levelError?: boolean;
  receptionLevel?: boolean;
  calls: string[];
  writes: string[];
}) {
  return {
    async rpc(name: string) {
      options.calls.push(name);
      if (name === "custody_client_level") {
        return options.levelError
          ? { data: null, error: new Error("lookup caído") }
          : { data: options.level ?? 1, error: null };
      }
      if (name === "confirm_reception") {
        options.writes.push(name);
        return { data: null, error: null };
      }
      return { data: null, error: new Error(`RPC inesperada ${name}`) };
    },
    from(table: string) {
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.maybeSingle = async () => {
        if (table !== "receptions") return { data: null, error: null };
        return {
          data: {
            client_id: CLIENT,
            custody_reforzada: options.receptionLevel === true,
          },
          error: null,
        };
      };
      query.insert = () => {
        options.writes.push(`insert:${table}`);
        return query;
      };
      query.update = () => {
        options.writes.push(`update:${table}`);
        return query;
      };
      query.single = async () => ({ data: { id: RECEPTION }, error: null });
      query.then = (done: (value: { data: unknown; error: null }) => unknown) =>
        done({ data: null, error: null });
      return query;
    },
  };
}

beforeEach(() => {
  __setSessionClient(null);
  __setAdminClient(null);
  attachMock.mockReset().mockResolvedValue({
    ok: true,
    data: { evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", event_public_id: "CUST-1" },
  });
});

describe("recepción N2 · preflight antes de cualquier escritura", () => {
  it("error al resolver nivel corta createReceptionFull sin writes", async () => {
    const calls: string[] = [];
    const writes: string[] = [];
    __setSessionClient(session({ levelError: true, calls, writes }));

    const result = await createReceptionFull(payload(false, 1));
    expect(result.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(calls).toEqual(["custody_client_level"]);
  });

  it("respuesta de nivel inválida nunca se degrada a N1", async () => {
    const calls: string[] = [];
    const writes: string[] = [];
    __setSessionClient(session({ level: "desconocido", calls, writes }));

    const result = await createReceptionFull(payload(false, 1));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/no es verificable/i);
    expect(writes).toEqual([]);
  });

  it("dos líneas N2 con una sola foto cortan antes del primer insert", async () => {
    const calls: string[] = [];
    const writes: string[] = [];
    __setSessionClient(session({ level: 2, calls, writes }));

    const result = await createConfirmAndCaptureAction(
      formFor(payload(false, 2), [png("a.png"), null]),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/cada línea/i);
    expect(writes).toEqual([]);
  });

  it("una elevación manual N2 exige fotos sin confiar en el lookup", async () => {
    const calls: string[] = [];
    const writes: string[] = [];
    __setSessionClient(session({ level: 1, calls, writes }));

    const result = await createConfirmAndCaptureAction(
      formFor(payload(true, 1), [null]),
    );
    expect(result.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("magic bytes falsos cortan antes de crear stock", async () => {
    const calls: string[] = [];
    const writes: string[] = [];
    __setSessionClient(session({ level: 2, calls, writes }));
    const fake = new File([new Uint8Array([1, 2, 3, 4])], "falsa.png", { type: "image/png" });

    const result = await createConfirmAndCaptureAction(formFor(payload(false, 1), [fake]));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/no es JPEG, PNG o WebP/i);
    expect(writes).toEqual([]);
  });

  it("el camino N2 completo liga cada foto por reception_item_id y recupera QR distintos", async () => {
    const itemA = "44444444-4444-4444-8444-444444444441";
    const itemB = "44444444-4444-4444-8444-444444444442";
    const unitA = "55555555-5555-4555-8555-555555555551";
    const unitB = "55555555-5555-4555-8555-555555555552";
    const caseA = "66666666-6666-4666-8666-666666666661";
    const caseB = "66666666-6666-4666-8666-666666666662";
    const tokenA = "77777777-7777-4777-8777-777777777771";
    const tokenB = "77777777-7777-4777-8777-777777777772";
    const itemIds = [itemA, itemB];
    const writes: string[] = [];
    const rpcCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];

    const custodyRows = [
      {
        physical_unit_id: unitB,
        reception_item_id: itemB,
        unit_public_id: "CPU-B",
        sku: "SKU-2",
        quantity: 1,
        custody_level: 2,
        case_id: caseB,
        case_public_id: "CINT-B",
        case_state: "PENDING_EVIDENCE",
        has_ingress_photo: true,
      },
      {
        physical_unit_id: unitA,
        reception_item_id: itemA,
        unit_public_id: "CPU-A",
        sku: "SKU-1",
        quantity: 1,
        custody_level: 2,
        case_id: caseA,
        case_public_id: "CINT-A",
        case_state: "PENDING_EVIDENCE",
        has_ingress_photo: true,
      },
    ];

    __setSessionClient({
      async rpc(name: string, args?: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (name === "custody_client_level") return { data: 2, error: null };
        if (name === "wms_create_confirm_reception_v1") {
          writes.push(name);
          return {
            data: { version: 1, operation_id: "90909090-9090-4090-8090-909090909090", reception_id: RECEPTION, item_ids: [itemA, itemB] },
            error: null,
          };
        }
        if (name === "custody_reception_units") return { data: custodyRows, error: null };
        if (name === "get_custody_physical_token") {
          return {
            data: args?.p_physical_unit_id === unitA ? tokenA : tokenB,
            error: null,
          };
        }
        return { data: null, error: new Error(`RPC inesperada ${name}`) };
      },
      from(table: string) {
        const query: Record<string, unknown> = {};
        query.insert = () => {
          writes.push(`insert:${table}`);
          return query;
        };
        query.update = () => {
          writes.push(`update:${table}`);
          return query;
        };
        query.select = () => query;
        query.eq = () => query;
        query.single = async () => ({
          data: { id: table === "receptions" ? RECEPTION : itemIds.shift() },
          error: null,
        });
        query.then = (done: (value: { data: null; error: null }) => unknown) =>
          done({ data: null, error: null });
        return query;
      },
    });
    __setAdminClient({
      from(table: string) {
        const query: Record<string, unknown> = {};
        query.select = () => query;
        query.eq = () => query;
        query.maybeSingle = async () => ({
          data: table === "clients" ? { id: CLIENT, razon: "Cliente A", activo: true } : null,
          error: null,
        });
        return query;
      },
    });

    const result = await createConfirmAndCaptureAction(
      formFor(payload(false, 2), [png("foto-a.png"), png("foto-b.png")]),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.data).toBeDefined();
    if (!result.ok || !result.data) throw new Error("resultado N2 ausente");
    expect(result.data.units.map((unit) => unit.physicalUnitId)).toEqual([unitB, unitA]);
    expect(result.data.units.map((unit) => unit.qrUrl)).toEqual([
      expect.stringContaining(tokenB),
      expect.stringContaining(tokenA),
    ]);
    expect(result.data.fotosPendientes).toEqual([]);
    expect(writes).toEqual(["wms_create_confirm_reception_v1"]);
    expect(attachMock).toHaveBeenCalledTimes(2);
    const attached = attachMock.mock.calls.map(([form]) => {
      const fd = form as FormData;
      return {
        entity: fd.get("entity_id"),
        file: (fd.get("file") as File).name,
        stage: fd.get("stage"),
        eventType: fd.get("event_type"),
      };
    });
    expect(attached).toEqual([
      { entity: unitA, file: "foto-a.png", stage: "recepcion", eventType: "foto_ingreso" },
      { entity: unitB, file: "foto-b.png", stage: "recepcion", eventType: "foto_ingreso" },
    ]);
    expect(rpcCalls.filter((call) => call.name === "custody_reception_units")).toHaveLength(2);
  });
});

describe("confirmación directa · nivel releído por el servidor", () => {
  it("N2 rechaza sin invocar confirm_reception", async () => {
    const calls: string[] = [];
    const writes: string[] = [];
    __setSessionClient(session({ level: 2, calls, writes }));

    const result = await confirmReceptionAction(RECEPTION);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/anulá.*recreala/i);
    expect(writes).toEqual([]);
  });

  it("N1 conserva el camino histórico y llama confirm_reception", async () => {
    const calls: string[] = [];
    const writes: string[] = [];
    __setSessionClient(session({ level: 1, calls, writes }));

    const result = await confirmReceptionAction(RECEPTION);
    expect(result.ok).toBe(true);
    expect(writes).toEqual(["confirm_reception"]);
  });

  it("UUID inválido no consulta ni escribe", async () => {
    const calls: string[] = [];
    const writes: string[] = [];
    __setSessionClient(session({ level: 1, calls, writes }));

    const result = await confirmReceptionAction("../otro");
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe("QR inmediato y recuperable · sólo token canónico N2", () => {
  it("dos CPU N2 conservan QR distintos y N1 nunca pide token", async () => {
    const unitA = "44444444-4444-4444-8444-444444444444";
    const unitB = "55555555-5555-4555-8555-555555555555";
    const unitN1 = "66666666-6666-4666-8666-666666666666";
    const tokenA = "77777777-7777-4777-8777-777777777777";
    const tokenB = "88888888-8888-4888-8888-888888888888";
    const tokenCalls: string[] = [];
    __setSessionClient({
      async rpc(name: string, args: Record<string, unknown>) {
        if (name === "custody_reception_units") {
          return {
            data: [
              {
                physical_unit_id: unitA,
                reception_item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                unit_public_id: "CPU-A",
                sku: "SKU-A",
                quantity: 1,
                custody_level: 2,
                case_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                case_public_id: "CINT-A",
                case_state: "PENDING_EVIDENCE",
                has_ingress_photo: true,
              },
              {
                physical_unit_id: unitB,
                reception_item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                unit_public_id: "CPU-B",
                sku: "SKU-B",
                quantity: 1,
                custody_level: 2,
                case_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                case_public_id: "CINT-B",
                case_state: "PENDING_EVIDENCE",
                has_ingress_photo: true,
              },
              {
                physical_unit_id: unitN1,
                reception_item_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                unit_public_id: "CPU-N1",
                sku: "SKU-N1",
                quantity: 1,
                custody_level: 1,
                case_id: null,
                case_public_id: null,
                case_state: null,
                has_ingress_photo: false,
              },
            ],
            error: null,
          };
        }
        if (name === "get_custody_physical_token") {
          const id = String(args.p_physical_unit_id);
          tokenCalls.push(id);
          return id === unitA
            ? { data: tokenA, error: null }
            : id === unitB
              ? { data: tokenB, error: null }
              : { data: null, error: new Error("N1 no debe pedir token") };
        }
        return { data: null, error: new Error(`RPC inesperada ${name}`) };
      },
    });

    const result = await receptionCustodyUnitsAction(RECEPTION);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toBeDefined();
    if (!result.ok || !result.data) throw new Error("resultado de custodia ausente");
    expect(result.data[0].qrUrl).toContain(tokenA);
    expect(result.data[1].qrUrl).toContain(tokenB);
    expect(result.data[0].qrUrl).not.toBe(result.data[1].qrUrl);
    expect(result.data[2].qrUrl).toBeNull();
    expect(result.data[2].qrDataUrl).toBeNull();
    expect(tokenCalls).toEqual([unitA, unitB]);
    expect(JSON.stringify(result.data)).not.toMatch(/"token"\s*:/);
  });
});
