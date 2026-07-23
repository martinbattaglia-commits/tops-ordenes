// Runner del MANUAL DE ACEPTACIÓN del Copilot (2026-07-07) — env-gated.
// Corre las 104 preguntas del brief de Dirección contra askCopilot en demo
// mode (fixtures + provider mock determinístico) y vuelca un JSON con la
// evidencia cruda por pregunta (outcome, tools, visual, fuentes, citas) para
// el grading humano PASS/PARTIAL/FAIL. NO corre en CI: solo con
// COPILOT_ACCEPTANCE=1 (npm test lo saltea).
//
//   COPILOT_ACCEPTANCE=1 npx vitest run src/lib/ai/acceptance-smoke.test.ts
//
// También regenera la matriz de aceptación (Fase 1 del protocolo) en
// docs/superpowers/COPILOT_ACCEPTANCE_QUESTION_MATRIX.md.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACCEPTANCE_QUESTIONS } from "./acceptance-questions";

const RUN = process.env.COPILOT_ACCEPTANCE === "1";
const OUT = process.env.COPILOT_ACCEPTANCE_OUT ?? "copilot-acceptance-results.json";
const MATRIX = "docs/superpowers/COPILOT_ACCEPTANCE_QUESTION_MATRIX.md";

(RUN ? describe : describe.skip)("manual de aceptación · batería completa (demo)", () => {
  beforeAll(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("AI_PROVIDER", "mock");
    vi.stubEnv("AI_ENABLED", "1");
    // La batería completa supera el presupuesto diario default (40): se eleva
    // SOLO para esta corrida de aceptación (env del proceso de test, no prod).
    vi.stubEnv("AI_DAILY_LIMIT", "500");
  });
  afterAll(() => vi.unstubAllEnvs());

  it(
    "corre las 104 preguntas y vuelca evidencia cruda",
    async () => {
      const { askCopilot } = await import("./engine");

      // El audit demo imprime `tools=` por turno (console.info) — se captura
      // para registrar qué tools corrió el engine (sources solo trae citadas).
      const auditLines: string[] = [];
      const origInfo = console.info;
      console.info = (...a: unknown[]) => {
        const line = a.map(String).join(" ");
        if (line.includes("[ai/audit demo]")) auditLines.push(line);
        else origInfo(...a);
      };

      const results: Array<Record<string, unknown>> = [];
      try {
        for (const q of ACCEPTANCE_QUESTIONS) {
          const before = auditLines.length;
          const res = await askCopilot({
            sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            question: q.pregunta,
            history: [],
            channel: "page",
          });
          const audit = auditLines.slice(before).at(-1) ?? "";
          const tools = audit.match(/tools=([^ ]*)/)?.[1] ?? "";
          const v = res.visual;
          results.push({
            id: q.id,
            seccion: q.seccion,
            tipo: q.tipo,
            pregunta: q.pregunta,
            outcome: res.outcome,
            tools: tools.split(",").filter(Boolean),
            citas: (res.answer.match(/\[S\d+\]/g) ?? []).length,
            fuentes: res.sources.map((s) => ({
              tool: s.tool,
              entityType: s.entityType,
              url: s.url,
            })),
            visual: v
              ? {
                  kind: v.kind,
                  title: v.title,
                  kpis: v.kpis?.length ?? 0,
                  tableCols: v.table?.columns ?? null,
                  tableRows: v.table?.rows.length ?? 0,
                  rowLinks: v.table?.rowLinks?.filter(Boolean).length ?? 0,
                  charts: [...(v.chart ? [v.chart] : []), ...(v.charts ?? [])].map(
                    (c) => `${c.type}:${c.title ?? ""}`
                  ),
                  insights: v.insights?.length ?? 0,
                  warnings: v.warnings ?? [],
                }
              : null,
            answer: res.answer,
          });
        }
      } finally {
        console.info = origInfo;
      }

      const outPath = resolve(process.cwd(), OUT);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(results, null, 2));

      // Matriz de aceptación (Fase 1): una fila por pregunta del manual.
      const matrix = [
        "# Copilot · Matriz de preguntas de aceptación",
        "",
        "Fuente: `Nexus_Copilot_Brief_Preguntas_por_Seccion` (brief de Dirección, julio 2026).",
        "Este documento es el CONTRATO de aceptación funcional del Copilot: no es una lista decorativa.",
        `Preguntas: ${ACCEPTANCE_QUESTIONS.length}. Regenerada por acceptance-smoke.test.ts.`,
        "",
        "| # | Sección | Pregunta | Intención | Módulos | Resultado esperado | Visual esperado |",
        "|---|---------|----------|-----------|---------|--------------------|-----------------|",
        ...ACCEPTANCE_QUESTIONS.map(
          (q) =>
            `| ${q.id} | ${q.seccion} | ${q.pregunta} | ${q.tipo} | ${q.modulos.join(", ")} | ${q.esperado} | ${q.visualEsperado} |`
        ),
        "",
      ].join("\n");
      writeFileSync(resolve(process.cwd(), MATRIX), matrix);

      expect(results).toHaveLength(ACCEPTANCE_QUESTIONS.length);
      // Piso duro del manual: ninguna pregunta puede terminar en error del engine.
      expect(results.filter((r) => r.outcome === "error")).toEqual([]);
    },
    180_000
  );
});
