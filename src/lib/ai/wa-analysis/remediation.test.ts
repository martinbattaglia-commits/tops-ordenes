// LINK-WA-002 · remediación del camino estructurado.
//
// Cada test acá nace de un defecto REAL que ocurrió en producción, no de una
// hipótesis. El smoke con Gemini falló y el diagnóstico encontró que:
//   · la auditoría económica NUNCA persistía (sessionId string vs uuid) ⇒ el
//     analizador corría sin tope diario ni mensual efectivos;
//   · el `throw` del proveedor descartaba el `usage` ⇒ el costo cobrado se perdía;
//   · el error no propagaba provider/model/detail ⇒ la causa raíz se perdía;
//   · `input_sha256` nunca se escribía ⇒ la garantía de evidencia de 0215 vacía;
//   · no había candado: dos pestañas eran dos cargos reales.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const VALIDATION_CONTRACTS = [
  {
    id: "0217",
    path: "supabase/tests/0217_ai_run_lifecycle_VALIDATION.sql",
    sha256: "208be040fac01679a5dcfcc940b9845df259a636b75f9781d02ff9eb36005720",
  },
  {
    id: "0218",
    path: "supabase/tests/0218_ai_usage_breakdown_VALIDATION.sql",
    sha256: "41d1d6a3af5912ec404ce816518c93b69c3c6055bf03c2a9705a9ea0f712ac43",
  },
] as const;

function sha256(path: string): string {
  return createHash("sha256")
    .update(readFileSync(join(process.cwd(), path)))
    .digest("hex");
}

describe("validation contracts 0217/0218 · custodia de identidad", () => {
  it.each(VALIDATION_CONTRACTS)(
    "$id: preserva SHA-256; no afirma comportamiento ni estado de ninguna DB",
    ({ id, path, sha256: expected }) => {
      expect(
        sha256(path),
        `cambió el contrato de validación ${id}; HASH MATCH no equivale a DB VALIDATION PASS`,
      ).toBe(expected);
    },
  );
});

vi.mock("server-only", () => ({}));

type AuditRes = { ok: true; messageId: string | null; persisted: boolean } | { ok: false; error: string };
type AuditFn = (sb: unknown, p: Record<string, unknown>) => Promise<AuditRes>;

const logInteraction = vi.fn(async (_sb: unknown, _p: Record<string, unknown>) => "msg-id");
const auditOk = vi.fn<AuditFn>(async () => ({ ok: true, messageId: "msg-id", persisted: true }));
const auditFail = vi.fn<AuditFn>(async () => ({ ok: false, error: "RLS: permission denied" }));
let auditImpl: AuditFn = auditOk;

const checkGate = vi.fn();
const checkBudget = vi.fn();
const checkMonthlyBudget = vi.fn();
const getProvider = vi.fn();
const maybeRaiseBudgetAlert = vi.fn(async () => ({
  raised: false, alreadyRaised: false, spentUsd: 0, capUsd: 15, pct: 0,
}));

vi.mock("../gate", () => ({ checkGate: (...a: unknown[]) => checkGate(...a) }));
vi.mock("../budget", () => ({
  checkBudget: (...a: unknown[]) => checkBudget(...a),
  checkMonthlyBudget: (...a: unknown[]) => checkMonthlyBudget(...a),
}));
vi.mock("../budget-alerts", () => ({
  maybeRaiseBudgetAlert: (...a: unknown[]) => maybeRaiseBudgetAlert(...(a as [])),
  alertMessage: () => "alerta",
}));
vi.mock("../audit", () => ({
  logInteraction: (sb: unknown, p: Record<string, unknown>) => logInteraction(sb, p),
  logInteractionResult: (sb: unknown, p: Record<string, unknown>) => auditImpl(sb, p),
  sha256: (s: string) => s,
}));
vi.mock("../provider", () => ({ getProvider: () => getProvider() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => null, createAdminClient: () => null }));

import { runStructuredAnalysis } from "../engine";
import { canonicalWindowSha256 } from "./analyze";
import type { WaMessageInput } from "./prompt";

const RUN_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const GEMINI = { name: "gemini", model: "gemini-2.5-flash", plan: vi.fn() };
const MOCK = { name: "mock", model: "mock-1", plan: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  auditImpl = auditOk;
  checkGate.mockResolvedValue({ ok: true, userId: "u1", demo: false });
  checkMonthlyBudget.mockResolvedValue({ allowed: true });
  checkBudget.mockResolvedValue({ allowed: true });
  getProvider.mockReturnValue(GEMINI);
});

const gen = (raw: string, usage?: { inputTokens: number; outputTokens: number; costUsd: number }) =>
  async () => ({ raw, ...(usage ? { usage } : {}) });

describe("R1 · identidad de auditoría: runId es el nexo entre las dos tablas", () => {
  it("el sessionId auditado ES el runId, no un string armado", async () => {
    await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: gen('{"ok":1}', { inputTokens: 100, outputTokens: 50, costUsd: 0.001 }),
    });
    expect(auditOk.mock.calls[0][1]).toMatchObject({ sessionId: RUN_ID });
  });

  it("lo que el engine AUDITA es un UUID, no una etiqueta armada", async () => {
    // Antes este test validaba la constante del propio archivo: pasaba igual con
    // el bug original (`structured:wa_analysis`). Ahora mira lo que el engine
    // realmente le pasó al RPC, que es donde estaba el defecto.
    await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis", generate: gen("{}"),
    });
    const auditado = (auditOk.mock.calls[0][1] as { sessionId: string }).sessionId;
    expect(auditado).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(auditado).not.toContain("structured");
    expect(auditado).not.toContain(":");
  });

  it("dos corridas NO comparten sessionId ⇒ dos usuarios no chocan por «sesión ajena»", async () => {
    const otro = "ffffffff-1111-4222-8333-444444444444";
    await runStructuredAnalysis({ runId: RUN_ID, prompt: "P", kind: "wa_analysis", generate: gen("{}") });
    await runStructuredAnalysis({ runId: otro, prompt: "P", kind: "wa_analysis", generate: gen("{}") });
    expect(auditOk.mock.calls[0][1]).toMatchObject({ sessionId: RUN_ID });
    expect(auditOk.mock.calls[1][1]).toMatchObject({ sessionId: otro });
  });
});

describe("R2 · auditoría económica FAIL-CLOSED", () => {
  it("si la auditoría no persiste, la corrida NO es exitosa: outcome audit_failure", async () => {
    auditImpl = auditFail;
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: gen('{"ok":1}', { inputTokens: 100, outputTokens: 50, costUsd: 0.001 }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.outcome).toBe("audit_failure");
      expect(r.audited).toBe(false);
      // El costo se informa igual: el proveedor cobró aunque no se pudiera auditar.
      expect(r.costUsd).toBe(0.001);
    }
  });

  it("con auditoría OK la corrida declara audited=true", async () => {
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: gen('{"ok":1}', { inputTokens: 10, outputTokens: 5, costUsd: 0.0001 }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(`esperaba éxito, llegó ${r.outcome}`);
    expect(r.audited).toBe(true);
  });

  it("el mensaje al usuario NO promete un análisis exitoso cuando la auditoría falló", async () => {
    auditImpl = auditFail;
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis", generate: gen('{"ok":1}'),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperaba fallo por auditoría");
    expect(r.message.toLowerCase()).toContain("descart");
  });
});

describe("R3 · el error conserva el usage: el costo cobrado no se pierde", () => {
  it("error DESPUÉS de recibir usage ⇒ tokens y costo quedan registrados", async () => {
    const err = Object.assign(new Error("Gemini cortó la salida por el tope de 2000 tokens"), {
      code: "max_tokens",
      usage: { inputTokens: 5147, outputTokens: 2000, costUsd: 0.0065 },
      finishReason: "MAX_TOKENS",
    });
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => { throw err; },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r).toMatchObject({
        outcome: "error", provider: "gemini", model: "gemini-2.5-flash",
        inputTokens: 5147, outputTokens: 2000, costUsd: 0.0065,
        finishReason: "MAX_TOKENS", errorCode: "max_tokens",
      });
    }
    // …y la auditoría recibió esos números, que es lo que alimenta el presupuesto.
    expect(auditOk.mock.calls[0][1]).toMatchObject({
      tokensIn: 5147, tokensOut: 2000, costEstimate: 0.0065, outcome: "error",
    });
  });

  it("error ANTES de recibir usage ⇒ costo NO VERIFICABLE (null), nunca inventado", async () => {
    const err = Object.assign(new Error("Gemini API error: HTTP 429"), {
      code: "http_429", usage: null, finishReason: null,
    });
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => { throw err; },
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperaba fallo del provider");
    {
      expect(r.costUsd).toBeNull();
      expect(r.inputTokens).toBeNull();
      expect(r.errorCode).toBe("http_429");
      // el modelo SÍ se informa: antes quedaba NULL justo cuando más importaba
      expect(r.model).toBe("gemini-2.5-flash");
    }
  });

  it("el detalle técnico llega al llamador, saneado y acotado", async () => {
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => { throw new Error("HTTP 404 modelo no disponible"); },
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperaba fallo del provider");
    {
      expect(r.detail).toContain("404");
      expect(r.detail!.length).toBeLessThanOrEqual(2000);
      // el mensaje al usuario sigue siendo gobernado, sin el status
      expect(r.message).not.toContain("404");
    }
  });

  it("el mock declara costo CERO VERIFICABLE, no «no verificable»", async () => {
    getProvider.mockReturnValue(MOCK);
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis", generate: gen("{}"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("el mock no debería fallar");
    expect(r.costUsd).toBe(0);
    expect(r.inputTokens).toBe(0);
  });
});

describe("R4 · validación ANTES de auditar y de persistir", () => {
  it("salida inválida ⇒ invalid_output, y el costo se audita igual (el proveedor cobró)", async () => {
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      validate: () => ({ ok: false, reason: "cita fuera de la ventana" }),
      generate: gen("basura", { inputTokens: 100, outputTokens: 20, costUsd: 0.0004 }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome).toBe("invalid_output");
    expect(auditOk.mock.calls[0][1]).toMatchObject({ costEstimate: 0.0004 });
  });

  it("el validador corre ANTES de la auditoría de éxito", async () => {
    const orden: string[] = [];
    auditImpl = vi.fn<AuditFn>(async () => { orden.push("audit"); return { ok: true, messageId: "m", persisted: true }; });
    await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      validate: () => { orden.push("validate"); return { ok: true }; },
      generate: gen("{}"),
    });
    expect(orden).toEqual(["validate", "audit"]);
  });
});

describe("R5 · la alerta del 70 % no consume cupo del usuario", () => {
  it("una alerta levantada NO genera un segundo asiento en ai_messages", async () => {
    maybeRaiseBudgetAlert.mockResolvedValue({
      raised: true, alreadyRaised: false, spentUsd: 10.5, capUsd: 15, pct: 70,
    });
    await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: gen('{"ok":1}', { inputTokens: 10, outputTokens: 5, costUsd: 0.0001 }),
    });
    // UNA sola auditoría: la de la corrida. La constancia de la alerta vive en
    // ai_budget_alerts, no en ai_messages, que es lo que cuenta el tope diario.
    expect(auditOk).toHaveBeenCalledTimes(1);
    expect(logInteraction).not.toHaveBeenCalled();
  });
});

describe("R6 · input_sha256 canónico y estable", () => {
  const m = (id: string, body: string, iso = "2026-01-01T00:00:00.000Z"): WaMessageInput => ({
    id, author: "Cliente", createdAt: iso, body,
  });

  it("es estable: la misma ventana da el mismo hash", () => {
    const a = [m("1", "hola"), m("2", "chau")];
    expect(canonicalWindowSha256(a)).toBe(canonicalWindowSha256([...a]));
    expect(canonicalWindowSha256(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cambiar UN mensaje cambia el hash", () => {
    const base = canonicalWindowSha256([m("1", "hola"), m("2", "chau")]);
    expect(canonicalWindowSha256([m("1", "hola"), m("2", "chau!")])).not.toBe(base);
  });

  it("cambiar el ORDEN cambia el hash (el orden es evidencia)", () => {
    const a = canonicalWindowSha256([m("1", "hola"), m("2", "chau")]);
    expect(canonicalWindowSha256([m("2", "chau"), m("1", "hola")])).not.toBe(a);
  });

  it("cambiar el timestamp o el autor cambia el hash", () => {
    const base = canonicalWindowSha256([m("1", "hola")]);
    expect(canonicalWindowSha256([m("1", "hola", "2026-01-02T00:00:00.000Z")])).not.toBe(base);
    expect(canonicalWindowSha256([{ ...m("1", "hola"), author: "Otro" }])).not.toBe(base);
  });

  it("agregar un mensaje al final cambia el hash (no es un hash débil por concatenación)", () => {
    const a = canonicalWindowSha256([m("1", "ab"), m("2", "c")]);
    const b = canonicalWindowSha256([m("1", "a"), m("2", "bc")]);
    expect(a).not.toBe(b);
  });

  it("hashea el cuerpo REDACTADO: dos ventanas que sólo difieren en el teléfono coinciden", () => {
    const h1 = canonicalWindowSha256([m("1", "llamame al +5491122334455")]);
    const h2 = canonicalWindowSha256([m("1", "llamame al +5491199887766")]);
    expect(h1).toBe(h2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Guardas de código: el candado y la visibilidad no pueden desaparecer sin ruido.
// ─────────────────────────────────────────────────────────────────────────────

const ANALYZE = readFileSync(join(process.cwd(), "src/lib/ai/wa-analysis/analyze.ts"), "utf8");
const ACTION = readFileSync(join(process.cwd(), "src/lib/connect/adapters/driving/wa-analysis-actions.ts"), "utf8");
const READ = readFileSync(join(process.cwd(), "src/lib/ai/wa-analysis/read.ts"), "utf8");

describe("R7 · orden y finalización del runtime", () => {
  it("la corrida se reclama por RPC antes de llamar al proveedor", () => {
    const iClaim = ANALYZE.indexOf("ai_claim_analysis_run");
    const iRun = ANALYZE.indexOf("runStructuredAnalysis({");
    expect(iClaim).toBeGreaterThan(0);
    expect(iRun).toBeGreaterThan(iClaim);
  });

  it("el cierre solicitado por el runtime pasa por RPC", () => {
    expect(ANALYZE).toContain("ai_finalize_analysis_run");
  });
});

describe("R8 · el truncamiento es visible para el OPERADOR", () => {
  it("la acción devuelve la ventana, no sólo los conteos", () => {
    expect(ACTION).toContain("window?:");
    expect(ACTION).toContain("omitted");
    expect(ACTION).toContain("window: r.window");
  });

  it("la lista de corridas expone detail y la economía", () => {
    expect(READ).toContain("detail");
    expect(READ).toContain("cost_usd");
    expect(READ).toContain("audited");
  });
});

describe("R9 · thinking desactivado SÓLO en el camino estructurado", () => {
  const GEM = readFileSync(join(process.cwd(), "src/lib/ai/providers/gemini.ts"), "utf8");

  it("generateJson apaga el razonamiento", () => {
    const i = GEM.indexOf("async generateJson");
    expect(GEM.slice(i).indexOf("thinkingBudget: 0")).toBeGreaterThan(0);
  });

  it("plan() —el Copilot conversacional— NO lo apaga: no se toca su comportamiento", () => {
    const plan = GEM.slice(GEM.indexOf("async plan("), GEM.indexOf("async generateJson"));
    expect(plan).not.toContain("thinkingConfig");
  });

  it("el error del provider conserva el usage por contrato", () => {
    expect(GEM).toContain("class GeminiStructuredError");
    expect(GEM).toMatch(/readonly usage: ProviderUsage \| null/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Los defectos que la revisión adversarial final encontró rompiendo el código de
// producción SIN romper estos tests. Cada uno de acá falla si el defecto vuelve.
// ─────────────────────────────────────────────────────────────────────────────

describe("R10 · CRITICAL: `audited` es una constatación, nunca un literal", () => {
  it("auditoría que NO persistió (modo demo con base ausente) ⇒ audit_failure", async () => {
    // `logInteractionResult` devuelve {ok:true, persisted:false} cuando no hay
    // cliente de datos. Con `audited: true` literal, una corrida sin UNA SOLA fila
    // en ai_messages se declaraba auditada: el defecto original con una mentira
    // encima, e invisible para la reconciliación.
    auditImpl = vi.fn<AuditFn>(async () => ({ ok: true, messageId: null, persisted: false }));
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: gen('{"ok":1}', { inputTokens: 100, outputTokens: 50, costUsd: 0.001 }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("una corrida sin auditoría persistida NO puede ser exitosa");
    expect(r.outcome).toBe("audit_failure");
    expect(r.audited).toBe(false);
  });

  it("el código NO contiene `audited: true` como literal en el retorno de éxito", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/ai/engine.ts"), "utf8");
    const cuerpo = src.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
    expect(cuerpo).not.toMatch(/audited:\s*true\s*,/);
    // La afirmación se DERIVA del resultado de la auditoría, en los tres retornos
    // (éxito, error del provider e invalid_output).
    expect(cuerpo.match(/audited: audit\.ok && audit\.persisted/g) ?? []).toHaveLength(3);
  });

  it("la guarda exige persistencia, no sólo ausencia de error", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/ai/engine.ts"), "utf8");
    expect(src).toContain("!audit.ok || !audit.persisted");
  });
});

describe("R11 · HIGH: el hash canónico no se puede colisionar", () => {
  const m = (id: string, body: string): WaMessageInput => ({
    id, author: "a", createdAt: "2026-01-01T00:00:00.000Z", body,
  });

  it("un cuerpo con los separadores de control NO imita la frontera", () => {
    // Colisión real con separadores crudos: el cuerpo del primer mensaje inyecta
    // el separador de REGISTRO (\u001e) más los campos del segundo, así la cadena
    // canónica de una ventana de 1 mensaje queda idéntica a la de 2.
    const T = "2026-01-01T00:00:00.000Z";
    const uno = [m("1", `x\u001e2\u001f${T}\u001fa\u001fy`)];
    const dos = [m("1", "x"), m("2", "y")];
    // (con `join` crudo ambas darían "1␟T␟a␟x␞2␟T␟a␟y" — el mismo hash)
    expect(canonicalWindowSha256(uno)).not.toBe(canonicalWindowSha256(dos));
  });

  it("un cuerpo con comillas, barras y saltos de línea no rompe la canonicalización", () => {
    const a = canonicalWindowSha256([m("1", 'dice "hola\\" y')]);
    const b = canonicalWindowSha256([m("1", 'dice "hola\\"'), m("2", "y")]);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mover texto de un mensaje al siguiente cambia el hash", () => {
    expect(canonicalWindowSha256([m("1", "ab"), m("2", "")]))
      .not.toBe(canonicalWindowSha256([m("1", "a"), m("2", "b")]));
  });
});

describe("R14 · una excepción no deja el hilo bloqueado ni el cargo sin auditar", () => {
  const ANA = readFileSync(join(process.cwd(), "src/lib/ai/wa-analysis/analyze.ts"), "utf8");

  it("todo lo posterior al claim va dentro de try/catch", () => {
    const iClaim = ANA.indexOf("ai_claim_analysis_run");
    const iTry = ANA.indexOf("try {", iClaim);
    const iRun = ANA.indexOf("runStructuredAnalysis({");
    expect(iTry).toBeGreaterThan(iClaim);
    expect(iRun).toBeGreaterThan(iTry);
  });

  it("una excepción imprevista cierra la corrida como error, no la deja en_curso", () => {
    expect(ANA).toContain('errorCode: "unhandled"');
    expect(ANA).toContain("excepción no prevista");
  });

  it("si el cierre falla, NO se declara éxito aunque haya sugerencias", () => {
    expect(ANA).toContain("no se pudo cerrar su registro");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// R15 · La red de contención, cerrada.
//
// La revalidación demostró que regresiones runtime reales podían conservar strings
// esperados y aun así romper la conducta. Estas pruebas ejercitan el comportamiento
// observable; las propiedades de DB quedan a cargo de los validation artifacts.
// ─────────────────────────────────────────────────────────────────────────────

describe("R15 · las regresiones que la suite dejaba pasar", () => {
  it("B2 · provider REAL sin usage en el camino de éxito ⇒ costo NULL, jamás 0", async () => {
    // La rotura era `costUsd: usage?.costUsd ?? 0`: una llamada facturada quedaba
    // como «cero verificado». Con provider real y usage ausente debe dar null.
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => ({ raw: '{"ok":1}', usage: null }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("el provider respondió: debía ser éxito");
    expect(r.costUsd).toBeNull();
    expect(r.inputTokens).toBeNull();
    expect(r.outputTokens).toBeNull();
    // …y lo que se auditó también es null, no 0: es lo que alimenta el presupuesto.
    expect(auditOk.mock.calls[0][1]).toMatchObject({ costEstimate: null, tokensIn: null });
  });

  it("B2b · el MOCK sí declara 0, porque su cero es verificable", async () => {
    getProvider.mockReturnValue(MOCK);
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => ({ raw: "{}", usage: null }),
    });
    if (!r.ok) throw new Error("el mock no falla");
    expect(r.costUsd).toBe(0);
  });

  it("B1b · en modo demo (sin base) tampoco los caminos de FALLO declaran audited", async () => {
    // Hallazgo de la revalidación: los retornos de error usaban `audit.ok`, que es
    // true en demo aunque nada se haya persistido. El objeto `economics` que ve el
    // operador mentía.
    auditImpl = vi.fn<AuditFn>(async () => ({ ok: true, messageId: null, persisted: false }));
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => { throw Object.assign(new Error("HTTP 500"), { code: "http_500", usage: null }); },
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperaba fallo");
    expect(r.audited).toBe(false);
  });

  it("B1c · salida inválida en demo tampoco se declara auditada", async () => {
    auditImpl = vi.fn<AuditFn>(async () => ({ ok: true, messageId: null, persisted: false }));
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      validate: () => ({ ok: false, reason: "cita fuera de ventana" }),
      generate: gen("basura"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperaba invalid_output");
    expect(r.audited).toBe(false);
  });

  it("B4 · el contrato del generador declara `usage` NULLABLE (protección de tipos)", () => {
    // Sin esto TypeScript no impedía volver a `?? 0`: el cast local lavaba el null.
    const src = readFileSync(join(process.cwd(), "src/lib/ai/engine.ts"), "utf8");
    expect(src).toMatch(/usage\?: ProviderUsage \| null/);
    const ana = readFileSync(join(process.cwd(), "src/lib/ai/wa-analysis/analyze.ts"), "utf8");
    expect(ana).toMatch(/costUsd: number \} \| null/);
  });
});

describe("R16 · B3 · el cierre fallido se REPORTA (comportamiento, no grep)", () => {
  it("finalizeRun devuelve false cuando el RPC falla", async () => {
    const { finalizeRun } = await import("./analyze");
    const rpc = vi.fn(async () => ({ error: { message: "permission denied" } }));
    const ok = await finalizeRun({
      supabase: { rpc }, runId: RUN_ID, outcome: "ok",
      economics: { provider: "gemini", model: "gemini-2.5-flash", inputTokens: 10, outputTokens: 5, costUsd: 0.001, audited: true },
      detail: "d", finishReason: null, errorCode: null, analyzed: 1, emitted: 1,
      win: { included: [{ id: "1", author: "a", createdAt: "2026-01-01T00:00:00.000Z", body: "x" }] },
    });
    expect(ok).toBe(false);
    expect(rpc).toHaveBeenCalledWith("ai_finalize_analysis_run", expect.any(Object));
  });

  it("finalizeRun devuelve true sólo cuando el RPC no dio error", async () => {
    const { finalizeRun } = await import("./analyze");
    const ok = await finalizeRun({
      supabase: { rpc: async () => ({ error: null }) }, runId: RUN_ID, outcome: "ok",
      economics: { provider: "mock", model: "mock-1", inputTokens: 0, outputTokens: 0, costUsd: 0, audited: true },
      detail: "d", finishReason: null, errorCode: null, analyzed: 1, emitted: 0,
      win: { included: [] },
    });
    expect(ok).toBe(true);
  });

  it("sin cliente de datos NO se declara cerrada", async () => {
    const { finalizeRun } = await import("./analyze");
    const ok = await finalizeRun({
      supabase: null, runId: RUN_ID, outcome: "ok",
      economics: { provider: "mock", model: null, inputTokens: null, outputTokens: null, costUsd: null, audited: false },
      detail: "d", finishReason: null, errorCode: null, analyzed: 0, emitted: 0, win: { included: [] },
    });
    expect(ok).toBe(false);
  });

  it("NO manda la economía al RPC: la deriva la base", async () => {
    const { finalizeRun } = await import("./analyze");
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ error: null }));
    await finalizeRun({
      supabase: { rpc }, runId: RUN_ID, outcome: "ok",
      economics: { provider: "gemini", model: "m", inputTokens: 99, outputTokens: 88, costUsd: 7.7, audited: true },
      detail: "d", finishReason: null, errorCode: null, analyzed: 1, emitted: 1, win: { included: [] },
    });
    const args = rpc.mock.calls[0][1];
    for (const k of ["p_tokens_in", "p_tokens_out", "p_cost_usd", "p_audited"]) {
      expect(args, `${k} no debe viajar desde el cliente`).not.toHaveProperty(k);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R17 · D-1 postcheck de conformidad y D-3 desglose de usage.
//
// La 2ª corrida real excedió el tope de entrada (10.835 contra 8.000) y nada lo
// detectó: la guarda trabaja con una ESTIMACIÓN y el proveedor cobra por tokens
// reales. Y `outputTokens` sumaba candidates + thoughts, así que era imposible
// AFIRMAR si el razonamiento estaba apagado.
// ─────────────────────────────────────────────────────────────────────────────

describe("R17 · D-1 · conformidad medida contra lo COBRADO", () => {
  it("input real por encima del tope ⇒ conforme=false con el motivo y los números", async () => {
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => ({
        raw: '{"ok":1}',
        usage: { inputTokens: 10_835, outputTokens: 1_990, costUsd: 0.008226 },
      }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("el provider respondió");
    expect(r.conforme).toBe(false);
    expect(r.deviation).toContain("context_limit_exceeded");
    expect(r.deviation).toContain("10835");
    expect(r.deviation).toContain("8000");
  });

  it("input dentro del tope ⇒ conforme=true sin desviación", async () => {
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => ({
        raw: '{"ok":1}', usage: { inputTokens: 7_900, outputTokens: 3_000, costUsd: 0.01 },
      }),
    });
    if (!r.ok) throw new Error("esperaba éxito");
    expect(r.conforme).toBe(true);
    expect(r.deviation).toBeNull();
  });

  it("sin usage NO se declara incumplimiento: no hay evidencia en contra", async () => {
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => ({ raw: '{"ok":1}', usage: null }),
    });
    if (!r.ok) throw new Error("esperaba éxito");
    expect(r.conforme).toBe(true);
    expect(r.deviation).toBeNull();
  });

  it("la conformidad también se evalúa en el camino de ERROR", async () => {
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => {
        throw Object.assign(new Error("Gemini cortó la salida por el tope de 6000 tokens"), {
          code: "max_tokens", finishReason: "MAX_TOKENS",
          usage: { inputTokens: 12_000, outputTokens: 6_000, costUsd: 0.0186 },
        });
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperaba fallo");
    expect(r.conforme).toBe(false);
    expect(r.deviation).toContain("12000");
  });
});

describe("R17 · D-3 · el desglose viaja y se distingue del registro económico", () => {
  it("candidates y thoughts quedan SEPARADOS, no sumados en un solo número", async () => {
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => ({
        raw: '{"ok":1}',
        usage: {
          inputTokens: 5_000, outputTokens: 2_000, costUsd: 0.0065,
          breakdown: { promptTokens: 5_000, candidatesTokens: 1_400, thoughtsTokens: 600, totalTokens: 7_000 },
        },
      }),
    });
    if (!r.ok) throw new Error("esperaba éxito");
    expect(r.usageBreakdown).toEqual({
      promptTokens: 5_000, candidatesTokens: 1_400, thoughtsTokens: 600, totalTokens: 7_000,
    });
    // Con el desglose ya se puede AFIRMAR si el razonamiento consumió cupo.
    expect(r.usageBreakdown!.thoughtsTokens).toBe(600);
    expect(r.usageBreakdown!.candidatesTokens + r.usageBreakdown!.thoughtsTokens).toBe(r.outputTokens);
  });

  it("thoughts en 0 permite afirmar que el razonamiento está apagado", async () => {
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => ({
        raw: '{"ok":1}',
        usage: {
          inputTokens: 100, outputTokens: 50, costUsd: 0.0001,
          breakdown: { promptTokens: 100, candidatesTokens: 50, thoughtsTokens: 0, totalTokens: 150 },
        },
      }),
    });
    if (!r.ok) throw new Error("esperaba éxito");
    expect(r.usageBreakdown!.thoughtsTokens).toBe(0);
  });

  it("el desglose también se conserva cuando el provider FALLA", async () => {
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => {
        throw Object.assign(new Error("cortado"), {
          code: "max_tokens",
          usage: {
            inputTokens: 5_000, outputTokens: 6_000, costUsd: 0.0165,
            breakdown: { promptTokens: 5_000, candidatesTokens: 5_800, thoughtsTokens: 200, totalTokens: 11_000 },
          },
        });
      },
    });
    if (r.ok) throw new Error("esperaba fallo");
    expect(r.usageBreakdown!.candidatesTokens).toBe(5_800);
  });

  it("sin usage el desglose es null, no un objeto de ceros", async () => {
    const r = await runStructuredAnalysis({
      runId: RUN_ID, prompt: "P", kind: "wa_analysis",
      generate: async () => ({ raw: "{}", usage: null }),
    });
    if (!r.ok) throw new Error("esperaba éxito");
    expect(r.usageBreakdown).toBeNull();
  });
});
