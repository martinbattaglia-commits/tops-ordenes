import { describe, it, expect } from "vitest";
import {
  projectInbound,
  contextIdFor,
  isProjectionComplete,
  type LinkProjectionPort,
  type ProjectionConversation,
  type ProjectionParticipant,
} from "./link-projection";
import { canTransition } from "./outbound-state";
import { STATUS_UNMATCHED_REASON } from "./link-projection";
import { errorCategory } from "./inbound-core";
import type { WaInboundMessage, WaInboundStatus, WaStatusValue } from "./inbound";

/**
 * LINK-WA S1 · Proyección a Nexus Link con puerto EN MEMORIA.
 *
 * Sin red, sin Supabase, sin números reales. Verifica lo que exige el máster:
 * idempotencia de mensajes, creación/reutilización de conversación, membresía
 * deny-by-default y estados sent/delivered/read/failed.
 */

const PHONE = "+5491100000001";
const OP = "11111111-1111-4111-8111-111111111111";
const OP_INACTIVO = "22222222-2222-4222-9222-222222222222";

interface FakeMessage {
  conversationId: string;
  externalMsgId: string;
  body: string;
  authorParticipantId: string | null;
  status?: WaStatusValue;
}

function makeFakePort(opts: { eligible?: string[]; seed?: () => void } = {}) {
  const conversations = new Map<string, ProjectionConversation & { contextId: string }>();
  const participants = new Map<string, ProjectionParticipant[]>();
  const messages: FakeMessage[] = [];
  const calls = { createConversation: 0, unarchive: 0, addStaff: 0, addWhatsapp: 0 };
  let seqId = 0;
  const nextId = (p: string) => `${p}-${++seqId}`;

  const port: LinkProjectionPort = {
    async findConversationByContext(contextId) {
      for (const c of conversations.values()) if (c.contextId === contextId) return { ...c };
      return null;
    },
    async createConversation({ contextId }) {
      calls.createConversation += 1;
      const conv = { id: nextId("conv"), contextId, archivedAt: null as string | null };
      conversations.set(conv.id, conv);
      participants.set(conv.id, []);
      return { id: conv.id, archivedAt: conv.archivedAt };
    },
    async unarchiveConversation(id) {
      calls.unarchive += 1;
      const c = conversations.get(id);
      if (c) c.archivedAt = null;
    },
    async listParticipants(id) {
      return [...(participants.get(id) ?? [])];
    },
    async addStaffParticipant(conversationId, profileId) {
      calls.addStaff += 1;
      participants.get(conversationId)!.push({ id: nextId("part"), profileId, phone: null });
    },
    async addWhatsappParticipant({ conversationId, phone }) {
      calls.addWhatsapp += 1;
      const p = { id: nextId("part"), profileId: null, phone };
      participants.get(conversationId)!.push(p);
      return p.id;
    },
    async insertMessage(r) {
      // Espeja el índice único GLOBAL de external_msg_id: el rechazo es por
      // fila, exactamente como el 23505 real.
      if (messages.some((m) => m.externalMsgId === r.externalMsgId)) return "duplicate";
      messages.push({
        conversationId: r.conversationId,
        externalMsgId: r.externalMsgId,
        body: r.body,
        authorParticipantId: r.authorParticipantId,
      });
      return "inserted";
    },
    async resolveEligibleOperators(ids) {
      const eligible = opts.eligible ?? [];
      return ids.filter((id) => eligible.includes(id));
    },
    async applyOutboundStatus(status) {
      const msg = messages.find((m) => m.externalMsgId === status.wamid);
      if (!msg) return "unmatched";
      if (!canTransition(msg.status ?? null, status.status)) return "noop";
      msg.status = status.status;
      return "applied";
    },
  };

  return { port, conversations, participants, messages, calls };
}

function msg(wamid: string, text = "hola"): WaInboundMessage {
  return {
    wamid,
    fromE164: PHONE,
    text,
    sentAt: "2026-08-09T10:00:00.000Z",
    profileName: "Contacto Sintético",
  };
}

function status(wamid: string, s: WaStatusValue): WaInboundStatus {
  return { wamid, status: s, at: "2026-08-09T10:01:00.000Z", recipientE164: PHONE, errorCode: null, errorDetail: null };
}

describe("contextIdFor", () => {
  it("usa la misma convención que el importador histórico", () => {
    expect(contextIdFor(PHONE)).toBe(`wa:${PHONE}`);
  });
});

describe("projectInbound · conversación", () => {
  it("crea la conversación en el primer mensaje", async () => {
    const f = makeFakePort();
    const r = await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, []);
    expect(r.conversationsCreated).toBe(1);
    expect(r.messagesInserted).toBe(1);
    expect(f.calls.addWhatsapp).toBe(1);
  });

  it("REUTILIZA la conversación para un segundo mensaje del mismo teléfono", async () => {
    const f = makeFakePort();
    await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, []);
    const r = await projectInbound({ messages: [msg("wamid.2")], statuses: [] }, f.port, []);
    expect(r.conversationsCreated).toBe(0);
    expect(r.messagesInserted).toBe(1);
    expect(f.conversations.size).toBe(1);
    expect(f.calls.addWhatsapp).toBe(1); // el participante externo no se duplica
  });

  it("agrupa varios mensajes del mismo teléfono en un solo hilo", async () => {
    const f = makeFakePort();
    const r = await projectInbound(
      { messages: [msg("wamid.1"), msg("wamid.2"), msg("wamid.3")], statuses: [] },
      f.port,
      [],
    );
    expect(f.conversations.size).toBe(1);
    expect(r.messagesInserted).toBe(3);
  });

  it("desarchiva el hilo histórico sólo cuando entra un mensaje nuevo", async () => {
    const f = makeFakePort();
    await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, []);
    const conv = [...f.conversations.values()][0];
    conv.archivedAt = "2026-01-01T00:00:00.000Z";

    await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, []); // duplicado
    expect(f.calls.unarchive).toBe(0);

    await projectInbound({ messages: [msg("wamid.9")], statuses: [] }, f.port, []); // nuevo
    expect(f.calls.unarchive).toBe(1);
  });
});

describe("projectInbound · idempotencia", () => {
  it("reprocesar el MISMO evento no duplica mensajes", async () => {
    const f = makeFakePort();
    const evt = { messages: [msg("wamid.1"), msg("wamid.2")], statuses: [] };
    const first = await projectInbound(evt, f.port, []);
    const second = await projectInbound(evt, f.port, []);

    expect(first.messagesInserted).toBe(2);
    expect(second.messagesInserted).toBe(0);
    expect(second.messagesDuplicated).toBe(2);
    expect(f.messages).toHaveLength(2);
  });

  it("el mismo wamid con texto distinto tampoco reescribe (wamid manda)", async () => {
    const f = makeFakePort();
    await projectInbound({ messages: [msg("wamid.1", "original")], statuses: [] }, f.port, []);
    await projectInbound({ messages: [msg("wamid.1", "alterado")], statuses: [] }, f.port, []);
    expect(f.messages).toHaveLength(1);
    expect(f.messages[0].body).toBe("original");
  });
});

describe("projectInbound · membresía deny-by-default", () => {
  it("sin operadores configurados NO agrega ningún participante staff", async () => {
    const f = makeFakePort({ eligible: [OP] });
    const r = await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, []);
    expect(r.operatorsAdded).toBe(0);
    expect(f.calls.addStaff).toBe(0);
  });

  it("agrega sólo al operador configurado Y elegible", async () => {
    const f = makeFakePort({ eligible: [OP] });
    const r = await projectInbound(
      { messages: [msg("wamid.1")], statuses: [] },
      f.port,
      [OP, OP_INACTIVO],
    );
    expect(r.operatorsAdded).toBe(1);
    const parts = [...f.participants.values()][0];
    expect(parts.filter((p) => p.profileId).map((p) => p.profileId)).toEqual([OP]);
  });

  it("no re-agrega al operador en eventos posteriores", async () => {
    const f = makeFakePort({ eligible: [OP] });
    await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, [OP]);
    const r = await projectInbound({ messages: [msg("wamid.2")], statuses: [] }, f.port, [OP]);
    expect(r.operatorsAdded).toBe(0);
    expect(f.calls.addStaff).toBe(1);
  });
});

describe("projectInbound · estados", () => {
  it("aplica sent → delivered → read en orden monótono", async () => {
    const f = makeFakePort();
    await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, []);
    for (const s of ["sent", "delivered", "read"] as WaStatusValue[]) {
      await projectInbound({ messages: [], statuses: [status("wamid.1", s)] }, f.port, []);
    }
    expect(f.messages[0].status).toBe("read");
  });

  it("NO retrocede si llega un estado viejo fuera de orden", async () => {
    const f = makeFakePort();
    await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, []);
    await projectInbound({ messages: [], statuses: [status("wamid.1", "read")] }, f.port, []);
    await projectInbound({ messages: [], statuses: [status("wamid.1", "sent")] }, f.port, []);
    expect(f.messages[0].status).toBe("read");
  });

  it("R1A · failed NO pisa read (corrección C4: antes ganaba)", async () => {
    const f = makeFakePort();
    await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, []);
    await projectInbound({ messages: [], statuses: [status("wamid.1", "read")] }, f.port, []);
    const r = await projectInbound(
      { messages: [], statuses: [status("wamid.1", "failed")] },
      f.port,
      [],
    );
    expect(f.messages[0].status).toBe("read");
    expect(r.statusesNoop).toBe(1);
    expect(r.statusesApplied).toBe(0);
  });

  it("failed sí cierra un intento antes de delivered", async () => {
    const f = makeFakePort();
    await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, []);
    await projectInbound({ messages: [], statuses: [status("wamid.1", "sent")] }, f.port, []);
    await projectInbound({ messages: [], statuses: [status("wamid.1", "failed")] }, f.port, []);
    expect(f.messages[0].status).toBe("failed");
  });

  it("un status ANTERIOR al sello del wamid queda pendiente, no se pierde", async () => {
    const f = makeFakePort();
    const r = await projectInbound(
      { messages: [], statuses: [status("wamid.SIN-SELLO", "delivered")] },
      f.port,
      [],
    );
    expect(r.statusesApplied).toBe(0);
    expect(r.statusesUnmatched).toBe(1);
    // Y por lo tanto el evento NO puede cerrarse como procesado.
    expect(isProjectionComplete(r)).toBe(false);
  });

  it("se reconcilia al reprocesar el evento una vez sellado el wamid", async () => {
    const f = makeFakePort();
    const pendiente = { messages: [], statuses: [status("wamid.1", "delivered")] };
    const primero = await projectInbound(pendiente, f.port, []);
    expect(primero.statusesUnmatched).toBe(1);

    await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, []);
    const segundo = await projectInbound(pendiente, f.port, []);
    expect(segundo.statusesApplied).toBe(1);
    expect(isProjectionComplete(segundo)).toBe(true);
    expect(f.messages[0].status).toBe("delivered");
  });
});

describe("isProjectionComplete · gate de processed", () => {
  it("una proyección limpia se puede cerrar", async () => {
    const f = makeFakePort();
    const r = await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, []);
    expect(isProjectionComplete(r)).toBe(true);
  });

  it("un error parcial impide cerrar el evento", async () => {
    const f = makeFakePort();
    f.port.insertMessage = async () => {
      throw new Error("fallo sintético de fila");
    };
    const r = await projectInbound({ messages: [msg("wamid.1")], statuses: [] }, f.port, []);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(isProjectionComplete(r)).toBe(false);
  });
});

describe("projectInbound · lotes solapados (R1A)", () => {
  it("[A,B] y [B,C] terminan con A, B y C exactamente una vez", async () => {
    const f = makeFakePort();
    const A = msg("wamid.A");
    const B = msg("wamid.B");
    const C = msg("wamid.C");

    const r1 = await projectInbound({ messages: [A, B], statuses: [] }, f.port, []);
    const r2 = await projectInbound({ messages: [B, C], statuses: [] }, f.port, []);

    expect(r1.messagesInserted).toBe(2);
    // El duplicado B NO arrastra a C: ése era el defecto del insert masivo.
    expect(r2.messagesInserted).toBe(1);
    expect(r2.messagesDuplicated).toBe(1);
    expect(f.messages.map((m) => m.externalMsgId).sort()).toEqual([
      "wamid.A",
      "wamid.B",
      "wamid.C",
    ]);
  });

  it("un duplicado en medio del lote no impide insertar los nuevos", async () => {
    const f = makeFakePort();
    await projectInbound({ messages: [msg("wamid.B")], statuses: [] }, f.port, []);
    const r = await projectInbound(
      { messages: [msg("wamid.A"), msg("wamid.B"), msg("wamid.C")], statuses: [] },
      f.port,
      [],
    );
    expect(r.messagesInserted).toBe(2);
    expect(r.messagesDuplicated).toBe(1);
    expect(f.messages).toHaveLength(3);
  });
});

describe("projectInbound · aislamiento de fallos", () => {
  it("un teléfono que falla no impide proyectar el resto", async () => {
    const f = makeFakePort();
    const original = f.port.createConversation.bind(f.port);
    let first = true;
    f.port.createConversation = async (input) => {
      if (first) {
        first = false;
        throw new Error("fallo sintético");
      }
      return original(input);
    };
    const otro: WaInboundMessage = { ...msg("wamid.2"), fromE164: "+5491100000002" };
    const r = await projectInbound({ messages: [msg("wamid.1"), otro], statuses: [] }, f.port, []);
    expect(r.errors).toHaveLength(1);
    expect(r.messagesInserted).toBe(1);
  });
});

/**
 * INCIDENTE-WHATSAPP-ENTRANTES · R-19 · par ROJO→VERDE.
 *
 * Medido en producción: los 203 eventos terminales de `wa_inbound_events` son
 * TODOS acuses de entrega cuyo wamid no existe en `connect_messages`
 * (correlación 268/268), y los 203 dicen `last_error = "error_desconocido"`.
 *
 * El motivo nunca se perdió: NUNCA SE ESCRIBIÓ. `statusesUnmatched` era el
 * único desenlace incompleto que no dejaba razón en `errors`, así que el
 * consumidor recibía `errors: []` y saneaba `undefined` a «error_desconocido».
 */
describe("projectInbound · el status sin sello DEJA MOTIVO (incidente 203)", () => {
  it("un status unmatched escribe una razón legible en errors", async () => {
    const f = makeFakePort();
    const r = await projectInbound(
      { messages: [], statuses: [status("wamid.SIN-SELLO", "delivered")] },
      f.port,
      [],
    );
    expect(r.statusesUnmatched).toBe(1);
    // ANTES: errors === []  →  el consumidor no tenía NADA que sanear.
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toContain("status_unmatched");
  });

  it("la razón no filtra el wamid ni el teléfono de la contraparte", async () => {
    const f = makeFakePort();
    const r = await projectInbound(
      { messages: [], statuses: [status("wamid.SECRETO-DEL-CLIENTE", "read")] },
      f.port,
      [],
    );
    const todo = r.errors.join(" | ");
    expect(todo).not.toContain("wamid.SECRETO-DEL-CLIENTE");
    expect(todo).not.toContain(PHONE);
  });

  it("C4 · M-2 · la razón tiene categoría propia: NUNCA «unknown»", async () => {
    const f = makeFakePort();
    const r = await projectInbound(
      { messages: [], statuses: [status("wamid.SIN-SELLO", "delivered")] },
      f.port,
      [],
    );
    // El camino EN VIVO (webhook) categoriza cada motivo antes de loguearlo.
    // Sin rama propia caía en «unknown» y el arreglo no se notaba ahí.
    expect(errorCategory(r.errors[0])).toBe(STATUS_UNMATCHED_REASON);
    expect(errorCategory(r.errors[0])).not.toBe("unknown");
  });

  it("invariante: proyección incompleta ⇒ SIEMPRE hay al menos un motivo", async () => {
    const f = makeFakePort();
    const r = await projectInbound(
      { messages: [], statuses: [status("wamid.SIN-SELLO", "sent")] },
      f.port,
      [],
    );
    if (!isProjectionComplete(r)) expect(r.errors.length).toBeGreaterThan(0);
  });
});
