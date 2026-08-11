import { describe, it, expect } from "vitest";
import {
  applyRealtimeEvent,
  matchIndex,
  mergePartial,
  type MergeableMessage,
  type RealtimeEvent,
} from "./realtime-merge";

/**
 * LINK-WA 1B-1 · Reconciliación realtime — PURO, sin red ni DB.
 */

interface Msg extends MergeableMessage {
  body: string | null;
  authorName: string | null;
  createdAt: string;
  waStatus?: string;
}

const CONV = "conv-1";

function build(row: Record<string, unknown>, existing: Msg | null): Partial<Msg> & { id: string } {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const wa = (meta.wa ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id ?? existing?.conversationId ?? CONV),
    seq: row.seq != null ? Number(row.seq) : (existing?.seq as number),
    body: row.body !== undefined ? ((row.body as string) ?? null) : existing?.body,
    authorName: row.author_name !== undefined ? (row.author_name as string) : existing?.authorName,
    createdAt: (row.created_at as string) ?? existing?.createdAt ?? "2026-08-09T10:00:00.000Z",
    clientMsgId: (row.client_msg_id as string) ?? existing?.clientMsgId,
    waStatus: wa.status !== undefined ? String(wa.status) : existing?.waStatus,
    // Un evento real limpia la marca optimista.
    status: undefined,
  };
}

const opts = { conversationId: CONV, build };

function ev(type: string, row: Record<string, unknown>): RealtimeEvent {
  return { eventType: type, new: row };
}

const ROW_INSERT = {
  id: "m1",
  conversation_id: CONV,
  seq: 10,
  body: "hola",
  author_name: "Ana",
  created_at: "2026-08-09T10:00:00.000Z",
  client_msg_id: "cli-1",
};

function apply(prev: readonly Msg[], e: RealtimeEvent): readonly Msg[] {
  return applyRealtimeEvent<Msg>(prev, e, opts);
}

describe("1 · INSERT nuevo", () => {
  it("agrega el mensaje", () => {
    const out = apply([], ev("INSERT", ROW_INSERT));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "m1", body: "hola", seq: 10 });
  });
});

describe("2 · eco de mensaje optimista", () => {
  it("reconcilia en su lugar, sin segunda burbuja", () => {
    const optimista: Msg = {
      id: "tmp-1",
      conversationId: CONV,
      seq: Number.MAX_SAFE_INTEGER,
      clientMsgId: "cli-1",
      status: "sending",
      body: "hola",
      authorName: null,
      createdAt: "2026-08-09T09:59:59.000Z",
    };
    const out = apply([optimista], ev("INSERT", ROW_INSERT));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("m1");
    expect(out[0].status).toBeUndefined();
    expect(out[0].seq).toBe(10);
  });

  it("no reordena: conserva la posición original", () => {
    const otro: Msg = {
      id: "m0", conversationId: CONV, seq: 9, body: "previo",
      authorName: "Ana", createdAt: "2026-08-09T09:00:00.000Z",
    };
    const optimista: Msg = {
      id: "tmp-1", conversationId: CONV, seq: Number.MAX_SAFE_INTEGER,
      clientMsgId: "cli-1", status: "sending", body: "hola",
      authorName: null, createdAt: "2026-08-09T09:59:59.000Z",
    };
    const posterior: Msg = {
      id: "m2", conversationId: CONV, seq: 11, body: "después",
      authorName: "Ana", createdAt: "2026-08-09T10:01:00.000Z",
    };
    const out = apply([otro, optimista, posterior], ev("INSERT", ROW_INSERT));
    expect(out.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
  });
});

describe("3 · UPDATE de mensaje existente", () => {
  it("aplica el nuevo estado sin duplicar", () => {
    const base = apply([], ev("INSERT", ROW_INSERT));
    const out = apply(base, ev("UPDATE", { id: "m1", conversation_id: CONV, meta: { wa: { status: "delivered" } } }));
    expect(out).toHaveLength(1);
    expect(out[0].waStatus).toBe("delivered");
  });
});

describe("4 · UPDATE repetido", () => {
  it("no cambia la cantidad ni el contenido, y conserva la referencia", () => {
    const base = apply([], ev("INSERT", ROW_INSERT));
    const e = ev("UPDATE", { id: "m1", conversation_id: CONV, meta: { wa: { status: "read" } } });
    const once = apply(base, e);
    const twice = apply(once, e);
    const thrice = apply(twice, e);
    expect(twice).toHaveLength(1);
    expect(thrice[0].waStatus).toBe("read");
    // No-op ⇒ misma referencia (evita re-render inútil).
    expect(twice).toBe(once);
    expect(thrice).toBe(once);
  });
});

describe("5 · UPDATE antes y después del INSERT", () => {
  const insert = ev("INSERT", ROW_INSERT);
  const update = ev("UPDATE", { id: "m1", conversation_id: CONV, meta: { wa: { status: "read" } } });

  it("orden INSERT → UPDATE converge", () => {
    const out = apply(apply([], insert), update);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "m1", body: "hola", waStatus: "read" });
  });

  it("orden UPDATE → INSERT converge al MISMO resultado", () => {
    const out = apply(apply([], update), insert);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "m1", body: "hola", waStatus: "read" });
  });

  it("ambos órdenes producen el mismo estado final", () => {
    const a = apply(apply([], insert), update);
    const b = apply(apply([], update), insert);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("6 · evento de otra conversación", () => {
  it("se ignora sin tocar la lista", () => {
    const base = apply([], ev("INSERT", ROW_INSERT));
    const out = apply(base, ev("INSERT", { ...ROW_INSERT, id: "otro", conversation_id: "conv-2" }));
    expect(out).toBe(base);
    expect(out).toHaveLength(1);
  });
});

describe("7 · payload parcial", () => {
  it("preserva body, autor y fecha ausentes del UPDATE", () => {
    const base = apply([], ev("INSERT", ROW_INSERT));
    const out = apply(base, ev("UPDATE", { id: "m1", conversation_id: CONV, meta: { wa: { status: "sent" } } }));
    expect(out[0]).toMatchObject({
      body: "hola",
      authorName: "Ana",
      createdAt: "2026-08-09T10:00:00.000Z",
      seq: 10,
      waStatus: "sent",
    });
  });
});

describe("8 · una sola burbuja bajo todos los órdenes", () => {
  const insert = ev("INSERT", ROW_INSERT);
  const u1 = ev("UPDATE", { id: "m1", conversation_id: CONV, meta: { wa: { status: "sent" } } });
  const u2 = ev("UPDATE", { id: "m1", conversation_id: CONV, meta: { wa: { status: "delivered" } } });

  const permutaciones: RealtimeEvent[][] = [
    [insert, u1, u2],
    [u1, insert, u2],
    [u1, u2, insert],
    [u2, u1, insert],
    [insert, u2, u1],
    [insert, insert, u1, u2, u2],
  ];

  it.each(permutaciones.map((p, i) => [i, p] as const))(
    "permutación %i deja exactamente 1 mensaje",
    (_i, secuencia) => {
      let list: readonly Msg[] = [];
      for (const e of secuencia) list = apply(list, e);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe("m1");
      expect(list[0].body).toBe("hola");
    },
  );
});

describe("matchIndex", () => {
  const list: Msg[] = [
    { id: "a", conversationId: CONV, seq: 1, body: null, authorName: null, createdAt: "x" },
    { id: "b", conversationId: CONV, seq: 2, clientMsgId: "cli-b", body: null, authorName: null, createdAt: "x" },
    { id: "tmp", conversationId: CONV, seq: 3, status: "sending", body: null, authorName: null, createdAt: "x" },
  ];

  it("prioriza id", () => expect(matchIndex(list, { id: "b", clientMsgId: "cli-b" })).toBe(1));
  it("cae a clientMsgId", () => expect(matchIndex(list, { id: "z", clientMsgId: "cli-b" })).toBe(1));
  it("cae a seq sólo si el candidato ya es real", () => {
    expect(matchIndex(list, { id: "z", seq: 2 })).toBe(1);
    expect(matchIndex(list, { id: "z", seq: 3 })).toBe(-1);
  });
  it("devuelve -1 sin coincidencia", () => expect(matchIndex(list, { id: "z" })).toBe(-1));
});

describe("mergePartial · presencia de clave, no valor", () => {
  const base: Msg = {
    id: "a", conversationId: CONV, seq: 1, body: "texto",
    authorName: "Ana", createdAt: "x", status: "sending",
  };

  it("una clave AUSENTE preserva el valor anterior", () => {
    const out = mergePartial(base, { authorName: "Beto" });
    expect(out.body).toBe("texto");
    expect(out.createdAt).toBe("x");
    expect(out.authorName).toBe("Beto");
  });

  it("una clave PRESENTE con undefined limpia el campo (marca optimista)", () => {
    const out = mergePartial(base, { status: undefined });
    expect(out.status).toBeUndefined();
    expect(out.body).toBe("texto");
  });
});

describe("eventos no soportados", () => {
  it.each(["DELETE", "TRUNCATE", ""])("%s es no-op", (t) => {
    const base = apply([], ev("INSERT", ROW_INSERT));
    expect(apply(base, ev(t, { id: "m1", conversation_id: CONV }))).toBe(base);
  });

  it("payload sin fila es no-op", () => {
    const base = apply([], ev("INSERT", ROW_INSERT));
    expect(apply(base, { eventType: "UPDATE", new: null })).toBe(base);
  });
});
