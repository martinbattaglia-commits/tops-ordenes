import { describe, it, expect, vi } from "vitest";
import {
  handleInboundEvent,
  type InboundPorts,
  type PersistedInbound,
  type RelayKickResult,
} from "./inbound-core";
import type { ProjectionResult } from "./link-projection";
import type { WaInboundParse } from "./inbound";

/**
 * LINK-WA 1B-1B · Webhook core — FAKES EN MEMORIA. Sin red, sin DB, sin Meta.
 */

const PHONE = "+5491100000001";
const TEXTO = "texto-confidencial-de-tercero";

function projection(over: Partial<ProjectionResult> = {}): ProjectionResult {
  return {
    conversationsTouched: 1, conversationsCreated: 0, messagesInserted: 1,
    messagesDuplicated: 0, operatorsAdded: 0, statusesApplied: 0,
    statusesNoop: 0, statusesUnmatched: 0, mediaStored: 0, errors: [], ...over,
  };
}

const PARSED_OK: WaInboundParse = {
  ok: true,
  phoneNumberId: "111111111111111",
  messages: [{ wamid: "wamid.1", fromE164: PHONE, text: TEXTO, sentAt: "2026-08-09T10:00:00.000Z", profileName: null }],
  statuses: [],
  skipped: { nonText: 0, malformed: 0, unknownStatus: 0 },
};

interface Opts {
  signature?: { valid: boolean; reason: string };
  parse?: WaInboundParse;
  persist?: PersistedInbound | null | (() => Promise<PersistedInbound | null>);
  result?: ProjectionResult;
  projectThrows?: boolean;
  relay?: RelayKickResult;
}

function makePorts(o: Opts = {}) {
  const marks: Array<{ kind: "processed" | "pending"; seq: number; notes: string }> = [];
  const logs: string[] = [];
  const project = vi.fn(async () => {
    if (o.projectThrows) throw new Error("fallo sintético");
    return o.result ?? projection();
  });
  const persist = vi.fn(async () => {
    if (typeof o.persist === "function") return o.persist();
    return o.persist === undefined ? { seq: 42, relayKey: null } : o.persist;
  });
  const ports: InboundPorts = {
    verifySignature: () => o.signature ?? { valid: true, reason: "ok" },
    parsePayload: () => o.parse ?? PARSED_OK,
    store: {
      persist,
      async markProcessed(seq, notes) { marks.push({ kind: "processed", seq, notes }); },
      async markPending(seq, notes) { marks.push({ kind: "pending", seq, notes }); },
    },
    project,
    kickRelay: vi.fn(async () => o.relay ?? "disabled"),
    auditSignatureRejection: vi.fn(async () => {}),
    shouldAuditRejection: () => true,
    logger: { error: (m) => logs.push(m), warn: (m) => logs.push(m) },
  };
  return { ports, marks, logs, project };
}

const REQ = { rawBody: JSON.stringify({ object: "whatsapp_business_account" }), signatureHeader: "sha256=deadbeef" };

describe("15 · firma inválida", () => {
  it("401 sin procesar ni persistir", async () => {
    const f = makePorts({ signature: { valid: false, reason: "mismatch" } });
    const res = await handleInboundEvent(REQ, f.ports);
    expect(res.status).toBe(401);
    expect(f.project).not.toHaveBeenCalled();
    expect(f.marks).toHaveLength(0);
    expect(f.ports.auditSignatureRejection).toHaveBeenCalledWith("mismatch");
  });

  it("sin app secret → 503 fail-closed", async () => {
    const f = makePorts({ signature: { valid: false, reason: "no_secret" } });
    const res = await handleInboundEvent(REQ, f.ports);
    expect(res.status).toBe(503);
    expect(f.project).not.toHaveBeenCalled();
  });
});

describe("16 · body o JSON inválido", () => {
  it("con firma válida se persiste igual y no se proyecta como evento válido", async () => {
    const f = makePorts({ parse: { ok: false, reason: "not_object" } });
    const res = await handleInboundEvent({ rawBody: "no-json{", signatureHeader: "sha256=x" }, f.ports);
    expect(res.status).toBe(200);
    expect(f.marks[0]).toMatchObject({ kind: "processed" });
    expect(f.project).not.toHaveBeenCalled();
  });
});

describe("17 · falla de persistencia → retryable", () => {
  it.each([
    ["sin custodia (null)", null as PersistedInbound | null],
  ])("%s", async (_l, persist) => {
    const f = makePorts({ persist });
    const res = await handleInboundEvent(REQ, f.ports);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, retryable: true });
    expect(f.project).not.toHaveBeenCalled();
  });

  it("excepción al persistir tampoco responde éxito", async () => {
    const f = makePorts({ persist: async () => { throw new Error("db caída"); } });
    const res = await handleInboundEvent(REQ, f.ports);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ retryable: true });
    expect(f.project).not.toHaveBeenCalled();
  });
});

describe("18 · proyección parcial → processed=false", () => {
  it("con errores el evento queda pendiente", async () => {
    const f = makePorts({ result: projection({ errors: ["mensaje wamid.X: boom"] }) });
    const res = await handleInboundEvent(REQ, f.ports);
    expect(res.status).toBe(200);
    expect(f.marks[0].kind).toBe("pending");
    expect((res.body.projection as { processed: boolean }).processed).toBe(false);
  });

  it("una excepción de proyección deja el evento pendiente", async () => {
    const f = makePorts({ projectThrows: true });
    const res = await handleInboundEvent(REQ, f.ports);
    expect(res.status).toBe(200);
    expect(f.marks[0].kind).toBe("pending");
  });
});

describe("19 · estado anterior al sello → pendiente", () => {
  it("statusesUnmatched impide cerrar el evento", async () => {
    const f = makePorts({ result: projection({ messagesInserted: 0, statusesUnmatched: 1 }) });
    const res = await handleInboundEvent(REQ, f.ports);
    expect(f.marks[0].kind).toBe("pending");
    expect((res.body.projection as { pending: number }).pending).toBe(1);
  });
});

describe("20 · reconciliación del estado pendiente", () => {
  it("al reprocesar con el wamid ya sellado, el evento se cierra", async () => {
    const pendiente = makePorts({ result: projection({ statusesUnmatched: 1 }) });
    await handleInboundEvent(REQ, pendiente.ports);
    expect(pendiente.marks[0].kind).toBe("pending");

    const reconciliado = makePorts({ result: projection({ statusesApplied: 1 }) });
    const res = await handleInboundEvent(REQ, reconciliado.ports);
    expect(reconciliado.marks[0].kind).toBe("processed");
    expect((res.body.projection as { processed: boolean }).processed).toBe(true);
  });
});

describe("21 · estados fuera de orden sin regresión", () => {
  it("los no-op no impiden cerrar el evento", async () => {
    const f = makePorts({ result: projection({ statusesApplied: 0, statusesNoop: 2 }) });
    await handleInboundEvent(REQ, f.ports);
    expect(f.marks[0].kind).toBe("processed");
    expect(f.marks[0].notes).toContain("noop=2");
  });
});

describe("22 · handler invocado exactamente una vez", () => {
  it("una entrada válida proyecta una sola vez", async () => {
    const f = makePorts();
    await handleInboundEvent(REQ, f.ports);
    expect(f.project).toHaveBeenCalledTimes(1);
    expect(f.ports.kickRelay).toHaveBeenCalledTimes(1);
    expect(f.marks).toHaveLength(1);
  });
});

describe("22b · relay Nexus → Make", () => {
  it("firma inválida ⇒ nunca hay egress", async () => {
    const f = makePorts({ signature: { valid: false, reason: "mismatch" } });
    await handleInboundEvent(REQ, f.ports);
    expect(f.ports.kickRelay).not.toHaveBeenCalled();
  });

  it("persistencia fallida ⇒ nunca hay egress", async () => {
    const f = makePorts({ persist: null });
    await handleInboundEvent(REQ, f.ports);
    expect(f.ports.kickRelay).not.toHaveBeenCalled();
  });

  it("persiste body crudo y firma antes de intentar el relay", async () => {
    const f = makePorts();
    await handleInboundEvent(REQ, f.ports);
    expect(f.ports.store.persist).toHaveBeenCalledWith({
      payload: JSON.parse(REQ.rawBody),
      rawBody: REQ.rawBody,
      signatureHeader: REQ.signatureHeader,
    });
  });

  it("outbox encolada se intenta por su identidad estable", async () => {
    const f = makePorts({ persist: { seq: 42, relayKey: "a".repeat(64) }, relay: "delivered" });
    const res = await handleInboundEvent(REQ, f.ports);
    expect(f.ports.kickRelay).toHaveBeenCalledWith("a".repeat(64));
    expect(res.status).toBe(200);
    expect(res.body.relay).toBe("delivered");
  });

  it("Make caído ⇒ 200 porque la outbox queda pendiente y durable", async () => {
    const f = makePorts({ persist: { seq: 42, relayKey: "a".repeat(64) }, relay: "pending" });
    const res = await handleInboundEvent(REQ, f.ports);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, persisted: true, relay: "pending" });
    expect(JSON.stringify({ body: res.body, logs: f.logs })).not.toContain(REQ.rawBody);
    expect(JSON.stringify({ body: res.body, logs: f.logs })).not.toContain(REQ.signatureHeader);
  });
});

describe("23 · sin PII ni secretos en la respuesta", () => {
  it("ni el teléfono, ni el texto, ni el wamid salen en el body", async () => {
    const f = makePorts();
    const res = await handleInboundEvent(REQ, f.ports);
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain(PHONE);
    expect(dump).not.toContain(TEXTO);
    expect(dump).not.toContain("wamid.1");
  });

  it("tampoco en las notas de custodia ni en los logs", async () => {
    const f = makePorts({ result: projection({ errors: ["fallo interno"] }) });
    await handleInboundEvent(REQ, f.ports);
    const dump = JSON.stringify({ marks: f.marks, logs: f.logs });
    expect(dump).not.toContain(PHONE);
    expect(dump).not.toContain(TEXTO);
  });

  it("el 401 no revela el motivo interno del rechazo", async () => {
    const f = makePorts({ signature: { valid: false, reason: "mismatch" } });
    const res = await handleInboundEvent(REQ, f.ports);
    expect(JSON.stringify(res.body)).not.toContain("mismatch");
  });
});
