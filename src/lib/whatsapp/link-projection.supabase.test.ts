import { describe, it, expect, vi } from "vitest";

// El adaptador declara `import "server-only"` (guarda de Next). Se neutraliza
// SÓLO para este test, sin tocar vitest.config ni configuración compartida.
vi.mock("server-only", () => ({}));

import { createSupabaseProjectionPort } from "./link-projection.supabase";
import { projectInbound, isProjectionComplete } from "./link-projection";

/**
 * LINK-WA 1B-1C · Test del ADAPTADOR productivo con un builder GRABADOR.
 *
 * A diferencia de los fakes Map de los cores, acá se registra la consulta EXACTA
 * que el adaptador arma contra el builder de Supabase: tabla, operación,
 * filtros, columnas y payload. Es lo que mata la clase de bug que el C4
 * encontró — un selector PostgREST mal formado (`meta->wa>>status`) pasaba
 * inadvertido porque ningún fake lo interpretaba.
 *
 * Sin red, sin Supabase real, sin datos reales.
 */

type Call = {
  table: string;
  op: "select" | "insert" | "update";
  columns?: string;
  payload?: unknown;
  filters: Array<{ kind: string; column: string; value: unknown }>;
};

interface Programmed {
  /** Resultado discriminado devuelto por `connect_wa_apply_status`. */
  rpcOutcome?: string;
  rpcError?: { message: string };
  /** Resultado del SELECT inicial. */
  selectData?: unknown;
  selectError?: { message: string } | null;
  /** Filas devueltas por el `.select("id")` del UPDATE. */
  updateRows?: unknown[];
  updateError?: { message: string } | null;
}

function recordingClient(p: Programmed = {}) {
  const calls: Call[] = [];

  function builder(table: string) {
    const call: Call = { table, op: "select", filters: [] };
    const api: Record<string, unknown> = {};
    const chain = () => api;

    api.select = (columns: string) => {
      if (call.op === "update" || call.op === "insert") {
        // `.select()` posterior a un update/insert = "devolveme las filas".
        call.columns = columns;
        return {
          then: (res: (v: unknown) => unknown) =>
            res({ data: p.updateRows ?? [], error: p.updateError ?? null }),
        };
      }
      call.op = "select";
      call.columns = columns;
      calls.push(call);
      return chain();
    };
    api.insert = (payload: unknown) => {
      call.op = "insert";
      call.payload = payload;
      calls.push(call);
      return chain();
    };
    api.update = (payload: unknown) => {
      call.op = "update";
      call.payload = payload;
      calls.push(call);
      return chain();
    };
    for (const kind of ["eq", "is", "in", "not"]) {
      api[kind] = (column: string, value: unknown) => {
        call.filters.push({ kind, column, value });
        return chain();
      };
    }
    api.maybeSingle = async () => ({
      data: p.selectData ?? null,
      error: p.selectError ?? null,
    });
    api.single = async () => ({ data: p.selectData ?? null, error: p.selectError ?? null });
    return api;
  }

  // WA-8R9 · el estado del outbound ya no se escribe con select/update: se
  // delega en una RPC transaccional. El grabador registra su nombre y sus
  // argumentos EXACTOS, que es el contrato que este adaptador debe cumplir.
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  async function rpc(fn: string, args: Record<string, unknown>) {
    rpcs.push({ fn, args });
    if (p.rpcError) return { data: null, error: p.rpcError };
    return { data: p.rpcOutcome ?? "applied", error: null };
  }

  return { client: { from: builder, rpc } as never, calls, rpcs };
}

const STATUS = {
  wamid: "wamid.OUT1",
  status: "delivered" as const,
  at: "2026-08-09T10:00:00.000Z",
  recipientE164: "+5491100000001",
  errorCode: null,
};

describe("insertMessage · una fila por vez", () => {
  it("un 23505 es duplicado, no error del lote", async () => {
    const { client } = recordingClient({ updateError: null });
    // El insert no encadena `.select()`: el resultado se resuelve por `await`.
    const port = createSupabaseProjectionPort({
      from: () => ({
        insert: async () => ({ error: { message: "duplicate key value 23505" } }),
      }),
    } as never);
    const out = await port.insertMessage({
      conversationId: "c1", authorParticipantId: "p1",
      externalMsgId: "wamid.1", body: "x", createdAt: "2026-08-09T10:00:00.000Z",
    });
    expect(out).toBe("duplicate");
    expect(client).toBeDefined();
  });

  it("otro error SÍ propaga (no se silencia como duplicado)", async () => {
    const port = createSupabaseProjectionPort({
      from: () => ({ insert: async () => ({ error: { message: "permission denied" } }) }),
    } as never);
    await expect(
      port.insertMessage({
        conversationId: "c1", authorParticipantId: "p1",
        externalMsgId: "wamid.1", body: "x", createdAt: "2026-08-09T10:00:00.000Z",
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

// ══ WA-8R9 · §3.A · el estado del outbound se aplica por RPC ATÓMICA ═══════
/**
 * Esta suite cambió de objeto de prueba a propósito.
 *
 * Antes verificaba los filtros PostgREST del CAS y la fusión de `meta.wa` hecha
 * en JavaScript. Ese diseño era la causa de dos defectos que ningún CAS por
 * columnas cierra:
 *
 *  B-1. la fusión partía del snapshot leído, así que un `audit_sent` agregado
 *       por un escritor concurrente se BORRABA al escribir el objeto entero;
 *  H-1. agotar el CAS devolvía `noop`, indistinguible de "no había nada que
 *       hacer", y el evento se marcaba `processed` sin haber aplicado nada.
 *
 * La decisión se mudó adentro de una transacción de PostgreSQL con lock de
 * fila. Por eso las garantías semánticas —preservación de claves concurrentes,
 * monotonía canónica, precedencia de procedencia, cardinalidad— ya no se
 * verifican acá sino contra PostgreSQL REAL, en
 * `tests/db/t-wa-r9-01-atomic-status.test.ts`, donde además se matan por
 * mutación siete variantes del defecto.
 *
 * Lo que SÍ le corresponde a este adaptador, y es lo que se prueba acá:
 * llamar a la RPC correcta, con los argumentos exactos, y traducir su
 * resultado discriminado sin colapsar nada en `noop`.
 */
describe("WA-8R9 · applyOutboundStatus delega en connect_wa_apply_status", () => {
  it("llama a la RPC UNA vez, con nombre y argumentos exactos", async () => {
    const { client, rpcs, calls } = recordingClient({ rpcOutcome: "applied" });
    await createSupabaseProjectionPort(client).applyOutboundStatus(STATUS);

    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].fn).toBe("connect_wa_apply_status");
    expect(rpcs[0].args).toEqual({
      p_wamid: STATUS.wamid,
      p_status: STATUS.status,
      p_source: "meta",
      p_at: STATUS.at,
      p_error_code: null,
    });
    // Y CERO read-modify-write: ni lectura previa ni UPDATE desde el cliente.
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
    expect(calls.filter((c) => c.op === "select")).toHaveLength(0);
  });

  it("la procedencia la fija el adaptador y no viaja en la entrada", async () => {
    const { client, rpcs } = recordingClient({ rpcOutcome: "applied" });
    // Aunque el payload intentara declarar su propia fuente, no hay parámetro.
    await createSupabaseProjectionPort(client).applyOutboundStatus({
      ...STATUS,
      ...({ statusSource: "server" } as unknown as Record<string, never>),
    });
    expect(rpcs[0].args.p_source).toBe("meta");
  });

  it("propaga el código de error del proveedor cuando existe", async () => {
    const { client, rpcs } = recordingClient({ rpcOutcome: "applied" });
    await createSupabaseProjectionPort(client).applyOutboundStatus({
      ...STATUS, status: "failed", errorCode: 131047,
    });
    expect(rpcs[0].args.p_error_code).toBe(131047);
  });

  it.each([
    ["sent", "sent"], ["delivered", "delivered"], ["read", "read"], ["failed", "failed"],
  ])("el estado %s viaja tal cual al servidor", async (_l, status) => {
    const { client, rpcs } = recordingClient({ rpcOutcome: "applied" });
    await createSupabaseProjectionPort(client)
      .applyOutboundStatus({ ...STATUS, status: status as never });
    expect(rpcs[0].args.p_status).toBe(status);
  });
});

// ══ WA-8R9 · H-1 · la traducción del resultado no colapsa en `noop` ════════
describe("WA-8R9 · H-1 · cada resultado se traduce sin perder el hecho", () => {
  const traducir = async (rpcOutcome: string) => {
    const { client } = recordingClient({ rpcOutcome });
    return createSupabaseProjectionPort(client).applyOutboundStatus(STATUS);
  };

  it("`applied` acredita la aplicación", async () => {
    expect(await traducir("applied")).toBe("applied");
  });

  it.each([
    // El hecho YA estaba idéntico: replay idempotente, nada que aplicar ahora.
    ["duplicate"],
    // La fila no admite el hecho (entrante, canon, procedencia): terminal.
    ["rejected"],
  ])("`%s` es terminal sin acreditar (noop honesto)", async (outcome) => {
    expect(await traducir(outcome)).toBe("noop");
  });

  it("`unmatched` deja el status pendiente de reconciliar", async () => {
    expect(await traducir("unmatched")).toBe("unmatched");
  });

  it.each([
    ["retryable"],
    ["reconciliation_required"],
  ])("`%s` LANZA: el evento no puede quedar `processed`", async (outcome) => {
    // Éste es el corazón de H-1. El status NO se aplicó; devolver `noop` haría
    // que el core lo contara como resuelto y el webhook marcara el evento como
    // procesado, perdiéndolo. Lanzar lo deja en la cola durable de reproceso.
    await expect(traducir(outcome)).rejects.toThrow(/requiere reproceso/);
  });

  it("un resultado desconocido es fail-closed, jamás éxito", async () => {
    await expect(traducir("cualquier_cosa")).rejects.toThrow(/resultado desconocido/);
  });

  it("un error de PostgREST no se degrada a noop ni a applied", async () => {
    const { client } = recordingClient({ rpcError: { message: "permission denied" } });
    await expect(
      createSupabaseProjectionPort(client).applyOutboundStatus(STATUS),
    ).rejects.toThrow(/estado \(rpc\)/);
  });
});

// ══ WA-8R9 · el contador y la cola del core, compuestos con el adaptador ═══
describe("WA-8R9 · statusesApplied y la reprocesabilidad del evento", () => {
  const proyectar = async (rpcOutcome: string) => {
    const { client, calls } = recordingClient({ rpcOutcome });
    const res = await projectInbound(
      { messages: [], statuses: [STATUS] },
      createSupabaseProjectionPort(client),
      [],
    );
    return { res, calls };
  };

  it("una fila entrante (rejected) no acredita ni escribe", async () => {
    const { res, calls } = await proyectar("rejected");
    expect(res.statusesApplied).toBe(0);
    expect(res.statusesNoop).toBe(1);
    expect(res.errors).toEqual([]);
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("una fila saliente sí acredita", async () => {
    const { res } = await proyectar("applied");
    expect(res.statusesApplied).toBe(1);
  });

  it("un replay idéntico NO infla el contador", async () => {
    const { res } = await proyectar("duplicate");
    expect(res.statusesApplied).toBe(0);
  });

  it.each([["retryable"], ["reconciliation_required"]])(
    "`%s` deja error en el resultado ⇒ la proyección NO está completa",
    async (outcome) => {
      const { res } = await proyectar(outcome);
      expect(res.statusesApplied).toBe(0);
      expect(res.errors).toHaveLength(1);
      // `isProjectionComplete` es lo que el webhook consulta para marcar
      // `processed`. Con errores presentes, el evento queda reprocesable.
      expect(isProjectionComplete(res)).toBe(false);
    },
  );

  it("en cambio `applied` y `rejected` sí completan la proyección", async () => {
    for (const outcome of ["applied", "rejected", "duplicate"]) {
      const { res } = await proyectar(outcome);
      expect(isProjectionComplete(res)).toBe(true);
    }
  });
});
