import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  executeWhatsappComposerSend,
  parseWhatsappComposerInput,
  toComposerResult,
  PENDING_MESSAGE,
  PENDING_RESULT,
  INVALID_INPUT_RESULT,
  type WhatsappActionPorts,
} from "./reply-action-core";
import type { ReplyCoreResult, ReplyErrorCode } from "./reply-core";

/**
 * LINK-WA WA-8 · Server Action del composer WhatsApp.
 *
 * Se ejercita el núcleo REAL con el puerto inyectado — sin red, sin DB, sin Meta
 * y sin Supabase. El envoltorio `"use server"` se verifica aparte, sobre el
 * fuente, porque su único trabajo es inyectar el adaptador productivo.
 */

const CONV = "22222222-3333-4444-8555-666666666666";
const MSG = "11111111-2222-4333-8444-555555555555";
const CID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const PHONE = "+5491100000001";
const WAMID = "wamid.HBgNNTQ5MTEwMDAwMDAwMRUCABIYFjNBMDA";
const TOKEN = "Bearer <token-sintetico-de-prueba>";
const TEXTO = "hola, soy el cliente y mi DNI es 30111222";

const VALID = { conversationId: CONV, text: "hola", clientMsgId: CID };

function ports(result: ReplyCoreResult = { ok: true, messageId: MSG, reused: false }) {
  const reply = vi.fn(async () => result);
  return { reply } as WhatsappActionPorts & { reply: typeof reply };
}

// ── 7 · entrada inválida ⇒ cero llamadas ───────────────────────────────────
describe("7 · input inválido produce CERO llamadas al core", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["cadena", "hola"],
    ["número", 42],
    ["arreglo", []],
    ["objeto vacío", {}],
    ["sin conversationId", { text: "hola", clientMsgId: CID }],
    ["sin text", { conversationId: CONV, clientMsgId: CID }],
    ["sin clientMsgId", { conversationId: CONV, text: "hola" }],
    ["clave de más", { ...VALID, mentions: [] }],
    ["clave desconocida", { ...VALID, attachmentIds: [] }],
    ["conversationId no UUID", { ...VALID, conversationId: "conv-1" }],
    ["conversationId teléfono", { ...VALID, conversationId: "5491100000001" }],
    ["clientMsgId no UUID", { ...VALID, clientMsgId: "reintento-1" }],
    ["clientMsgId token", { ...VALID, clientMsgId: TOKEN }],
    ["text vacío", { ...VALID, text: "" }],
    ["text sólo espacios", { ...VALID, text: "    " }],
    ["text no string", { ...VALID, text: 7 }],
    ["conversationId no string", { ...VALID, conversationId: 7 }],
    ["text objeto", { ...VALID, text: { body: "hola" } }],
  ])("%s → cero llamadas y rechazo", async (_l, raw) => {
    const p = ports();
    const out = await executeWhatsappComposerSend(raw, p);

    expect(p.reply).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, state: "rejected", message: "El mensaje no es válido." });
  });

  it("una entrada válida sí parsea y se normaliza", () => {
    expect(parseWhatsappComposerInput({ ...VALID, text: "  hola  " })).toEqual({
      conversationId: CONV,
      text: "hola",
      clientMsgId: CID,
    });
  });

  it("el clientMsgId se normaliza a minúsculas, como en el core", () => {
    const parsed = parseWhatsappComposerInput({ ...VALID, clientMsgId: CID.toUpperCase() });
    expect(parsed?.clientMsgId).toBe(CID);
  });
});

// ── 8 · éxito ──────────────────────────────────────────────────────────────
describe("8 · éxito devuelve un resultado seguro", () => {
  it("sólo ok y messageId; nunca el wamid", async () => {
    const p = ports({ ok: true, messageId: MSG, reused: false });
    const out = await executeWhatsappComposerSend(VALID, p);

    expect(out).toEqual({ ok: true, messageId: MSG });
    expect(Object.keys(out).sort()).toEqual(["messageId", "ok"]);
  });

  it("un intento reutilizado no expone `reused` a la UI", async () => {
    const p = ports({ ok: true, messageId: MSG, reused: true });
    const out = await executeWhatsappComposerSend(VALID, p);
    expect(out).toEqual({ ok: true, messageId: MSG });
  });
});

// ── 9-10 · resultados ambiguos ─────────────────────────────────────────────
describe("9-10 · reconciliation_required e in_flight devuelven espera", () => {
  it.each(["reconciliation_required", "in_flight"] as ReplyErrorCode[])(
    "%s → pending con el texto exacto del mandato",
    async (code) => {
      const p = ports({ ok: false, code, error: "audit_reconciliation", messageId: MSG });
      const out = await executeWhatsappComposerSend(VALID, p);

      expect(out).toEqual({
        ok: false,
        state: "pending",
        message: "Envío pendiente de confirmación. No lo reintentes.",
      });
      expect(out).not.toMatchObject({ state: "rejected" });
    },
  );

  it("el texto de espera desaconseja explícitamente reintentar", () => {
    expect(PENDING_MESSAGE).toBe("Envío pendiente de confirmación. No lo reintentes.");
    expect(PENDING_MESSAGE.toLowerCase()).toContain("no lo reintentes");
  });
});

// ── 11-12 · nada de detalles internos ──────────────────────────────────────
describe("11-12 · el rechazo no filtra detalles internos", () => {
  const CODES: ReplyErrorCode[] = [
    "invalid_input", "no_session", "not_operator", "not_tenant_member", "no_thread",
    "no_counterpart", "rbac_denied", "attempt_binding_mismatch", "attempt_not_verifiable",
    "attempt_closed", "audit_failed", "sandbox_denied", "state_unavailable", "send_failed",
    "reconciliation_required", "in_flight",
  ];

  it.each(CODES)("%s devuelve un mensaje estable y no el código crudo", async (code) => {
    const p = ports({ ok: false, code, error: "meta_rejected", messageId: MSG });
    const out = await executeWhatsappComposerSend(VALID, p);

    expect(out.ok).toBe(false);
    const dump = JSON.stringify(out);
    // Ni el código interno, ni el mensaje interno del core, viajan a la UI.
    expect(dump).not.toContain(code);
    expect(dump).not.toContain("meta_rejected");
    expect(dump.length).toBeGreaterThan(0);
  });

  /**
   * MUTANTE central del mandato: aunque el core devolviera —por un defecto
   * futuro— campos con PII o secretos, la traducción no los reenvía.
   */
  it("ninguna respuesta contiene wamid, teléfono, body, token, payload ni stack", async () => {
    const contaminado = {
      ok: false,
      code: "send_failed",
      error: "meta_rejected",
      messageId: MSG,
      // Campos que NO existen en el contrato pero que un defecto podría agregar.
      wamid: WAMID,
      phone: PHONE,
      body: TEXTO,
      token: TOKEN,
      detail: "secreto-del-proveedor",
      payload: { messages: [{ id: WAMID, text: TEXTO }] },
      stack: "Error: boom\n    at reply (/app/src/lib/whatsapp/reply.ts:42:1)",
    } as unknown as ReplyCoreResult;

    const p = ports(contaminado);
    const out = await executeWhatsappComposerSend(VALID, p);
    const dump = JSON.stringify(out);

    for (const marca of [WAMID, PHONE, TEXTO, TOKEN, "secreto-del-proveedor", "at reply", "30111222"]) {
      expect(dump).not.toContain(marca);
    }
    expect(Object.keys(out).sort()).toEqual(["message", "ok", "state"]);
  });

  it("un éxito contaminado tampoco filtra nada", async () => {
    const p = ports({
      ok: true, messageId: MSG, reused: false, wamid: WAMID, phone: PHONE,
    } as unknown as ReplyCoreResult);
    const out = await executeWhatsappComposerSend(VALID, p);
    const dump = JSON.stringify(out);
    expect(dump).not.toContain(WAMID);
    expect(dump).not.toContain(PHONE);
  });

  it("un código desconocido cae al genérico, nunca al valor crudo", () => {
    const out = toComposerResult({
      ok: false, code: "codigo_nuevo" as ReplyErrorCode, error: "x" as never,
    });
    expect(out).toEqual({ ok: false, state: "rejected", message: "No se pudo enviar el mensaje." });
  });
});

// ── 13 · exactamente una llamada ───────────────────────────────────────────
describe("13 · replyToWhatsappThread se llama exactamente una vez", () => {
  it("una sola llamada, con la entrada normalizada", async () => {
    const p = ports();
    await executeWhatsappComposerSend({ ...VALID, text: "  hola  " }, p);

    expect(p.reply).toHaveBeenCalledTimes(1);
    expect(p.reply).toHaveBeenCalledWith({
      conversationId: CONV,
      text: "hola",
      clientMsgId: CID,
    });
  });

  it.each([
    ["éxito", { ok: true, messageId: MSG, reused: false }],
    ["pendiente", { ok: false, code: "in_flight", error: "in_flight" }],
    ["rechazo", { ok: false, code: "send_failed", error: "meta_rejected" }],
  ] as Array<[string, ReplyCoreResult]>)(
    "%s: sigue siendo UNA sola llamada, sin reintento",
    async (_l, result) => {
      const p = ports(result);
      await executeWhatsappComposerSend(VALID, p);
      expect(p.reply).toHaveBeenCalledTimes(1);
    },
  );
});

// ── WA-8R1 · §6 · excepción del puerto ⇒ pending fail-closed ───────────────
/**
 * Si el core arroja no se sabe hasta dónde llegó el intento: pudo no haber
 * salido, o pudo haberse sellado el wamid y haberse perdido la respuesta.
 * Declararlo `failed` afirmaría lo primero sin evidencia y el operador
 * reintentaría un mensaje que el contacto quizá ya recibió.
 */
describe("12 · una excepción del core devuelve `pending`, nunca `failed`", () => {
  const EXCEPCIONES: Array<[string, unknown]> = [
    ["Error común", new Error("connection reset")],
    ["TypeError", new TypeError("fetch failed")],
    ["error con stack", Object.assign(new Error("boom"), {
      stack: "Error: boom\n    at reply (/app/src/lib/whatsapp/reply.ts:42:1)",
    })],
    ["error con datos adjuntos", Object.assign(new Error("meta"), {
      wamid: WAMID, phone: PHONE, body: TEXTO, token: TOKEN,
    })],
    ["string suelto", "insufficient_privilege"],
    ["objeto plano", { detail: "secreto-del-proveedor", status: 500 }],
    ["null", null],
    ["undefined", undefined],
    ["número", 500],
  ];

  it.each(EXCEPCIONES)("%s ⇒ pending con el texto exacto", async (_l, causa) => {
    const reply = vi.fn(async () => {
      throw causa;
    });
    const out = await executeWhatsappComposerSend(VALID, { reply });

    expect(out).toEqual({
      ok: false,
      state: "pending",
      message: "Envío pendiente de confirmación. No lo reintentes.",
    });
    expect(out).not.toMatchObject({ state: "rejected" });
  });

  /** 15 · la excepción no filtra NADA: ni mensaje, ni stack, ni campos adjuntos. */
  it("no filtra error, stack, texto, teléfono, wamid ni detalle interno", async () => {
    const reply = vi.fn(async () => {
      throw Object.assign(new Error("connection reset a " + PHONE), {
        stack: "Error\n    at reply (/app/src/lib/whatsapp/reply.ts:42:1)",
        wamid: WAMID, body: TEXTO, token: TOKEN, detail: "secreto-del-proveedor",
      });
    });
    const out = await executeWhatsappComposerSend(VALID, { reply });
    const dump = JSON.stringify(out);

    for (const marca of [
      WAMID, PHONE, TEXTO, TOKEN, "secreto-del-proveedor",
      "connection reset", "at reply", "/app/src", "30111222",
    ]) {
      expect(dump).not.toContain(marca);
    }
    expect(Object.keys(out).sort()).toEqual(["message", "ok", "state"]);
  });

  /** 14 · ni siquiera ante excepción hay un segundo intento. */
  it("la llamada al puerto sigue siendo exactamente una", async () => {
    const reply = vi.fn(async () => {
      throw new Error("boom");
    });
    await executeWhatsappComposerSend(VALID, { reply });
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("nunca propaga la excepción: siempre resuelve", async () => {
    const reply = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(executeWhatsappComposerSend(VALID, { reply })).resolves.toBeDefined();
  });

  it("una entrada inválida sigue sin llamar al puerto, aunque éste arrojaría", async () => {
    const reply = vi.fn(async () => {
      throw new Error("no debería llegar acá");
    });
    const out = await executeWhatsappComposerSend({ ...VALID, clientMsgId: "x" }, { reply });
    expect(reply).not.toHaveBeenCalled();
    expect(out).toEqual(INVALID_INPUT_RESULT);
  });

  it("la excepción produce el MISMO resultado que `reconciliation_required`", async () => {
    const porExcepcion = await executeWhatsappComposerSend(VALID, {
      reply: async () => {
        throw new Error("boom");
      },
    });
    const porReconciliacion = await executeWhatsappComposerSend(VALID, {
      reply: async () => ({
        ok: false as const,
        code: "reconciliation_required" as ReplyErrorCode,
        error: "audit_reconciliation" as never,
      }),
    });
    expect(porExcepcion).toEqual(porReconciliacion);
    expect(porExcepcion).toEqual(PENDING_RESULT);
  });
});

// ── envoltorio "use server" ────────────────────────────────────────────────
describe("la Server Action es un envoltorio delgado", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/whatsapp/reply-action.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("declara `use server` en la primera línea útil", () => {
    expect(src.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("delega en el núcleo y no reimplementa la decisión", () => {
    expect(code).toMatch(/executeWhatsappComposerSend\(/);
    expect(code).toMatch(/reply:\s*replyToWhatsappThread/);
    // Nada de autorización, sandbox, claim, auditoría, sello ni transporte duplicados.
    for (const prohibido of [
      "isOperatorAuthorized", "checkOutboundAllowed", "createAdminClient",
      "createMetaHttpTransport", "connect_post_message", "audit_log", "process.env",
    ]) {
      expect(code).not.toContain(prohibido);
    }
  });

  it("no expone un route handler ni un endpoint público", () => {
    expect(code).not.toMatch(/export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\b/);
  });

  it("exporta exactamente una función", () => {
    const exports = code.match(/export\s+async\s+function\s+(\w+)/g) ?? [];
    expect(exports).toHaveLength(1);
    expect(exports[0]).toContain("sendWhatsappTextAction");
  });
});
