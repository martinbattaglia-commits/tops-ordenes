// LINK-WA-002 · estado efectivo de la IA en la interfaz.
//
// Estos tests existen por una desviación concreta: la bandeja anunciaba
// «provider mock (determinista, costo cero)» con texto FIJO, así que el Draft
// corriendo Gemini seguía diciendo mock y el operador no podía distinguir una
// corrida real de una simulada. La lección: un texto no atado al dato miente en
// silencio, y nadie se entera hasta que alguien mira.
//
// Se fija entonces: (1) el estado se deriva del entorno, (2) nunca vuelve un
// literal de provider a la UI, (3) al cliente sólo cruzan campos públicos.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `server-only` no existe fuera del runtime de Next: se neutraliza igual que en
// los demás tests del módulo (governance.test.ts, wa-analysis.test.ts).
vi.mock("server-only", () => ({}));

async function loadStatus() {
  vi.resetModules();
  return await import("./runtime-status");
}

beforeEach(() => vi.unstubAllEnvs());

describe("R1 · el estado refleja el ENTORNO, no una constante", () => {
  it("con AI_PROVIDER=gemini y AI_MODEL=flash informa gemini/flash y NO es mock", async () => {
    vi.stubEnv("AI_ENABLED", "1");
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("AI_MODEL", "gemini-2.5-flash");
    vi.stubEnv("AI_DAILY_LIMIT", "20");
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "15");
    const { getAiRuntimeStatus, providerLabel, costLabel } = await loadStatus();
    const s = getAiRuntimeStatus();
    expect(s).toMatchObject({
      enabled: true, provider: "gemini", model: "gemini-2.5-flash",
      dailyLimit: 20, monthlyBudgetUsd: 15, isMock: false,
    });
    expect(providerLabel(s)).toBe("Gemini · gemini-2.5-flash");
    expect(costLabel(s)).toContain("costo real");
  });

  it("con provider mock informa mock y costo cero", async () => {
    vi.stubEnv("AI_ENABLED", "1");
    vi.stubEnv("AI_PROVIDER", "mock");
    const { getAiRuntimeStatus, providerLabel, costLabel } = await loadStatus();
    const s = getAiRuntimeStatus();
    expect(s.isMock).toBe(true);
    expect(s.provider).toBe("mock");
    expect(providerLabel(s)).toContain("mock");
    expect(costLabel(s)).toContain("costo cero");
  });

  it("sin AI_ENABLED informa IA desactivada", async () => {
    vi.stubEnv("AI_ENABLED", "");
    vi.stubEnv("AI_PROVIDER", "gemini");
    const { getAiRuntimeStatus } = await loadStatus();
    const s = getAiRuntimeStatus();
    expect(s.enabled).toBe(false);
    // el provider sigue informándose: «desactivada» no significa «mock»
    expect(s.provider).toBe("gemini");
  });

  it("los topes de la ventana viajan a la UI y son los de E1.1", async () => {
    const { getAiRuntimeStatus } = await loadStatus();
    expect(getAiRuntimeStatus()).toMatchObject({
      maxMessages: 120, maxChars: 24_000, maxInputTokens: 8_000, maxOutputTokens: 6_000,
    });
  });
});

describe("R2 · al cliente NO cruza nada sensible", () => {
  it("el objeto tiene EXACTAMENTE los campos públicos permitidos", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    const { getAiRuntimeStatus } = await loadStatus();
    expect(Object.keys(getAiRuntimeStatus()).sort()).toEqual([
      "dailyLimit", "enabled", "isMock", "maxChars", "maxInputTokens",
      "maxMessages", "maxOutputTokens", "model", "monthlyBudgetUsd", "provider",
    ]);
  });

  it("serializado no contiene ninguna clave ni secreto", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("AI_GEMINI_API_KEY", "VALOR-SECRETO-DE-PRUEBA");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "OTRO-SECRETO");
    vi.stubEnv("CRON_SECRET", "TERCER-SECRETO");
    const { getAiRuntimeStatus } = await loadStatus();
    const json = JSON.stringify(getAiRuntimeStatus());
    for (const s of ["VALOR-SECRETO-DE-PRUEBA", "OTRO-SECRETO", "TERCER-SECRETO"]) {
      expect(json).not.toContain(s);
    }
    for (const k of ["apiKey", "Key", "secret", "Secret", "token", "password"]) {
      expect(json).not.toContain(k);
    }
  });

  it("es serializable como prop de React (sin funciones ni ciclos)", async () => {
    const { getAiRuntimeStatus } = await loadStatus();
    const s = getAiRuntimeStatus();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Guardas sobre el código de la UI. Son los que habrían atrapado la desviación.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = join(process.cwd(), "src/app/(app)/connect/ia-sugerencias/page.tsx");
const INBOX = join(process.cwd(), "src/app/(app)/connect/_components/SuggestionsInbox.tsx");

/** Texto visible: se descartan los comentarios, que sí pueden nombrar el defecto. */
function visible(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
}

describe("R3 · la UI no puede volver a anunciar un provider fijo", () => {
  it.each([["page", PAGE], ["inbox", INBOX]])(
    "%s: ningún nombre de provider aparece como literal en el texto visible",
    (_n, path) => {
      const v = visible(path).toLowerCase();
      for (const lit of ["provider mock", "determinista, costo cero", "determinista, sin costo",
                         "gemini 2.5", "gemini-2.5-flash", "claude-opus"]) {
        expect(v, `«${lit}» quedó fijo en la UI: debe derivarse del entorno`).not.toContain(lit);
      }
    },
  );

  it("la página lee el estado efectivo del servidor y lo pasa como prop", () => {
    const v = visible(PAGE);
    expect(v).toContain("getAiRuntimeStatus");
    expect(v).toMatch(/ai=\{ai\}/);
  });

  it("el inbox recibe `ai` por props y NO importa @/lib/env", () => {
    const v = visible(INBOX);
    expect(v).toContain("ai: AiRuntimeStatus");
    expect(v).not.toContain('from "@/lib/env"');
  });

  // D-1 · el tope de mensajes dejó de ser alcanzable en hilos densos: con la
  // constante calibrada sobre la medición real, el tope de TOKENS muerde antes
  // (11.952 caracteres ≈ 81 mensajes en la densidad medida, no 120). Anunciar
  // «hasta 120» sin más convertía un techo en una promesa.
  //
  // ⚠️ Es un grep sobre el texto visible, y un grep no protege conducta: alcanza
  // reescribir la frase para eludirlo. Lo que de verdad protege es que las cifras
  // vengan de `ai` y que la frase NOMBRE el tope que decide. Eso es lo que se mide.
  it("el inbox no promete un cupo fijo de mensajes: nombra el tope que decide", () => {
    const v = visible(INBOX);
    expect(v).not.toMatch(/hasta \{ai\.maxMessages\} mensajes por corrida/);
    expect(v).toContain("ai.maxInputTokens.toLocaleString");
    // La advertencia previa a gastar y el reporte posterior deben coexistir.
    expect(v).toMatch(/menos si primero/);
    expect(v).toContain("Ventana truncada por");
  });

  it("la página NO pasa el objeto env completo al cliente", () => {
    const v = visible(PAGE);
    expect(v).not.toMatch(/env=\{env\}/);
    expect(v).not.toMatch(/\{\.\.\.env\}/);
    expect(v).not.toMatch(/ai=\{env\.ai\}/);
  });

  it("el módulo de estado es server-only: no puede importarse desde el cliente", () => {
    expect(readFileSync(join(process.cwd(), "src/lib/ai/runtime-status.ts"), "utf8"))
      .toContain('import "server-only"');
  });
});
