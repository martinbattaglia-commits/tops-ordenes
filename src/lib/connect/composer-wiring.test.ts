import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { applyRealtimeEvent, type RealtimeEvent } from "./realtime-merge";
import {
  reduceMessageState,
  projectWaMessage,
  projectionFromActionOutcome,
  bubbleStatusFromProjection,
  isAuditedConfirmation,
  hydrateMessageState,
  type BubbleStatus,
} from "./realtime-status";
import type { WaProjection } from "./types";
import { dispatchComposerSend, type ComposerDispatchPorts } from "./composer-dispatch";

/**
 * LINK-WA WA-8 · Cableado del composer.
 *
 * El repositorio corre vitest en `environment: "node"` y no tiene jsdom ni
 * testing-library instalados; `package.json` está fuera de alcance en esta
 * sesión. Por eso las garantías del composer se prueban de dos formas
 * complementarias, y ninguna de las dos es un test de render:
 *
 *  · ESTRUCTURALMENTE sobre el fuente de `ThreadView.tsx`, para lo que es
 *    cableado (qué llama, qué guarda ejecuta, qué NO reintenta);
 *  · FUNCIONALMENTE sobre los módulos puros que el componente delega, que es
 *    donde vive toda la decisión.
 *
 * La consecuencia de diseño es deliberada: `ThreadView` no decide nada por su
 * cuenta, así que probar los módulos puros SÍ prueba el comportamiento.
 */

const THREADVIEW = resolve(
  process.cwd(),
  "src/app/(app)/connect/_components/ThreadView.tsx",
);

/** Fuente sin comentarios: la prohibición es sobre el código, no sobre la prosa. */
const code = readFileSync(THREADVIEW, "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Cuerpo de una función, por balance de llaves desde su declaración.
 *
 * Se hace así y no con `indexOf` de un marcador de fin porque acotar “hasta el
 * próximo X” es frágil: si X aparece antes, el corte queda vacío y el test pasa
 * a verificar la cadena vacía — es decir, deja de probar. Un cuerpo vacío acá
 * es un error del test, y se afirma explícitamente.
 */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`declaración no encontrada: ${declaration}`);
  const open = source.indexOf("{", start);
  if (open < 0) throw new Error(`sin cuerpo: ${declaration}`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`llaves desbalanceadas: ${declaration}`);
}

const SEND_BODY = functionBody(code, "async function send()");
const SEND_AUDIO_BODY = functionBody(code, "async function sendAudio()");

describe("el extractor de cuerpos realmente extrae algo", () => {
  it("los dos cuerpos analizados son no triviales", () => {
    expect(SEND_BODY.length).toBeGreaterThan(200);
    expect(SEND_AUDIO_BODY.length).toBeGreaterThan(200);
    expect(SEND_BODY).toContain("dispatchComposerSend");
    expect(SEND_AUDIO_BODY).toContain("prepareAudioUploadAction");
  });
});

// ── 14 · el composer WhatsApp usa el dispatcher por kind ───────────────────
describe("14 · el composer despacha por kind", () => {
  it("`kind` es una prop requerida de ThreadView", () => {
    expect(code).toMatch(/kind:\s*ConversationKind;/);
    expect(code).toMatch(/\bkind,\s*$/m);
  });

  it("`send` llama al dispatcher y le pasa el kind", () => {
    expect(code).toMatch(/dispatchComposerSend\(\s*\{\s*kind,/);
  });

  it("no elige camino por su cuenta: sin condicionales sobre kind en el componente", () => {
    // El único uso admitido de `kind` en la lógica es pasarlo al dispatcher y a
    // las capacidades. Una comparación literal acá sería una segunda decisión.
    expect(code).not.toMatch(/kind\s*===\s*["']whatsapp["']/);
    expect(code).not.toMatch(/kind\s*!==\s*["']whatsapp["']/);
  });

  it("no infiere WhatsApp por título, teléfono, URL ni contenido", () => {
    for (const heuristica of [/wa\.me/, /\+\d{8,}/, /body\.includes\(/, /title\.includes\(/]) {
      expect(code).not.toMatch(heuristica);
    }
  });

  it("ambas acciones se inyectan al dispatcher, no se llaman sueltas", () => {
    expect(code).toMatch(/postConnectMessage:\s*\(i\)\s*=>\s*postMessageAction\(i\)/);
    expect(code).toMatch(/sendWhatsappText:\s*\(i\)\s*=>\s*sendWhatsappTextAction\(i\)/);
    // Una sola aparición de cada acción en el cuerpo: la del cableado.
    expect(code.match(/postMessageAction\(/g) ?? []).toHaveLength(1);
    expect(code.match(/sendWhatsappTextAction\(/g) ?? []).toHaveLength(1);
  });
});

// ── 15 · una sola burbuja optimista ────────────────────────────────────────
describe("15 · una sola burbuja optimista por envío", () => {
  it("un único clientMsgId y un único append antes de despachar", () => {
    expect(code.match(/crypto\.randomUUID\(\)/g) ?? []).toHaveLength(2); // texto + audio
    expect(SEND_BODY.match(/crypto\.randomUUID\(\)/g) ?? []).toHaveLength(1);
    expect(SEND_BODY.match(/\[\.\.\.prev,\s*optimistic\]/g) ?? []).toHaveLength(1);
  });

  it("la burbuja se agrega ANTES de despachar, y una sola vez", () => {
    expect(SEND_BODY.indexOf("[...prev, optimistic]")).toBeLessThan(
      SEND_BODY.indexOf("dispatchComposerSend("),
    );
    expect(SEND_BODY.match(/dispatchComposerSend\(/g) ?? []).toHaveLength(1);
  });
});

// ── WA-8R1 · el builder no puede forzar el estado ──────────────────────────
/**
 * Región entre dos marcadores, con la garantía de que no queda vacía.
 * Se acota al HANDLER realtime a propósito: `status: undefined` sigue siendo
 * correcto en la rama donde la acción CONFIRMA el envío — ahí sí hay evidencia.
 * Lo que no puede existir es un `undefined` forzado por la mera llegada de un evento.
 */
function regionBetween(source: string, start: string, end: string): string {
  const i = source.indexOf(start);
  if (i < 0) throw new Error(`marcador inicial no encontrado: ${start}`);
  const j = source.indexOf(end, i);
  if (j < 0) throw new Error(`marcador final no encontrado: ${end}`);
  const region = source.slice(i, j);
  if (region.trim().length === 0) throw new Error("región vacía");
  return region;
}

const REALTIME_HANDLER = regionBetween(code, "useRealtimeTable(", "{ filter:");

describe("el builder realtime de ThreadView no fuerza `status: undefined`", () => {
  it("la región analizada es realmente el handler realtime", () => {
    expect(REALTIME_HANDLER.length).toBeGreaterThan(300);
    expect(REALTIME_HANDLER).toContain("applyRealtimeEvent");
    expect(REALTIME_HANDLER).toContain("build:");
  });

  it("delega la reconciliación del estado en el reducer puro", () => {
    expect(REALTIME_HANDLER).not.toMatch(/status:\s*undefined/);
    expect(REALTIME_HANDLER).toMatch(/reduceMessageState\(\{/);
    expect(REALTIME_HANDLER).toMatch(/projectWaMessage\(\{/);
    expect(REALTIME_HANDLER).toMatch(/source:\s*"realtime"/);
    // Y le pasa los tres insumos: kind, estado local previo y meta crudo.
    expect(REALTIME_HANDLER).toMatch(/kind,/);
    expect(REALTIME_HANDLER).toMatch(/wa:\s*existing\?\.wa/);
    expect(REALTIME_HANDLER).toMatch(/meta:\s*row\.meta/);
    expect(REALTIME_HANDLER).toMatch(/externalMsgId:\s*row\.external_msg_id/);
  });

  it("`send` aplica el MISMO reducer, dentro del update funcional", () => {
    expect(SEND_BODY).toMatch(/setMessages\(\(prev\) =>/);
    const upd = SEND_BODY.indexOf("setMessages((prev) =>");
    expect(SEND_BODY.indexOf("reduceMessageState({")).toBeGreaterThan(upd);
    expect(SEND_BODY).toMatch(/source:\s*"action"/);
    // Y NO decide el estado por su cuenta.
    expect(SEND_BODY).not.toMatch(/status:\s*undefined/);
    expect(SEND_BODY).not.toMatch(/bubbleStatusFor\(/);
  });

  it("la UI nunca conserva `meta` crudo ni el wamid", () => {
    // Ambos se usan SÓLO como argumento del reducer, y una sola vez.
    expect(code.match(/row\.meta/g) ?? []).toHaveLength(1);
    expect(code.match(/row\.external_msg_id/g) ?? []).toHaveLength(1);
    expect(code).not.toMatch(/\bmeta\s*[:=]\s*row\.meta\s*(as|\))/);
    // `UiMessage` no declara campos crudos del proveedor.
    const uiStart = code.indexOf("interface UiMessage");
    expect(uiStart).toBeGreaterThan(-1);
    // Hasta la llave de cierre: acotar con un comentario no sirve porque el
    // stripper ya los eliminó y el slice se comería medio archivo.
    const ui = code.slice(uiStart, code.indexOf("}", uiStart) + 1);
    expect(ui.length).toBeLessThan(400);
    for (const prohibido of ["meta", "wamid", "external_msg_id", "phone", "token"]) {
      expect(ui).not.toContain(prohibido);
    }
    expect(ui).toContain("wa?: WaProjection");
  });
});

// ── WA-8R1 · try/finally: `sending` siempre vuelve a false ─────────────────
describe("13 · `sending` siempre vuelve a false", () => {
  it("el envío usa try/finally alrededor del despacho", () => {
    expect(SEND_BODY).toMatch(/try\s*\{/);
    expect(SEND_BODY).toMatch(/\}\s*finally\s*\{/);
    const finallyIdx = SEND_BODY.indexOf("finally");
    expect(SEND_BODY.indexOf("setSending(false)")).toBeGreaterThan(finallyIdx);
  });

  it("`setSending(false)` aparece una sola vez, y dentro del finally", () => {
    expect(SEND_BODY.match(/setSending\(false\)/g) ?? []).toHaveLength(1);
    expect(SEND_BODY.match(/setSending\(true\)/g) ?? []).toHaveLength(1);
    expect(SEND_BODY.indexOf("setSending(true)")).toBeLessThan(SEND_BODY.indexOf("try {"));
  });
});

// ── 17 · pendiente ≠ fallo definitivo ──────────────────────────────────────
describe("17 · pendiente no se pinta como fallo", () => {
  it("el estado de la burbuja sale del reducer puro, no de un ternario local", () => {
    expect(SEND_BODY).toMatch(/\.\.\.reduced,/);
    expect(SEND_BODY).toMatch(/reduceMessageState\(\{/);
  });

  it("la UI distingue los tres estados", () => {
    expect(code).toMatch(/m\.status === "sending"/);
    expect(code).toMatch(/m\.status === "pending"/);
    expect(code).toMatch(/m\.status === "failed"/);
  });

  it("un outcome pendiente produce `pending`, nunca `failed`", async () => {
    const ports = {
      postConnectMessage: async () => ({ ok: true as const, messageId: "m", seq: 1 }),
      sendWhatsappText: async () => ({
        ok: false as const, state: "pending" as const, message: "Envío pendiente de confirmación. No lo reintentes.",
      }),
    } satisfies ComposerDispatchPorts;

    const outcome = await dispatchComposerSend(
      { kind: "whatsapp", conversationId: "c", body: "hola", clientMsgId: "x" },
      ports,
    );
    const wa = projectionFromActionOutcome(outcome);
    expect(bubbleStatusFromProjection(wa)).toBe("pending");
    expect(bubbleStatusFromProjection(wa)).not.toBe("failed");
  });
});

// ── 18 · cero reintentos automáticos ───────────────────────────────────────
describe("18 · el composer no reintenta automáticamente", () => {
  it("no hay bucles, temporizadores ni reintentos en el envío", () => {
    for (const patron of [
      /setTimeout\(/, /setInterval\(/, /requestIdleCallback\(/,
      /\bwhile\s*\(/, /\bfor\s*\(/, /retry/i, /reintent/i,
    ]) {
      expect(SEND_BODY).not.toMatch(patron);
    }
  });

  it("no existe un botón de reintento sobre un envío pendiente", () => {
    expect(code).not.toMatch(/Reintentar/i);
  });
});

// ── 19-20-22 · las guardas de LÓGICA existen, no sólo CSS ──────────────────
describe("19-20-22 · guardas de lógica en el componente", () => {
  it("`sendAudio` corta por capacidad antes de cualquier acción de audio", () => {
    const audioBody = SEND_AUDIO_BODY;
    expect(audioBody).toMatch(/if\s*\(!caps\.canSendAudio\)\s*return;/);
    // Y esa guarda está ANTES de las tres acciones que el mandato nombra.
    const guarda = audioBody.indexOf("caps.canSendAudio");
    for (const accion of ["prepareAudioUploadAction", "uploadToSignedUrl", "finalizeAudioMessageAction"]) {
      expect(audioBody.indexOf(accion)).toBeGreaterThan(guarda);
    }
  });

  it("`send` corta por capacidad y no manda menciones sin permiso", () => {
    // CLOSEOUT · §4.F · la salida temprana además SUELTA el cerrojo síncrono
    // contra el doble envío; si no lo hiciera, el composer quedaría trabado
    // para siempre tras un intento con capacidad denegada.
    expect(SEND_BODY).toMatch(
      /if\s*\(!caps\.canSendText\)\s*\{\s*\n\s*enviando\.current = false;\s*\n\s*return;\s*\n\s*\}/,
    );
    expect(SEND_BODY).toMatch(/caps\.canMention\s*\?\s*resolveMentions\(/);
  });

  it("readOnly sigue bloqueando el envío", () => {
    expect(SEND_BODY).toMatch(/readOnly/);
    expect(code).toMatch(/composerCapabilities\(kind,\s*\{\s*readOnly\s*\}\)/);
  });

  it("el autocomplete de menciones también depende de la capacidad", () => {
    expect(code).toMatch(/if\s*\(!caps\.canMention\s*\|\|\s*mentionables\.length === 0\)/);
    expect(code).toMatch(/if\s*\(!caps\.canMention\)\s*return \[\];/);
  });
});

// ── WA-8R3 · CONVERGENCIA, HIDRATACIÓN E INBOUND SOBRE LA LISTA ───────────
/**
 * Simula el pipeline REAL de `ThreadView`: hidratación server-side, burbuja
 * optimista, eventos realtime aplicados con `applyRealtimeEvent` + el builder, y
 * la resolución de la acción dentro del update funcional.
 */
describe("WA-8R3 · pipeline completo del hilo", () => {
  type Msg = {
    id: string; conversationId: string; seq: number;
    clientMsgId?: string; status?: BubbleStatus; wa?: WaProjection;
    sendError?: string; body?: string;
  };

  const CONV = "22222222-3333-4444-8555-666666666666";
  const MSG = "11111111-2222-4333-8444-555555555555";
  const CID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  const OTRO_CID = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
  const WAMID = "wamid.OUT1";
  const AT = "2026-08-10T12:00:00.000Z";
  const AT_LATER = "2026-08-10T12:05:00.000Z";
  const PENDING_MSG = "Envío pendiente de confirmación. No lo reintentes.";

  const optimista = (clientMsgId = CID): Msg => ({
    id: `tmp-${clientMsgId}`, conversationId: CONV, seq: Number.MAX_SAFE_INTEGER,
    clientMsgId, status: "sending", body: "hola",
  });

  /** Espejo del builder realtime de ThreadView. */
  const makeBuild =
    (kind: string) =>
    (row: Record<string, unknown>, existing: Msg | null): Msg => {
      const reduced = reduceMessageState({
        kind, source: "realtime",
        current: { wa: existing?.wa, status: existing?.status },
        incoming: projectWaMessage({ meta: row.meta, externalMsgId: row.external_msg_id }),
      });
      return {
        id: row.id as string,
        conversationId: (row.conversation_id as string) ?? existing?.conversationId ?? CONV,
        seq: row.seq != null ? Number(row.seq) : (existing?.seq as number),
        clientMsgId: (row.client_msg_id as string) ?? existing?.clientMsgId,
        body: (row.body as string) ?? existing?.body,
        ...reduced,
        sendError: isAuditedConfirmation(reduced.wa) ? undefined : existing?.sendError,
      };
    };

  const buildWa = makeBuild("whatsapp");
  const buildConnect = makeBuild("dm");

  const evento = (type: string, row: Record<string, unknown>): RealtimeEvent =>
    ({ eventType: type, new: row }) as RealtimeEvent;

  const row = (extra: Record<string, unknown> = {}) => ({
    id: MSG, conversation_id: CONV, seq: 12, client_msg_id: CID, ...extra,
  });
  /**
   * WA-8R7 · las filas declaran su procedencia. `sent`/`delivered`/`read` son
   * hechos observados por Meta; `sending`/`queued`/`reconciliation_required` los
   * escribe el servidor. `failed` puede venir de cualquiera de los dos.
   */
  const fuenteDe = (status: string) =>
    ["delivered", "read"].includes(status) ? "meta"
      : ["queued", "sending", "reconciliation_required"].includes(status) ? "server"
        : "meta";
  const OUT = (status: string, at = AT, audit = true, source = fuenteDe(status)) => ({
    meta: {
      wa: {
        direction: "outbound", status, status_at: at, status_source: source,
        ...(audit ? { audit_sent: { wamid: WAMID, at: AT } } : {}),
      },
    },
    external_msg_id: WAMID,
  });
  const IN = () => ({ meta: { wa: { direction: "inbound" } }, external_msg_id: "wamid.IN1" });

  /** Espejo de la resolución de la acción en `send()`. */
  const aplicarAccion = (
    msgs: readonly Msg[],
    clientMsgId: string,
    outcome: { status: "sent" | "pending" | "failed"; message?: string; messageId?: string },
    kind = "whatsapp",
  ): Msg[] =>
    msgs.map((m) => {
      if (m.clientMsgId !== clientMsgId) return m;
      const reduced = reduceMessageState({
        kind, source: "action",
        current: { wa: m.wa, status: m.status },
        incoming: projectionFromActionOutcome(outcome),
      });
      const confirmed =
        kind === "whatsapp" ? isAuditedConfirmation(reduced.wa) : reduced.status === undefined;
      return {
        ...m,
        id: outcome.status === "sent" ? (outcome.messageId ?? m.id) : m.id,
        ...reduced,
        sendError: confirmed ? undefined : outcome.status === "sent" ? m.sendError : outcome.message,
      };
    });

  const realtime = (msgs: readonly Msg[], ev: RealtimeEvent, build = buildWa): Msg[] =>
    applyRealtimeEvent<Msg>(msgs, ev, { conversationId: CONV, build }) as Msg[];

  // ── 1-3 · transiciones canónicas sobre la burbuja ───────────────────────
  it("1 · sent auditado y luego failed termina visualmente en failed", () => {
    let msgs: Msg[] = [optimista()];
    msgs = realtime(msgs, evento("UPDATE", row(OUT("sent", AT))));
    expect(msgs[0].status).toBeUndefined();
    msgs = realtime(msgs, evento("UPDATE", row(OUT("failed", AT_LATER, false))));

    expect(msgs).toHaveLength(1);
    expect(msgs[0].status).toBe("failed");
  });

  it.each(["delivered", "read"])("2-3 · %s y luego failed conserva el estado", (status) => {
    let msgs: Msg[] = [optimista()];
    msgs = realtime(msgs, evento("UPDATE", row(OUT(status, AT))));
    msgs = realtime(msgs, evento("UPDATE", row(OUT("failed", AT_LATER, false))));

    expect(msgs[0].status).toBeUndefined();
    expect(msgs[0].wa?.providerState).toBe(status);
  });

  it("6 · failed no puede volverse reconciliation_required", () => {
    let msgs: Msg[] = [optimista()];
    msgs = realtime(msgs, evento("UPDATE", row(OUT("failed", AT, false))));
    msgs = realtime(msgs, evento("UPDATE", row(OUT("reconciliation_required", AT_LATER, false))));
    expect(msgs[0].wa?.providerState).toBe("failed");
    expect(msgs[0].status).toBe("failed");
  });

  // ── 7 · convergencia ────────────────────────────────────────────────────
  it("7 · las seis permutaciones dan una burbuja y un solo estado", () => {
    type Paso = "accion" | "insert" | "update";
    const permutaciones: Paso[][] = [
      ["accion", "insert", "update"], ["accion", "update", "insert"],
      ["insert", "accion", "update"], ["insert", "update", "accion"],
      ["update", "accion", "insert"], ["update", "insert", "accion"],
    ];
    const finales = new Set<string>();
    for (const orden of permutaciones) {
      let msgs: Msg[] = [optimista()];
      for (const paso of orden) {
        if (paso === "accion") msgs = aplicarAccion(msgs, CID, { status: "pending", message: PENDING_MSG });
        if (paso === "insert") msgs = realtime(msgs, evento("INSERT", row(OUT("sending", AT, false))));
        if (paso === "update") msgs = realtime(msgs, evento("UPDATE", row(OUT("delivered", AT_LATER))));
      }
      expect(msgs).toHaveLength(1);
      finales.add(`${msgs[0].wa?.providerState}|${msgs[0].status}|${msgs[0].sendError}`);
    }
    expect(finales.size).toBe(1);
    expect([...finales]).toEqual(["delivered|undefined|undefined"]);
  });

  it("una acción tardía no degrada una confirmación auditada", () => {
    let msgs: Msg[] = [optimista()];
    msgs = realtime(msgs, evento("UPDATE", row(OUT("delivered", AT))));
    msgs = aplicarAccion(msgs, CID, { status: "pending", message: PENDING_MSG });
    expect(msgs[0].status).toBeUndefined();
    expect(msgs[0].sendError).toBeUndefined();
  });

  // ── 8-11, 15 · hidratación ──────────────────────────────────────────────
  describe("hidratación server-side", () => {
    const hidratar = (rows: Array<Record<string, unknown>>, kind = "whatsapp"): Msg[] =>
      rows.map((r) => ({
        id: r.id as string, conversationId: CONV, seq: r.seq as number,
        clientMsgId: r.client_msg_id as string | undefined,
        // El servidor ya adjuntó la proyección; el cliente sólo deriva el estado.
        ...hydrateMessageState(kind, projectWaMessage({
          meta: r.meta, externalMsgId: r.external_msg_id,
        })),
      }));

    it("8 · un outbound failed reaparece failed", () => {
      expect(hidratar([row(OUT("failed", AT, false))])[0].status).toBe("failed");
    });

    it("9 · un outbound en reconciliation_required reaparece bloqueado", () => {
      expect(hidratar([row(OUT("reconciliation_required", AT, false))])[0].status).toBe("pending");
    });

    it.each([
      ["sin meta", {}],
      ["delivered sin auditoría", OUT("delivered", AT, false)],
      ["sin dirección", { meta: { wa: { status: "delivered" } }, external_msg_id: WAMID }],
    ])("10 · %s NO reaparece confirmado", (_l, extra) => {
      const m = hidratar([row(extra)])[0];
      expect(m.status).not.toBeUndefined();
      expect(isAuditedConfirmation(m.wa)).toBe(false);
    });

    it("11 · con marcador auditado válido reaparece confirmado", () => {
      const m = hidratar([row(OUT("delivered", AT))])[0];
      expect(m.status).toBeUndefined();
      expect(isAuditedConfirmation(m.wa)).toBe(true);
    });

    it("15 · rehidratar (cambio de conversación) da el mismo resultado", () => {
      const rows = [row(OUT("failed", AT, false)), row({ ...OUT("delivered", AT), id: "otro" })];
      expect(hidratar(rows)).toEqual(hidratar(rows));
    });

    it("12 · el mensaje hidratado no lleva meta ni wamid", () => {
      const dump = JSON.stringify(hidratar([row(OUT("delivered", AT))]));
      // `"meta"` a secas ya no sirve como marca: `stateSource` puede valer
      // legítimamente "meta". Se busca la CLAVE cruda, que es lo prohibido.
      for (const marca of [WAMID, "audit_sent", "external_msg_id", '"meta":', "status_at"]) {
        expect(dump).not.toContain(marca);
      }
      // Y la procedencia sí viaja: es una etiqueta cerrada, sin PII.
      expect(dump).toContain('"stateSource"');
    });

    it("17 · Connect hidrata sin proyección y sin marca", () => {
      const m = hidratar([row(OUT("delivered", AT))], "dm")[0];
      expect(m.wa).toBeUndefined();
      expect(m.status).toBeUndefined();
    });
  });

  // ── 13-14 · inbound ─────────────────────────────────────────────────────
  describe("aislamiento inbound", () => {
    it("13 · un INSERT inbound nunca muestra `sending`", () => {
      const msgs = realtime([], evento("INSERT", { ...row({ client_msg_id: null }), ...IN() }));
      expect(msgs).toHaveLength(1);
      expect(msgs[0].status).toBeUndefined();
      expect(msgs[0].wa?.direction).toBe("inbound");
    });

    it("14 · INSERT/UPDATE duplicados inbound dejan una sola burbuja", () => {
      let msgs: Msg[] = [];
      for (const t of ["INSERT", "UPDATE", "UPDATE", "INSERT"]) {
        msgs = realtime(msgs, evento(t, { ...row({ client_msg_id: null }), ...IN() }));
      }
      expect(msgs).toHaveLength(1);
      expect(msgs[0].status).toBeUndefined();
    });

    it("un inbound nunca adquiere estado de egress aunque llegue un UPDATE outbound", () => {
      let msgs: Msg[] = realtime([], evento("INSERT", { ...row({ client_msg_id: null }), ...IN() }));
      msgs = realtime(msgs, evento("UPDATE", row(OUT("delivered", AT_LATER))));
      expect(msgs[0].wa?.direction).toBe("inbound");
      expect(msgs[0].wa?.providerState).toBeNull();
      expect(msgs[0].status).toBeUndefined();
    });
  });

  // ── 16-18 · optimista, Connect y errores ────────────────────────────────
  it("16 · el optimista WhatsApp conserva su comportamiento", () => {
    const msgs = [optimista()];
    expect(msgs[0].status).toBe("sending");
    expect(aplicarAccion(msgs, CID, { status: "pending", message: PENDING_MSG })[0].status)
      .toBe("pending");
  });

  it("17 · Connect: el INSERT real limpia la marca optimista", () => {
    const msgs = realtime([optimista()], evento("INSERT", row()), buildConnect);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].status).toBeUndefined();
    expect(msgs[0].wa).toBeUndefined();
  });

  it("17 · Connect: la acción fallida marca fallo y la exitosa limpia", () => {
    expect(aplicarAccion([optimista()], CID, { status: "failed", message: "Datos inválidos." }, "dm")[0])
      .toMatchObject({ status: "failed", sendError: "Datos inválidos." });
    expect(aplicarAccion([optimista()], CID, { status: "sent", messageId: MSG }, "dm")[0])
      .toMatchObject({ status: undefined, sendError: undefined });
  });

  describe("18 · el error pertenece a su mensaje", () => {
    it("una confirmación auditada limpia SÓLO el error de ese intento", () => {
      let msgs: Msg[] = [optimista(CID), optimista(OTRO_CID)];
      msgs = aplicarAccion(msgs, CID, { status: "pending", message: PENDING_MSG });
      msgs = aplicarAccion(msgs, OTRO_CID, { status: "failed", message: "WhatsApp rechazó el mensaje." });
      expect(msgs[0].sendError).toBe(PENDING_MSG);
      expect(msgs[1].sendError).toBe("WhatsApp rechazó el mensaje.");

      msgs = realtime(msgs, evento("UPDATE", row(OUT("delivered", AT_LATER))));

      expect(msgs[0].sendError).toBeUndefined();
      expect(msgs[1].sendError).toBe("WhatsApp rechazó el mensaje.");
      expect(msgs[1].status).toBe("failed");
    });

    it("un evento no confirmatorio NO limpia el error", () => {
      let msgs: Msg[] = aplicarAccion([optimista()], CID, { status: "pending", message: PENDING_MSG });
      msgs = realtime(msgs, evento("UPDATE", row(OUT("delivered", AT_LATER, false))));
      expect(msgs[0].sendError).toBe(PENDING_MSG);
      expect(msgs[0].status).toBe("pending");
    });

    it("un resultado tardío de otro mensaje no crea ni borra el error actual", () => {
      let msgs: Msg[] = [optimista(CID), optimista(OTRO_CID)];
      msgs = aplicarAccion(msgs, CID, { status: "failed", message: "error del primero" });
      const antes = msgs[1].sendError;
      msgs = aplicarAccion(msgs, OTRO_CID, { status: "pending", message: PENDING_MSG });
      expect(antes).toBeUndefined();
      expect(msgs[0].sendError).toBe("error del primero");
      expect(msgs[1].sendError).toBe(PENDING_MSG);
    });
  });

  it("una excepción del dispatcher deja pending, sin retry", async () => {
    const llamadas: number[] = [];
    const outcome = await dispatchComposerSend(
      { kind: "whatsapp", conversationId: CONV, body: "hola", clientMsgId: CID },
      {
        postConnectMessage: async () => ({ ok: true as const, messageId: MSG, seq: 1 }),
        sendWhatsappText: async () => { llamadas.push(1); throw new Error("Failed to fetch"); },
      } satisfies ComposerDispatchPorts,
    );
    const msgs = aplicarAccion([optimista()], CID, outcome);
    expect(outcome.status).toBe("pending");
    expect(msgs[0].status).toBe("pending");
    expect(llamadas).toHaveLength(1);
    expect(JSON.stringify(msgs)).not.toContain("Failed to fetch");
  });
});
