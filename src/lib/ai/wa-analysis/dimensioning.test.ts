// LINK-WA-002 · dimensionamiento del análisis estructurado (D-1, D-2, D-3).
//
// Todo lo de acá sale de UNA medición real, no de una hipótesis: la segunda corrida
// sobre «Escribanía Galarza» cobró 10.835 tokens de entrada sobre 17.541 caracteres
// —1,619 caracteres por token— cuando la ventana había declarado ~5.147. El tope
// autorizado de 8.000 se excedió (135,4 %) y nada lo detectó, porque la guarda
// trabajaba con una estimación calibrada sobre prosa administrativa (3.8) y el
// proveedor cobra por tokens reales.
//
// Estos tests no verifican «que la función corra». Verifican con ARITMÉTICA sobre el
// dato medido que la constante vigente hace lo que promete: que la ventana que la
// guarda admite no puede costar más que el tope autorizado.
//
// Límite de estos tests, dicho explícitamente: no hay un tokenizador acá. El «cobro
// real» se MODELA con la tasa observada en una corrida. Es la mejor evidencia
// disponible, no una certeza — y por eso el postcheck de conformidad contra lo
// efectivamente cobrado sigue siendo obligatorio en producción.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildWindow, describeWindow, estimateTokens, CONTEXT_LIMITS,
  CHARS_PER_TOKEN, CHARS_PER_TOKEN_MEDIDO_WHATSAPP,
  PER_MESSAGE_OVERHEAD_CHARS, PROMPT_SCAFFOLD_TOKENS,
} from "./window";
import type { WaMessageInput } from "./prompt";

/** La medición cruda de la 2ª corrida real. Todo lo demás se DERIVA de acá. */
const MEDICION = { chars: 17_541, tokensCobrados: 10_835 } as const;
const TASA_MEDIDA_EXACTA = MEDICION.chars / MEDICION.tokensCobrados; // 1,6189…

const TOPE = CONTEXT_LIMITS.maxInputTokens;

/** Caracteres máximos que la guarda puede admitir antes de tocar el tope de tokens. */
const CHARS_MAX_POR_TOKENS = (TOPE - PROMPT_SCAFFOLD_TOKENS) * CHARS_PER_TOKEN;

/** Modelo A — cobro esperado: la tasa agregada ya incluye el andamiaje del prompt. */
const cobroEsperado = (chars: number) => Math.ceil(chars / TASA_MEDIDA_EXACTA);

/** Modelo B — cobro pesimista: cuenta el andamiaje DOS veces (dentro de la tasa y
 *  otra vez aparte). Si el tope se respeta incluso acá, se respeta de verdad. */
const cobroPesimista = (chars: number) =>
  Math.ceil(chars / CHARS_PER_TOKEN_MEDIDO_WHATSAPP) + PROMPT_SCAFFOLD_TOKENS;

/** Corpus REALISTA: WhatsApp en español con acentos, emojis y abreviaturas, que es
 *  lo que tokeniza mal. Un corpus de prosa administrativa daba 3,8 c/token y de ahí
 *  salió la constante equivocada. */
const FRASES = [
  "Hola! cómo va? te consulto por el remito 4417 🙌",
  "buenísimo, gracias!! mañana te confirmo la entrega en Luján 📦",
  "che, el chofer dice q no hay nadie en el depósito, avisás?",
  "perfecto ✅ quedó facturado, te paso el CAE por mail",
  "no llegó todavía… podés fijarte si salió de planta?",
  "listo, ya está autorizado por Ruth 👍 seguimos mañana",
];

function corpus(n: number): WaMessageInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m-${String(i).padStart(4, "0")}`,
    author: i % 3 === 0 ? "Logistica Top's" : "Escribania Galarza",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    body: FRASES[i % FRASES.length],
  }));
}

describe("D-1 · la constante está calibrada sobre la medición, no sobre prosa", () => {
  it("CHARS_PER_TOKEN vale 1.6", () => {
    expect(CHARS_PER_TOKEN).toBe(1.6);
  });

  it("la tasa MEDIDA queda registrada en el código, no en un comentario", () => {
    expect(CHARS_PER_TOKEN_MEDIDO_WHATSAPP).toBeCloseTo(1.62, 2);
    expect(TASA_MEDIDA_EXACTA).toBeCloseTo(1.619, 3);
  });

  it("🔑 la constante es MÁS estricta que la tasa real: la estimación no subestima", () => {
    // Es la propiedad de la que depende todo lo demás. Si la constante fuera mayor
    // que la tasa real, la guarda admitiría más caracteres de los que el tope paga.
    expect(CHARS_PER_TOKEN).toBeLessThan(TASA_MEDIDA_EXACTA);
    expect(CHARS_PER_TOKEN).toBeLessThan(CHARS_PER_TOKEN_MEDIDO_WHATSAPP);
  });
});

describe("D-1 · el tope de entrada AHORA se respeta, con números", () => {
  it("la guarda no puede admitir más de 11.952 caracteres por el tope de tokens", () => {
    expect(CHARS_MAX_POR_TOKENS).toBe(11_952);
    // 11.952 exactos son admisibles; un carácter más excede.
    expect(estimateTokens(CHARS_MAX_POR_TOKENS)).toBe(TOPE);
    expect(estimateTokens(CHARS_MAX_POR_TOKENS + 1)).toBeGreaterThan(TOPE);
  });

  it("🔑 el peor caso admisible NO excede el tope, ni en el modelo pesimista", () => {
    expect(cobroEsperado(CHARS_MAX_POR_TOKENS)).toBeLessThanOrEqual(TOPE);
    expect(cobroPesimista(CHARS_MAX_POR_TOKENS)).toBeLessThanOrEqual(TOPE);
    // Margen que queda: ~8 % en el modelo esperado, ~1 % en el pesimista.
    expect(cobroEsperado(CHARS_MAX_POR_TOKENS) / TOPE).toBeLessThan(0.95);
  });

  it("la ventana que causó el exceso ya no sería admitida", () => {
    // 17.541 caracteres cobraron 10.835 tokens. Con 1.6 la guarda corta antes.
    expect(CHARS_MAX_POR_TOKENS).toBeLessThan(MEDICION.chars);
    expect(estimateTokens(MEDICION.chars)).toBeGreaterThan(TOPE);
  });

  it("ninguna ventana construida sobre corpus real excede el tope cobrado", () => {
    for (const n of [10, 60, 120, 300, 600, 2_000]) {
      const w = buildWindow(corpus(n));
      expect(w.estimatedInputTokens).toBeLessThanOrEqual(TOPE);
      expect(cobroEsperado(w.chars)).toBeLessThanOrEqual(TOPE);
      expect(cobroPesimista(w.chars)).toBeLessThanOrEqual(TOPE);
    }
  });

  it("las constantes descartadas SÍ habrían excedido: por eso el valor es 1.6", () => {
    // Deja asentada la aritmética de la calibración en vez de la conclusión sola.
    for (const descartada of [2.2, 3.8]) {
      const charsQueAdmitiria = (TOPE - PROMPT_SCAFFOLD_TOKENS) * descartada;
      expect(cobroEsperado(charsQueAdmitiria)).toBeGreaterThan(TOPE);
    }
  });
});

describe("D-1 · la cantidad efectiva de mensajes baja, y se DECLARA", () => {
  it("el tope que muerde primero pasa a ser el de TOKENS", () => {
    const w = buildWindow(corpus(600));
    expect(w.reason).toBe("tokens");
    expect(w.included.length).toBeLessThan(CONTEXT_LIMITS.maxMessages);
    // El de caracteres queda holgado: 11.952 < 24.000. No es letra muerta —sigue
    // aplicándose— pero ya no es el que decide.
    expect(w.chars).toBeLessThan(CONTEXT_LIMITS.maxChars);
  });

  it("en la densidad medida entran ~81 mensajes en vez de 120", () => {
    // 17.541 caracteres / 120 mensajes = 146,2 por mensaje (con encabezado).
    const densidadMedida = MEDICION.chars / 120;
    expect(Math.floor(CHARS_MAX_POR_TOKENS / densidadMedida)).toBe(81);
  });

  it("🔑 recortar más NO es recortar en silencio: el relato lo dice con cifras", () => {
    const w = buildWindow(corpus(600));
    const d = describeWindow(w);
    expect(w.truncated).toBe(true);
    expect(d).toContain("TRUNCADA");
    expect(d).toContain("tope de 8000 tokens de entrada");
    expect(d).toContain(String(w.included.length));
    expect(d).toContain("600");
    expect(d).toContain(String(w.omitted));
    expect(w.included.length + w.omitted).toBe(600);
  });
});

describe("D-1 · las otras cinco promesas siguen en pie", () => {
  it("los cuatro topes se aplican A LA VEZ", () => {
    const w = buildWindow(corpus(600));
    expect(w.included.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxMessages);
    expect(w.chars).toBeLessThanOrEqual(CONTEXT_LIMITS.maxChars);
    expect(w.estimatedInputTokens).toBeLessThanOrEqual(CONTEXT_LIMITS.maxInputTokens);
    expect(w.maxOutputTokens).toBe(CONTEXT_LIMITS.maxOutputTokens);
  });

  it("mensajes COMPLETOS: ningún cuerpo se parte", () => {
    const w = buildWindow(corpus(600));
    for (const m of w.included) expect(FRASES).toContain(m.body);
    const exacto = w.included.reduce((a, m) => a + m.body.length + PER_MESSAGE_OVERHEAD_CHARS, 0);
    expect(w.chars).toBe(exacto);
  });

  it("orden CRONOLÓGICO ascendente, y la cola del hilo es la que se conserva", () => {
    const t = corpus(600);
    const w = buildWindow(t);
    const fechas = w.included.map((m) => Date.parse(m.createdAt));
    expect(fechas).toEqual([...fechas].sort((a, b) => a - b));
    expect(w.included[w.included.length - 1].id).toBe(t[599].id);
  });

  it("estimateTokens usa la constante vigente y suma el andamiaje", () => {
    expect(estimateTokens(0)).toBe(PROMPT_SCAFFOLD_TOKENS);
    expect(estimateTokens(1_600)).toBe(1_000 + PROMPT_SCAFFOLD_TOKENS);
  });

  it("un único mensaje que no entra deja la ventana vacía, nunca medio mensaje", () => {
    const w = buildWindow([{ ...corpus(1)[0], body: "x".repeat(50_000) }]);
    expect(w.included).toHaveLength(0);
    expect(w.omitted).toBe(1);
    expect(w.truncated).toBe(true);
  });
});

describe("D-2 · el tope de salida sube a 6.000", () => {
  it("CONTEXT_LIMITS.maxOutputTokens = 6000", () => {
    expect(CONTEXT_LIMITS.maxOutputTokens).toBe(6_000);
  });

  it("6.000 supera con holgura los 1.990 en que se cortó el JSON medido", () => {
    expect(CONTEXT_LIMITS.maxOutputTokens).toBeGreaterThan(1_990 * 2);
  });

  it("el tope de salida viaja en la ventana y no se mezcla con el de entrada", () => {
    const w = buildWindow(corpus(10));
    expect(w.maxOutputTokens).toBe(6_000);
    expect(w.estimatedInputTokens).toBeLessThan(CONTEXT_LIMITS.maxInputTokens);
  });

  it("el costo por corrida con Flash sigue siendo centavos", async () => {
    const { estimateGeminiCostUsd } = await import("../providers/gemini");
    // Peor caso autorizado: 8.000 de entrada + 6.000 de salida.
    const peor = estimateGeminiCostUsd("gemini-2.5-flash", 8_000, 6_000);
    expect(peor).toBeLessThan(0.02);
    // 20 corridas diarias no ponen en riesgo el tope mensual de USD 15.
    expect(peor * 20 * 30).toBeLessThan(15);
  });
});
