import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error stub inyectado por alias en vitest.wms-ui.config.ts
import { __setAdminClient, __setSessionClient } from "@/lib/supabase/server";
import {
  attachEvidenceAction,
  generatePodAction,
  shipmentPodReadinessAction,
} from "@/app/(app)/wms/custody/actions";
import { CustodyShipmentActions } from "@/app/(app)/wms/custody/_components/CustodyShipmentActions";

const SHIPMENT = "11111111-1111-4111-8111-111111111111";
const SIGNATURE = "22222222-2222-4222-8222-222222222222";
const MALICIOUS_SIGNATURE = "33333333-3333-4333-8333-333333333333";
const DELIVERED_AT = "2026-08-20T10:00:00.000Z";

function podSession(options: {
  status: "despachado" | "entregado";
  deliveredAt?: string | null;
  signatureId?: string | null;
  signatureError?: boolean;
}) {
  const filters: Array<{ table: string; op: string; column: string; value: unknown }> = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    filters,
    rpcs,
    from(table: string) {
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = (column: string, value: unknown) => {
        filters.push({ table, op: "eq", column, value });
        return query;
      };
      query.gte = (column: string, value: unknown) => {
        filters.push({ table, op: "gte", column, value });
        return query;
      };
      query.order = () => query;
      query.maybeSingle = async () => ({
        data: table === "shipments"
          ? {
              id: SHIPMENT,
              status: options.status,
              delivered_at: options.deliveredAt ?? null,
            }
          : null,
        error: null,
      });
      query.limit = async () => ({
        data: options.signatureId ? [{ id: options.signatureId, created_at: DELIVERED_AT }] : [],
        error: options.signatureError ? new Error("lectura fallida") : null,
      });
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      if (name !== "generate_delivery_pod_v2") {
        return { data: null, error: new Error(`RPC inesperada ${name}`) };
      }
      return {
        data: {
          pod_id: "44444444-4444-4444-8444-444444444444",
          public_id: "POD-2026-0001",
        },
        error: null,
      };
    },
  };
}

beforeEach(() => {
  __setSessionClient(null);
  __setAdminClient(null);
});

describe("POD y firma derivados del shipment exacto", () => {
  const podForm = () => {
    const form = new FormData();
    form.set("shipment_id", SHIPMENT);
    form.set("receiver_name", "Receptor");
    return form;
  };

  it("antes de la entrega no consulta firma ni genera POD", async () => {
    const db = podSession({ status: "despachado" });
    __setSessionClient(db);

    const readiness = await shipmentPodReadinessAction(SHIPMENT);
    expect(readiness).toEqual({
      ok: true,
      data: { delivered: false },
    });
    expect(db.filters.some((filter) => filter.table === "custody_evidence")).toBe(false);

    const result = await generatePodAction(podForm());
    expect(result.ok).toBe(false);
    expect(db.rpcs).toEqual([]);
  });

  it("no reutiliza firmas históricas y genera únicamente por la RPC v2", async () => {
    const db = podSession({
      status: "entregado",
      deliveredAt: DELIVERED_AT,
      signatureId: SIGNATURE,
    });
    __setSessionClient(db);

    const readiness = await shipmentPodReadinessAction(SHIPMENT);
    expect(readiness).toEqual({
      ok: true,
      data: { delivered: true },
    });
    expect(db.filters.some((filter) => filter.table === "custody_evidence")).toBe(false);

    const generated = await generatePodAction(podForm());
    expect(generated.ok).toBe(true);
    const call = db.rpcs.find((item) => item.name === "generate_delivery_pod_v2");
    expect(call?.args.p_signature_operation_id).toBeNull();
  });

  it("un dato de firma enviado por fuera del formulario no se consulta ni consume", async () => {
    const db = podSession({
      status: "entregado",
      deliveredAt: DELIVERED_AT,
      signatureId: MALICIOUS_SIGNATURE,
    });
    __setSessionClient(db);
    const readiness = await shipmentPodReadinessAction(SHIPMENT);
    expect(readiness).toEqual({ ok: true, data: { delivered: true } });
    const generated = await generatePodAction(podForm());
    expect(generated.ok).toBe(true);
    expect(db.filters.some((filter) => filter.table === "custody_evidence")).toBe(false);
  });

  it("una llamada directa tampoco adjunta firma antes de entregar", async () => {
    const db = podSession({ status: "despachado" });
    __setSessionClient(db);
    const form = new FormData();
    form.set("file", new File(["firma"], "firma.png", { type: "image/png" }));
    form.set("scope", "shipment");
    form.set("entity_id", SHIPMENT);
    form.set("kind", "firma");
    form.set("stage", "entrega");
    form.set("event_type", "firmado");

    const before = await attachEvidenceAction(form);
    expect(before.ok).toBe(false);
    expect(before.ok === false && before.error).toMatch(/después de confirmar la entrega/i);

    const deliveredDb = podSession({ status: "entregado", deliveredAt: DELIVERED_AT });
    __setSessionClient(deliveredDb);
    const after = await attachEvidenceAction(form);
    expect(after.ok).toBe(false);
    expect(after.ok === false && after.error).toBe("Operación administrativa no disponible");
  });
});

describe("presentación POD post-entrega", () => {
  const renderActions = (podReadiness: "delivered" | "pending_delivery" | "unavailable") =>
    renderToStaticMarkup(
      <CustodyShipmentActions
        shipmentId={SHIPMENT}
        podPresent={false}
        revalidate="/wms/despachos/pedido"
        podReadiness={podReadiness}
      />,
    );

  it("oculta firma y POD antes de la entrega", () => {
    const html = renderActions("pending_delivery");
    expect(html).not.toContain("Firma del receptor");
    expect(html).not.toContain("Generar POD");
    expect(html).toContain("después de confirmar la entrega");
  });

  it("habilita firma y POD sólo con entrega verificada", () => {
    const html = renderActions("delivered");
    expect(html).toContain("Firma del receptor");
    expect(html).toContain("Generar POD");
  });

  it("un estado no verificable muestra bloqueo explícito", () => {
    const html = renderActions("unavailable");
    expect(html).not.toContain("Generar POD");
    expect(html).toContain("Estado de entrega no verificable");
  });
});
