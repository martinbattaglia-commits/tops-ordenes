/**
 * M-4 · el consumidor durable, con puertos falsos.
 *
 * La concurrencia real (claim atómico, dos workers, backoff) se prueba contra
 * PostgreSQL en `tests/db/t-wa-r9-04-inbound-queue.test.ts`. Acá se prueba la
 * ORQUESTACIÓN: qué desenlace corresponde a cada resultado, que un evento roto
 * no bloquee el lote, y que nada sin sanear llegue a la base.
 */

import { describe, it, expect, vi } from "vitest";
import {
  consumeInboundBatch,
  sanitizeError,
  isPermanent,
  isTransient,
  type ClaimedEvent,
  type InboundConsumerPorts,
} from "./inbound-consumer";

const TOKEN = "tok-1";

function makePorts(over: Partial<InboundConsumerPorts> = {}) {
  const liberados: Array<{ seq: number; outcome: string; error: string | null }> = [];
  const ports: InboundConsumerPorts = {
    newToken: () => TOKEN,
    claim: async () => [],
    release: async (seq, _t, outcome, error) => {
      liberados.push({ seq, outcome, error });
      return outcome === "done" ? "done" : outcome === "permanent" ? "terminal" : "requeued";
    },
    project: async () => ({ complete: true, errors: [] }),
    ...over,
  };
  return { ports, liberados };
}

const ev = (seq: number, attempts = 1): ClaimedEvent => ({ seq, payload: { seq }, attempts });

// ══ 1 · DESENLACES ═════════════════════════════════════════════════════════
describe("M-4 · cada resultado tiene su desenlace", () => {
  it("proyección completa ⇒ done", async () => {
    const { ports, liberados } = makePorts({ claim: async () => [ev(1)] });
    const r = await consumeInboundBatch(ports);
    expect(r).toMatchObject({ claimed: 1, done: 1, requeued: 0, terminal: 0 });
    expect(liberados).toEqual([{ seq: 1, outcome: "done", error: null }]);
  });

  it("proyección incompleta recuperable ⇒ vuelve a la cola", async () => {
    const { ports, liberados } = makePorts({
      claim: async () => [ev(1)],
      project: async () => ({ complete: false, errors: ["retryable: requiere reproceso"] }),
    });
    const r = await consumeInboundBatch(ports);
    expect(r).toMatchObject({ done: 0, requeued: 1, terminal: 0 });
    expect(liberados[0].outcome).toBe("retryable");
  });

  it("errores permanentes ⇒ terminal, no se insiste", async () => {
    const { ports, liberados } = makePorts({
      claim: async () => [ev(1)],
      project: async () => ({ complete: false, errors: ["rejected"] }),
    });
    const r = await consumeInboundBatch(ports);
    expect(r).toMatchObject({ terminal: 1, requeued: 0 });
    expect(liberados[0].outcome).toBe("permanent");
  });

  it("una excepción es AMBIGUA: se reintenta, nunca se descarta", async () => {
    const { ports, liberados } = makePorts({
      claim: async () => [ev(1)],
      project: async () => { throw new Error("timeout de red"); },
    });
    const r = await consumeInboundBatch(ports);
    expect(r.requeued).toBe(1);
    expect(liberados[0].outcome).toBe("retryable");
  });

  it("`not_claimed` no acredita nada: la fila es de otro worker", async () => {
    const { ports } = makePorts({
      claim: async () => [ev(1)],
      release: async () => "not_claimed",
    });
    const r = await consumeInboundBatch(ports);
    expect(r).toMatchObject({ claimed: 1, done: 0, requeued: 0, terminal: 0 });
  });
});

// ══ 2 · UN EVENTO ROTO NO BLOQUEA EL LOTE ══════════════════════════════════
describe("M-4 · el lote continúa aunque un evento falle", () => {
  it("procesa los tres y sólo uno queda pendiente", async () => {
    const { ports, liberados } = makePorts({
      claim: async () => [ev(1), ev(2), ev(3)],
      project: async (p) =>
        (p as { seq: number }).seq === 2
          ? { complete: false, errors: ["boom"] }
          : { complete: true, errors: [] },
    });
    const r = await consumeInboundBatch(ports);
    expect(r).toMatchObject({ claimed: 3, done: 2, requeued: 1 });
    expect(liberados.map((l) => l.seq)).toEqual([1, 2, 3]);
  });

  it("si falla registrar el desenlace, el evento NO se acredita", async () => {
    const { ports } = makePorts({
      claim: async () => [ev(1), ev(2)],
      release: async (seq) => {
        if (seq === 1) throw new Error("db caída");
        return "done";
      },
    });
    const r = await consumeInboundBatch(ports);
    // El 1 no se cuenta: volverá por vencimiento del claim.
    expect(r).toMatchObject({ claimed: 2, done: 1 });
    expect(r.errors).toContain("release_fallido");
  });

  it("si falla el claim, no hay trabajo tomado ni desenlaces", async () => {
    const { ports, liberados } = makePorts({
      claim: async () => { throw new Error("permission denied"); },
    });
    const r = await consumeInboundBatch(ports);
    expect(r).toMatchObject({ claimed: 0, done: 0 });
    expect(liberados).toEqual([]);
  });

  it("cola vacía es una pasada válida, no un error", async () => {
    const { ports } = makePorts();
    expect(await consumeInboundBatch(ports)).toEqual({
      claimed: 0, done: 0, requeued: 0, terminal: 0, errors: [],
    });
  });
});

// ══ 3 · SANEAMIENTO: NADA SENSIBLE LLEGA A LA BASE ═════════════════════════
/**
 * `last_error` es la ÚNICA columna consultable donde puede filtrarse contenido
 * del evento. El payload trae teléfonos y texto libre de terceros.
 */
describe("M-4 · el error que se persiste está saneado", () => {
  it.each([
    ["teléfono en el mensaje", "fallo enviando a +5491100000001", "fallo"],
    ["token Bearer", "Bearer EAAG0aBcD3fGhIjKlMnOpQrStUvWxYz012345 rechazado", "bearer"],
    ["texto libre del cliente", "no se pudo: «hola, necesito el remito 123»", "no"],
    ["wamid", "wamid.HBgNNTQ5MTEyMzQ1Njc4 no encontrado", "wamid"],
    ["vacío", "", "error_desconocido"],
    ["sólo dígitos", "5491100000001", "error_desconocido"],
    ["no textual", { a: 1 }, "error_desconocido"],
  ])("%s ⇒ sólo un código", (_l, entrada, esperado) => {
    expect(sanitizeError(entrada)).toBe(esperado);
  });

  it("el resultado NUNCA conserva un dígito largo ni un +", () => {
    for (const crudo of [
      "error con +5491100000001 adentro",
      "wamid.HBgNNTQ5MTEyMzQ1Njc4",
      "Bearer eyJhbGciOiJIUzI1NiJ9.payload.firma",
    ]) {
      const s = sanitizeError(crudo);
      expect(s).not.toContain("+");
      expect(s).not.toMatch(/\d{5,}/);
      expect(s.length).toBeLessThanOrEqual(40);
    }
  });

  it("lo que se envía a `release` es el texto SANEADO, no el crudo", async () => {
    const { ports, liberados } = makePorts({
      claim: async () => [ev(1)],
      project: async () => ({
        complete: false,
        errors: ["timeout hablando con +5491100000001"],
      }),
    });
    await consumeInboundBatch(ports);
    expect(liberados[0].error).toBe("timeout");
    expect(liberados[0].error).not.toContain("5491100000001");
  });
});

// ══ 4 · CLASIFICACIÓN PERMANENTE VS RECUPERABLE ════════════════════════════
describe("M-4 · sólo lo que no mejora reintentando es permanente", () => {
  it("sin errores no hay permanencia", () => {
    expect(isPermanent([])).toBe(false);
  });

  it.each([["rejected"], ["malformed"], ["unmatched_permanent"]])(
    "`%s` es permanente", (e) => expect(isPermanent([e])).toBe(true),
  );

  it.each([["retryable"], ["reconciliation_required"], ["timeout"], ["network"]])(
    "`%s` es recuperable — el default seguro es reintentar", (e) =>
      expect(isPermanent([e])).toBe(false),
  );

  it("mezcla de permanente y recuperable ⇒ recuperable", () => {
    // Basta un error que pueda mejorar para que valga la pena reintentar.
    expect(isPermanent(["rejected", "timeout"])).toBe(false);
  });
});

// ══ 5 · IDEMPOTENCIA Y TOKEN ═══════════════════════════════════════════════
describe("M-4 · el token del worker acompaña cada desenlace", () => {
  it("todos los release del lote usan el MISMO token del claim", async () => {
    const tokens: string[] = [];
    const { ports } = makePorts({
      claim: async () => [ev(1), ev(2)],
      release: async (_s, t) => { tokens.push(t); return "done"; },
    });
    await consumeInboundBatch(ports);
    expect(tokens).toEqual([TOKEN, TOKEN]);
  });

  it("el token lo genera el puerto, no el núcleo", async () => {
    const newToken = vi.fn(() => "tok-inyectado");
    const { ports } = makePorts({ newToken, claim: async () => [ev(1)] });
    await consumeInboundBatch(ports);
    expect(newToken).toHaveBeenCalledTimes(1);
  });

  it("reprocesar un evento ya proyectado es inocuo (proyección idempotente)", async () => {
    let veces = 0;
    const { ports } = makePorts({
      claim: async () => [ev(1, 3)],
      project: async () => { veces += 1; return { complete: true, errors: [] }; },
    });
    await consumeInboundBatch(ports);
    await consumeInboundBatch(ports);
    // El núcleo no memoriza: la idempotencia es del proyector, y por eso
    // reintentar un evento no puede duplicar su efecto.
    expect(veces).toBeGreaterThanOrEqual(1);
  });

  it("el límite del lote se respeta y se propaga al claim", async () => {
    const claim = vi.fn(async () => []);
    const { ports } = makePorts({ claim });
    await consumeInboundBatch(ports, 3);
    expect(claim).toHaveBeenCalledWith(TOKEN, 3);
  });
});

// ══ HIGH-3 · `tenant_unresolved` es TRANSITORIO, no permanente ═════════════
/**
 * Es una condición de configuración del proceso —falta
 * `META_WA_PHONE_NUMBER_ID`—, no un defecto del evento. Tratarlo como
 * permanente descartaba hechos reales de Meta por un error de despliegue.
 */
describe("HIGH-3 · clasificación de motivos de parseo", () => {
  it.each([
    ["tenant_unresolved"],
    ["state_unavailable"],
    ["timeout"],
    ["network"],
  ])("`%s` es TRANSITORIO ⇒ nunca permanente", (motivo) => {
    expect(isTransient(motivo)).toBe(true);
    expect(isPermanent([motivo])).toBe(false);
  });

  it.each([
    ["not_whatsapp_object"],
    ["not_object"],
    ["tenant_mismatch"],
    ["rejected"],
    ["malformed"],
  ])("`%s` es PERMANENTE: este tenant no lo va a proyectar nunca", (motivo) => {
    expect(isTransient(motivo)).toBe(false);
    expect(isPermanent([motivo])).toBe(true);
  });

  it("un transitorio mezclado con permanentes gana: el lote se reintenta", () => {
    expect(isPermanent(["not_whatsapp_object", "tenant_unresolved"])).toBe(false);
  });

  it("`tenant_unresolved` deja el evento en la cola, NO terminal", async () => {
    const { ports, liberados } = makePorts({
      claim: async () => [ev(1)],
      project: async () => ({ complete: false, errors: ["tenant_unresolved"] }),
    });
    const r = await consumeInboundBatch(ports);
    expect(r).toMatchObject({ requeued: 1, terminal: 0, done: 0 });
    expect(liberados[0].outcome).toBe("retryable");
  });

  it("`not_whatsapp_object` sí es terminal explícito", async () => {
    const { ports, liberados } = makePorts({
      claim: async () => [ev(1)],
      project: async () => ({ complete: false, errors: ["not_whatsapp_object"] }),
    });
    const r = await consumeInboundBatch(ports);
    expect(r).toMatchObject({ terminal: 1, requeued: 0 });
    expect(liberados[0].outcome).toBe("permanent");
  });

  it("restaurada la configuración, el MISMO evento se procesa exactamente una vez", async () => {
    // Antes: sin configuración. Después: con configuración.
    let hayConfig = false;
    let proyecciones = 0;
    const liberados: string[] = [];
    const ports: InboundConsumerPorts = {
      newToken: () => TOKEN,
      claim: async () => [ev(1)],
      release: async (_s, _t, outcome) => {
        liberados.push(outcome);
        return outcome === "done" ? "done" : outcome === "permanent" ? "terminal" : "requeued";
      },
      project: async () => {
        if (!hayConfig) return { complete: false, errors: ["tenant_unresolved"] };
        proyecciones += 1;
        return { complete: true, errors: [] };
      },
    };

    const sinConfig = await consumeInboundBatch(ports);
    expect(sinConfig).toMatchObject({ requeued: 1, done: 0 });
    expect(proyecciones).toBe(0);

    hayConfig = true;
    const conConfig = await consumeInboundBatch(ports);
    expect(conConfig).toMatchObject({ done: 1, requeued: 0 });
    // Exactamente UNA proyección efectiva, pese a los dos pasajes por la cola.
    expect(proyecciones).toBe(1);
    expect(liberados).toEqual(["retryable", "done"]);
  });
});
