/**
 * 2-C-1 · LA PUERTA DE EGRESO EN LA PANTALLA DE DESPACHO.
 *
 * El requisito duro del bloque es NEGATIVO y por eso se prueba primero: un
 * despacho de NIVEL 1 no debe ver nada — ni panel, ni aviso, ni un botón
 * apagado—. La pantalla tiene que quedar exactamente igual que antes.
 *
 * Se ejercita la función REAL con los clientes de Supabase inyectados por alias,
 * igual que `physical-capture-actions.test.ts`: sin red, sin cookies, sin DOM.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REMEDIACIÓN DE C4 1/2 · F-3 · LOS DOBLES DEJARON DE DESCARTAR ARGUMENTOS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La versión anterior hacía `for (const m of [...]) api[m] = () => api`, de modo
 * que `select`, `eq`, `in` y `order` ignoraban lo que recibían, y `rpc` no
 * aceptaba parámetros. El revisor lo demostró de la única forma que cuenta:
 * **borrando `.in("allocation_id", allocationIds)` de `dispatch-egress.ts` los
 * seis tests pasaban idénticos.** Una suite que sobrevive a que le saquen el
 * acotamiento del `service_role` no protege ese acotamiento: lo acompaña.
 *
 * Lo que cambió, y por qué alcanza:
 *
 *   · `eq` e `in` REGISTRAN su predicado y `then` resuelve las filas filtradas.
 *     Un filtro que desaparece del código deja de excluir, y eso ahora se ve.
 *   · `rpc` recibe los parámetros y responde POR `p_physical_unit_id`. Pedir el
 *     estado de otra unidad devuelve error, no la fila de siempre.
 *   · **las fixtures traen filas AJENAS a propósito** — un pedido, una
 *     allocation y una unidad de otro despacho. Sin ellas el doble podría
 *     respetar los argumentos y los mutantes seguirían vivos, porque no habría
 *     nada que los filtros tuvieran que excluir. Los datos son la mitad de la
 *     prueba.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error stub inyectado por alias en vitest.wms-ui.config.ts
import { __setSessionClient, __setAdminClient } from "@/lib/supabase/server";
import { getDispatchEgressGate, resolveDispatchOrderUnits } from "@/lib/custody/dispatch-egress";
import {
  confirmDeliveryAction,
  confirmDispatchAction,
  registerDispatchEgressAction,
} from "@/app/(app)/wms/despachos/actions";

const ORDER = "11111111-1111-4111-8111-111111111111";
const ALLOC = "22222222-2222-4222-8222-222222222222";
const UNIT = "33333333-3333-4333-8333-333333333333";
const CASE = "44444444-4444-4444-8444-444444444444";
const SHIPMENT = "55555555-5555-4555-8555-555555555555";

/** El pedido AJENO. Existe para que los filtros tengan algo que excluir. */
const ORDER_OTRO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALLOC_OTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UNIT_OTRO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Row = Record<string, unknown>;

/** Lee `a.b.c` sobre una fila con embeds, como los devuelve PostgREST. */
function pick(row: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Row)[k];
  }, row);
}

/**
 * Doble de PostgREST que **honra los filtros**. `select` y `order` no filtran —
 * son forma y orden—; `eq` e `in` sí, y se acumulan.
 */
function db(
  tablas: Record<string, Row[]>,
  rpcPorUnidad?: Record<string, Row>,
  mutationCalls?: Array<{ name: string; args?: Record<string, unknown> }>,
) {
  const q = (rows: Row[]) => {
    const filtros: Array<(r: Row) => boolean> = [];
    const resolver = () => rows.filter((r) => filtros.every((f) => f(r)));
    const api: Record<string, unknown> = {};
    api.select = () => api;
    api.order = () => api;
    api.eq = (col: string, val: unknown) => {
      filtros.push((r) => pick(r, col) === val);
      return api;
    };
    api.in = (col: string, vals: unknown[]) => {
      filtros.push((r) => Array.isArray(vals) && vals.includes(pick(r, col) as never));
      return api;
    };
    api.maybeSingle = async () => {
      const f = resolver();
      return { data: f[0] ?? null, error: null };
    };
    api.then = (r: (v: { data: Row[]; error: null }) => unknown) => r({ data: resolver(), error: null });
    return api;
  };
  return {
    from(t: string) {
      return q(tablas[t] ?? []);
    },
    async rpc(name: string, params?: Record<string, unknown>) {
      if (name === "confirm_dispatch" || name === "confirm_delivery") {
        mutationCalls?.push({ name, args: params });
        return { data: name === "confirm_dispatch" ? SHIPMENT : null, error: null };
      }
      if (name !== "custody_egress_gate_status") throw new Error(`rpc inesperada: ${name}`);
      const id = String(params?.p_physical_unit_id ?? "");
      const row = rpcPorUnidad?.[id];
      // Pedir el estado de una unidad que no se resolvió es un error, no la fila
      // de siempre: así el mutante que cambia `p_physical_unit_id` muere.
      return row ? { data: [row], error: null } : { data: null, error: new Error("sin fila") };
    },
  };
}

/** Las dos allocations: la del pedido y la AJENA, las dos empacadas. */
const ALLOCS: Row[] = [
  { id: ALLOC, quantity: 1, status: "empacada", logistics_order_items: { order_id: ORDER } },
  { id: ALLOC_OTRO, quantity: 1, status: "empacada", logistics_order_items: { order_id: ORDER_OTRO } },
];

/** El puente, con la fila ajena que el `.in(allocation_id)` debe excluir. */
const BRIDGE: Row[] = [
  { allocation_id: ALLOC, physical_unit_id: UNIT, quantity: 1 },
  { allocation_id: ALLOC_OTRO, physical_unit_id: UNIT_OTRO, quantity: 1 },
];

function unidad(id: string, publicId: string, sku: string, nivel: number): Row {
  return { id, public_id: publicId, sku, custody_level: nivel };
}

function caso(physicalUnitId = UNIT): Row {
  return {
    id: CASE,
    public_id: "CINT-2026-000001",
    physical_unit_id: physicalUnitId,
  };
}

/** Estado de puerta ABIERTA: liberada, con certificado y cadena al día. */
function abierta(): Row {
  return {
    custody_level: 2,
    case_exists: true,
    has_ingress_photo: true,
    has_egress_photo: true,
    case_state: "RELEASED",
    decision_kind: "release",
    hold_reasons: [],
    release_certificate_issued: true,
    chain_advanced_after_release: false,
  };
}

/** Estado de puerta CERRADA por falta de la foto de egreso. */
function sinEgreso(): Row {
  return {
    custody_level: 2,
    case_exists: true,
    has_ingress_photo: true,
    has_egress_photo: false,
    case_state: "PENDING_EVIDENCE",
    decision_kind: null,
    hold_reasons: [],
    release_certificate_issued: false,
    chain_advanced_after_release: false,
  };
}

describe("2-C-1 · el NIVEL 1 no ve absolutamente nada", () => {
  it("una unidad de nivel 1 ⇒ applies=false y ninguna unidad", async () => {
    __setSessionClient(
      db({
        stock_allocations: ALLOCS,
        custody_physical_units: [unidad(UNIT, "CPU-2026-000001", "SKU-1", 1)],
      }),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const g = await getDispatchEgressGate(ORDER);
    expect(g.applies).toBe(false);
    expect(g.status).toBe("not_applicable");
    expect(g.allAllowed).toBe(true);
    expect(g.units).toEqual([]);
  });

  it("un pedido con allocation pero SIN genealogía verificable queda bloqueado", async () => {
    __setSessionClient(db({ stock_allocations: ALLOCS, custody_physical_units: [] }));
    __setAdminClient(db({ custody_allocation_physical_units: [] }));

    const g = await getDispatchEgressGate(ORDER);
    expect(g.applies).toBe(false);
    expect(g.status).toBe("unavailable");
    expect(g.allAllowed).toBe(false);
  });

  it("un pedido sin allocations ⇒ applies=false", async () => {
    __setSessionClient(db({ stock_allocations: [] }));
    __setAdminClient(db({}));

    const g = await getDispatchEgressGate(ORDER);
    expect(g.applies).toBe(false);
  });

  it("si la lectura del estado falla, queda no verificable y bloqueada", async () => {
    __setSessionClient(
      db(
        {
          stock_allocations: ALLOCS,
          custody_physical_units: [unidad(UNIT, "CPU-2026-000002", "SKU-2", 2)],
          custody_integrity_cases: [caso()],
        },
        {}, // ninguna unidad tiene fila de estado ⇒ la RPC devuelve error
      ),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const g = await getDispatchEgressGate(ORDER);
    expect(g.applies).toBe(false);
    expect(g.status).toBe("unavailable");
    expect(g.allAllowed).toBe(false);
  });
});

describe("2-C-1 · el NIVEL 2 sí ve la puerta, y dice qué falta", () => {
  /**
   * ⚠ ÉSTE ES EL TEST DE LA VUELTA (F-3).
   *
   * Las fixtures traen la unidad del pedido AJENO en las tres tablas y con la
   * puerta ABIERTA. Si cualquiera de los tres filtros desaparece, esa unidad
   * entra al resultado: `units` pasa a 2 y `allAllowed` a `true`. Y si la RPC
   * recibe otro `p_physical_unit_id`, no hay fila y todo cae a `applies:false`.
   */
  it("sin foto de egreso ⇒ aplica, no permite despachar y guía", async () => {
    __setSessionClient(
      db(
        {
          stock_allocations: ALLOCS,
          custody_physical_units: [
            unidad(UNIT, "CPU-2026-000003", "SKU-3", 2),
            unidad(UNIT_OTRO, "CPU-2026-000999", "SKU-AJENO", 2),
          ],
          custody_integrity_cases: [caso()],
        },
        { [UNIT]: sinEgreso(), [UNIT_OTRO]: abierta() },
      ),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const g = await getDispatchEgressGate(ORDER);
    expect(g.applies).toBe(true);
    expect(g.status).toBe("required");
    // La unidad ajena NO entra. Éste es el aserto que mata a los mutantes 1-3.
    expect(g.units).toHaveLength(1);
    expect(g.units[0].unitPublicId).toBe("CPU-2026-000003");
    expect(g.units[0].caseId).toBe(CASE);
    expect(g.units[0].casePublicId).toBe("CINT-2026-000001");
    expect(g.units.map((u) => u.unitPublicId)).not.toContain("CPU-2026-000999");
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
          custody_physical_units: [
            unidad(UNIT, "CPU-2026-000004", "SKU-4", 2),
            unidad(UNIT_OTRO, "CPU-2026-000999", "SKU-AJENO", 2),
          ],
          custody_integrity_cases: [caso()],
        },
        { [UNIT]: abierta(), [UNIT_OTRO]: abierta() },
      ),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const g = await getDispatchEgressGate(ORDER);
    expect(g.applies).toBe(true);
    expect(g.status).toBe("required");
    expect(g.units).toHaveLength(1);
    expect(g.units[0].unitPublicId).toBe("CPU-2026-000004");
    expect(g.units[0].dispatchAllowed).toBe(true);
    expect(g.units[0].blockers).toEqual([]);
    expect(g.allAllowed).toBe(true);
  });
});

describe("2-C-1 · el vínculo pedido → unidades es UNO SOLO", () => {
  /**
   * F-1 se cierra reusando este resolvedor en la acción. Si respondiera distinto
   * que el panel, la validación de pertenencia dejaría de describir lo que la
   * pantalla ofrece — por eso se prueba que acota igual.
   */
  it("resuelve SÓLO las unidades del pedido, de cualquier nivel", async () => {
    __setSessionClient(
      db({
        stock_allocations: ALLOCS,
        custody_physical_units: [
          unidad(UNIT, "CPU-2026-000005", "SKU-5", 2),
          unidad(UNIT_OTRO, "CPU-2026-000999", "SKU-AJENO", 2),
        ],
      }),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const u = await resolveDispatchOrderUnits(ORDER);
    expect(u?.map((x) => x.id)).toEqual([UNIT]);
  });

  it("un pedido con allocation y sin genealogía comprobada devuelve null", async () => {
    __setSessionClient(db({ stock_allocations: ALLOCS, custody_physical_units: [] }));
    __setAdminClient(db({ custody_allocation_physical_units: [] }));

    expect(await resolveDispatchOrderUnits(ORDER)).toBeNull();
  });

  it("una cobertura cuantitativa parcial queda no verificable", async () => {
    __setSessionClient(
      db({
        stock_allocations: [
          { id: ALLOC, quantity: 2, status: "empacada", logistics_order_items: { order_id: ORDER } },
        ],
        custody_physical_units: [unidad(UNIT, "CPU-2026-000005", "SKU-5", 2)],
      }),
    );
    __setAdminClient(
      db({
        custody_allocation_physical_units: [
          { allocation_id: ALLOC, physical_unit_id: UNIT, quantity: 1 },
        ],
      }),
    );

    expect(await resolveDispatchOrderUnits(ORDER)).toBeNull();
    const gate = await getDispatchEgressGate(ORDER);
    expect(gate.status).toBe("unavailable");
    expect(gate.allAllowed).toBe(false);
  });
});

describe("remediación UX · caso y disponibilidad son fail-closed", () => {
  it("si la RPC afirma caso pero el caso no es visible, el gate queda unavailable", async () => {
    __setSessionClient(
      db(
        {
          stock_allocations: ALLOCS,
          custody_physical_units: [unidad(UNIT, "CPU-2026-000007", "SKU-7", 2)],
          custody_integrity_cases: [],
        },
        { [UNIT]: abierta() },
      ),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const gate = await getDispatchEgressGate(ORDER);
    expect(gate.status).toBe("unavailable");
    expect(gate.allAllowed).toBe(false);
    expect(gate.units).toEqual([]);
  });

  it("sin allocations verificadas es not_applicable, no unavailable", async () => {
    __setSessionClient(db({ stock_allocations: [] }));
    __setAdminClient(db({}));

    const gate = await getDispatchEgressGate(ORDER);
    expect(gate.status).toBe("not_applicable");
    expect(gate.allAllowed).toBe(true);
  });
});

describe("acciones de despacho y entrega releen el gate autoritativo", () => {
  it("N1 confirmado no recibe un falso bloqueo y puede invocar confirm_dispatch", async () => {
    const mutations: Array<{ name: string; args?: Record<string, unknown> }> = [];
    __setSessionClient(
      db(
        {
          stock_allocations: ALLOCS,
          custody_physical_units: [unidad(UNIT, "CPU-2026-000010", "SKU-10", 1)],
        },
        {},
        mutations,
      ),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const result = await confirmDispatchAction(ORDER);
    expect(result).toEqual({ ok: true, id: SHIPMENT });
    expect(mutations).toEqual([
      { name: "confirm_dispatch", args: { p_order_id: ORDER } },
    ]);
  });

  it("un N2 pendiente no llega a confirm_dispatch", async () => {
    const mutations: Array<{ name: string; args?: Record<string, unknown> }> = [];
    __setSessionClient(
      db(
        {
          stock_allocations: ALLOCS,
          custody_physical_units: [unidad(UNIT, "CPU-2026-000011", "SKU-11", 2)],
          custody_integrity_cases: [caso()],
        },
        { [UNIT]: sinEgreso() },
        mutations,
      ),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const result = await confirmDispatchAction(ORDER);
    expect(result.ok).toBe(false);
    expect(mutations).toEqual([]);
  });

  it("una entrega bloqueada no llega a confirm_delivery", async () => {
    const mutations: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const dispatchedAllocs = ALLOCS.map((row) => ({ ...row, status: "despachada" }));
    __setSessionClient(
      db(
        {
          shipments: [{ id: SHIPMENT, order_id: ORDER, status: "despachado" }],
          stock_allocations: dispatchedAllocs,
          custody_physical_units: [unidad(UNIT, "CPU-2026-000012", "SKU-12", 2)],
          custody_integrity_cases: [caso()],
        },
        { [UNIT]: sinEgreso() },
        mutations,
      ),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const result = await confirmDeliveryAction(SHIPMENT, ORDER, "Receptor");
    expect(result.ok).toBe(false);
    expect(mutations).toEqual([]);
  });

  it("una entrega con CINT liberado invoca confirm_delivery para el shipment exacto", async () => {
    const mutations: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const dispatchedAllocs = ALLOCS.map((row) => ({ ...row, status: "despachada" }));
    __setSessionClient(
      db(
        {
          shipments: [{ id: SHIPMENT, order_id: ORDER, status: "despachado" }],
          stock_allocations: dispatchedAllocs,
          custody_physical_units: [unidad(UNIT, "CPU-2026-000013", "SKU-13", 2)],
          custody_integrity_cases: [caso()],
        },
        { [UNIT]: abierta() },
        mutations,
      ),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));

    const result = await confirmDeliveryAction(SHIPMENT, ORDER, "Receptor");
    expect(result.ok).toBe(true);
    expect(mutations).toEqual([
      {
        name: "confirm_delivery",
        args: { p_shipment_id: SHIPMENT, p_received_by: "Receptor" },
      },
    ]);
  });
});

describe("F-1 · una foto de egreso sólo se adjunta a una unidad DE ESTE PEDIDO", () => {
  const MEMBRESIA = "no pertenece a este pedido";

  function escenario() {
    __setSessionClient(
      db({
        stock_allocations: ALLOCS,
        custody_physical_units: [
          unidad(UNIT, "CPU-2026-000006", "SKU-6", 2),
          unidad(UNIT_OTRO, "CPU-2026-000999", "SKU-AJENO", 2),
        ],
      }),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));
  }

  function formulario(unitId: string) {
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array([1, 2, 3, 4])], "egreso.jpg", { type: "image/jpeg" }));
    fd.set("entity_id", unitId);
    return fd;
  }

  /**
   * ⚠ LA PRUEBA POR LA NEGATIVA. El escenario del revisor, textual: un operario
   * parado en el pedido A manda el `entity_id` de una unidad del pedido B. Nivel
   * ✓, tenant ✓, permiso ✓ — y antes de esta remediación la foto quedaba
   * adjunta a un bulto que estaba en la estantería.
   */
  it("unidad de OTRO pedido ⇒ RECHAZO", async () => {
    escenario();
    const res = await registerDispatchEgressAction(ORDER, formulario(UNIT_OTRO));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain(MEMBRESIA);
  });

  /**
   * El control que impide que la guarda pase por rechazarlo todo: la unidad
   * legítima NO muere por pertenencia. Muere después, donde corresponde —no hay
   * cliente administrativo ni Storage en este arnés—, y eso es prueba de que
   * cruzó la validación.
   */
  it("la unidad DEL pedido cruza la validación de pertenencia", async () => {
    escenario();
    const res = await registerDispatchEgressAction(ORDER, formulario(UNIT));
    if (res.ok === false) expect(res.error).not.toContain(MEMBRESIA);
  });

  it("un pedido sin genealogía de custodia también RECHAZA", async () => {
    __setSessionClient(db({ stock_allocations: ALLOCS, custody_physical_units: [] }));
    __setAdminClient(db({ custody_allocation_physical_units: [] }));
    const res = await registerDispatchEgressAction(ORDER, formulario(UNIT));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain(MEMBRESIA);
  });

  it("un replay posterior al despacho queda fuera de la ventana de captura", async () => {
    __setSessionClient(
      db({
        stock_allocations: ALLOCS.map((row) => ({ ...row, status: "despachada" })),
        custody_physical_units: [unidad(UNIT, "CPU-2026-000014", "SKU-14", 2)],
      }),
    );
    __setAdminClient(db({ custody_allocation_physical_units: BRIDGE }));
    const res = await registerDispatchEgressAction(ORDER, formulario(UNIT));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain(MEMBRESIA);
  });
});
