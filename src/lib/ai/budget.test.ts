// F5.2-lite · Tests del presupuesto (parte pura + contador demo).
// F5 · Tests del path DB de checkBudget (conteo personal + override) y del tope
// mensual global, con un cliente Supabase mockeado (sin red ni DB reales).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeBudgetState, demoCount, startOfTodayIso } from "./budget";

describe("computeBudgetState", () => {
  it("permite bajo el límite y corta al alcanzarlo", () => {
    expect(computeBudgetState(0, 40).allowed).toBe(true);
    expect(computeBudgetState(39, 40).allowed).toBe(true);
    expect(computeBudgetState(40, 40).allowed).toBe(false);
    expect(computeBudgetState(41, 40).allowed).toBe(false);
  });
  it("explica el motivo al cortar", () => {
    const s = computeBudgetState(40, 40);
    expect(s.reason).toContain("40");
  });
});

describe("demoCount", () => {
  it("incrementa por usuario y resetea por día", () => {
    const day1 = new Date("2026-07-03T10:00:00");
    expect(demoCount("u1", day1)).toBe(1);
    expect(demoCount("u1", day1)).toBe(2);
    expect(demoCount("u2", day1)).toBe(1); // otro usuario, contador propio
    const day2 = new Date("2026-07-04T10:00:00");
    expect(demoCount("u1", day2)).toBe(1); // nuevo día → reset
  });
});

describe("startOfTodayIso", () => {
  it("devuelve la medianoche local del día dado", () => {
    const iso = startOfTodayIso(new Date("2026-07-03T15:30:00"));
    expect(new Date(iso).getHours()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// F5 · Path DB de checkBudget: conteo SIEMPRE personal (filtro user_id
// explícito, no RLS) + límite por usuario vía ai_daily_limit_for. Fail-closed.
// ─────────────────────────────────────────────────────────────────────────

type EqCall = [string, unknown];

/** Cliente Supabase mínimo mockeado para el path real de checkBudget. */
function supabaseMock(opts: {
  limit?: { data: unknown; error: unknown };
  count?: number | null;
  countError?: unknown;
}) {
  const eqCalls: EqCall[] = [];
  const builder: Record<string, unknown> = {};
  builder.eq = (col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return builder;
  };
  builder.gte = () =>
    Promise.resolve({ count: opts.count ?? null, error: opts.countError ?? null });
  const supabase = {
    rpc: async (_name: string, _args?: unknown) =>
      opts.limit ?? { data: null, error: { message: "no fn" } },
    from: () => ({ select: () => builder }),
  };
  return { supabase: supabase as never, eqCalls };
}

async function loadBudget() {
  return await import("./budget");
}

describe("checkBudget · conteo personal + override diario (FIX F5)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it("sin override → usa el default (40): permite bajo, corta al alcanzar", async () => {
    vi.stubEnv("AI_DAILY_LIMIT", "40");
    const { checkBudget } = await loadBudget();
    const under = supabaseMock({ limit: { data: 40, error: null }, count: 39 });
    expect((await checkBudget(under.supabase, "u1")).allowed).toBe(true);
    const at = supabaseMock({ limit: { data: 40, error: null }, count: 40 });
    const s = await checkBudget(at.supabase, "u1");
    expect(s.allowed).toBe(false);
    expect(s.limit).toBe(40);
  });

  it("override 300 (superadmin) → permite lo que a 40 se cortaría", async () => {
    const { checkBudget } = await loadBudget();
    const m = supabaseMock({ limit: { data: 300, error: null }, count: 250 });
    const s = await checkBudget(m.supabase, "martin");
    expect(s.allowed).toBe(true);
    expect(s.limit).toBe(300);
    expect(s.requestsToday).toBe(250);
  });

  it("cuenta SOLO lo propio: filtra por user_id explícito (admin y usuario común)", async () => {
    const { checkBudget } = await loadBudget();
    for (const uid of ["admin-uid", "normal-uid"]) {
      const m = supabaseMock({ limit: { data: 40, error: null }, count: 3 });
      await checkBudget(m.supabase, uid);
      expect(m.eqCalls).toContainEqual(["user_id", uid]);
      expect(m.eqCalls).toContainEqual(["role", "user"]);
    }
  });

  it("resolución de límite fail-closed: si la RPC falla → default (nunca abre)", async () => {
    vi.stubEnv("AI_DAILY_LIMIT", "40");
    const { checkBudget } = await loadBudget();
    const m = supabaseMock({ limit: { data: null, error: { message: "boom" } }, count: 40 });
    const s = await checkBudget(m.supabase, "u1");
    expect(s.limit).toBe(40);
    expect(s.allowed).toBe(false);
  });

  it("valor de override inválido (<=0 / no numérico) → cae al default", async () => {
    vi.stubEnv("AI_DAILY_LIMIT", "40");
    const { checkBudget } = await loadBudget();
    for (const bad of [0, -5, "abc", null]) {
      const m = supabaseMock({ limit: { data: bad, error: null }, count: 10 });
      expect((await checkBudget(m.supabase, "u1")).limit).toBe(40);
    }
  });

  it("fail-closed: si no puede contar → no gasta (allowed=false)", async () => {
    const { checkBudget } = await loadBudget();
    const m = supabaseMock({
      limit: { data: 300, error: null },
      count: null,
      countError: { message: "boom" },
    });
    const s = await checkBudget(m.supabase, "u1");
    expect(s.allowed).toBe(false);
    expect(s.requestsToday).toBe(-1);
  });
});

describe("checkMonthlyBudget · tope global sigue cortando (F5)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it("gasto >= cap → corta", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "100");
    const { checkMonthlyBudget } = await loadBudget();
    const supabase = { rpc: async () => ({ data: 100, error: null }) } as never;
    expect((await checkMonthlyBudget(supabase)).allowed).toBe(false);
  });

  it("gasto < cap → permite", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "100");
    const { checkMonthlyBudget } = await loadBudget();
    const supabase = { rpc: async () => ({ data: 0.37, error: null }) } as never;
    expect((await checkMonthlyBudget(supabase)).allowed).toBe(true);
  });

  it("error al leer el spend → fail-closed (corta)", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "100");
    const { checkMonthlyBudget } = await loadBudget();
    const supabase = { rpc: async () => ({ data: null, error: { message: "boom" } }) } as never;
    expect((await checkMonthlyBudget(supabase)).allowed).toBe(false);
  });
});
