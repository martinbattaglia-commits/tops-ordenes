import { describe, it, expect, vi } from "vitest";

// La factory no declara `server-only`, pero sí lo hacen sus vecinos si el grafo
// cambia. Se neutraliza sólo acá, sin tocar vitest.config ni configuración global.
vi.mock("server-only", () => ({}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createSupabaseReplyPorts,
  CLAIM_COLUMNS,
  AUDIT_PAYLOAD_ALLOWLIST,
  AUDIT_ACTIONS,
  AUDIT_REASONS,
  AUDIT_SCHEMAS,
  MARK_AUDITED_MAX_ATTEMPTS,
  type ReplyPortsDeps,
} from "./reply.supabase";
import { isValidClientMsgId } from "./reply-core";
import { canTransition, WA_AUDIT_MARKER_KEY } from "./outbound-state";
import type { MetaSendOutcome } from "./transport";

/**
 * LINK-WA WA-7 · `createSupabaseReplyPorts` con BUILDER GRABADOR.
 *
 * Se ejercita la factory REAL — no una copia ni un fake que oculte la consulta.
 * Cada llamada registra tabla, operación, columnas, payload y filtros exactos,
 * de modo que un `->>` degradado a `>>`, un filtro faltante, una precondición
 * omitida o una cardinalidad relajada rompen el test.
 *
 * Sin red, sin PostgreSQL, sin Supabase remoto, sin Meta real, sin datos reales.
 */

/**
 * WA-7R3 · los identificadores de correlación son UUID CANÓNICOS.
 *
 * Antes eran `"msg-1"` / `"conv-1"`, y ese detalle del banco de pruebas es
 * justamente lo que ocultaba el defecto: una expresión que aceptaba
 * `msg-1` aceptaba también `5491100000001` y `Bearer_token`. Con el contrato
 * semántico, el banco de pruebas usa lo mismo que produce el sistema real.
 */
const MSG = "11111111-2222-4333-8444-555555555555";
const CONV = "22222222-3333-4444-8555-666666666666";
const OP = "11111111-1111-4111-8111-111111111111";
const CID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const PHONE = "+5491100000001";
const WAMID = "wamid.OUT1";
const AT = "2026-08-09T12:00:00.000Z";

type Filter = { kind: string; column: string; value: unknown };
type Call = {
  table: string;
  op: "select" | "insert" | "update";
  columns?: string;
  payload?: unknown;
  filters: Filter[];
  terminal?: "maybeSingle" | "select";
};
type RpcCall = { fn: string; args: Record<string, unknown> };
type SelectResult = { data?: unknown; error?: { message: string } | null };

interface Program {
  /** Resultado discriminado de `connect_wa_apply_status`. */
  rpcOutcome?: string;
  rpcError?: { message: string };
  /** Resultado por tabla del SELECT (`maybeSingle`). */
  select?: Record<string, SelectResult>;
  /**
   * WA-7R3 · resultados SUCESIVOS del SELECT por tabla. El último se repite.
   * Permite simular que un webhook avanza el estado ENTRE dos lecturas del CAS.
   */
  selectSeq?: Record<string, SelectResult[]>;
  /** Filas devueltas por el `.select("id")` posterior a un UPDATE. */
  updateRows?: unknown[];
  /** WA-7R3 · filas devueltas por UPDATEs sucesivos. Fuera de rango ⇒ cero filas. */
  updateRowsSeq?: unknown[][];
  updateError?: { message: string } | null;
  insertError?: { message: string } | null;
  rpc?: { data?: unknown; error?: { message: string } | null };
}

function recorder(p: Program = {}) {
  const calls: Call[] = [];
  const rpcs: RpcCall[] = [];
  let updateIdx = 0;
  const selectIdx: Record<string, number> = {};

  function from(table: string) {
    const call: Call = { table, op: "select", filters: [] };
    const api: Record<string, unknown> = {};
    const chain = () => api;

    api.select = (columns: string) => {
      if (call.op === "update" || call.op === "insert") {
        call.columns = columns;
        call.terminal = "select";
        const rows = p.updateRowsSeq
          ? (p.updateRowsSeq[updateIdx++] ?? [])
          : (p.updateRows ?? []);
        return {
          then: (res: (v: unknown) => unknown) =>
            res({ data: rows, error: p.updateError ?? null }),
        };
      }
      call.columns = columns;
      calls.push(call);
      return chain();
    };
    api.insert = (payload: unknown) => {
      call.op = "insert";
      call.payload = payload;
      calls.push(call);
      return Object.assign(chain(), {
        then: (res: (v: unknown) => unknown) => res({ error: p.insertError ?? null }),
      });
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
    api.maybeSingle = async () => {
      call.terminal = "maybeSingle";
      const seq = p.selectSeq?.[table];
      if (seq && seq.length > 0) {
        const i = selectIdx[table] ?? 0;
        selectIdx[table] = i + 1;
        // El último resultado se repite: el webhook avanza una vez y se queda.
        const step = seq[Math.min(i, seq.length - 1)];
        return { data: step.data ?? null, error: step.error ?? null };
      }
      const prog = p.select?.[table] ?? {};
      return { data: prog.data ?? null, error: prog.error ?? null };
    };
    return api;
  }

  const client = {
    from,
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      // WA-8R9 · el estado del outbound viaja por su propia RPC transaccional,
      // con resultado discriminado. El resto (claim) conserva su forma.
      const respuesta =
        fn === "connect_wa_apply_status" || fn === "connect_wa_mark_audited"
          ? { data: p.rpcOutcome ?? "applied", error: p.rpcError ?? null }
          : (p.rpc ?? { data: null, error: null });
      return { then: (res: (v: unknown) => unknown) => res(respuesta) };
    },
    auth: { getUser: async () => ({ data: { user: { id: OP } } }) },
  };
  return { client, calls, rpcs };
}

const transport = {
  sendText: vi.fn(async (): Promise<MetaSendOutcome> => ({ kind: "accepted", wamid: WAMID })),
};

function makeFactory(p: Program = {}, over: Partial<ReplyPortsDeps> = {}) {
  const rec = recorder(p);
  const clock = { now: vi.fn(() => AT) };
  const isOperator = vi.fn(() => true);
  const isSandboxAllowed = vi.fn(() => true);
  const ports = createSupabaseReplyPorts({
    supabase: rec.client as never,
    admin: rec.client as never,
    isOperator,
    isSandboxAllowed,
    clock,
    transport: transport as never,
    ...over,
  });
  return { ports, ...rec, clock, isOperator, isSandboxAllowed };
}

/** Fila canónica devuelta por la relectura del claim. */
const CANONICAL_ROW = {
  id: MSG,
  conversation_id: CONV,
  author_profile_id: OP,
  client_msg_id: CID,
  body: "hola",
  external_msg_id: null,
};

function claimProgram(row: unknown = CANONICAL_ROW, rpcId: string | null = MSG): Program {
  return {
    rpc: { data: rpcId ? [{ id: rpcId }] : [], error: null },
    select: { connect_messages: { data: row } },
  };
}

// ── 16 · argumentos exactos del RPC ────────────────────────────────────────
describe("16 · RPC connect_post_message con argumentos canónicos", () => {
  it("nombre y los seis parámetros exactos", async () => {
    const f = makeFactory(claimProgram());
    await f.ports.claim.acquire({ conversationId: CONV, body: "hola", clientMsgId: CID });

    expect(f.rpcs).toHaveLength(1);
    expect(f.rpcs[0].fn).toBe("connect_post_message");
    expect(f.rpcs[0].args).toEqual({
      p_conversation_id: CONV,
      p_body: "hola",
      p_reply_to: null,
      p_client_msg_id: CID,
      p_attachment_ids: [],
      p_mentions: null,
    });
  });

  it("un RPC sin fila devuelve `denied`, no un binding fabricado", async () => {
    const f = makeFactory(claimProgram(CANONICAL_ROW, null));
    const out = await f.ports.claim.acquire({ conversationId: CONV, body: "hola", clientMsgId: CID });
    expect(out).toEqual({ kind: "denied", reason: "rbac_denied" });
  });
});

// ── 16b · WA-7R · C · cardinalidad exacta del RPC ──────────────────────────
/**
 * `connect_post_message` debe devolver EXACTAMENTE una fila. Cada mutante
 * verifica que la ambigüedad no se resuelva a favor del envío y que un fallo de
 * infraestructura no se disfrace de decisión de autorización.
 */
describe("16b · cardinalidad de connect_post_message", () => {
  const acquire = (f: ReturnType<typeof makeFactory>) =>
    f.ports.claim.acquire({ conversationId: CONV, body: "hola", clientMsgId: CID });

  it("0 filas → fail-closed (`denied`), sin relectura", async () => {
    const f = makeFactory({ rpc: { data: [], error: null } });
    expect(await acquire(f)).toEqual({ kind: "denied", reason: "rbac_denied" });
    expect(f.calls.filter((c) => c.op === "select")).toHaveLength(0);
  });

  it("1 fila válida → continúa y relee el snapshot", async () => {
    const f = makeFactory(claimProgram());
    expect(await acquire(f)).toMatchObject({ kind: "claimed" });
    expect(f.calls.filter((c) => c.op === "select")).toHaveLength(1);
  });

  it("más de 1 fila → `not_verifiable`, SIN relectura y sin egress", async () => {
    const f = makeFactory({
      rpc: { data: [{ id: MSG }, { id: "msg-2" }], error: null },
      select: { connect_messages: { data: CANONICAL_ROW } },
    });
    expect(await acquire(f)).toEqual({ kind: "not_verifiable" });
    // Lo decisivo: no se eligió arbitrariamente `data[0]` ni se releyó nada.
    expect(f.calls.filter((c) => c.op === "select")).toHaveLength(0);
  });

  it("1 fila sin id → `not_verifiable`, no `denied`", async () => {
    const f = makeFactory({ rpc: { data: [{}], error: null } });
    expect(await acquire(f)).toEqual({ kind: "not_verifiable" });
  });

  it("forma no-array impide verificar cardinalidad → `not_verifiable`", async () => {
    const f = makeFactory({ rpc: { data: { id: MSG }, error: null } });
    expect(await acquire(f)).toEqual({ kind: "not_verifiable" });
    expect(f.calls.filter((c) => c.op === "select")).toHaveLength(0);
  });

  it("`data` nulo sin error → 0 filas → `denied`", async () => {
    const f = makeFactory({ rpc: { data: null, error: null } });
    expect(await acquire(f)).toEqual({ kind: "denied", reason: "rbac_denied" });
  });
});

// ── 17 · relectura de las seis columnas ────────────────────────────────────
describe("17 · relectura canónica del snapshot", () => {
  it("selecciona exactamente las seis columnas de CLAIM_COLUMNS, acotada por id", async () => {
    const f = makeFactory(claimProgram());
    const out = await f.ports.claim.acquire({ conversationId: CONV, body: "hola", clientMsgId: CID });

    const read = f.calls.find((c) => c.table === "connect_messages" && c.op === "select")!;
    expect(read.columns).toBe(CLAIM_COLUMNS);
    for (const col of [
      "id", "conversation_id", "author_profile_id", "client_msg_id", "body", "external_msg_id",
    ]) {
      expect(read.columns).toContain(col);
    }
    expect(read.filters).toEqual([{ kind: "eq", column: "id", value: MSG }]);
    expect(out).toEqual({
      kind: "claimed",
      snapshot: {
        id: MSG, conversationId: CONV, authorProfileId: OP,
        clientMsgId: CID, body: "hola", externalMsgId: null,
      },
    });
  });
});

// ── 18 · relectura fallida no fabrica binding ──────────────────────────────
describe("18 · error / ausencia / snapshot incompleto → not_verifiable", () => {
  it.each([
    ["error de SELECT", { rpc: { data: [{ id: MSG }] }, select: { connect_messages: { error: { message: "boom" } } } }],
    ["fila ausente", { rpc: { data: [{ id: MSG }] }, select: { connect_messages: { data: null } } }],
    ["sin id", { rpc: { data: [{ id: MSG }] }, select: { connect_messages: { data: { ...CANONICAL_ROW, id: null } } } }],
    ["sin conversation_id", { rpc: { data: [{ id: MSG }] }, select: { connect_messages: { data: { ...CANONICAL_ROW, conversation_id: null } } } }],
  ])("%s", async (_l, prog) => {
    const f = makeFactory(prog as Program);
    const out = await f.ports.claim.acquire({ conversationId: CONV, body: "hola", clientMsgId: CID });
    expect(out).toEqual({ kind: "not_verifiable" });
  });

  /**
   * WA-7R · C · un error del RPC es INDISPONIBILIDAD, no una denegación RBAC.
   * Etiquetarlo `denied` afirmaba que la autorización había decidido algo que
   * nunca llegó a evaluarse, y mandaba a operaciones a revisar permisos ante
   * una caída de infraestructura.
   */
  it.each([
    ["privilegio insuficiente", { message: "insufficient_privilege" }],
    ["caída del motor", { message: "connection reset" }],
  ])("un error de RPC (%s) → not_verifiable, nunca denied, y sin releer", async (_l, error) => {
    const f = makeFactory({ rpc: { data: null, error } });
    const out = await f.ports.claim.acquire({ conversationId: CONV, body: "hola", clientMsgId: CID });
    expect(out).toEqual({ kind: "not_verifiable" });
    expect(out).not.toMatchObject({ kind: "denied" });
    expect(f.calls.filter((c) => c.op === "select")).toHaveLength(0);
  });
});

// ── 19 · construir la factory no tiene efectos ─────────────────────────────
describe("19 · la construcción es inerte", () => {
  it("no ejecuta RPC, auth, reloj, transporte ni consultas", () => {
    const rec = recorder();
    const clock = { now: vi.fn(() => "x") };
    const send = vi.fn();
    const authSpy = vi.spyOn(rec.client.auth, "getUser");
    createSupabaseReplyPorts({
      supabase: rec.client as never,
      admin: rec.client as never,
      isOperator: () => true,
      isSandboxAllowed: () => true,
      clock,
      transport: { sendText: send } as never,
    });
    expect(rec.rpcs).toHaveLength(0);
    expect(rec.calls).toHaveLength(0);
    expect(clock.now).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(authSpy).not.toHaveBeenCalled();
  });
});

// ── 20-22 · claimSending: filtros, selector y ramas de estado ──────────────
describe("20-22 · claimSending", () => {
  function casProgram(status: string | null, rows: unknown[] = [{ id: MSG }]): Program {
    return {
      select: {
        connect_messages: { data: { meta: status ? { wa: { status } } : {} } },
      },
      updateRows: rows,
    };
  }

  it("rama estado NULO: TRES filtros — id, status nulo y external_msg_id nulo", async () => {
    const f = makeFactory(casProgram(null));
    expect(await f.ports.state.claimSending(MSG)).toBe(true);

    const upd = f.calls.find((c) => c.op === "update")!;
    expect(upd.table).toBe("connect_messages");
    expect(upd.filters).toEqual([
      { kind: "eq", column: "id", value: MSG },
      { kind: "is", column: "meta->wa->>status", value: null },
      { kind: "is", column: "external_msg_id", value: null },
    ]);
    expect(upd.filters).toHaveLength(3);
    // El selector correcto es `->>`; `>>` no es sintaxis PostgREST válida.
    expect(JSON.stringify(upd.filters)).not.toContain("wa>>");
    expect(upd.terminal).toBe("select");
  });

  it("rama `queued`: TRES filtros — id, status 'queued' y external_msg_id nulo", async () => {
    const f = makeFactory(casProgram("queued"));
    expect(await f.ports.state.claimSending(MSG)).toBe(true);
    const upd = f.calls.find((c) => c.op === "update")!;
    expect(upd.filters).toEqual([
      { kind: "eq", column: "id", value: MSG },
      { kind: "eq", column: "meta->wa->>status", value: "queued" },
      { kind: "is", column: "external_msg_id", value: null },
    ]);
    expect(upd.filters).toHaveLength(3);
  });

  /**
   * WA-7R · A · MUTANTE DIRIGIDO al filtro `external_msg_id IS NULL`.
   *
   * Este test existe para MORIR si alguien borra exactamente esa línea, y sólo
   * esa: no mira el resto del WHERE ni el payload. Sin él, quitar la
   * precondición dejaba pasar el CAS sobre una fila ya sellada y habilitaba un
   * segundo egress con el mismo mensaje.
   */
  it.each([null, "queued"] as Array<string | null>)(
    "el CAS exige `external_msg_id IS NULL` en el WHERE (estado inicial %s)",
    async (status) => {
      const f = makeFactory(casProgram(status));
      expect(await f.ports.state.claimSending(MSG)).toBe(true);
      const upd = f.calls.find((c) => c.op === "update")!;
      const wamidGuard = upd.filters.filter(
        (x) => x.column === "external_msg_id" && x.kind === "is" && x.value === null,
      );
      expect(wamidGuard).toHaveLength(1);
    },
  );

  /**
   * Carrera real: la lectura previa ve `meta` sin wamid, pero entre esa lectura
   * y el UPDATE otra sesión sella `external_msg_id`. El WHERE ya no acierta y
   * PostgREST devuelve cero filas: el CAS debe reportar derrota, no éxito.
   */
  it("wamid sellado entre la lectura y el UPDATE → cero filas → false", async () => {
    const f = makeFactory(casProgram(null, []));
    expect(await f.ports.state.claimSending(MSG)).toBe(false);
    const upd = f.calls.find((c) => c.op === "update")!;
    expect(upd.filters).toContainEqual({ kind: "is", column: "external_msg_id", value: null });
  });

  it.each(["sending", "sent", "delivered", "read", "failed", "reconciliation_required"])(
    "estado %s NO es reclamable: cero UPDATE",
    async (status) => {
      const f = makeFactory(casProgram(status));
      expect(await f.ports.state.claimSending(MSG)).toBe(false);
      expect(f.calls.some((c) => c.op === "update")).toBe(false);
    },
  );

  it("error del SELECT inicial NO se degrada a carrera perdida: lanza", async () => {
    const f = makeFactory({ select: { connect_messages: { error: { message: "boom" } } } });
    await expect(f.ports.state.claimSending(MSG)).rejects.toThrow(/state_unavailable/);
  });

  it("fila ausente detiene el flujo", async () => {
    const f = makeFactory({ select: { connect_messages: { data: null } } });
    await expect(f.ports.state.claimSending(MSG)).rejects.toThrow(/state_unavailable/);
  });

  it("error del UPDATE NO es carrera perdida: lanza", async () => {
    const f = makeFactory({ ...casProgram(null), updateError: { message: "permission denied" } });
    await expect(f.ports.state.claimSending(MSG)).rejects.toThrow(/state_unavailable/);
  });

  const CARDINALIDADES: Array<[string, unknown[]]> = [
    ["cero filas", []],
    ["más de una fila", [{ id: "a" }, { id: "b" }]],
  ];

  it.each(CARDINALIDADES)("%s no acredita el CAS", async (_l, rows) => {
    const f = makeFactory(casProgram(null, rows));
    expect(await f.ports.state.claimSending(MSG)).toBe(false);
  });

  it("sin admin client, fail-closed", async () => {
    const f = makeFactory({}, { admin: null as never });
    await expect(f.ports.state.claimSending(MSG)).rejects.toThrow(/state_unavailable/);
  });
});

// ── 23 · sealSent con precondición completa ────────────────────────────────
describe("23 · sealSent exige id + sending + external_msg_id nulo + 1 fila", () => {
  const sealProgram = (rows: unknown[] = [{ id: MSG }]): Program => ({
    select: { connect_messages: { data: { meta: { wa: { status: "sending" } } } } },
    updateRows: rows,
  });

  it("las tres precondiciones viajan en el WHERE", async () => {
    const f = makeFactory(sealProgram());
    expect(await f.ports.state.sealSent(MSG, WAMID)).toBe(true);

    const upd = f.calls.find((c) => c.op === "update")!;
    expect(upd.filters).toEqual([
      { kind: "eq", column: "id", value: MSG },
      { kind: "eq", column: "meta->wa->>status", value: "sending" },
      { kind: "is", column: "external_msg_id", value: null },
    ]);
    // Y el wamid se escribe en la misma sentencia.
    expect((upd.payload as { external_msg_id: string }).external_msg_id).toBe(WAMID);
    expect(upd.terminal).toBe("select");
  });

  const CARD: Array<[string, unknown[]]> = [
    ["cero filas", []],
    ["más de una fila", [{ id: "a" }, { id: "b" }]],
  ];

  it.each(CARD)("%s no acredita sello", async (_l, rows) => {
    const f = makeFactory(sealProgram(rows));
    expect(await f.ports.state.sealSent(MSG, WAMID)).toBe(false);
  });

  it("error de UPDATE o de lectura previa → false, nunca true", async () => {
    const conError = makeFactory({ ...sealProgram(), updateError: { message: "denied" } });
    expect(await conError.ports.state.sealSent(MSG, WAMID)).toBe(false);

    const sinFila = makeFactory({ select: { connect_messages: { data: null } } });
    expect(await sinFila.ports.state.sealSent(MSG, WAMID)).toBe(false);
  });
});

// ── state.read fail-closed ─────────────────────────────────────────────────
describe("state.read fail-closed", () => {
  it("error o fila ausente lanzan, no devuelven status null", async () => {
    const conError = makeFactory({ select: { connect_messages: { error: { message: "boom" } } } });
    await expect(conError.ports.state.read(MSG)).rejects.toThrow(/state_unavailable/);

    const sinFila = makeFactory({ select: { connect_messages: { data: null } } });
    await expect(sinFila.ports.state.read(MSG)).rejects.toThrow(/state_unavailable/);
  });

  it("fila real sin estado devuelve status null, wamid persistido y sin marcador", async () => {
    const f = makeFactory({
      select: { connect_messages: { data: { meta: {}, external_msg_id: WAMID } } },
    });
    expect(await f.ports.state.read(MSG)).toEqual({
      status: null,
      wamid: WAMID,
      auditedWamid: null,
    });
    const sel = f.calls.find((c) => c.op === "select")!;
    expect(sel.columns).toBe("meta, external_msg_id");
    expect(sel.filters).toEqual([{ kind: "eq", column: "id", value: MSG }]);
  });

  /**
   * WA-7R2 · `read` debe devolver los TRES hechos por separado. El marcador se
   * lee de la fila, jamás se infiere del estado.
   */
  it("expone el marcador durable como un hecho propio", async () => {
    const f = makeFactory({
      select: {
        connect_messages: {
          data: {
            meta: { wa: { status: "delivered", audit_sent: { wamid: WAMID, at: AT } } },
            external_msg_id: WAMID,
          },
        },
      },
    });
    expect(await f.ports.state.read(MSG)).toEqual({
      status: "delivered",
      wamid: WAMID,
      auditedWamid: WAMID,
    });
  });

  /**
   * MUTANTE 15 del mandato · un marcador con `at` inválido NO acredita auditoría.
   * WA-7R2 sólo exigía "string no vacío", así que `at: "x"` o una fecha imposible
   * acreditaban un cierre que nadie puede correlacionar.
   */
  it.each([
    ["marcador ausente", { wa: { status: "sent" } }],
    ["marcador sin wamid", { wa: { status: "sent", audit_sent: { at: AT } } }],
    ["marcador sin at", { wa: { status: "sent", audit_sent: { wamid: WAMID } } }],
    ["marcador no-objeto", { wa: { status: "sent", audit_sent: true } }],
    ["marcador arreglo", { wa: { status: "sent", audit_sent: [WAMID, AT] } }],
    ["marcador con wamid vacío", { wa: { status: "sent", audit_sent: { wamid: "  ", at: AT } } }],
    ["at = 'x'", { wa: { status: "sent", audit_sent: { wamid: WAMID, at: "x" } } }],
    ["at fecha imposible", { wa: { status: "sent", audit_sent: { wamid: WAMID, at: "2026-02-30T00:00:00.000Z" } } }],
    ["at con offset no canónico", { wa: { status: "sent", audit_sent: { wamid: WAMID, at: "2026-08-09T12:00:00+00:00" } } }],
    ["at no-string", { wa: { status: "sent", audit_sent: { wamid: WAMID, at: 1760000000000 } } }],
    ["clave de más en el marcador", { wa: { status: "sent", audit_sent: { wamid: WAMID, at: AT, extra: 1 } } }],
  ])("%s ⇒ auditedWamid null (nunca se asume auditado)", async (_l, meta) => {
    const f = makeFactory({
      select: { connect_messages: { data: { meta, external_msg_id: WAMID } } },
    });
    expect((await f.ports.state.read(MSG)).auditedWamid).toBeNull();
  });
});

// ── 23b · WA-7R2 · el sello deja el intento NO auditado ────────────────────
describe("23b · sealSent no acredita auditoría", () => {
  it("elimina cualquier marcador residual al sellar", async () => {
    const f = makeFactory({
      select: {
        connect_messages: {
          data: {
            meta: {
              otro: 1,
              wa: { status: "sending", audit_sent: { wamid: "wamid.VIEJO", at: "2026-01-01T00:00:00.000Z" } },
            },
          },
        },
      },
      updateRows: [{ id: MSG }],
    });
    expect(await f.ports.state.sealSent(MSG, WAMID)).toBe(true);

    const upd = f.calls.find((c) => c.op === "update")!;
    const meta = (upd.payload as { meta: Record<string, unknown> }).meta;
    const wa = meta.wa as Record<string, unknown>;
    expect(wa).not.toHaveProperty("audit_sent");
    expect(wa.status).toBe("sent");
    // Las claves ajenas de meta siguen intactas: no es un borrado indiscriminado.
    expect(meta.otro).toBe(1);
    expect(JSON.stringify(upd.payload)).not.toContain("wamid.VIEJO");
  });
});

// ── 23c · WA-7R3 · markAudited: CAS sobre el estado EXACTO ─────────────────
// ══ WA-8R9 · B-1 · markAudited acredita sin reconstruir meta.wa ═══════════
/**
 * La suite anterior verificaba el CAS cliente de `markAudited`: tres intentos,
 * relectura y filtros por columnas JSON. Ese diseño ERA la otra mitad de B-1
 * —reconstruía `meta.wa` desde un snapshot y podía regresar un status llegado
 * en el medio—, así que se eliminó junto con el defecto.
 *
 * La acreditación ahora escribe SÓLO `audit_sent`, bajo el lock de la fila. La
 * carrera bidireccional webhook ↔ markAudited se prueba contra PostgreSQL real
 * en `tests/db/t-wa-r9-01-atomic-status.test.ts`.
 */
describe("WA-8R9 · markAudited delega en la RPC atómica", () => {
  const rpcs = (f: ReturnType<typeof makeFactory>) =>
    f.rpcs.filter((r) => r.fn === "connect_wa_mark_audited");

  it("llama a connect_wa_mark_audited una vez, con argumentos exactos", async () => {
    const f = makeFactory({ rpcOutcome: "applied" });
    expect(await f.ports.state.markAudited(MSG, WAMID)).toBe(true);
    expect(rpcs(f)).toHaveLength(1);
    expect(rpcs(f)[0].args).toEqual({ p_message_id: MSG, p_wamid: WAMID, p_at: AT });
  });

  it("no ejecuta select ni update sobre connect_messages", async () => {
    const f = makeFactory({ rpcOutcome: "applied" });
    await f.ports.state.markAudited(MSG, WAMID);
    expect(
      f.calls.filter((c) => c.table === "connect_messages"),
    ).toHaveLength(0);
  });

  it("un reloj inválido no produce NINGUNA llamada", async () => {
    const f = makeFactory({ rpcOutcome: "applied" }, { clock: { now: () => "no-es-fecha" } });
    expect(await f.ports.state.markAudited(MSG, WAMID)).toBe(false);
    expect(rpcs(f)).toHaveLength(0);
  });

  it.each([["applied", true], ["duplicate", true]])(
    "`%s` acredita el marcador", async (outcome, esperado) => {
      const f = makeFactory({ rpcOutcome: outcome });
      expect(await f.ports.state.markAudited(MSG, WAMID)).toBe(esperado);
    },
  );

  it.each([["rejected"], ["unmatched"], ["retryable"], ["desconocido"]])(
    "`%s` NO acredita", async (outcome) => {
      const f = makeFactory({ rpcOutcome: outcome });
      expect(await f.ports.state.markAudited(MSG, WAMID)).toBe(false);
    },
  );

  it("un error de la RPC es fail-closed", async () => {
    const f = makeFactory({ rpcError: { message: "denied" } });
    expect(await f.ports.state.markAudited(MSG, WAMID)).toBe(false);
  });

  it("sin admin no se intenta nada", async () => {
    const f = makeFactory({}, { admin: null });
    expect(await f.ports.state.markAudited(MSG, WAMID)).toBe(false);
    expect(rpcs(f)).toHaveLength(0);
  });
});


// ── 24 · stamp y auditoría fail-closed ─────────────────────────────────────
describe("24 · stamp y auditoría", () => {
  /**
   * WA-8R9 · `stamp` ya no arma un CAS por columnas: declara la intención y la
   * RPC transaccional decide bajo el lock de la fila. Acá se prueba el CONTRATO
   * del adaptador; la semántica (dirección, canon, procedencia, cardinalidad,
   * preservación de `audit_sent`) se prueba contra PostgreSQL real en
   * `tests/db/t-wa-r9-01-atomic-status.test.ts`.
   */
  const stampProgram = (outcome = "applied"): Program => ({ rpcOutcome: outcome });

  // La cardinalidad (0 filas, >1 filas) y los errores de escritura dejaron de
  // ser decisión del cliente: los resuelve `connect_wa_apply_status` dentro de
  // su transacción y se verifican contra PostgreSQL real. Acá sólo queda el
  // contrato del adaptador, cubierto en "WA-8R9 · stamp delega en la RPC".

  it("audit inserta en audit_log y falla cerrado ante error", async () => {
    const SENT = { actor: OP, conversationId: CONV, messageId: MSG, at: AT };

    const ok = makeFactory();
    expect(await ok.ports.audit.record("reply_sent", SENT)).toBe(true);
    const ins = ok.calls.find((c) => c.op === "insert")!;
    expect(ins.table).toBe("audit_log");
    expect(ins.payload).toMatchObject({ entity: "whatsapp_reply", entity_id: MSG, action: "reply_sent" });

    const falla = makeFactory({ insertError: { message: "denied" } });
    expect(await falla.ports.audit.record("reply_sent", SENT)).toBe(false);

    const sinAdmin = makeFactory({}, { admin: null as never });
    expect(await sinAdmin.ports.audit.record("reply_sent", SENT)).toBe(false);
  });
});

// ── 24b · WA-7R · D · el sink de auditoría no persiste payload arbitrario ──
/**
 * El adaptador es la ÚLTIMA frontera antes de una fila persistida y consultable.
 * Cada caso pasa marcadores sensibles deliberados y exige que no aparezcan ni en
 * la inserción grabada, ni en la respuesta, ni en los logs.
 */
describe("24b · allowlist de PII en el sink de auditoría", () => {
  const TEXTO = "hola, soy el cliente y mi DNI es 30111222";
  // Marcador SINTÉTICO con forma de credencial. No es un token: existe sólo
  // para comprobar que el sink lo descarta.
  const TOKEN = "Bearer <token-sintetico-de-prueba>";
  const MARCADORES = [TEXTO, PHONE, WAMID, TOKEN, "secreto-del-proveedor", "30111222"];

  const PAYLOAD_HOSTIL: Record<string, unknown> = {
    // Permitidos y legítimos.
    actor: OP,
    conversationId: CONV,
    messageId: MSG,
    clientMsgId: CID,
    at: AT,
    // Prohibidos: claves desconocidas con contenido sensible.
    text: TEXTO,
    body: TEXTO,
    phone: PHONE,
    to: PHONE,
    wamid: WAMID,
    externalMsgId: WAMID,
    token: TOKEN,
    authorization: TOKEN,
    detail: "secreto-del-proveedor",
    providerPayload: { messages: [{ id: WAMID, text: TEXTO }] },
  };

  /**
   * WA-7R2 · el cambio de contrato: un payload que no cumple NO se recorta para
   * grabar el resto. Se rechaza entero y no se inserta ninguna fila. Truncar
   * dejaría una fila que parece legítima y esconde el intento.
   */
  it("payload hostil: fail-closed, cero inserciones y cero rastro sensible", async () => {
    const logs: unknown[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a)),
    );
    try {
      const f = makeFactory();
      const ok = await f.ports.audit.record("reply_attempt", PAYLOAD_HOSTIL);
      expect(ok).toBe(false);
      expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(0);

      const dump = JSON.stringify({ calls: f.calls, ok, logs });
      for (const marca of MARCADORES) expect(dump).not.toContain(marca);
      expect(logs).toHaveLength(0);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it("la correlación legítima sí se persiste completa", async () => {
    const f = makeFactory();
    const ok = await f.ports.audit.record("reply_attempt", {
      actor: OP,
      conversationId: CONV,
      messageId: MSG,
      clientMsgId: CID,
      at: AT,
    });
    expect(ok).toBe(true);
    const ins = f.calls.find((c) => c.op === "insert")!;
    const grabado = ins.payload as { payload: Record<string, unknown>; entity_id: string | null };
    expect(grabado.payload).toEqual({
      actor: OP,
      conversationId: CONV,
      messageId: MSG,
      clientMsgId: CID,
      at: AT,
    });
    expect(Object.keys(grabado.payload).every((k) =>
      (AUDIT_PAYLOAD_ALLOWLIST as readonly string[]).includes(k),
    )).toBe(true);
    expect(grabado.entity_id).toBe(MSG);
  });

  /** Mutante 8 de WA-7R2: `action` fuera del enum cerrado. */
  it.each([
    "reply_unknown",
    "REPLY_SENT",
    "reply_sent ",
    "drop table",
    "",
  ])("action desconocida (%s) → rechazo sin insertar", async (action) => {
    const f = makeFactory();
    expect(await f.ports.audit.record(action, { actor: OP, messageId: MSG })).toBe(false);
    expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(0);
  });
});

// ── 24c · WA-7R3 · CONTRATO SEMÁNTICO POR ACCIÓN ───────────────────────────
/**
 * MAJOR corregido en WA-7R3. La expresión de WA-7R2 —
 * `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` — aceptaba como identificador un teléfono
 * sin `+`, un DNI o CUIT, una palabra suelta y cualquier token alfanumérico.
 * La clave estaba permitida y el valor podía ser PII o un secreto: exactamente
 * lo que la frontera existe para impedir.
 */
describe("24c · contrato semántico del sink de auditoría", () => {
  const TEXTO = "hola, soy el cliente y mi DNI es 30111222";
  const TOKEN = "Bearer <token-sintetico-de-prueba>";
  const MARCADORES = [TEXTO, PHONE, WAMID, TOKEN, "30111222", "5491100000001"];

  /** Payload MÍNIMO y EXACTO de cada acción: obligatorios, nada más. */
  const CANONICOS: Record<string, Record<string, string>> = {
    reply_attempt: { actor: OP, conversationId: CONV, messageId: MSG, clientMsgId: CID, at: AT },
    reply_denied: { actor: OP, reason: "not_operator" },
    reply_sandbox_rejected: { actor: OP, messageId: MSG },
    reply_ambiguous: { actor: OP, messageId: MSG, reason: "timeout" },
    reply_failed: { actor: OP, messageId: MSG, reason: "http_error" },
    reply_seal_failed: { actor: OP, messageId: MSG },
    reply_sent: { actor: OP, conversationId: CONV, messageId: MSG, at: AT },
    reply_audit_marker_failed: { actor: OP, messageId: MSG },
  };

  /** MUTANTE 11 · cada acción exige EXACTAMENTE sus obligatorios. */
  it.each(AUDIT_ACTIONS)("%s con sus campos obligatorios exactos sí inserta", async (action) => {
    const f = makeFactory();
    expect(await f.ports.audit.record(action, CANONICOS[action])).toBe(true);
    const ins = f.calls.filter((c) => c.op === "insert");
    expect(ins).toHaveLength(1);
    expect((ins[0].payload as { payload: unknown }).payload).toEqual(CANONICOS[action]);
  });

  /** MUTANTE 11b · el único opcional del contrato: `messageId` en reply_denied. */
  it("reply_denied admite messageId como opcional", async () => {
    const f = makeFactory();
    expect(
      await f.ports.audit.record("reply_denied", {
        actor: OP,
        reason: "attempt_binding_mismatch",
        messageId: MSG,
      }),
    ).toBe(true);
    expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(1);
  });

  /** MUTANTE 12 · quitar UN obligatorio produce cero INSERT. */
  it.each(
    AUDIT_ACTIONS.flatMap((action) =>
      Object.keys(CANONICOS[action]).map((omitida) => [action, omitida] as const),
    ),
  )("%s sin %s → cero INSERT", async (action, omitida) => {
    const payload = { ...CANONICOS[action] };
    delete payload[omitida];
    const f = makeFactory();
    expect(await f.ports.audit.record(action, payload)).toBe(false);
    expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(0);
  });

  /** MUTANTE 11c · un campo DE MÁS para la acción también se rechaza. */
  it.each([
    ["reply_sent con clientMsgId", "reply_sent", { clientMsgId: CID }],
    ["reply_sandbox_rejected con at", "reply_sandbox_rejected", { at: AT }],
    ["reply_seal_failed con conversationId", "reply_seal_failed", { conversationId: CONV }],
    ["reply_attempt con reason", "reply_attempt", { reason: "not_operator" }],
    ["reply_audit_marker_failed con reason", "reply_audit_marker_failed", { reason: "http_error" }],
  ])("%s → cero INSERT", async (_l, action, extra) => {
    const f = makeFactory();
    expect(
      await f.ports.audit.record(action, { ...CANONICOS[action], ...extra }),
    ).toBe(false);
    expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(0);
  });

  /**
   * MUTANTE 13 · un `reason` VÁLIDO para una acción es inválido en otra.
   * `http_error` describe un rechazo inequívoco; bajo `reply_ambiguous` afirmaría
   * lo contrario de lo que ese evento significa.
   */
  const REASONS_POR_ACCION: Record<string, readonly string[]> = {
    reply_denied: [
      "not_operator", "not_tenant_member", "rbac_denied",
      "attempt_not_verifiable", "attempt_binding_mismatch",
    ],
    reply_ambiguous: ["timeout", "network", "contract_unknown", "invalid_2xx", "server_error"],
    reply_failed: ["http_error", "invalid_json", "not_configured"],
  };

  it("cada reason sólo vale en su propia acción", async () => {
    for (const [action, propios] of Object.entries(REASONS_POR_ACCION)) {
      for (const reason of propios) {
        const ok = makeFactory();
        expect(
          await ok.ports.audit.record(action, { ...CANONICOS[action], reason }),
        ).toBe(true);
      }
      // Los reason de las OTRAS acciones deben ser rechazados acá.
      const ajenos = Object.entries(REASONS_POR_ACCION)
        .filter(([otra]) => otra !== action)
        .flatMap(([, rs]) => rs);
      for (const reason of ajenos) {
        const f = makeFactory();
        expect(
          await f.ports.audit.record(action, { ...CANONICOS[action], reason }),
        ).toBe(false);
        expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(0);
      }
    }
  });

  it.each(["reply_attempt", "reply_sandbox_rejected", "reply_seal_failed", "reply_sent", "reply_audit_marker_failed"])(
    "%s no acepta reason bajo ningún valor del enum global",
    async (action) => {
      for (const reason of AUDIT_REASONS) {
        const f = makeFactory();
        expect(
          await f.ports.audit.record(action, { ...CANONICOS[action], reason }),
        ).toBe(false);
      }
    },
  );

  /**
   * MUTANTE 9 · el corazón del hallazgo: teléfono sin `+`, DNI/CUIT, texto corto
   * y token alfanumérico bajo CADA campo de identificación. Todos pasaban la
   * expresión anterior; ninguno es un UUID.
   */
  const NO_IDENTIFICADORES: Array<[string, string]> = [
    ["teléfono sin +", "5491100000001"],
    ["teléfono E.164", PHONE],
    ["DNI", "30111222"],
    ["CUIT", "20301112223"],
    ["CUIT con guiones", "20-30111222-3"],
    ["palabra", "Bearer"],
    ["token alfanumérico", "Bearer_token"],
    ["token con espacios", TOKEN],
    ["frase", TEXTO],
    ["wamid", WAMID],
    ["wamid largo", "wamid.HBgNNTQ5MTEwMDAwMDAwMRUCABIYFjNBMDA"],
    ["id corto legacy", "msg-1"],
    ["UUID inválido", "aaaaaaaa-1111-9111-8111-aaaaaaaaaaaa"],
    ["UUID truncado", "aaaaaaaa-1111-4111-8111"],
    ["cadena vacía", ""],
  ];

  it.each(
    (["actor", "conversationId", "messageId", "clientMsgId"] as const).flatMap((campo) =>
      NO_IDENTIFICADORES.map(([etiqueta, valor]) => [campo, etiqueta, valor] as const),
    ),
  )("%s con %s → fail-closed sin inserción", async (campo, _e, valor) => {
    // `reply_attempt` es la única acción que declara los cuatro campos ID.
    const f = makeFactory();
    expect(
      await f.ports.audit.record("reply_attempt", { ...CANONICOS.reply_attempt, [campo]: valor }),
    ).toBe(false);
    expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(0);
    const dump = JSON.stringify(f.calls);
    for (const marca of MARCADORES) expect(dump).not.toContain(marca);
  });

  /**
   * FRONTERA EXPLÍCITA entre las dos gramáticas del contrato.
   *
   * `actor`, `conversationId` y `messageId` exigen UUID CANÓNICO: el valor debe
   * venir ya en forma canónica, así que un UUID con espacios alrededor NO pasa.
   *
   * `clientMsgId` usa EXACTAMENTE `isValidClientMsgId`, que aplica `trim()`
   * antes de comparar. Se documenta como diferencia deliberada y no como
   * descuido: es la misma gramática que el core exige para admitir un intento, y
   * el core normaliza (`trim().toLowerCase()`) ANTES de llamar al sink, de modo
   * que la forma con espacios no puede originarse en el flujo productivo.
   */
  it("un UUID con espacios NO pasa como actor, conversationId ni messageId", async () => {
    for (const campo of ["actor", "conversationId", "messageId"] as const) {
      const f = makeFactory();
      expect(
        await f.ports.audit.record("reply_attempt", {
          ...CANONICOS.reply_attempt,
          [campo]: ` ${CID} `,
        }),
      ).toBe(false);
      expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(0);
    }
  });

  it("clientMsgId sigue exactamente la gramática de isValidClientMsgId (que hace trim)", async () => {
    const f = makeFactory();
    expect(
      await f.ports.audit.record("reply_attempt", {
        ...CANONICOS.reply_attempt,
        clientMsgId: ` ${CID} `,
      }),
    ).toBe(true);
    // El core normaliza antes de llamar: esta forma no nace del flujo productivo.
    expect(isValidClientMsgId(` ${CID} `)).toBe(true);
    // Y ningún no-identificador se cuela por esa puerta.
    for (const [, valor] of NO_IDENTIFICADORES) {
      expect(isValidClientMsgId(valor)).toBe(false);
    }
  });

  /** MUTANTE 14 · instantes sintácticamente parecidos pero imposibles. */
  it.each([
    ["texto", TEXTO],
    ["sin T ni Z", "2026-08-09 12:00:00"],
    ["día imposible", "2026-02-30T00:00:00.000Z"],
    ["31 de abril", "2026-04-31T00:00:00.000Z"],
    ["29 de febrero no bisiesto", "2026-02-29T00:00:00.000Z"],
    ["mes 13", "2026-13-01T00:00:00.000Z"],
    ["mes 00", "2026-00-10T00:00:00.000Z"],
    ["día 00", "2026-08-00T00:00:00.000Z"],
    ["hora 24", "2026-08-09T24:00:00.000Z"],
    ["minuto 60", "2026-08-09T12:60:00.000Z"],
    ["segundo 60", "2026-08-09T12:00:60.000Z"],
    ["offset no canónico", "2026-08-09T12:00:00+00:00"],
    ["offset -03:00", "2026-08-09T09:00:00-03:00"],
    ["z minúscula", "2026-08-09T12:00:00.000z"],
    ["sin zona", "2026-08-09T12:00:00.000"],
    ["microsegundos", "2026-08-09T12:00:00.000000Z"],
    ["sólo fecha", "2026-08-09"],
    ["epoch como texto", "1760000000000"],
  ])("at %s → fail-closed sin inserción", async (_l, at) => {
    const f = makeFactory();
    expect(await f.ports.audit.record("reply_sent", { ...CANONICOS.reply_sent, at })).toBe(false);
    expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(0);
  });

  it.each([
    ["29 de febrero bisiesto", "2024-02-29T00:00:00.000Z"],
    ["sin milisegundos", "2026-08-09T12:00:00Z"],
    ["un dígito de milisegundo", "2026-08-09T12:00:00.5Z"],
    ["fin de año", "2026-12-31T23:59:59.999Z"],
  ])("at %s sí es canónico", async (_l, at) => {
    const f = makeFactory();
    expect(await f.ports.audit.record("reply_sent", { ...CANONICOS.reply_sent, at })).toBe(true);
  });

  /** Tipos no-string bajo una clave permitida: objeto, array, número, booleano. */
  it.each([
    ["objeto", { detail: "secreto-del-proveedor" }],
    ["array", [MSG]],
    ["número", 42],
    ["booleano", true],
    ["null", null],
    ["objeto vacío", {}],
  ])("messageId como %s → fail-closed sin inserción", async (_l, valor) => {
    const f = makeFactory();
    expect(
      await f.ports.audit.record("reply_sent", {
        ...CANONICOS.reply_sent,
        messageId: valor as never,
      }),
    ).toBe(false);
    expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(0);
  });

  /** Claves desconocidas con contenido sensible: rechazo entero, no recorte. */
  it.each([
    ["texto del mensaje", { text: TEXTO }],
    ["teléfono", { phone: PHONE }],
    ["wamid", { wamid: WAMID }],
    ["token", { authorization: TOKEN }],
    ["detail del proveedor", { detail: "secreto-del-proveedor" }],
    ["payload crudo", { providerPayload: { messages: [{ id: WAMID, text: TEXTO }] } }],
    ["clave desconocida vacía", { providerPayload: {} }],
  ])("clave desconocida (%s) → fail-closed sin inserción", async (_l, extra) => {
    const f = makeFactory();
    expect(await f.ports.audit.record("reply_sent", { ...CANONICOS.reply_sent, ...extra })).toBe(false);
    expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(0);
    const dump = JSON.stringify(f.calls);
    for (const marca of MARCADORES) expect(dump).not.toContain(marca);
  });

  /**
   * MUTANTE 10 · un payload vacío ya NO es válido. En WA-7R2 `reply_sent` con
   * `{}` insertaba una fila sin actor, sin mensaje y sin instante: una traza que
   * no correlaciona nada y que sólo sirve para simular que hubo auditoría.
   */
  it.each(AUDIT_ACTIONS)("%s con payload vacío → cero INSERT", async (action) => {
    const f = makeFactory();
    expect(await f.ports.audit.record(action, {})).toBe(false);
    expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(0);
  });

  /**
   * INVARIANTE del esquema que sostiene lo anterior, fijada aparte porque no es
   * observable desde el comportamiento: toda acción declara al menos un campo
   * obligatorio. Mientras se cumpla, un payload vacío no puede pasar ni siquiera
   * si la guarda explícita de "payload vacío" desapareciera. Agregar mañana una
   * acción sin obligatorios rompería este test antes de habilitar filas huecas.
   */
  it("toda acción declara al menos un campo obligatorio", () => {
    expect(Object.keys(AUDIT_SCHEMAS).sort()).toEqual([...AUDIT_ACTIONS].sort());
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_SCHEMAS[action].required.length).toBeGreaterThan(0);
      // Y `actor` está siempre: sin actor la traza no atribuye nada.
      expect(AUDIT_SCHEMAS[action].required).toContain("actor");
    }
  });

  /** Sólo tres acciones aceptan `reason`, y cada una el suyo. */
  it("el mapa de reason por acción es el declarado, sin unión global", () => {
    const conReason = AUDIT_ACTIONS.filter((a) => AUDIT_SCHEMAS[a].reasons !== undefined);
    expect([...conReason].sort()).toEqual(["reply_ambiguous", "reply_denied", "reply_failed"]);
    for (const action of conReason) {
      const propios = AUDIT_SCHEMAS[action].reasons!;
      expect(propios.length).toBeGreaterThan(0);
      // Ningún conjunto por acción es la unión completa: eso sería el defecto.
      expect(propios.length).toBeLessThan(AUDIT_REASONS.length);
    }
  });

  it("un payload que no es objeto plano se rechaza", async () => {
    const f = makeFactory();
    expect(await f.ports.audit.record("reply_sent", [] as never)).toBe(false);
    expect(await f.ports.audit.record("reply_sent", null as never)).toBe(false);
    expect(await f.ports.audit.record("reply_sent", "texto" as never)).toBe(false);
    expect(f.calls.filter((c) => c.op === "insert")).toHaveLength(0);
  });
});

// ── 25 · sin PII en lo que sale de la factory ──────────────────────────────
describe("25 · la factory no filtra PII", () => {
  it("ni el snapshot ni los payloads registran teléfono, token o wamid crudo en meta", async () => {
    const f = makeFactory({
      select: { connect_messages: { data: { meta: { wa: { status: "sending" } } } } },
      updateRows: [{ id: MSG }],
    });
    await f.ports.state.stamp(MSG, { status: "failed", error: "sandbox_denied" });
    const dump = JSON.stringify(f.calls);
    expect(dump).not.toContain(PHONE);
    expect(dump).not.toContain("Bearer");
  });

  it("tenant y conversación se leen acotados y no exponen columnas de más", async () => {
    const f = makeFactory({
      select: {
        profiles: { data: { active: true, role: "admin", client_id: "cli-1" } },
        connect_conversations: { data: { id: CONV, kind: "whatsapp", context_id: `wa:${PHONE}` } },
      },
    });
    expect(await f.ports.tenant.getMembership(OP)).toEqual({
      active: true, role: "admin", clientId: "cli-1",
    });
    expect(await f.ports.conversations.get(CONV)).toEqual({
      id: CONV, kind: "whatsapp", contextId: `wa:${PHONE}`,
    });
    const prof = f.calls.find((c) => c.table === "profiles")!;
    expect(prof.columns).toBe("active, role, client_id");
    expect(prof.filters).toEqual([{ kind: "eq", column: "id", value: OP }]);
  });

  it("un error en tenant o conversación devuelve null (fail-closed)", async () => {
    const f = makeFactory({
      select: {
        profiles: { error: { message: "boom" } },
        connect_conversations: { error: { message: "boom" } },
      },
    });
    expect(await f.ports.tenant.getMembership(OP)).toBeNull();
    expect(await f.ports.conversations.get(CONV)).toBeNull();
  });
});

// ══ WA-8R7 · PROCEDENCIA DEL ESTADO ════════════════════════════════════════
/**
 * Todo lo que este adaptador escribe en `meta.wa.status` proviene del SERVIDOR:
 * su instante viene de `clock.now()`, con milisegundos. El proyector del webhook
 * escribe con el reloj de Meta, en segundos enteros. Sin declarar la procedencia
 * la UI comparaba ambos como texto y descartaba hechos reales del proveedor.
 */
describe("WA-8R7 · todo writer de estado declara procedencia `server`", () => {
  const waDe = (call: Call) =>
    ((call.payload as { meta: Record<string, unknown> }).meta.wa) as Record<string, unknown>;

  it("claimSending estampa status_source junto al instante", async () => {
    const f = makeFactory({
      select: { connect_messages: { data: { meta: {} } } },
      updateRows: [{ id: MSG }],
    });
    expect(await f.ports.state.claimSending(MSG)).toBe(true);

    const wa = waDe(f.calls.find((c) => c.op === "update")!);
    expect(wa.status).toBe("sending");
    expect(wa.status_source).toBe("server");
    expect(wa.status_at).toBe(AT);
  });

  it("sealSent estampa status_source", async () => {
    const f = makeFactory({
      select: { connect_messages: { data: { meta: { wa: { status: "sending" } } } } },
      updateRows: [{ id: MSG }],
    });
    expect(await f.ports.state.sealSent(MSG, WAMID)).toBe(true);

    const wa = waDe(f.calls.find((c) => c.op === "update")!);
    expect(wa.status).toBe("sent");
    expect(wa.status_source).toBe("server");
  });

  it.each(["failed", "reconciliation_required"] as const)(
    "stamp(%s) estampa status_source",
    async (status) => {
      const f = makeFactory({ rpcOutcome: "applied" });
      expect(await f.ports.state.stamp(MSG, { status })).toBe(true);

      // WA-8R9 · `stamp` ya no arma el UPDATE: declara la procedencia como
      // argumento de la RPC, que es quien escribe bajo el lock.
      const r = f.rpcs.find((x) => x.fn === "connect_wa_apply_status")!;
      expect(r.args.p_status).toBe(status);
      expect(r.args.p_source).toBe("server");
    },
  );

  it("markAudited no envía procedencia: sólo acredita el marcador", async () => {
    const f = makeFactory({ rpcOutcome: "applied" });
    await f.ports.state.markAudited(MSG, WAMID);
    // El estado y su procedencia quedan intactos por construcción: la RPC
    // escribe únicamente `audit_sent`. Acreditar la auditoría no puede
    // reetiquetar de quién vino el estado.
    const args = f.rpcs.find((r) => r.fn === "connect_wa_mark_audited")!.args;
    expect(Object.keys(args).sort()).toEqual(["p_at", "p_message_id", "p_wamid"]);
    expect(JSON.stringify(args)).not.toContain("source");
  });

  it("la procedencia nunca proviene de la entrada del llamador", async () => {
    const f = makeFactory({ rpcOutcome: "applied" });
    // `stamp` sólo acepta `status` y `error`; no hay forma de elegir la fuente.
    await f.ports.state.stamp(MSG, { status: "failed", error: "sandbox_denied" } as never);
    const r = f.rpcs.find((x) => x.fn === "connect_wa_apply_status")!;
    expect(r.args.p_source).toBe("server");
  });
});


// ══ WA-8R9 · §1 · `stamp` server-side, sin CAS cliente ═════════════════════
/**
 * El último read-modify-write del expediente vivía acá: `stamp` leía la fila,
 * decidía en JavaScript y escribía con seis precondiciones JSON. Aun endurecido,
 * arrastraba el defecto de fondo — la fusión partía de un snapshot que podía
 * haber dejado de describir la fila.
 *
 * Ahora la decisión completa ocurre dentro de `connect_wa_apply_status`, con el
 * lock tomado. A este adaptador le queda una sola responsabilidad, y es la que
 * se verifica acá: llamar bien y traducir el resultado sin inventar éxitos.
 */
describe("WA-8R9 · stamp delega en la RPC atómica", () => {
  /** Sólo las llamadas a la RPC de estado; el claim tiene la suya. */
  const rpcs = (f: ReturnType<typeof makeFactory>) =>
    f.rpcs.filter((r) => r.fn === "connect_wa_apply_status");

  it("llama a connect_wa_apply_status una vez, con argumentos exactos", async () => {
    const f = makeFactory({ rpcOutcome: "applied" });
    expect(await f.ports.state.stamp(MSG, { status: "failed", error: "sandbox_denied" })).toBe(true);

    const r = rpcs(f);
    expect(r).toHaveLength(1);
    expect(r[0].args).toEqual({
      p_message_id: MSG,
      p_status: "failed",
      p_source: "server",
      // El instante lo pone el servidor de base, no el proceso Node.
      p_at: null,
      p_error: "sandbox_denied",
    });
  });

  it("no ejecuta NINGÚN select ni update sobre connect_messages", async () => {
    const f = makeFactory({ rpcOutcome: "applied" });
    await f.ports.state.stamp(MSG, { status: "failed" });
    const tocadas = f.calls.filter(
      (c) => c.table === "connect_messages" && (c.op === "select" || c.op === "update"),
    );
    expect(tocadas).toHaveLength(0);
  });

  it("el reloj del proceso ya no interviene en el estado", async () => {
    const f = makeFactory({ rpcOutcome: "applied" });
    await f.ports.state.stamp(MSG, { status: "failed" });
    expect(rpcs(f)[0].args).toMatchObject({ p_at: null });
  });

  it.each([
    ["applied", true],
    // El hecho ya estaba escrito idéntico: el trazo durable existe.
    ["duplicate", true],
  ])("`%s` acredita el sello", async (outcome, esperado) => {
    const f = makeFactory({ rpcOutcome: outcome });
    expect(await f.ports.state.stamp(MSG, { status: "failed" })).toBe(esperado);
  });

  it.each([
    ["retryable"],
    ["reconciliation_required"],
    ["rejected"],
    ["unmatched"],
    ["cualquier_cosa_no_prevista"],
  ])("`%s` NO acredita: el estado no avanzó", async (outcome) => {
    const f = makeFactory({ rpcOutcome: outcome });
    expect(await f.ports.state.stamp(MSG, { status: "failed" })).toBe(false);
  });

  it("un error de la RPC es fail-closed, nunca éxito ni carrera", async () => {
    const f = makeFactory({ rpcError: { message: "permission denied" } });
    expect(await f.ports.state.stamp(MSG, { status: "failed" })).toBe(false);
  });

  it("sin cliente admin no se intenta nada", async () => {
    const f = makeFactory({}, { admin: null });
    expect(await f.ports.state.stamp(MSG, { status: "failed" })).toBe(false);
    expect(rpcs(f)).toHaveLength(0);
  });

  it("la procedencia es SIEMPRE server y no proviene del llamador", async () => {
    const f = makeFactory({ rpcOutcome: "applied" });
    // Se pasa un patch ENSANCHADO a propósito: aunque el llamador intentara
    // declarar la fuente, la firma no la admite y el adaptador la impone.
    const patchHostil = { status: "failed", statusSource: "meta", p_source: "meta" };
    await f.ports.state.stamp(MSG, patchHostil as unknown as { status: "failed" });
    expect(rpcs(f)[0].args).toMatchObject({ p_source: "server" });
  });

  it.each(["sandbox_denied", "audit_unavailable", "audit_reconciliation"])(
    "persiste el motivo pre-egress `%s`",
    async (motivo) => {
      const f = makeFactory({ rpcOutcome: "applied" });
      expect(await f.ports.state.stamp(MSG, { status: "failed", error: motivo })).toBe(true);
      expect(rpcs(f)[0].args).toMatchObject({ p_error: motivo });
    },
  );

  it("ningún desenlace toca el transporte (cero segundo egress)", async () => {
    transport.sendText.mockClear();
    for (const outcome of ["applied", "duplicate", "retryable", "rejected",
                           "reconciliation_required", "unmatched"]) {
      await makeFactory({ rpcOutcome: outcome }).ports.state.stamp(MSG, { status: "failed" });
    }
    expect(transport.sendText).not.toHaveBeenCalled();
  });
});
