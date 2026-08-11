import { describe, it, expect, vi } from "vitest";
import { canTransition } from "./outbound-state";
import {
  executeReply,
  isValidWhatsappText,
  isValidClientMsgId,
  normalizeWhatsappText,
  snapshotMatchesAttempt,
  counterpartPhoneFromContext,
  type ClaimOutcome,
  type ClaimSnapshot,
  type OutboundStateSnapshot,
  type ReplyPorts,
} from "./reply-core";
import type { MetaSendOutcome } from "./transport";
import type { WaOutboundState } from "./outbound-state";

/**
 * LINK-WA 1B-1D · Reply core — FAKES EN MEMORIA.
 *
 * Cero red, cero Supabase, cero Meta real, cero datos reales. Cada escenario
 * cuenta llamadas al transporte Y a `claimSending`.
 */

const OP = "11111111-1111-4111-8111-111111111111";
const CID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const CID2 = "bbbbbbbb-2222-4222-9222-bbbbbbbbbbbb";
const CONV = "conv-1";
const PHONE = "+5491100000001";
const TEXTO = "hola";

function snap(over: Partial<ClaimSnapshot> = {}): ClaimSnapshot {
  return {
    id: "msg-1",
    conversationId: CONV,
    authorProfileId: OP,
    clientMsgId: CID,
    body: TEXTO,
    externalMsgId: null,
    ...over,
  };
}

interface FakeOpts {
  actor?: { id: string } | null;
  authorized?: boolean;
  membership?: { active: boolean; role: string | null; clientId: string | null } | null;
  conversation?: { id: string; kind: string; contextId: string } | null;
  allowed?: boolean;
  claim?: ClaimOutcome | ((body: string) => ClaimOutcome);
  initialState?: Partial<OutboundStateSnapshot>;
  readThrows?: boolean;
  claimSendingThrows?: boolean;
  sealOk?: boolean;
  auditOk?: boolean | ((action: string) => boolean);
  stampOk?: boolean;
  markAuditedOk?: boolean;
  outcome?: MetaSendOutcome;
}

function makePorts(o: FakeOpts = {}) {
  const sendText = vi.fn(
    async (input: { to: string; text: string }): Promise<MetaSendOutcome> => {
      sent.push(input);
      return o.outcome ?? { kind: "accepted", wamid: "wamid.OK" };
    },
  );
  const sent: Array<{ to: string; text: string }> = [];
  const stamps: Array<{ status: WaOutboundState; wamid?: string; error?: string }> = [];
  const audits: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const claimSending = vi.fn(async () => {
    const s = state.status;
    if (o.claimSendingThrows) throw new Error("db down");
    if (s !== null && s !== "queued") return false;
    state = { ...state, status: "sending" };
    stamps.push({ status: "sending" });
    return true;
  });
  let state: OutboundStateSnapshot = {
    status: null,
    wamid: null,
    auditedWamid: null,
    ...(o.initialState ?? {}),
  };
  /**
   * WA-7R2 · réplica fiel del adaptador: el marcador exige el MISMO wamid y un
   * estado de progreso. Un fake que se limitara a poner `auditedWamid` no
   * probaría nada.
   */
  const markAudited = vi.fn(async (_id: string, wamid: string) => {
    if (o.markAuditedOk === false) return false;
    if (state.wamid !== wamid) return false;
    if (!state.status || !["sent", "delivered", "read"].includes(state.status)) return false;
    state = { ...state, auditedWamid: wamid };
    return true;
  });

  const ports: ReplyPorts = {
    session: { async getActor() { return o.actor === undefined ? { id: OP } : o.actor; } },
    operators: { isAuthorized: () => o.authorized !== false },
    tenant: {
      async getMembership() {
        return o.membership === undefined
          ? { active: true, role: "admin", clientId: "cli-1" }
          : o.membership;
      },
    },
    conversations: {
      async get() {
        return o.conversation === undefined
          ? { id: CONV, kind: "whatsapp", contextId: `wa:${PHONE}` }
          : o.conversation;
      },
    },
    sandbox: { isAllowed: () => o.allowed !== false },
    claim: {
      async acquire({ body }) {
        if (typeof o.claim === "function") return o.claim(body);
        return o.claim ?? { kind: "claimed", snapshot: snap() };
      },
    },
    state: {
      async read() {
        if (o.readThrows) throw new Error("db down");
        return state;
      },
      claimSending,
      async sealSent(_id, wamid) {
        if (o.sealOk === false) return false;
        // El sello deja el intento SELLADO PERO NO AUDITADO.
        state = { status: "sent", wamid, auditedWamid: null };
        stamps.push({ status: "sent", wamid });
        return true;
      },
      markAudited,
      async stamp(_id, patch) {
        if (o.stampOk === false) return false;
        stamps.push(patch);
        state = {
          ...state,
          status: patch.status,
          wamid: patch.wamid ?? state.wamid,
        };
        return true;
      },
    },
    audit: {
      async record(action, payload) {
        const ok = typeof o.auditOk === "function" ? o.auditOk(action) : o.auditOk !== false;
        if (ok) audits.push({ action, payload });
        return ok;
      },
    },
    clock: { now: () => "2026-08-09T12:00:00.000Z" },
    transport: { sendText },
  };
  return {
    ports, sendText, stamps, audits, sent, claimSending, markAudited,
    calls: () => sendText.mock.calls.length,
    claimCalls: () => claimSending.mock.calls.length,
    markCalls: () => markAudited.mock.calls.length,
    /** Estado durable resultante: lo que verá un reintento posterior. */
    durable: () => state,
  };
}

const INPUT = { conversationId: CONV, text: TEXTO, clientMsgId: CID };

// ── 1 · reutilización válida ───────────────────────────────────────────────
describe("1 · mismo ID + snapshot canónico coincidente", () => {
  it("permite el intento y transporta el texto persistido", async () => {
    const f = makePorts();
    const r = await executeReply(INPUT, f.ports);
    expect(r).toEqual({ ok: true, messageId: "msg-1", reused: false });
    expect(f.sent).toEqual([{ to: PHONE, text: TEXTO }]);
  });
});

// ── 2 · body distinto ──────────────────────────────────────────────────────
describe("2 · mismo clientMsgId con BODY distinto", () => {
  it("mismatch, cero transporte y cero claimSending", async () => {
    // La fila persistida tiene "texto-A"; el core pidió enviar "hola".
    const f = makePorts({ claim: { kind: "claimed", snapshot: snap({ body: "texto-A" }) } });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ ok: false, code: "attempt_binding_mismatch", error: "attempt_binding_mismatch" });
    expect(f.calls()).toBe(0);
    expect(f.claimCalls()).toBe(0);
  });
});

// ── 3 · conversación / actor / clientMsgId distintos ───────────────────────
describe("3 · identidad del intento no coincide", () => {
  it.each([
    ["conversación", snap({ conversationId: "otra" })],
    ["actor", snap({ authorProfileId: "22222222-2222-4222-9222-222222222222" })],
    ["clientMsgId", snap({ clientMsgId: CID2 })],
    ["autor nulo", snap({ authorProfileId: null })],
  ])("%s → fail-closed", async (_l, s) => {
    const f = makePorts({ claim: { kind: "claimed", snapshot: s } });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ code: "attempt_binding_mismatch" });
    expect(f.calls()).toBe(0);
    expect(f.claimCalls()).toBe(0);
  });
});

// ── 4 · fila nula / incompleta / error ─────────────────────────────────────
describe("4 · snapshot no verificable", () => {
  it("not_verifiable → cero transporte", async () => {
    const f = makePorts({ claim: { kind: "not_verifiable" } });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ code: "attempt_not_verifiable", error: "attempt_not_verifiable" });
    expect(f.calls()).toBe(0);
    expect(f.claimCalls()).toBe(0);
  });

  it("claim denegada → rbac_denied sin transporte", async () => {
    const f = makePorts({ claim: { kind: "denied", reason: "x" } });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ code: "rbac_denied", error: "rbac_denied" });
    expect(f.calls()).toBe(0);
  });

  it("id vacío en el snapshot → mismatch", async () => {
    const f = makePorts({ claim: { kind: "claimed", snapshot: snap({ id: "" }) } });
    expect(await executeReply(INPUT, f.ports)).toMatchObject({ code: "attempt_binding_mismatch" });
    expect(f.calls()).toBe(0);
  });
});

// ── 5 · normalización canónica ─────────────────────────────────────────────
describe("5 · normalización `\"  hola  \"` vs `\"hola\"`", () => {
  it("son el MISMO intento: el snapshot con espacios coincide", async () => {
    const f = makePorts({ claim: { kind: "claimed", snapshot: snap({ body: "  hola  " }) } });
    const r = await executeReply({ ...INPUT, text: "  hola  " }, f.ports);
    expect(r).toMatchObject({ ok: true });
    // Y lo transportado es el texto NORMALIZADO, no el crudo.
    expect(f.sent[0].text).toBe("hola");
  });

  it("normalizeWhatsappText es la única fuente", () => {
    expect(normalizeWhatsappText("  hola  ")).toBe("hola");
    expect(normalizeWhatsappText("hola")).toBe("hola");
  });
});

// ── 6 · carrera A/B ────────────────────────────────────────────────────────
describe("6 · carrera A/B con el mismo clientMsgId", () => {
  it("exactamente un transporte y coincide con el body persistido", async () => {
    // El primero en llegar persiste "texto-A": la fila queda con ese body.
    const persisted = "texto-A";
    const f = makePorts({ claim: { kind: "claimed", snapshot: snap({ body: persisted }) } });

    const [a, b] = await Promise.all([
      executeReply({ ...INPUT, text: persisted }, f.ports),
      executeReply({ ...INPUT, text: "texto-B" }, f.ports),
    ]);

    expect(f.calls()).toBe(1);
    expect(f.sent[0].text).toBe(persisted);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "attempt_binding_mismatch")).toHaveLength(1);
  });
});

// ── 7 · failed cierra el intento ───────────────────────────────────────────
describe("7 · estado failed", () => {
  it("cero segundo egress: exige un clientMsgId nuevo", async () => {
    const f = makePorts({ initialState: { status: "failed", wamid: null } });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ code: "attempt_closed", error: "attempt_closed" });
    expect(f.calls()).toBe(0);
    expect(f.claimCalls()).toBe(0);
  });
});

// ── 8 · external_msg_id previo ─────────────────────────────────────────────
/**
 * WA-7R · B · un wamid previo bloquea el egress SIEMPRE, pero sólo un intento
 * duramente cerrado y AUDITADO puede devolver éxito reutilizado. El wamid prueba
 * que hubo egress; el estado durable dice si ese intento quedó cerrado.
 */
describe("8 · wamid previo bloquea cualquier egress", () => {
  it("snapshot con wamid + estado `sent` + marcador auditado: éxito reutilizado", async () => {
    const f = makePorts({
      claim: { kind: "claimed", snapshot: snap({ externalMsgId: "wamid.PREVIO" }) },
      initialState: { status: "sent", wamid: "wamid.PREVIO", auditedWamid: "wamid.PREVIO" },
    });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toEqual({ ok: true, messageId: "msg-1", reused: true });
    expect(f.calls()).toBe(0);
    expect(f.claimCalls()).toBe(0);
  });

  it.each(["sent", "delivered", "read"] as WaOutboundState[])(
    "con wamid previo, estado %s y marcador auditado → reused",
    async (status) => {
      const f = makePorts({
        initialState: { status, wamid: "wamid.PREVIO", auditedWamid: "wamid.PREVIO" },
      });
      const r = await executeReply(INPUT, f.ports);
      expect(r).toMatchObject({ ok: true, reused: true });
      expect(f.calls()).toBe(0);
    },
  );

  /**
   * WA-7R2 · mutante 4 del mandato. El par (wamid, estado de progreso) YA NO
   * alcanza: sin marcador durable no hubo cierre auditado.
   */
  it.each(["sent", "delivered", "read"] as WaOutboundState[])(
    "wamid + estado %s SIN marcador auditado → reconciliación, no éxito",
    async (status) => {
      const f = makePorts({
        initialState: { status, wamid: "wamid.PREVIO", auditedWamid: null },
      });
      const r = await executeReply(INPUT, f.ports);
      expect(r).toMatchObject({
        ok: false,
        code: "reconciliation_required",
        error: "audit_unconfirmed",
      });
      expect(r).not.toMatchObject({ ok: true });
      expect(f.calls()).toBe(0);
    },
  );

  it("un marcador de OTRO wamid no acredita este sello", async () => {
    const f = makePorts({
      initialState: { status: "sent", wamid: "wamid.NUEVO", auditedWamid: "wamid.VIEJO" },
    });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ ok: false, code: "reconciliation_required" });
    expect(f.calls()).toBe(0);
  });

  it.each([
    ["reconciliation_required", "reconciliation_required"],
    ["sending", "in_flight"],
    ["failed", "attempt_closed"],
  ] as Array<[WaOutboundState, string]>)(
    "con wamid previo y estado %s NO hay éxito reutilizado (%s)",
    async (status, code) => {
      const f = makePorts({ initialState: { status, wamid: "wamid.PREVIO" } });
      const r = await executeReply(INPUT, f.ports);
      expect(r).toMatchObject({ ok: false, code });
      expect(f.calls()).toBe(0);
    },
  );

  it("wamid sin estado congruente NO se declara éxito: queda en reconciliación", async () => {
    // La fila afirma que hubo egress y la máquina de estados no lo registra.
    const f = makePorts({
      claim: { kind: "claimed", snapshot: snap({ externalMsgId: "wamid.PREVIO" }) },
      initialState: { status: null, wamid: null },
    });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({
      ok: false,
      code: "reconciliation_required",
      error: "reconciliation_unverified",
    });
    expect(f.calls()).toBe(0);
    expect(f.claimCalls()).toBe(0);
  });
});

// ── 9 · clientMsgId nuevo ──────────────────────────────────────────────────
describe("9 · un clientMsgId NUEVO habilita un intento independiente", () => {
  it("tras un failed, otro id sale normalmente", async () => {
    const cerrado = makePorts({ initialState: { status: "failed", wamid: null } });
    expect(await executeReply(INPUT, cerrado.ports)).toMatchObject({ code: "attempt_closed" });
    expect(cerrado.calls()).toBe(0);

    const nuevo = makePorts({
      claim: { kind: "claimed", snapshot: snap({ id: "msg-2", clientMsgId: CID2 }) },
    });
    const r = await executeReply({ ...INPUT, clientMsgId: CID2 }, nuevo.ports);
    expect(r).toMatchObject({ ok: true, messageId: "msg-2", reused: false });
    expect(nuevo.calls()).toBe(1);
  });
});

// ── 10 · sin PII ───────────────────────────────────────────────────────────
describe("10 · ni resultados ni auditoría contienen texto o teléfono", () => {
  it.each([
    ["éxito", {} as FakeOpts],
    ["mismatch", { claim: { kind: "claimed", snapshot: snap({ body: "otro" }) } } as FakeOpts],
    ["rechazo", { outcome: { kind: "rejected", reason: "http_error", status: 400, detail: "Invalid recipient +5491100000001" } } as FakeOpts],
    ["ambiguo", { outcome: { kind: "ambiguous", reason: "server_error", detail: "HTTP 503" } } as FakeOpts],
  ])("%s", async (_l, opts) => {
    const f = makePorts(opts);
    const r = await executeReply(INPUT, f.ports);
    const dump = JSON.stringify({ r, audits: f.audits });
    expect(dump).not.toContain(PHONE);
    expect(dump).not.toContain(TEXTO);
    expect(dump).not.toContain("Invalid recipient");
    expect(dump).not.toContain("wamid.OK");
  });

  it("el detalle del proveedor NUNCA llega al resultado", async () => {
    const f = makePorts({
      outcome: { kind: "rejected", reason: "http_error", status: 400, detail: "secreto-del-proveedor" },
    });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ ok: false, code: "send_failed", error: "meta_rejected" });
    expect(JSON.stringify(r)).not.toContain("secreto-del-proveedor");
  });
});

// ── 11 · auditoría final ───────────────────────────────────────────────────
/**
 * WA-7R · B · La auditoría de cierre es CONSTITUTIVA del éxito.
 *
 * Antes, el primer resultado era reconciliación pero el REINTENTO encontraba el
 * wamid sellado y devolvía `ok:true, reused:true`: un éxito falso sobre un
 * intento que nadie auditó. Ahora la reconciliación se PERSISTE y ningún
 * reintento puede declararla exitosa.
 */
describe("11 · fallo de la auditoría final", () => {
  it("persiste `reconciliation_required` y ningún reintento devuelve ok:true", async () => {
    const f = makePorts({ auditOk: (a) => a !== "reply_sent" });

    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({
      ok: false,
      code: "reconciliation_required",
      error: "audit_reconciliation",
    });
    expect(f.calls()).toBe(1);
    // El fallo quedó DURABLE, no sólo en la respuesta.
    expect(f.stamps.at(-1)).toMatchObject({
      status: "reconciliation_required",
      error: "audit_reconciliation",
    });

    // Dos reintentos con el MISMO clientMsgId: cero egress y cero falso éxito.
    const segunda = await executeReply(INPUT, f.ports);
    const tercera = await executeReply(INPUT, f.ports);
    for (const intento of [segunda, tercera]) {
      expect(intento).toMatchObject({ ok: false, code: "reconciliation_required" });
      expect(intento).not.toMatchObject({ ok: true });
    }
    expect(f.calls()).toBe(1);
    expect(f.claimCalls()).toBe(1);
  });

  it("el reintento tampoco miente cuando el claim trae el wamid en el snapshot", async () => {
    const f = makePorts({ auditOk: (a) => a !== "reply_sent" });
    expect(await executeReply(INPUT, f.ports)).toMatchObject({ ok: false });

    // Ahora el RPC devuelve la fila previa YA sellada, como en producción.
    const conWamid = makePorts({
      auditOk: (a) => a !== "reply_sent",
      claim: { kind: "claimed", snapshot: snap({ externalMsgId: "wamid.OK" }) },
      initialState: { status: "reconciliation_required", wamid: "wamid.OK" },
    });
    const r = await executeReply(INPUT, conWamid.ports);
    expect(r).toMatchObject({ ok: false, code: "reconciliation_required" });
    expect(conWamid.calls()).toBe(0);
  });

  /**
   * WA-7R2 · mutante 1 del mandato — EL DEFECTO QUE ABRIÓ ESTA SESIÓN.
   *
   * Sello OK + `reply_sent` fallido + `stamp` fallido. La fila durable queda
   * `sent + wamid` y SIN marcador. Antes de WA-7R2 el reintento devolvía
   * `ok:true, reused:true`. No alcanza con mirar la primera respuesta: el test
   * construye el estado durable resultante y ejecuta un reintento real.
   */
  it("doble fallo (auditoría + reconciliación): el reintento durable es ok:false y sin egress", async () => {
    const f = makePorts({ auditOk: (a) => a !== "reply_sent", stampOk: false });

    const primera = await executeReply(INPUT, f.ports);
    expect(primera).toMatchObject({
      ok: false,
      code: "reconciliation_required",
      error: "reconciliation_persist_failed",
    });
    expect(f.calls()).toBe(1);

    // Estado durable REAL tras el doble fallo: sellado, con progreso y sin auditar.
    expect(f.durable()).toMatchObject({
      status: "sent",
      wamid: "wamid.OK",
      auditedWamid: null,
    });

    // El reintento entra por `resolveClosedAttempt` con ese estado exacto.
    const segunda = await executeReply(INPUT, f.ports);
    const tercera = await executeReply(INPUT, f.ports);
    for (const intento of [segunda, tercera]) {
      expect(intento).toMatchObject({
        ok: false,
        code: "reconciliation_required",
        error: "audit_unconfirmed",
      });
      expect(intento).not.toMatchObject({ ok: true });
    }
    expect(f.calls()).toBe(1); // cero segundo egress
  });

  /**
   * WA-7R2 · mutante 3 del mandato: la auditoría PASA pero el marcador no puede
   * persistirse. Nunca éxito, nunca segundo egress — ni ahora ni al reintentar.
   */
  it("auditoría OK pero marcador no persistido: nunca éxito, ni en el reintento", async () => {
    const f = makePorts({ markAuditedOk: false });

    const primera = await executeReply(INPUT, f.ports);
    expect(primera).toMatchObject({
      ok: false,
      code: "reconciliation_required",
      error: "audit_marker_unpersisted",
    });
    expect(f.markCalls()).toBe(1);
    expect(f.durable()).toMatchObject({ status: "sent", wamid: "wamid.OK", auditedWamid: null });

    const segunda = await executeReply(INPUT, f.ports);
    expect(segunda).toMatchObject({ ok: false, code: "reconciliation_required" });
    expect(segunda).not.toMatchObject({ ok: true });
    expect(f.calls()).toBe(1);
  });

  /**
   * WA-7R2 · mutante 2 del mandato: reconciliación persistida y DESPUÉS un
   * webhook promueve el estado. El avance de estado no fabrica auditoría.
   */
  it.each(["delivered", "read"] as WaOutboundState[])(
    "reconciliación persistida + webhook %s: el reintento nunca es ok:true",
    async (avance) => {
      const f = makePorts({ auditOk: (a) => a !== "reply_sent" });
      expect(await executeReply(INPUT, f.ports)).toMatchObject({
        ok: false,
        error: "audit_reconciliation",
      });
      expect(f.durable()).toMatchObject({ status: "reconciliation_required" });

      // El webhook avanza el estado del proveedor sin tocar el marcador.
      const conAvance = makePorts({
        initialState: { status: avance, wamid: "wamid.OK", auditedWamid: null },
      });
      const r = await executeReply(INPUT, conAvance.ports);
      expect(r).toMatchObject({
        ok: false,
        code: "reconciliation_required",
        error: "audit_unconfirmed",
      });
      expect(conAvance.calls()).toBe(0);
    },
  );

  /** WA-7R2 · mutante 6: el marcador no puede aparecer antes de `reply_sent`. */
  it("el marcador se sella DESPUÉS de reply_sent, nunca antes", async () => {
    const orden: string[] = [];
    const base = makePorts();
    const ports: ReplyPorts = {
      ...base.ports,
      audit: {
        async record(action, payload) {
          orden.push(`audit:${action}`);
          return base.ports.audit.record(action, payload);
        },
      },
      state: {
        ...base.ports.state,
        async sealSent(id, wamid) {
          orden.push("sealSent");
          return base.ports.state.sealSent(id, wamid);
        },
        async markAudited(id, wamid) {
          orden.push("markAudited");
          return base.ports.state.markAudited(id, wamid);
        },
      },
    };
    expect(await executeReply(INPUT, ports)).toMatchObject({ ok: true, reused: false });
    expect(orden.indexOf("sealSent")).toBeLessThan(orden.indexOf("audit:reply_sent"));
    expect(orden.indexOf("audit:reply_sent")).toBeLessThan(orden.indexOf("markAudited"));
  });

  /** WA-7R2 · mutante 5: la ÚNICA reutilización válida. */
  it("wamid + progreso + marcador auditado es la única reutilización válida", async () => {
    const f = makePorts();
    expect(await executeReply(INPUT, f.ports)).toMatchObject({ ok: true, reused: false });
    expect(f.durable()).toMatchObject({
      status: "sent",
      wamid: "wamid.OK",
      auditedWamid: "wamid.OK",
    });

    const reintento = await executeReply(INPUT, f.ports);
    expect(reintento).toMatchObject({ ok: true, reused: true });
    expect(f.calls()).toBe(1);
  });
});

// ── 11b · WA-7R · A · carrera del wamid durante el CAS ─────────────────────
describe("11b · aparece un wamid entre la lectura inicial y el UPDATE", () => {
  it("el CAS pierde, se relee el estado y el resultado es fail-closed sin egress", async () => {
    // La lectura inicial ve la fila limpia; al intentar el CAS, otra sesión ya
    // selló el wamid, así que el UPDATE con `external_msg_id IS NULL` no afecta
    // ninguna fila. El core NO debe interpretarlo como "sigue disponible".
    let leidas = 0;
    const base = makePorts();
    const ports: ReplyPorts = {
      ...base.ports,
      state: {
        ...base.ports.state,
        async read() {
          leidas += 1;
          return leidas === 1
            ? { status: null, wamid: null, auditedWamid: null }
            : { status: "reconciliation_required", wamid: "wamid.CARRERA", auditedWamid: null };
        },
        async claimSending() {
          return false; // el WHERE ya no acierta: cero filas
        },
      },
    };

    const r = await executeReply(INPUT, ports);
    expect(r).toMatchObject({ ok: false, code: "reconciliation_required" });
    expect(r).not.toMatchObject({ ok: true });
    expect(base.calls()).toBe(0);
    expect(leidas).toBe(2);
  });

  it("si el estado posterior acredita cierre auditado, es reutilización, no reenvío", async () => {
    let leidas = 0;
    const base = makePorts();
    const ports: ReplyPorts = {
      ...base.ports,
      state: {
        ...base.ports.state,
        async read() {
          leidas += 1;
          return leidas === 1
            ? { status: null, wamid: null, auditedWamid: null }
            : // El ganador de la carrera ya selló Y auditó su intento.
              { status: "sent", wamid: "wamid.CARRERA", auditedWamid: "wamid.CARRERA" };
        },
        async claimSending() {
          return false;
        },
      },
    };
    expect(await executeReply(INPUT, ports)).toMatchObject({ ok: true, reused: true });
    expect(base.calls()).toBe(0);
  });

  it("si el ganador de la carrera todavía no auditó, no hay éxito reutilizado", async () => {
    let leidas = 0;
    const base = makePorts();
    const ports: ReplyPorts = {
      ...base.ports,
      state: {
        ...base.ports.state,
        async read() {
          leidas += 1;
          return leidas === 1
            ? { status: null, wamid: null, auditedWamid: null }
            : { status: "sent", wamid: "wamid.CARRERA", auditedWamid: null };
        },
        async claimSending() {
          return false;
        },
      },
    };
    const r = await executeReply(INPUT, ports);
    expect(r).toMatchObject({ ok: false, code: "reconciliation_required" });
    expect(base.calls()).toBe(0);
  });
});

// ── sello con precondición ─────────────────────────────────────────────────
describe("sello con precondición", () => {
  it("si el sello no afecta una fila → reconciliation_required, sin ok:true", async () => {
    const f = makePorts({ sealOk: false });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ ok: false, code: "reconciliation_required", error: "seal_precondition_failed" });
    expect(f.calls()).toBe(1);
    expect(f.stamps.at(-1)).toMatchObject({ status: "reconciliation_required" });
  });
});

// ── fail-closed de estado ──────────────────────────────────────────────────
describe("fail-closed en lectura de estado", () => {
  it("error de read → state_unavailable, cero transporte", async () => {
    const f = makePorts({ readThrows: true });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ code: "state_unavailable", error: "state_unavailable" });
    expect(f.calls()).toBe(0);
  });

  it("error de claimSending → state_unavailable, cero transporte", async () => {
    const f = makePorts({ claimSendingThrows: true });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ code: "state_unavailable" });
    expect(f.calls()).toBe(0);
  });
});

// ── guardas previas ────────────────────────────────────────────────────────
describe("guardas previas al claim → cero transporte", () => {
  it.each([
    ["texto vacío", { text: "" }, "invalid_input"],
    ["sólo espacios", { text: "   " }, "invalid_input"],
    ["texto >4096", { text: "x".repeat(4097) }, "invalid_input"],
    ["clientMsgId no UUID", { clientMsgId: "reintento-1" }, "invalid_input"],
    ["clientMsgId vacío", { clientMsgId: "" }, "invalid_input"],
  ])("%s", async (_l, patch, code) => {
    const f = makePorts();
    const r = await executeReply({ ...INPUT, ...patch }, f.ports);
    expect(r).toMatchObject({ code });
    expect(f.calls()).toBe(0);
  });

  it.each([
    ["sesión ausente", { actor: null } as FakeOpts, "no_session"],
    ["operador denegado", { authorized: false } as FakeOpts, "not_operator"],
    ["tenant denegado", { membership: null } as FakeOpts, "not_tenant_member"],
    ["hilo inexistente", { conversation: null } as FakeOpts, "no_thread"],
    ["allowlist denegada", { allowed: false } as FakeOpts, "sandbox_denied"],
  ])("%s", async (_l, opts, code) => {
    const f = makePorts(opts);
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ code });
    expect(f.calls()).toBe(0);
  });

  it("auditoría previa fallida → cero transporte", async () => {
    const f = makePorts({ auditOk: (a) => a !== "reply_attempt" });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ code: "audit_failed", error: "audit_unavailable" });
    expect(f.calls()).toBe(0);
  });
});

// ── ambiguo bloquea re-egress ──────────────────────────────────────────────
describe("resultado ambiguo", () => {
  it.each(["timeout", "network", "server_error", "invalid_2xx"] as const)(
    "%s → reconciliation_required y bloquea el mismo clientMsgId",
    async (reason) => {
      const f = makePorts({ outcome: { kind: "ambiguous", reason, detail: "x" } });
      const r = await executeReply(INPUT, f.ports);
      expect(r).toMatchObject({ ok: false, code: "reconciliation_required", error: "meta_unavailable" });
      expect(f.calls()).toBe(1);
      const otra = await executeReply(INPUT, f.ports);
      expect(otra).toMatchObject({ code: "reconciliation_required" });
      expect(f.calls()).toBe(1);
    },
  );

  it("contract_unknown se reporta con su propio código estable", async () => {
    const f = makePorts({ outcome: { kind: "ambiguous", reason: "contract_unknown", detail: "x" } });
    const r = await executeReply(INPUT, f.ports);
    expect(r).toMatchObject({ code: "reconciliation_required", error: "contract_unknown" });
  });
});

// ── helpers ────────────────────────────────────────────────────────────────
describe("helpers puros", () => {
  it("isValidClientMsgId exige UUID", () => {
    expect(isValidClientMsgId(CID)).toBe(true);
    expect(isValidClientMsgId("reintento-1")).toBe(false);
    expect(isValidClientMsgId("")).toBe(false);
  });

  it("isValidWhatsappText normaliza antes de medir", () => {
    expect(isValidWhatsappText("  hola  ")).toBe(true);
    expect(isValidWhatsappText("   ")).toBe(false);
  });

  it("snapshotMatchesAttempt compara con normalización canónica", () => {
    const expected = { conversationId: CONV, actorId: OP, clientMsgId: CID, body: "hola" };
    expect(snapshotMatchesAttempt(snap({ body: "  hola  " }), expected)).toBe(true);
    expect(snapshotMatchesAttempt(snap({ body: "chau" }), expected)).toBe(false);
    expect(snapshotMatchesAttempt(snap({ body: null }), expected)).toBe(false);
  });

  it("counterpartPhoneFromContext", () => {
    expect(counterpartPhoneFromContext(`wa:${PHONE}`)).toBe(PHONE);
    expect(counterpartPhoneFromContext("CTX-2026-000001")).toBeNull();
  });
});

// ══ WA-8R8 · EL RECHAZO DE `stamp` YA NO ES UNA SIMULACIÓN ═════════════════
/**
 * Hasta WA-8R7, `stampOk: false` modelaba un fallo hipotético de infraestructura.
 * Con el CAS durable de WA-8R8 es el comportamiento REAL y esperado del camino:
 * tras `sealSent` la fila queda en `sent/server`, y el canon prohíbe
 * `sent → reconciliation_required`, así que `stamp` devuelve `false` sin escribir.
 *
 * El core no necesita convertir `sent` en `reconciliation_required`: la ausencia
 * del marcador `audit_sent` ya impide declarar éxito, y el reintento lo confirma.
 */
describe("WA-8R8 · auditoría fallida tras el sello", () => {
  it("stamp rechaza la transición y el intento queda fail-closed, sin segundo egress", async () => {
    const f = makePorts({ auditOk: (a) => a !== "reply_sent", stampOk: false });

    const primera = await executeReply(INPUT, f.ports);
    expect(primera).toMatchObject({
      ok: false,
      code: "reconciliation_required",
      error: "reconciliation_persist_failed",
    });

    // La fila durable conserva el estado del sello: NO se degradó.
    const durable = f.durable();
    expect(durable).toMatchObject({ status: "sent", wamid: "wamid.OK", auditedWamid: null });
    expect(durable.status).not.toBe("reconciliation_required");

    // Y el canon confirma por qué `stamp` no podía escribir.
    expect(canTransition("sent", "reconciliation_required")).toBe(false);

    // Reintentos con el MISMO clientMsgId: nunca éxito, nunca segundo transporte.
    for (let i = 0; i < 3; i++) {
      const reintento = await executeReply(INPUT, f.ports);
      expect(reintento).not.toMatchObject({ ok: true });
      expect(reintento).toMatchObject({ ok: false, code: "reconciliation_required" });
    }
    expect(f.calls()).toBe(1);
  });
});
