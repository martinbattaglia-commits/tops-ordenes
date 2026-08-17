/**
 * 2-C-1 · LA PUERTA DE EGRESO EN LA PANTALLA DE DESPACHO.
 *
 * El requisito duro del bloque es NEGATIVO y por eso se prueba primero: un
 * despacho de NIVEL 1 no debe ver nada — ni panel, ni aviso, ni un botón
 * apagado—. La pantalla tiene que quedar exactamente igual que antes.
 *
 * Se ejercita la función REAL con los clientes de Supabase inyectados por alias,
 * igual que `physical-capture-actions.test.ts`: sin red, sin cookies, sin DOM.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error stub inyectado por alias en vitest.wms-ui.config.ts
import { __setSessionClient, __setAdminClient } from "@/lib/supabase/server";
import { getDispatchEgressGate } from "@/lib/custody/dispatch-egress";

const ORDER = "11111111-1111-4111-8111-111111111111";
const ALLOC = "22222222-2222-4222-8222-222222222222";
const UNIT = "33333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;

/**
 * Doble de PostgREST acotado a las tres tablas que este módulo lee. Devuelve lo
 * que se le configura y nada más: si el módulo pidiera otra tabla, fallaría acá
 * en vez de pasar por casualidad.
 */
function db(tablas: Record<string, Row[]>, rpc?: Row | null) {
  const q = (rows: Row[]) => {
    const api: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) {
      api[m] = () => api;
    }
    api.then = (r: (v: { data: Row[]; error: null }) => unknown) => r({ data: rows, error: null });
    return api;
  };
  return {
    from(t: string) {
      return q(tablas[t] ?? []);
    },
    async rpc(name: string) {
      if (name !== "custody_egress_gate_status") throw new Error(`rpc inesperada: ${name}`);
      return { data: rpc ? [rpc] : null, error: rpc ? null : new Error("sin fila") };
    },
  };
}

const ALLOCS = [{ id: ALLOC }];
const BRIDGE = [{ physical_unit_id: UNIT }];

describe("2-C-1 · el NIVEL 1 no ve absolutamente nada", () => {
  it("una unidad de nivel 1 ⇒ applies=false y ninguna unidad", async () => {
    __setSessionClient(
      db({
        stock_allocations: ALLOCS,
        custody_physical_units: [{ id: UNIT, public_id: "CPU-2026-000001", sku: "SKU-1", custody_level: 1 }],
      }),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const g = await getDispatchEgressGate(ORDER);
    expect(g.applies).toBe(false);
    expect(g.units).toEqual([]);
  });

  it("un pedido SIN genealogía de custodia ⇒ applies=false", async () => {
    __setSessionClient(db({ stock_allocations: ALLOCS, custody_physical_units: [] }));
    __setAdminClient(db({ custody_allocation_physical_units: [] }));

    const g = await getDispatchEgressGate(ORDER);
    expect(g.applies).toBe(false);
  });

  it("un pedido sin allocations ⇒ applies=false", async () => {
    __setSessionClient(db({ stock_allocations: [] }));
    __setAdminClient(db({}));

    const g = await getDispatchEgressGate(ORDER);
    expect(g.applies).toBe(false);
  });

  it("si la lectura del estado falla, NO se muestra el panel: la red es el trigger", async () => {
    __setSessionClient(
      db(
        {
          stock_allocations: ALLOCS,
          custody_physical_units: [{ id: UNIT, public_id: "CPU-2026-000002", sku: "SKU-2", custody_level: 2 }],
        },
        null, // la RPC devuelve error
      ),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const g = await getDispatchEgressGate(ORDER);
    expect(g.applies).toBe(false);
  });
});

describe("2-C-1 · el NIVEL 2 sí ve la puerta, y dice qué falta", () => {
  it("sin foto de egreso ⇒ aplica, no permite despachar y guía", async () => {
    __setSessionClient(
      db(
        {
          stock_allocations: ALLOCS,
          custody_physical_units: [{ id: UNIT, public_id: "CPU-2026-000003", sku: "SKU-3", custody_level: 2 }],
        },
        {
          custody_level: 2,
          case_exists: true,
          has_ingress_photo: true,
          has_egress_photo: false,
          case_state: "PENDING_EVIDENCE",
          decision_kind: null,
          hold_reasons: [],
          release_certificate_issued: false,
          chain_advanced_after_release: false,
        },
      ),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const g = await getDispatchEgressGate(ORDER);
    expect(g.applies).toBe(true);
    expect(g.units).toHaveLength(1);
    expect(g.units[0].unitPublicId).toBe("CPU-2026-000003");
    expect(g.units[0].hasEgressPhoto).toBe(false);
    expect(g.units[0].dispatchAllowed).toBe(false);
    expect(g.allAllowed).toBe(false);

    // El mensaje GUÍA: dice qué hacer, no un código. Y sale del traductor de
    // 2-B, no de un texto escrito acá.
    const texto = g.units[0].blockers.join(" ");
    expect(texto).not.toMatch(/CUSTODY_[A-Z_]+/);
    expect(texto.toLowerCase()).toContain("foto");
  });

  it("liberada con certificado ⇒ aplica y deja despachar", async () => {
    __setSessionClient(
      db(
        {
          stock_allocations: ALLOCS,
          custody_physical_units: [{ id: UNIT, public_id: "CPU-2026-000004", sku: "SKU-4", custody_level: 2 }],
        },
        {
          custody_level: 2,
          case_exists: true,
          has_ingress_photo: true,
          has_egress_photo: true,
          case_state: "RELEASED",
          decision_kind: "release",
          hold_reasons: [],
          release_certificate_issued: true,
          chain_advanced_after_release: false,
        },
      ),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const g = await getDispatchEgressGate(ORDER);
    expect(g.applies).toBe(true);
    expect(g.units[0].dispatchAllowed).toBe(true);
    expect(g.units[0].blockers).toEqual([]);
    expect(g.allAllowed).toBe(true);
  });
});
