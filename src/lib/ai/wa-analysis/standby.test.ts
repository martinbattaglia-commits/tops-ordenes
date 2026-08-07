// LINK-WA-002 · CIERRE CON IA ESTRUCTURADA EN STANDBY.
//
// Cuatro smokes reales fallaron, cada uno por una causa distinta y cada una medida:
//   1º  MAX_TOKENS               — el thinking agotó el cupo de salida
//   2º  context_limit_exceeded   — 10.835 tokens de entrada contra un tope de 8.000
//   3º  invalid_output           — JSON válido con un enum fuera de catálogo
//   4º  http_400                 — el proveedor rechazó el pedido
//
// Dirección resolvió PAUSAR el analizador y promover el resto del candidato. Lo que
// estos tests protegen no es una funcionalidad: es que la pausa REALMENTE pause, que
// no quede una puerta de atrás, y que NADA más se apague de paso.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

const RAIZ = process.cwd();
const leer = (p: string) => readFileSync(join(RAIZ, p), "utf8");
const MIGRATIONS_CUARENTENADAS = [
  "0213_ai_suggestions.sql",
  "0214_ai_budget_alerts.sql",
  "0215_ai_audit_retention.sql",
  "0216_ai_grants_hardening.sql",
  "0217_ai_run_lifecycle.sql",
  "0218_ai_usage_breakdown.sql",
] as const;

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); });

// ═══ 1 · El corte es FAIL-CLOSED y apagado por DEFECTO ═══════════════════════

describe("S1 · el standby está apagado por defecto", () => {
  it("🔑 sin la variable, el analizador está EN PAUSA", async () => {
    vi.stubEnv("AI_WA_ANALYSIS_ENABLED", "");
    const { env } = await import("@/lib/env");
    expect(env.ai.waAnalysisEnabled).toBe(false);
  });

  it("sólo «1» lo habilita: ningún valor parecido alcanza", async () => {
    for (const valor of ["0", "true", "TRUE", "yes", "si", "on", " 1", "1 ", "enabled"]) {
      vi.resetModules();
      vi.stubEnv("AI_WA_ANALYSIS_ENABLED", valor);
      const { env } = await import("@/lib/env");
      expect(env.ai.waAnalysisEnabled, `«${valor}» no debe habilitar`).toBe(false);
    }
    vi.resetModules();
    vi.stubEnv("AI_WA_ANALYSIS_ENABLED", "1");
    const { env } = await import("@/lib/env");
    expect(env.ai.waAnalysisEnabled).toBe(true);
  });

  it("es INDEPENDIENTE del kill-switch del Copilot", async () => {
    // El cierre resuelto es exactamente este estado: Copilot operativo, analizador
    // pausado. Si un solo flag gobernara ambos, apagar uno apagaría el otro.
    vi.stubEnv("AI_ENABLED", "1");
    vi.stubEnv("AI_WA_ANALYSIS_ENABLED", "");
    const { env } = await import("@/lib/env");
    expect(env.ai.enabled).toBe(true);          // Copilot: operativo
    expect(env.ai.waAnalysisEnabled).toBe(false); // analizador: en pausa
  });
});

// ═══ 2 · No existe vía alternativa para disparar el análisis ═════════════════

describe("S2 · 🔑 no queda ninguna puerta de atrás", () => {
  it("el corte está en el EMBUDO, antes de leer, reclamar o llamar al provider", () => {
    const src = leer("src/lib/ai/wa-analysis/analyze.ts");
    const cuerpo = src.slice(src.indexOf("export async function analyzeConversation"));
    const posCorte = cuerpo.indexOf("env.ai.waAnalysisEnabled");
    expect(posCorte, "el corte debe existir dentro de analyzeConversation").toBeGreaterThan(-1);
    // Todo lo costoso tiene que ocurrir DESPUÉS del corte.
    for (const despues of ["createClient()", "connect_messages", "ai_claim_analysis_run", "runStructuredAnalysis"]) {
      const pos = cuerpo.indexOf(despues);
      expect(pos, `«${despues}» debe estar después del corte`).toBeGreaterThan(posCorte);
    }
  });

  it("todo llamador del analizador pasa por `analyzeConversation`", () => {
    // Inventario EXHAUSTIVO sobre el árbol de src/: si mañana aparece una ruta nueva,
    // un cron o un script que importe el analizador, este test lo delata.
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const salida = execSync(
      `grep -rln --include=*.ts --include=*.tsx -e "analyzeConversation" -e "runStructuredAnalysis" src/ || true`,
      { cwd: RAIZ, encoding: "utf8" },
    );
    const archivos = salida.split("\n").filter(Boolean).filter((f) => !f.includes(".test."));
    // Los únicos autorizados: el analizador, el embudo del engine, la action y la UI.
    expect(archivos.sort()).toEqual([
      "src/app/(app)/connect/_components/SuggestionsInbox.tsx",
      "src/lib/ai/engine.ts",
      "src/lib/ai/wa-analysis/analyze.ts",
      "src/lib/connect/adapters/driving/wa-analysis-actions.ts",
    ]);
  });

  it("no hay ruta API que exponga el análisis", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const salida = execSync(
      `grep -rln --include=*.ts -e "analyzeConversation" -e "wa-analysis" src/app/api/ || true`,
      { cwd: RAIZ, encoding: "utf8" },
    );
    expect(salida.trim()).toBe("");
  });

  it("la server action también corta, y antes de cualquier consulta", () => {
    const src = leer("src/lib/connect/adapters/driving/wa-analysis-actions.ts");
    const cuerpo = src.slice(src.indexOf("export async function analyzeConversationAction"));
    const posCorte = cuerpo.indexOf("env.ai.waAnalysisEnabled");
    expect(posCorte).toBeGreaterThan(-1);
    expect(cuerpo.indexOf("requireAdmin()")).toBeGreaterThan(posCorte);
    expect(cuerpo.indexOf("analyzeConversation(")).toBeGreaterThan(posCorte);
  });

  it("el mensaje del standby es UNO, compartido, no copiado en cada capa", () => {
    const analyze = leer("src/lib/ai/wa-analysis/analyze.ts");
    const action = leer("src/lib/connect/adapters/driving/wa-analysis-actions.ts");
    expect(analyze).toContain("export const WA_ANALYSIS_STANDBY_MESSAGE");
    expect(analyze).toContain("Analizador temporalmente en pausa. No se ejecutarán nuevas corridas.");
    // La action IMPORTA la constante en vez de repetir el texto.
    expect(action).toContain("WA_ANALYSIS_STANDBY_MESSAGE");
    expect(action).not.toContain("Analizador temporalmente en pausa. No");
  });
});

// ═══ 3 · La UI lo refleja, y lo lee del servidor ════════════════════════════

describe("S3 · la interfaz", () => {
  const INBOX = "src/app/(app)/connect/_components/SuggestionsInbox.tsx";
  const visible = (p: string) => leer(p).split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
    .join("\n");

  it("el botón queda deshabilitado y dice «En pausa»", () => {
    const v = visible(INBOX);
    expect(v).toMatch(/disabled=\{ai\.waAnalysisStandby \|\| busy === t\.id\}/);
    expect(v).toContain('"En pausa"');
  });

  it("la explicación exigida está visible, textual", () => {
    expect(visible(INBOX)).toContain("Analizador temporalmente en pausa. No se ejecutarán nuevas corridas.");
  });

  it("🔒 el estado viene del SERVIDOR, no de un literal en el cliente", () => {
    const v = visible(INBOX);
    expect(v).toContain("ai.waAnalysisStandby");
    // Ni el nombre de la env var ni un booleano fijo pueden aparecer en el cliente.
    expect(v).not.toContain("AI_WA_ANALYSIS_ENABLED");
    expect(v).not.toContain("process.env");
    expect(v).not.toContain('from "@/lib/env"');
  });

  it("dice qué SIGUE funcionando: la pausa no puede leerse como una caída", () => {
    const v = visible(INBOX);
    expect(v).toMatch(/históricos/);
    expect(v).toMatch(/importador/);
    expect(v).toMatch(/historial de corridas/);
  });
});

// ═══ 4 · Nada más se apaga ══════════════════════════════════════════════════

describe("S4 · el cierre es quirúrgico", () => {
  it("el estado efectivo distingue Copilot operativo de analizador pausado", async () => {
    vi.stubEnv("AI_ENABLED", "1");
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("AI_WA_ANALYSIS_ENABLED", "");
    const { getAiRuntimeStatus } = await import("@/lib/ai/runtime-status");
    const s = getAiRuntimeStatus();
    expect(s.enabled).toBe(true);
    expect(s.waAnalysisStandby).toBe(true);
    expect(s.provider).toBe("gemini");
  });

  it("reactivar por configuración vuelve a habilitarlo: el cierre es REVERSIBLE", async () => {
    vi.stubEnv("AI_WA_ANALYSIS_ENABLED", "1");
    const { getAiRuntimeStatus } = await import("@/lib/ai/runtime-status");
    expect(getAiRuntimeStatus().waAnalysisStandby).toBe(false);
  });

  it("el objeto al cliente sigue CERRADO: un campo nuevo, ningún secreto", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("AI_GEMINI_API_KEY", "VALOR-SECRETO-DE-PRUEBA");
    const { getAiRuntimeStatus } = await import("@/lib/ai/runtime-status");
    const s = getAiRuntimeStatus();
    expect(Object.keys(s).sort()).toEqual([
      "dailyLimit", "enabled", "isMock", "maxChars", "maxInputTokens",
      "maxMessages", "maxOutputTokens", "model", "monthlyBudgetUsd", "provider",
      "waAnalysisStandby",
    ]);
    expect(JSON.stringify(s)).not.toContain("VALOR-SECRETO-DE-PRUEBA");
  });

  it("la capacidad runtime permanece implementada: el standby no amputó el analizador", () => {
    for (const f of [
      "src/lib/ai/wa-analysis/analyze.ts",
      "src/lib/ai/wa-analysis/schema.ts",
      "src/lib/ai/wa-analysis/prompt.ts",
      "src/lib/ai/wa-analysis/window.ts",
      "src/lib/ai/wa-analysis/mock-analyzer.ts",
      "src/lib/ai/wa-analysis/read.ts",
    ]) {
      expect(leer(f).length, `${f} debe existir y no estar vacío`).toBeGreaterThan(200);
    }
  });

  it.each(MIGRATIONS_CUARENTENADAS)(
    "%s: la migration histórica no tiene execution reachability desde supabase/migrations",
    (migration) => {
      const executable = join(RAIZ, "supabase/migrations", migration);
      expect(
        existsSync(executable),
        `${migration} reapareció como migration ejecutable; la historia preservada no equivale a execution reachability`,
      ).toBe(false);
    },
  );

  it("el contrato sigue cerrado: los catálogos no se tocaron al pausar", async () => {
    const { WA_CLASSES, WA_FINDINGS, WA_ACTIONS } = await import("./schema");
    expect(WA_CLASSES).toHaveLength(6);
    expect(WA_FINDINGS).toHaveLength(6);
    expect(WA_ACTIONS).toHaveLength(5);
  });

  it("el Copilot conversacional no fue tocado por el standby", () => {
    const engine = leer("src/lib/ai/engine.ts");
    const gemini = leer("src/lib/ai/providers/gemini.ts");
    // El flag del analizador NO aparece en el camino conversacional.
    const askCopilot = engine.slice(engine.indexOf("export async function askCopilot"));
    expect(askCopilot).not.toContain("waAnalysisEnabled");
    // `plan()` sigue sin las decisiones del camino estructurado.
    const plan = gemini.slice(gemini.indexOf("async plan("), gemini.indexOf("async generateJson("));
    expect(plan).not.toContain("thinkingConfig");
    expect(plan).not.toContain("responseSchema");
  });

  it("la decisión sobre sugerencias YA existentes sigue disponible", () => {
    // Dirección pausó «iniciar nuevas corridas», no revisar lo ya emitido.
    const action = leer("src/lib/connect/adapters/driving/wa-analysis-actions.ts");
    const decide = action.slice(action.indexOf("export async function decideSuggestionAction"));
    expect(decide).not.toContain("waAnalysisEnabled");
  });
});
