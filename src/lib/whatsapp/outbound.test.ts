import { describe, it, expect, vi } from "vitest";
import {
  createMetaHttpTransport,
  extractWamid,
  requiresReconciliation,
  isAmbiguousStatus,
  type MetaSendOutcome,
} from "./transport";
import {
  canTransition,
  blocksAutomaticResend,
  isDeliveredOrBeyond,
  isCanonicalIsoUtc,
  readAuditMarker,
  isAuditConfirmed,
  WA_AUDIT_MARKER_KEY,
  type WaOutboundState,
} from "./outbound-state";

/**
 * LINK-WA R1A · Transporte Meta y máquina de estados.
 *
 * ADAPTADOR EN MEMORIA / FAKE: no hay red ni llamadas reales a Meta. El fetch
 * está inyectado en todos los casos. Ningún número ni texto real.
 */

function fakeFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  return vi.fn(impl) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CFG = { token: "fake-token", phoneNumberId: "111111111111111", graphBase: "https://fake.invalid/v22.0" };
const TO = "+5491100000001";

describe("extractWamid · contrato estricto", () => {
  it("acepta un messages[0].id no vacío", () => {
    expect(extractWamid({ messages: [{ id: "wamid.OK" }] })).toBe("wamid.OK");
  });

  it.each([
    ["sin messages", {}],
    ["messages vacío", { messages: [] }],
    ["sin id", { messages: [{}] }],
    ["id vacío", { messages: [{ id: "   " }] }],
    ["id no string", { messages: [{ id: 123 }] }],
    ["no objeto", null],
  ])("rechaza %s", (_label, body) => {
    expect(extractWamid(body)).toBeNull();
  });
});

describe("transport · clasificación de resultados", () => {
  it("2xx con wamid → accepted", async () => {
    const t = createMetaHttpTransport({
      ...CFG,
      fetchImpl: fakeFetch(() => jsonResponse({ messages: [{ id: "wamid.OK" }] })),
    });
    const out = await t.sendText({ to: TO, text: "hola" });
    expect(out).toEqual({ kind: "accepted", wamid: "wamid.OK" });
  });

  it("R5 · 2xx SIN wamid → AMBIGUO, nunca rejected reintentable", async () => {
    const t = createMetaHttpTransport({
      ...CFG,
      fetchImpl: fakeFetch(() => jsonResponse({ messages: [] })),
    });
    const out = await t.sendText({ to: TO, text: "hola" });
    expect(out).toMatchObject({ kind: "ambiguous", reason: "contract_unknown" });
    expect(requiresReconciliation(out)).toBe(true);
    expect(JSON.stringify(out)).not.toContain("(sin id)");
  });

  it("R5 · 2xx con JSON inválido → AMBIGUO", async () => {
    const t = createMetaHttpTransport({
      ...CFG,
      fetchImpl: fakeFetch(() => new Response("<html>", { status: 200 })),
    });
    const out = await t.sendText({ to: TO, text: "hola" });
    expect(out).toMatchObject({ kind: "ambiguous", reason: "invalid_2xx" });
  });

  it("R5 · 2xx con cuerpo vacío → AMBIGUO", async () => {
    const t = createMetaHttpTransport({
      ...CFG,
      fetchImpl: fakeFetch(() => new Response("", { status: 200 })),
    });
    const out = await t.sendText({ to: TO, text: "hola" });
    expect(out).toMatchObject({ kind: "ambiguous", reason: "invalid_2xx" });
  });

  it("R5 · 2xx con wamid vacío → AMBIGUO", async () => {
    const t = createMetaHttpTransport({
      ...CFG,
      fetchImpl: fakeFetch(() => jsonResponse({ messages: [{ id: "   " }] })),
    });
    const out = await t.sendText({ to: TO, text: "hola" });
    expect(out).toMatchObject({ kind: "ambiguous", reason: "contract_unknown" });
  });

  it("HTTP no exitoso → rejected/http_error", async () => {
    const t = createMetaHttpTransport({
      ...CFG,
      fetchImpl: fakeFetch(() => jsonResponse({ error: { message: "Invalid recipient" } }, 400)),
    });
    const out = await t.sendText({ to: TO, text: "hola" });
    expect(out).toMatchObject({ kind: "rejected", reason: "http_error", status: 400 });
  });

  it("JSON inválido en un 4xx inequívoco → rejected/invalid_json", async () => {
    const t = createMetaHttpTransport({
      ...CFG,
      fetchImpl: fakeFetch(() => new Response("<html>", { status: 400 })),
    });
    const out = await t.sendText({ to: TO, text: "hola" });
    expect(out).toMatchObject({ kind: "rejected", reason: "invalid_json" });
    expect(requiresReconciliation(out)).toBe(false);
  });

  // §5 · sólo un 4xx inequívoco es rechazo.
  it.each([500, 502, 503, 504, 408])("HTTP %i → AMBIGUOUS (server_error)", async (status) => {
    const t = createMetaHttpTransport({
      ...CFG,
      fetchImpl: fakeFetch(() => jsonResponse({ error: { message: "boom" } }, status)),
    });
    const out = await t.sendText({ to: TO, text: "hola" });
    expect(out).toMatchObject({ kind: "ambiguous", reason: "server_error" });
    expect(requiresReconciliation(out)).toBe(true);
  });

  it.each([400, 401, 403])("HTTP %i → rejected estable", async (status) => {
    const t = createMetaHttpTransport({
      ...CFG,
      fetchImpl: fakeFetch(() => jsonResponse({ error: { message: "Invalid recipient +5491100000001" } }, status)),
    });
    const out = await t.sendText({ to: TO, text: "hola" });
    expect(out).toMatchObject({ kind: "rejected", reason: "http_error", status });
    // El mensaje del proveedor NO atraviesa el outcome.
    expect(JSON.stringify(out)).not.toContain("Invalid recipient");
    expect(JSON.stringify(out)).not.toContain("+5491100000001");
  });

  it("isAmbiguousStatus separa 4xx de 408/5xx", () => {
    expect(isAmbiguousStatus(408)).toBe(true);
    expect(isAmbiguousStatus(500)).toBe(true);
    expect(isAmbiguousStatus(504)).toBe(true);
    expect(isAmbiguousStatus(400)).toBe(false);
    expect(isAmbiguousStatus(404)).toBe(false);
  });

  it("timeout → ambiguous (NO rejected: el mensaje pudo haber salido)", async () => {
    const t = createMetaHttpTransport({
      ...CFG,
      timeoutMs: 5,
      fetchImpl: fakeFetch(
        (_u, init) =>
          new Promise((_res, rej) => {
            (init.signal as AbortSignal).addEventListener("abort", () => {
              const e = new Error("aborted");
              e.name = "AbortError";
              rej(e);
            });
          }),
      ),
    });
    const out = await t.sendText({ to: TO, text: "hola" });
    expect(out).toMatchObject({ kind: "ambiguous", reason: "timeout" });
    expect(requiresReconciliation(out)).toBe(true);
  });

  it("error de red → ambiguous/network", async () => {
    const t = createMetaHttpTransport({
      ...CFG,
      fetchImpl: fakeFetch(() => Promise.reject(new TypeError("fetch failed"))),
    });
    const out = await t.sendText({ to: TO, text: "hola" });
    expect(out).toMatchObject({ kind: "ambiguous", reason: "network" });
  });

  it("sin configuración → rejected/not_configured y CERO llamadas", async () => {
    const spy = fakeFetch(() => jsonResponse({}));
    const t = createMetaHttpTransport({ token: "", phoneNumberId: "", fetchImpl: spy });
    const out = await t.sendText({ to: TO, text: "hola" });
    expect(out).toMatchObject({ kind: "rejected", reason: "not_configured" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("un resultado rejected NO exige reconciliación", () => {
    const rejected: MetaSendOutcome = {
      kind: "rejected",
      reason: "http_error",
      status: 400,
      detail: "x",
    };
    expect(requiresReconciliation(rejected)).toBe(false);
  });
});

describe("outbound-state · progresión monótona", () => {
  it("avanza queued → sending → sent → delivered → read", () => {
    const chain: WaOutboundState[] = ["queued", "sending", "sent", "delivered", "read"];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(canTransition(chain[i], chain[i + 1])).toBe(true);
    }
  });

  it("no retrocede: read no vuelve a delivered ni a sent", () => {
    expect(canTransition("read", "delivered")).toBe(false);
    expect(canTransition("read", "sent")).toBe(false);
    expect(canTransition("delivered", "sent")).toBe(false);
  });

  it("un evento repetido es no-op", () => {
    for (const s of ["queued", "sending", "sent", "delivered", "read", "failed"] as WaOutboundState[]) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it("failed NO reemplaza delivered ni read", () => {
    expect(canTransition("delivered", "failed")).toBe(false);
    expect(canTransition("read", "failed")).toBe(false);
    expect(isDeliveredOrBeyond("delivered")).toBe(true);
  });

  it("failed sí cierra un intento antes de delivered", () => {
    expect(canTransition("queued", "failed")).toBe(true);
    expect(canTransition("sending", "failed")).toBe(true);
    expect(canTransition("sent", "failed")).toBe(true);
  });

  it("reconciliation_required sólo se entra desde un intento en curso", () => {
    expect(canTransition("queued", "reconciliation_required")).toBe(true);
    expect(canTransition("sending", "reconciliation_required")).toBe(true);
    expect(canTransition("delivered", "reconciliation_required")).toBe(false);
  });

  it("failed NO puede pisar una reconciliación pendiente", () => {
    expect(canTransition("reconciliation_required", "failed")).toBe(false);
  });

  it("un status real de Meta reconcilia el estado pendiente", () => {
    expect(canTransition("reconciliation_required", "sent")).toBe(true);
    expect(canTransition("reconciliation_required", "delivered")).toBe(true);
    expect(canTransition("reconciliation_required", "read")).toBe(true);
  });

  it("1B-1D · bloquea reenvío desde TODO estado terminal, incluido failed", () => {
    for (const s of [
      "sending", "reconciliation_required", "sent", "delivered", "read", "failed",
    ] as WaOutboundState[]) {
      expect(blocksAutomaticResend(s)).toBe(true);
    }
    // Sólo un intento no arrancado admite egress.
    expect(blocksAutomaticResend("queued")).toBe(false);
    expect(blocksAutomaticResend(null)).toBe(false);
  });
});

// ── WA-7R3 · instante ISO-8601 UTC canónico ────────────────────────────────
/**
 * WA-7R2 sólo exigía "string no vacío" para el `at` del marcador. Una fecha
 * imposible o un offset no canónico acreditaban una auditoría que después nadie
 * puede correlacionar. La validación es SINTÁCTICA y SEMÁNTICA a la vez.
 */
describe("isCanonicalIsoUtc", () => {
  it.each([
    ["con milisegundos", "2026-08-09T12:00:00.000Z"],
    ["sin milisegundos", "2026-08-09T12:00:00Z"],
    ["un dígito de milisegundo", "2026-08-09T12:00:00.5Z"],
    ["dos dígitos de milisegundo", "2026-08-09T12:00:00.25Z"],
    ["medianoche", "2026-01-01T00:00:00.000Z"],
    ["último instante del año", "2026-12-31T23:59:59.999Z"],
    ["29 de febrero bisiesto", "2024-02-29T12:00:00.000Z"],
    ["bisiesto secular 2000", "2000-02-29T00:00:00.000Z"],
  ])("acepta %s", (_l, value) => {
    expect(isCanonicalIsoUtc(value)).toBe(true);
  });

  it.each([
    ["timestamp 'x'", "x"],
    ["cadena vacía", ""],
    ["sólo espacios", "   "],
    ["sólo fecha", "2026-08-09"],
    ["espacio en vez de T", "2026-08-09 12:00:00.000Z"],
    ["sin zona", "2026-08-09T12:00:00.000"],
    ["z minúscula", "2026-08-09T12:00:00.000z"],
    ["offset +00:00", "2026-08-09T12:00:00+00:00"],
    ["offset -03:00", "2026-08-09T09:00:00-03:00"],
    ["offset Z redundante", "2026-08-09T12:00:00.000+00:00Z"],
    ["microsegundos", "2026-08-09T12:00:00.000000Z"],
    ["espacios alrededor", " 2026-08-09T12:00:00.000Z "],
    // Sintácticamente parecidas, imposibles en el calendario.
    ["30 de febrero", "2026-02-30T00:00:00.000Z"],
    ["29 de febrero no bisiesto", "2026-02-29T00:00:00.000Z"],
    ["29 de febrero de 1900", "1900-02-29T00:00:00.000Z"],
    ["31 de abril", "2026-04-31T00:00:00.000Z"],
    ["31 de junio", "2026-06-31T00:00:00.000Z"],
    ["31 de septiembre", "2026-09-31T00:00:00.000Z"],
    ["31 de noviembre", "2026-11-31T00:00:00.000Z"],
    ["día 32", "2026-08-32T00:00:00.000Z"],
    ["día 00", "2026-08-00T00:00:00.000Z"],
    ["mes 13", "2026-13-01T00:00:00.000Z"],
    ["mes 00", "2026-00-01T00:00:00.000Z"],
    ["hora 24", "2026-08-09T24:00:00.000Z"],
    ["minuto 60", "2026-08-09T12:60:00.000Z"],
    ["segundo bisiesto 60", "2026-08-09T12:00:60.000Z"],
    ["epoch como texto", "1760000000000"],
    ["teléfono", "5491100000001"],
  ])("rechaza %s", (_l, value) => {
    expect(isCanonicalIsoUtc(value)).toBe(false);
  });

  /**
   * Estos casos aíslan la comprobación de IDA Y VUELTA, la única capa capaz de
   * atraparlos: el calendario los da por válidos (agosto tiene 31 días), pero
   * `Date.UTC` remapea los años 0–99 a 1900+año y el instante deja de ser el
   * que el llamador escribió. Sin ida y vuelta, `0050-…` se acreditaría como
   * 1950 sin que nadie lo note.
   */
  it.each([
    ["año 0050 remapeado a 1950", "0050-08-09T12:00:00.000Z"],
    ["año 0099 remapeado a 1999", "0099-12-31T23:59:59.999Z"],
    ["año 0000 remapeado a 1900", "0000-01-01T00:00:00.000Z"],
  ])("rechaza %s (sólo la ida y vuelta lo detecta)", (_l, value) => {
    expect(isCanonicalIsoUtc(value)).toBe(false);
  });

  /**
   * Y estos aíslan `daysInMonth`, la única capa capaz de atraparlos ANTES de que
   * `Date.UTC` los normalice en silencio hacia el mes siguiente.
   */
  it.each([
    ["30 de febrero", "2026-02-30T00:00:00.000Z"],
    ["31 de abril", "2026-04-31T00:00:00.000Z"],
  ])("rechaza %s (daysInMonth lo detecta antes del roll-over)", (_l, value) => {
    expect(isCanonicalIsoUtc(value)).toBe(false);
  });

  it.each([
    ["número", 1_760_000_000_000],
    ["objeto Date-like", { toISOString: () => "2026-08-09T12:00:00.000Z" }],
    ["array", ["2026-08-09T12:00:00.000Z"]],
    ["null", null],
    ["undefined", undefined],
    ["booleano", true],
  ])("rechaza un valor no-string (%s)", (_l, value) => {
    expect(isCanonicalIsoUtc(value)).toBe(false);
  });

  it("acepta exactamente lo que emite toISOString", () => {
    // Instante FIJO, no el reloj: el core es puro y el test también.
    const iso = new Date(Date.UTC(2026, 7, 9, 12, 0, 0, 0)).toISOString();
    expect(iso).toBe("2026-08-09T12:00:00.000Z");
    expect(isCanonicalIsoUtc(iso)).toBe(true);
  });
});

// ── WA-7R3 · marcador durable con estructura exacta ────────────────────────
describe("readAuditMarker · estructura exacta y no ambigua", () => {
  const WAMID = "wamid.OUT1";
  const AT = "2026-08-09T12:00:00.000Z";
  const wrap = (marker: unknown) => ({ status: "sent", [WA_AUDIT_MARKER_KEY]: marker });

  it("acepta exactamente { wamid, at } con at canónico", () => {
    expect(readAuditMarker(wrap({ wamid: WAMID, at: AT }))).toEqual({ wamid: WAMID, at: AT });
  });

  it.each([
    ["marcador ausente", { status: "sent" }],
    ["wa nulo", null],
    ["wa no-objeto", "sent"],
    ["wa arreglo", [{ [WA_AUDIT_MARKER_KEY]: { wamid: WAMID, at: AT } }]],
  ])("%s ⇒ null", (_l, wa) => {
    expect(readAuditMarker(wa)).toBeNull();
  });

  it.each([
    ["marcador no-objeto", true],
    ["marcador arreglo", [WAMID, AT]],
    ["marcador nulo", null],
    ["sin wamid", { at: AT }],
    ["sin at", { wamid: WAMID }],
    ["wamid vacío", { wamid: "", at: AT }],
    ["wamid en blanco", { wamid: "   ", at: AT }],
    ["wamid no-string", { wamid: 123, at: AT }],
    ["at = 'x'", { wamid: WAMID, at: "x" }],
    ["at vacío", { wamid: WAMID, at: "" }],
    ["at fecha imposible", { wamid: WAMID, at: "2026-02-30T00:00:00.000Z" }],
    ["at offset no canónico", { wamid: WAMID, at: "2026-08-09T12:00:00+00:00" }],
    ["at no-string", { wamid: WAMID, at: 1_760_000_000_000 }],
    ["clave de más", { wamid: WAMID, at: AT, extra: 1 }],
    ["clave renombrada", { wamid: WAMID, when: AT }],
    ["marcador vacío", {}],
  ])("marcador con %s ⇒ null", (_l, marker) => {
    expect(readAuditMarker(wrap(marker))).toBeNull();
  });

  /**
   * La consecuencia que importa: un marcador inválido NO acredita auditoría.
   * `isAuditConfirmed` recibe `null` y el intento queda como reconciliación.
   */
  it.each(["sent", "delivered", "read"] as WaOutboundState[])(
    "un marcador inválido no acredita auditoría en estado %s",
    (status) => {
      const invalido = readAuditMarker(wrap({ wamid: WAMID, at: "x" }));
      expect(invalido).toBeNull();
      expect(isAuditConfirmed(invalido?.wamid ?? null, WAMID, status)).toBe(false);

      const valido = readAuditMarker(wrap({ wamid: WAMID, at: AT }));
      expect(isAuditConfirmed(valido?.wamid ?? null, WAMID, status)).toBe(true);
    },
  );

  it("un marcador de OTRO wamid tampoco acredita", () => {
    const m = readAuditMarker(wrap({ wamid: "wamid.VIEJO", at: AT }));
    expect(m).toEqual({ wamid: "wamid.VIEJO", at: AT });
    expect(isAuditConfirmed(m?.wamid ?? null, WAMID, "sent")).toBe(false);
  });
});
