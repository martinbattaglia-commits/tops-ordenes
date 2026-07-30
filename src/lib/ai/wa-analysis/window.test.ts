// LINK-WA-002 · E1.1 · Guarda A (CONTEXTO) — tests.
//
// Lo que se prueba NO es «que la función corra», sino la promesa de gobierno:
// los cuatro límites se aplican A LA VEZ, ningún mensaje se parte, y todo
// recorte queda REPORTADO con motivo y cifras.

import { describe, expect, it } from "vitest";
import {
  buildWindow, describeWindow, estimateTokens,
  CONTEXT_LIMITS, PER_MESSAGE_OVERHEAD_CHARS, CHARS_PER_TOKEN, PROMPT_SCAFFOLD_TOKENS,
} from "./window";
import type { WaMessageInput } from "./prompt";

function msg(i: number, len = 20): WaMessageInput {
  return {
    id: `msg-${String(i).padStart(4, "0")}`,
    author: "Cliente",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    body: "x".repeat(len),
  };
}
const thread = (n: number, len = 20) => Array.from({ length: n }, (_, i) => msg(i, len));

describe("A1 · ventana completa cuando el hilo entra", () => {
  it("no trunca, no omite y lo declara", () => {
    const w = buildWindow(thread(10));
    expect(w.included).toHaveLength(10);
    expect(w.omitted).toBe(0);
    expect(w.truncated).toBe(false);
    expect(w.reason).toBeNull();
    expect(describeWindow(w)).toContain("Ventana completa");
  });

  it("preserva orden cronológico, autor, fecha y message_id intactos", () => {
    const t = thread(5);
    const w = buildWindow(t);
    expect(w.included.map((m) => m.id)).toEqual(t.map((m) => m.id));
    expect(w.included[0]).toEqual(t[0]); // objeto íntegro: nada se reescribe
  });
});

describe("A2 · límite de CANTIDAD: es un TECHO, hoy inalcanzable", () => {
  it("🔴 el tope de 120 mensajes ya NO puede activarse: manda siempre el de tokens", () => {
    // C-4 · Al contabilizar el `responseSchema` que viaja en el pedido, la reserva de
    // andamiaje subió y los caracteres admitidos bajaron a ~10.485. Sólo los
    // ENCABEZADOS de evidencia de 120 mensajes cuestan 120 × 90 = 10.800 caracteres
    // ⇒ ni con cuerpos VACÍOS entran 120. El tope sigue evaluándose, pero no puede
    // ser el que corte. Queda asentado acá para que nadie lea «120» como una promesa.
    const soloEncabezados = CONTEXT_LIMITS.maxMessages * PER_MESSAGE_OVERHEAD_CHARS;
    const admitidos = (CONTEXT_LIMITS.maxInputTokens - PROMPT_SCAFFOLD_TOKENS) * CHARS_PER_TOKEN;
    expect(soloEncabezados).toBeGreaterThan(admitidos);

    const vacios = Array.from({ length: 200 }, (_, i) => ({ ...msg(i), body: "" }));
    const w = buildWindow(vacios);
    expect(w.reason).toBe("tokens");
    expect(w.included.length).toBeLessThan(CONTEXT_LIMITS.maxMessages);
  });

  it("recorta conservando los MÁS RECIENTES, y el tope de cantidad se puede inyectar", () => {
    const t = thread(200, 5);
    const w = buildWindow(t, { maxMessages: 40 });
    expect(w.included).toHaveLength(40);
    expect(w.omitted).toBe(160);
    expect(w.total).toBe(200);
    expect(w.reason).toBe("cantidad");
    // La cola: el último mensaje del hilo SIEMPRE está.
    expect(w.included[w.included.length - 1].id).toBe(t[199].id);
    expect(w.included[0].id).toBe(t[160].id);
  });
});

describe("A3 · límite de CARACTERES (24.000) — la brecha B-2 medida en D3", () => {
  it("un hilo de 120 mensajes de 400 caracteres NO entra por cantidad: corta por tamaño", () => {
    // Antes de E1.1 esto pasaba el tope de 120 y se iba a ~58.800 caracteres.
    const w = buildWindow(thread(120, 400));
    expect(w.included.length).toBeLessThan(120);
    expect(w.chars).toBeLessThanOrEqual(CONTEXT_LIMITS.maxChars);
    expect(w.truncated).toBe(true);
    expect(["caracteres", "tokens"]).toContain(w.reason);
  });

  it("nunca parte un mensaje: la suma de los incluidos es exacta", () => {
    const w = buildWindow(thread(300, 300));
    const exact = w.included.reduce((a, m) => a + m.body.length + PER_MESSAGE_OVERHEAD_CHARS, 0);
    expect(w.chars).toBe(exact);
    // y cada cuerpo llegó completo
    for (const m of w.included) expect(m.body).toHaveLength(300);
  });
});

describe("A4 · límite de TOKENS de entrada (8.000)", () => {
  it("la estimación incluye el andamiaje del prompt", () => {
    expect(estimateTokens(0)).toBe(PROMPT_SCAFFOLD_TOKENS);
    expect(estimateTokens(3800)).toBe(Math.ceil(3800 / CHARS_PER_TOKEN) + PROMPT_SCAFFOLD_TOKENS);
  });

  it("jamás excede el tope declarado, sea cual sea el hilo", () => {
    for (const len of [10, 120, 400, 1200, 4000]) {
      const w = buildWindow(thread(400, len));
      expect(w.estimatedInputTokens).toBeLessThanOrEqual(CONTEXT_LIMITS.maxInputTokens);
      expect(w.chars).toBeLessThanOrEqual(CONTEXT_LIMITS.maxChars);
      expect(w.included.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxMessages);
    }
  });

  it("el tope de SALIDA viaja en la ventana (6.000 tras D-2)", () => {
    expect(buildWindow(thread(3)).maxOutputTokens).toBe(6000);
    expect(CONTEXT_LIMITS.maxOutputTokens).toBe(6000);
  });
});

describe("A5 · los cuatro límites son SIMULTÁNEOS, no alternativos", () => {
  it("el primero que se alcanza es el que manda, y queda nombrado", () => {
    // C-4: con la reserva del esquema contabilizada, incluso «muchos y cortos» cortan
    // por TOKENS — el encabezado de evidencia por mensaje ya consume el presupuesto.
    expect(buildWindow(thread(500, 5)).reason).toBe("tokens");         // muchos y cortos
    expect(buildWindow(thread(500, 5), { maxMessages: 30 }).reason).toBe("cantidad");
    const grande = buildWindow(thread(500, 2000));
    expect(["caracteres", "tokens"]).toContain(grande.reason);         // pocos y enormes
  });
});

describe("A6 · NADA se recorta en silencio", () => {
  it("el relato del truncamiento nombra motivo, incluidos, omitidos y total", () => {
    const w = buildWindow(thread(200, 5));
    const d = describeWindow(w);
    expect(d).toContain("TRUNCADA");
    // Las cifras se leen de la ventana, no se fijan a mano: así el test no miente
    // cuando la reserva de andamiaje cambia.
    expect(d).toContain(String(w.included.length));
    expect(d).toContain("200");
    expect(d).toContain(String(w.omitted));
    expect(w.included.length + w.omitted).toBe(200);
  });

  it("truncated y reason son consistentes entre sí", () => {
    const full = buildWindow(thread(3));
    expect(full.truncated).toBe(false);
    expect(full.reason).toBeNull();
    const cut = buildWindow(thread(200, 5));
    expect(cut.truncated).toBe(true);
    expect(cut.reason).not.toBeNull();
  });
});

describe("A7 · bordes adversariales", () => {
  it("hilo vacío ⇒ ventana vacía, no explota", () => {
    const w = buildWindow([]);
    expect(w.included).toHaveLength(0);
    expect(w.total).toBe(0);
    expect(w.truncated).toBe(false);
  });

  it("un ÚNICO mensaje gigante que no entra ⇒ ventana vacía declarada (nunca partido)", () => {
    const w = buildWindow([msg(0, 100_000)]);
    expect(w.included).toHaveLength(0);
    expect(w.omitted).toBe(1);
    expect(w.truncated).toBe(true);
    // el llamador corta la corrida; jamás se manda medio mensaje al modelo
  });

  it("body vacío o nulo no rompe el conteo", () => {
    const w = buildWindow([{ ...msg(0), body: "" }, msg(1)]);
    expect(w.included).toHaveLength(2);
    expect(w.chars).toBe(PER_MESSAGE_OVERHEAD_CHARS * 2 + 20);
  });

  it("límites inyectados por el llamador se respetan (para tests y futuros modos)", () => {
    const w = buildWindow(thread(50), { maxMessages: 7 });
    expect(w.included).toHaveLength(7);
    expect(w.reason).toBe("cantidad");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Remediación de la revisión adversarial independiente (E1.1)
// ─────────────────────────────────────────────────────────────────────────────

describe("A8 · H5 — el total es el del HILO, no el del recorte de la consulta", () => {
  it("120 traídos de un hilo de 500 ⇒ TRUNCADA, no «completa»", () => {
    const w = buildWindow(thread(120, 5), {}, 500);
    expect(w.total).toBe(500);
    expect(w.omitted).toBe(500 - w.included.length);
    expect(w.included.length).toBeLessThan(120);   // C-4: corta por tokens antes
    expect(w.truncated).toBe(true);
    expect(describeWindow(w)).toContain("TRUNCADA");
    expect(describeWindow(w)).toContain("500");
  });

  it("un total informado menor que lo traído no puede fabricar omisiones negativas", () => {
    const w = buildWindow(thread(10), {}, 3);
    expect(w.total).toBe(10);
    expect(w.omitted).toBe(0);
    expect(w.truncated).toBe(false);
  });
});

describe("A9 · H11 — el relato cita los límites EFECTIVOS", () => {
  it("con override, el motivo nombra el tope aplicado y no el default", () => {
    const w = buildWindow(thread(50), { maxMessages: 7 });
    expect(w.limits.maxMessages).toBe(7);
    expect(describeWindow(w)).toContain("tope de 7 mensajes");
    expect(describeWindow(w)).not.toContain("tope de 120");
  });
});
