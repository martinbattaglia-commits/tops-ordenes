# F2 — Qualification Engine · Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Construir el Qualification Engine v1: para cada prospecto importado por F1, derivar un CompanyProfile de la evidencia del CSV y calcular —con funciones puras isomórficas— Lead Score + Confidence + Prioridad + decisión + explicación + Decision Trace, persistido en tablas aditivas, visible en preview/bandeja/dashboard.

**Architecture:** Pure Isomorphic ScoringStrategy. El dominio `src/lib/prospeccion/qualification/` es matemática pura (cero I/O, client-safe) que corre en el navegador (preview instantáneo) y en el servidor (autoritativo, persistido). Fuente de verdad: `docs/prospeccion/F2/ARQUITECTURA-F2-QUALIFICATION.md` (v1.2).

**Tech Stack:** TypeScript, Next.js (app router), Supabase (Postgres + RPC), vitest, Zod, Tailwind (design tokens). Sin dependencias nuevas.

## ⚠️ ESTADO: EN ESPERA + correcciones de verificación a aplicar al arrancar

> **F2 EN ESPERA del merge de F1 (PR #42), por decisión de Dirección.** Cuando F1 mergee a `main`, F2 ramifica `feat/prospeccion-f2-qualification` desde ese `main` (que ya incluye F1: ImportWizard, importProspectsAction, UDIE) — **plan completo, sin diferir**. NO crear la rama antes.
>
> **Verificación adversarial (R1 ready-with-fixes / R2 needs-rework) — aplicar estos fixes al arrancar F2:**
> 1. **(Blocker, resuelto en diseño)** El commit en 2 pasos NO puede correlacionar el lote (ingest no devuelve ids ni batch-id). → El RPC 0106 matchea cada calificación a su prospecto **por clave de dedup** (cuit/email/linkedin, la misma que usó F0), sobre `status='imported'`; NO por lote. Sin tocar F0.
> 2. **(High)** Unificar nombre de campo: usar **`profileInputs`** en TS (CompanyProfile + DecisionTrace); la columna DB es `profile_raw` → el write adapter mapea `profile_raw ← profile.profileInputs`. (Corregir §8 del doc de arquitectura, que dice `profileRaw`.)
> 3. **(High)** Agregar **`strategyId`** al `QualificationResult` del doc de arquitectura §8 (el plan ya lo tiene; `buildDecisionTrace` lo consume).
> 4. **(Medium)** `computePriority` debe usar señales de negocio (employeeBand/revenueBand/dentroMercadoObjetivo) además de score+confidence — no dejar `_p`/`_icp` sin uso (Task 5).
> 5. **(Medium)** §5.2 / Task 12: leer `raw` de **`prospeccion_prospects`** (el evento `prospect.imported` NO trae `raw`). El reader port ya hace esto; quitar la variante "raw del evento".
> 6. **(Medium)** PGLite NO está en el repo: agregar **`@electric-sql/pglite` como devDependency** (corrige "sin deps nuevas" → "sin deps de runtime"), crear `scripts/qualification-ddl-validate.mjs` + `prereqs.sql` (stub roles/has_permission/is_admin/enum/prospects) para validar 0106 (Task 9 step 2).
> 7. **(Medium)** `result.ts` clonado: agregar comentario de divergencia vs `src/lib/prospeccion/domain/result.ts` (2 genéricos) + el boundary debe prohibir importar el `result` de F1 desde `qualification/**`.
> 8. **(Medium)** RLS: confirmar que enrichment/scores siguen el patrón de tablas **legibles por usuario** (select=`has_permission('prospeccion.view')`, sin insert/update de sesión, writes solo por RPC DEFINER con `search_path` fijo y grant a service_role) — distinto de `prospeccion_events` (deny-all).
> 9. **(Low)** Test que fija el doble efecto NO_B2B/FUERA_MERCADO (penalty baja score AND hardFail fuerza discard); la explicación debe nombrar el hardFail. Extraer `const STRATEGY_ID = 'csv-evidence-v1'` (usado por `qualify()` y `csvEvidenceStrategy.id`).
> 10. **(Low)** Crear archivo stub del `FeedbackSourcePort` reservado (A5), junto a los otros ports reservados, para que no se pierda.
>
> Migración 0106 confirmada libre. Estados imported/enriquecido/scoreado, permisos y `raw jsonb` confirmados en el esquema real. Ninguno es rediseño; son correcciones de plan/diseño.

## Global Constraints

- **F1 CONGELADA:** no tocar `src/lib/udie/**`, la RPC `prospeccion_ingest`, las migraciones 0088/0089, el dominio/import de F1 (incl. `header-aliases.ts`/`csv-parser.ts`), ni el PR #42. F2 es **aditivo**.
- **A8 · Regla de dependencia (vinculante):** `src/lib/prospeccion/qualification/**` NUNCA importa SDK de proveedor (`openai`, `@anthropic-ai/*`, `@google/*`) ni, en `qualification/domain/**`, `@supabase/*` o `next/server`. Solo vía ports. Enforced por ESLint `no-restricted-imports` + grep/test de frontera.
- **Dominio puro/isomorfo:** `qualification/domain/**` = funciones puras sin I/O; mismo código corre cliente y servidor. Patrón espejo de `src/lib/comercial/commercial-score.ts`.
- **3 métricas SEPARADAS:** `score` (Lead Score), `confidence`, `priority` — nunca fusionadas; columnas y funciones distintas.
- **ICP multi-variante por unidad de negocio**, config-tunable (no hardcodeado), Σpesos=100; v1 califica contra `general`. Pesos v1: industria 20 / tamaño 15 / actividad logística 25 / presencia AR 10 / potencial 20 / crecimiento 10.
- **Tablas append-only** (sin UPDATE; re-cálculo = nueva fila), ADR-012 (firmográficos en columnas tipadas; resto jsonb), RLS-primary; escritura solo vía RPC DEFINER.
- **Transición de estado legal** `imported→enriquecido→scoreado` (INV-PR-1) dentro de la RPC mecánica (ADR-017).
- **Decision Trace (A7):** envelope jsonb en `prospeccion_scores.decision_trace`, sin tabla nueva.
- **Sin merge, sin deploy.** Rama `feat/prospeccion-f2-qualification` desde `main`. Migración a prod = G3 a mano por Martín.
- **TDD estricto**; gates por tarea: `npx tsc --noEmit`, `npx vitest run <archivo>`, grep de frontera.

---

## File Structure

**Dominio puro (client-safe) — `src/lib/prospeccion/qualification/domain/`**
- `icp-config.ts` — `IcpConfig`, `BusinessUnit`, `DEFAULT_ICP_REGISTRY`, `selectIcp`, Zod refine Σ=100.
- `company-profile.ts` — VO `CompanyProfile` + bandas/tipos.
- `qualification-result.ts` — `Decision`, `PriorityTier`, `ScoreFactor`, `ScoreFactors`, `QualificationResult`, `DecisionTrace`.
- `services/company-profiler.ts` — `buildCompanyProfile(raw, icp)`.
- `services/scoring-policy.ts` — `scoreProfile(profile, icp)`.
- `services/confidence-policy.ts` — `computeConfidence(profile)`.
- `services/priority-policy.ts` — `computePriority(score, confidence, profile, icp)`.
- `services/decision-policy.ts` — `decide(score, profile, icp)`.
- `services/explanation-policy.ts` — `explain(profile, factors, penalties, decision)`.
- `services/decision-trace.ts` — `buildDecisionTrace(result)`.
- `qualify.ts` — fachada `qualify(raw, icp)` + `csvEvidenceStrategy: ScoringStrategy`.
- `result.ts` — clon local de `Result/ok/err` (el dominio no importa de prospeccion/domain de F1 para mantenerse desacoplado y client-safe).
- `index.client.ts` — barrel client-safe (re-exporta solo dominio puro).
- `*.test.ts` junto a cada módulo.

**Ports / Application / Adapters / Read — `src/lib/prospeccion/qualification/`**
- `ports/qualification-write.port.ts`, `ports/prospect-reader.port.ts`, `ports/enrichment.port.ts` (reservado), `ports/ai-narrative.port.ts` (reservado), `ports/crm-sync.port.ts` (reservado).
- `application/qualify-prospects.use-case.ts`.
- `adapters/supabase/supabase-qualification-write.adapter.ts`, `adapters/supabase/supabase-prospect-reader.adapter.ts`.
- `adapters/driving/qualify-actions.ts` (server action).
- `read/qualification-data.ts` (read model bandeja + dashboard).

**Persistencia (aditiva)**
- `supabase/migrations/0106_prospeccion_qualification.sql` (verificar nº libre), `supabase/migrations/ROLLBACK_0106.sql`.

**UI — `src/app/(app)/comercial/prospeccion/`**
- `ImportWizard.tsx` (MOD aditivo: columnas score/confidence/priority/decisión/explicación en preview).
- `ProspeccionView.tsx` (MOD aditivo: columnas en bandeja).
- `QualificationDashboard.tsx` (NEW).

**Config / enforcement**
- `.eslintrc.json` (MOD: zona `qualification/**`), `scripts/qualification-boundary.mjs` (NEW), `vitest.config.ts` (MOD: include qualification).

---

## Task 0: Setup — rama, boundary (A8), vitest include

**Files:** Modify `.eslintrc.json`, `vitest.config.ts`; Create `scripts/qualification-boundary.mjs`.

- [ ] **Step 1: Crear rama desde main** (lo hace el controlador via worktree; el implementador NO crea rama). Verificar cwd = worktree en `feat/prospeccion-f2-qualification`.

- [ ] **Step 2: Script de frontera (A8)** — Create `scripts/qualification-boundary.mjs`:
```js
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const ROOT = "src/lib/prospeccion/qualification";
// Prohibido en TODO el módulo: SDK de proveedor. Prohibido SOLO en domain/: supabase/next.
const FORBIDDEN_ALL = /(from|import)\s+["'](openai|@anthropic-ai\/|@google\/|@google-cloud\/)/;
const FORBIDDEN_DOMAIN = /(from|import)\s+["'](@supabase\/|next\/server|@\/lib\/supabase)/;
function walk(d){const o=[];for(const n of readdirSync(d)){const p=join(d,n);if(statSync(p).isDirectory())o.push(...walk(p));else if((p.endsWith(".ts")||p.endsWith(".tsx"))&&!p.endsWith(".test.ts")&&!p.endsWith(".test.tsx"))o.push(p);}return o;}
const bad=[];
for(const f of walk(ROOT)){const s=readFileSync(f,"utf8");if(FORBIDDEN_ALL.test(s))bad.push(`${f}: SDK de proveedor`);if(f.includes("/domain/")&&FORBIDDEN_DOMAIN.test(s))bad.push(`${f}: supabase/next en dominio`);}
if(bad.length){console.error("A8 VIOLADO:\n"+bad.join("\n"));process.exit(1);}
console.log("A8 OK: qualification desacoplado de proveedores; dominio puro.");
```

- [ ] **Step 3: ESLint zone + vitest include + package script.** En `.eslintrc.json` `overrides`, agregar `{ "files": ["src/lib/prospeccion/qualification/**/*.{ts,tsx}"], "rules": { "no-restricted-imports": ["error", { "patterns": ["openai","@anthropic-ai/*","@google/*","@google-cloud/*"] }] } }`. En `vitest.config.ts` agregar `"src/lib/prospeccion/qualification/**/*.test.ts"` al `include`. En `package.json` script `"lint:qual-boundary": "node scripts/qualification-boundary.mjs"`.

- [ ] **Step 4: Durable boundary test** — Create `src/lib/prospeccion/qualification/__boundary.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
const PROBE = "src/lib/prospeccion/qualification/domain/__probe.ts";
const run = () => { try { execFileSync("node",["scripts/qualification-boundary.mjs"],{stdio:"pipe"}); return 0; } catch(e){ return (e).status ?? 1; } };
describe("A8 boundary", () => {
  it("exits 0 clean", () => expect(run()).toBe(0));
  it("exits 1 on provider import in qualification", () => {
    mkdirSync("src/lib/prospeccion/qualification/domain",{recursive:true});
    writeFileSync(PROBE,'import OpenAI from "openai";\nexport const x = OpenAI;\n');
    try { expect(run()).toBe(1); } finally { rmSync(PROBE,{force:true}); }
    expect(run()).toBe(0);
  });
});
```
Run: `npx vitest run src/lib/prospeccion/qualification/__boundary.test.ts` → PASS (2).

- [ ] **Step 5: Commit**
```bash
git add .eslintrc.json vitest.config.ts scripts/qualification-boundary.mjs src/lib/prospeccion/qualification/__boundary.test.ts
git commit -m "chore(qualification): A8 boundary (no provider SDK / pure domain) + vitest include

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 1: Domain — `result.ts` + `icp-config.ts`

**Files:** Create `qualification/domain/result.ts`, `qualification/domain/icp-config.ts`, `icp-config.test.ts`.

**Interfaces — Produces:** `Result/ok/err`; `BusinessUnit`, `IcpConfig`, `DEFAULT_ICP_REGISTRY`, `selectIcp`, `validateIcp`.

- [ ] **Step 1: Failing test** — `icp-config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_ICP_REGISTRY, selectIcp, validateIcp } from "./icp-config";
describe("icp-config", () => {
  it("general weights sum to 100", () => {
    const icp = selectIcp(DEFAULT_ICP_REGISTRY, "general");
    const w = icp.weights; const sum = w.industria+w.tamano+w.actividadLogistica+w.presenciaArgentina+w.potencialEconomico+w.crecimiento;
    expect(sum).toBe(100);
  });
  it("selectIcp defaults to general", () => expect(selectIcp(DEFAULT_ICP_REGISTRY).businessUnit).toBe("general"));
  it("validateIcp rejects weights != 100", () => {
    const bad = { ...selectIcp(DEFAULT_ICP_REGISTRY), weights: { industria:1,tamano:1,actividadLogistica:1,presenciaArgentina:1,potencialEconomico:1,crecimiento:1 } };
    expect(validateIcp(bad).ok).toBe(false);
  });
});
```
- [ ] **Step 2: Run → FAIL** (`npx vitest run .../icp-config.test.ts`, module not found).
- [ ] **Step 3: Implement** — `result.ts`:
```ts
export interface DomainError { code: string; message: string }
export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(code: string, message: string): Result<T> => ({ ok: false, error: { code, message } });
```
`icp-config.ts`:
```ts
import { ok, err, type Result } from "./result";
export type BusinessUnit = "general" | "anmat" | "cargas_generales" | "fulfillment" | "cross_dock" | "ultima_milla";
export interface IcpWeights { industria: number; tamano: number; actividadLogistica: number; presenciaArgentina: number; potencialEconomico: number; crecimiento: number }
export interface IcpConfig {
  businessUnit: BusinessUnit; version: string;
  weights: IcpWeights;
  thresholds: { import: number; review: number };
  idealProfile: { b2b: boolean; depositos: boolean; importExport: boolean; distribucionNacional: boolean; centrosDistribucion: boolean; pallets: boolean; tercerizaAlmacenamiento: boolean; mercadoObjetivoTops: string[] };
  penalties: ReadonlyArray<{ code: string; when: string; points: number }>;
  keywordMaps: Record<string, string[]>;
}
export type IcpRegistry = Record<BusinessUnit, IcpConfig>;
const GENERAL: IcpConfig = {
  businessUnit: "general", version: "general-v1",
  weights: { industria: 20, tamano: 15, actividadLogistica: 25, presenciaArgentina: 10, potencialEconomico: 20, crecimiento: 10 },
  thresholds: { import: 80, review: 60 },
  idealProfile: { b2b: true, depositos: true, importExport: true, distribucionNacional: true, centrosDistribucion: true, pallets: true, tercerizaAlmacenamiento: true, mercadoObjetivoTops: ["manufactura","industrial","consumo masivo","farma","retail","ecommerce","distribucion"] },
  penalties: [{ code: "NO_B2B", when: "is_b2b===false", points: 30 }, { code: "FUERA_MERCADO", when: "dentro_mercado_objetivo===false", points: 25 }],
  keywordMaps: {
    depositos: ["deposito","almacen","warehouse","bodega","centro de distribucion","cd"],
    importExport: ["import","export","comercio exterior","aduana","foreign trade"],
    cds: ["centro de distribucion","distribution center","cd ","hub logistico"],
    terceriza: ["3pl","tercer","outsourc","operador logistico","fulfillment"],
  },
};
// v1 construye 'general'; las demás variantes reusan general como base hasta que Dirección las afine (versionadas indep.)
const variant = (bu: BusinessUnit): IcpConfig => ({ ...GENERAL, businessUnit: bu, version: `${bu}-v1` });
export const DEFAULT_ICP_REGISTRY: IcpRegistry = {
  general: GENERAL, anmat: variant("anmat"), cargas_generales: variant("cargas_generales"),
  fulfillment: variant("fulfillment"), cross_dock: variant("cross_dock"), ultima_milla: variant("ultima_milla"),
};
export const selectIcp = (reg: IcpRegistry, bu: BusinessUnit = "general"): IcpConfig => reg[bu];
export function validateIcp(icp: IcpConfig): Result<IcpConfig> {
  const w = icp.weights; const sum = w.industria+w.tamano+w.actividadLogistica+w.presenciaArgentina+w.potencialEconomico+w.crecimiento;
  if (sum !== 100) return err("ICP_WEIGHTS", `pesos suman ${sum}, deben sumar 100`);
  return ok(icp);
}
```
- [ ] **Step 4: Run → PASS** (3 tests). Run `node scripts/qualification-boundary.mjs` → A8 OK.
- [ ] **Step 5: Commit** `feat(qualification): ICP config registry (multi-variante por unidad de negocio, Σpesos=100)`.

---

## Task 2: Domain — tipos `company-profile.ts` + `qualification-result.ts`

**Files:** Create `domain/company-profile.ts`, `domain/qualification-result.ts` (type-only). **Verify:** `npx tsc --noEmit`.

- [ ] **Step 1: Implement `company-profile.ts`** (firmas exactas del doc §8):
```ts
export type EmployeeBand = "XS" | "S" | "M" | "L" | "XL";
export type GrowthSignal = "none" | "low" | "mid" | "high";
export interface CompanyProfile {
  industry: string | null; industryNormalized: string | null;
  employeesRaw: number | null; employeeBand: EmployeeBand | null; revenueBand: string | null;
  country: string | null; isArgentina: boolean;
  isB2B: boolean | null; hasDepositos: boolean; hasImportExport: boolean;
  hasDistribucionNacional: boolean; hasCds: boolean; tercerizaAlmacenamiento: boolean;
  dentroMercadoObjetivo: boolean; growthSignal: GrowthSignal;
  evidenceSource: "csv"; profileInputs: Record<string, unknown>;
}
```
- [ ] **Step 2: Implement `qualification-result.ts`**:
```ts
import type { CompanyProfile } from "./company-profile";
export type Decision = "import" | "review" | "discard";
export type PriorityTier = "alta" | "media" | "baja";
export interface ScoreFactor { raw: number; weighted: number }
export interface ScoreFactors { industria: ScoreFactor; tamano: ScoreFactor; actividadLogistica: ScoreFactor; presenciaArgentina: ScoreFactor; potencialEconomico: ScoreFactor; crecimiento: ScoreFactor }
export interface Penalty { code: string; points: number; reason: string }
export interface QualificationResult {
  profile: CompanyProfile; score: number; confidence: number;
  priority: { tier: PriorityTier; value: number };
  factors: ScoreFactors; penalties: ReadonlyArray<Penalty>; hardFails: ReadonlyArray<string>;
  decision: Decision; explanation: string;
  businessUnit: string; modelVersion: string; strategyId: string; icpConfigVersion: string; confidenceVersion: string;
}
export interface DecisionTrace {
  icpConfigVersion: string; businessUnit: string; modelVersion: string; strategyId: string; confidenceVersion: string;
  profileInputs: Record<string, unknown>; factors: ScoreFactors; penalties: ReadonlyArray<Penalty>; hardFails: ReadonlyArray<string>;
  score: number; confidence: number; priority: { tier: PriorityTier; value: number }; decision: Decision; explanation: string;
}
```
- [ ] **Step 3: `npx tsc --noEmit` → 0 errores.** Commit `feat(qualification): domain types (CompanyProfile, QualificationResult, DecisionTrace)`.

---

## Task 3: Domain — `company-profiler.ts`

**Files:** Create `domain/services/company-profiler.ts`, `company-profiler.test.ts`.
**Interfaces — Consumes:** `CompanyProfile`, `IcpConfig`. **Produces:** `buildCompanyProfile(raw, icp): CompanyProfile`.

- [ ] **Step 1: Failing test** — cubre Apollo/SalesNav variants + soft signals + unknowns:
```ts
import { describe, it, expect } from "vitest";
import { buildCompanyProfile } from "./company-profiler";
import { selectIcp, DEFAULT_ICP_REGISTRY } from "../icp-config";
const icp = selectIcp(DEFAULT_ICP_REGISTRY);
describe("buildCompanyProfile", () => {
  it("reads Apollo-style firmographics + derives bands", () => {
    const p = buildCompanyProfile({ "Industry":"Logistics & Supply Chain","# Employees":"600","Country":"Argentina","Annual Revenue":"50000000" }, icp);
    expect(p.industry).toBe("Logistics & Supply Chain");
    expect(p.employeesRaw).toBe(600); expect(p.employeeBand).toBe("L");
    expect(p.isArgentina).toBe(true);
  });
  it("derives soft signals by keyword", () => {
    const p = buildCompanyProfile({ "Industry":"Warehousing and distribution center operator", "Keywords":"3PL, import, pallets" }, icp);
    expect(p.hasDepositos).toBe(true); expect(p.hasCds).toBe(true); expect(p.tercerizaAlmacenamiento).toBe(true); expect(p.hasImportExport).toBe(true);
  });
  it("missing firmographics → unknown, no crash", () => {
    const p = buildCompanyProfile({ "Company":"X" }, icp);
    expect(p.industry).toBeNull(); expect(p.employeeBand).toBeNull(); expect(p.isArgentina).toBe(false);
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `company-profiler.ts` (mapa de lectura PROPIO de F2, lowercased; bandas por umbral; keyword-match con `icp.keywordMaps`):
```ts
import type { CompanyProfile, EmployeeBand, GrowthSignal } from "../company-profile";
import type { IcpConfig } from "../icp-config";
const lc = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v)).toLowerCase();
const pick = (raw: Record<string, unknown>, keys: string[]): string | null => {
  const map = new Map(Object.keys(raw).map((k) => [k.toLowerCase().trim(), k]));
  for (const k of keys) { const real = map.get(k); const v = real != null ? raw[real] : undefined; if (v != null && String(v).trim() !== "") return String(v).trim(); }
  return null;
};
const band = (n: number | null): EmployeeBand | null => n == null ? null : n < 10 ? "XS" : n < 50 ? "S" : n < 200 ? "M" : n < 1000 ? "L" : "XL";
const has = (hay: string, needles: string[]) => needles.some((n) => hay.includes(n));
export function buildCompanyProfile(raw: Record<string, unknown>, icp: IcpConfig): CompanyProfile {
  const industry = pick(raw, ["industry","industria","company industry"]);
  const empStr = pick(raw, ["# employees","employees","number of employees","employee count","empleados","company size"]);
  const employeesRaw = empStr ? parseInt(empStr.replace(/[^\d]/g, ""), 10) || null : null;
  const country = pick(raw, ["country","pais","país","company country","location country"]);
  const revenueBand = pick(raw, ["annual revenue","revenue","facturacion","company revenue"]);
  const text = [industry, pick(raw,["keywords","seo description","short description","headline","descripcion"]), pick(raw,["company name","empresa","company"])].map(lc).join(" ");
  const km = icp.keywordMaps;
  const hasDepositos = has(text, km.depositos ?? []);
  const hasCds = has(text, km.cds ?? []);
  const tercerizaAlmacenamiento = has(text, km.terceriza ?? []);
  const hasImportExport = has(text, km.importExport ?? []);
  const isArgentina = lc(country).includes("argentina") || lc(country) === "ar";
  const dentroMercadoObjetivo = icp.idealProfile.mercadoObjetivoTops.some((m) => text.includes(lc(m)));
  return {
    industry, industryNormalized: industry ? lc(industry) : null,
    employeesRaw, employeeBand: band(employeesRaw), revenueBand,
    country, isArgentina,
    isB2B: null, // v1: el CSV rara vez lo dice explícito; null = desconocido (no penaliza salvo evidencia contraria)
    hasDepositos, hasImportExport, hasDistribucionNacional: has(text, ["distribucion nacional","nationwide","national distribution"]),
    hasCds, tercerizaAlmacenamiento, dentroMercadoObjetivo,
    growthSignal: (employeesRaw ?? 0) >= 1000 ? "high" : (employeesRaw ?? 0) >= 200 ? "mid" : "none" as GrowthSignal,
    evidenceSource: "csv", profileInputs: raw,
  };
}
```
- [ ] **Step 4: Run → PASS (3).** A8 OK. **Commit** `feat(qualification): company-profiler (CSV firmographics + deterministic soft signals)`.

---

## Task 4: Domain — `scoring-policy.ts`

**Files:** Create `domain/services/scoring-policy.ts`, `scoring-policy.test.ts`.
**Produces:** `scoreProfile(profile, icp): { score, factors, penalties }`.

- [ ] **Step 1: Failing test:**
```ts
import { describe, it, expect } from "vitest";
import { scoreProfile } from "./scoring-policy";
import { buildCompanyProfile } from "./company-profiler";
import { selectIcp, DEFAULT_ICP_REGISTRY } from "../icp-config";
const icp = selectIcp(DEFAULT_ICP_REGISTRY);
describe("scoreProfile", () => {
  it("strong logistics B2B AR scores high and clamps 0..100", () => {
    const p = buildCompanyProfile({ Industry:"Warehousing distribution", "# Employees":"600", Country:"Argentina", Keywords:"3PL import pallets centro de distribucion" }, icp);
    const { score, factors } = scoreProfile(p, icp);
    expect(score).toBeGreaterThanOrEqual(80); expect(score).toBeLessThanOrEqual(100);
    expect(factors.actividadLogistica.weighted).toBeGreaterThan(0);
  });
  it("penalty NO_B2B subtracts", () => {
    const base = buildCompanyProfile({ Industry:"Retail", Country:"Argentina" }, icp);
    const withFlag = { ...base, isB2B: false };
    expect(scoreProfile(withFlag, icp).penalties.some((x)=>x.code==="NO_B2B")).toBe(true);
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (suma ponderada de 6 dimensiones 0..1 × peso; penalties; clamp). Espejo de `commercial-score.ts`:
```ts
import type { CompanyProfile } from "../company-profile";
import type { IcpConfig } from "../icp-config";
import type { ScoreFactors, Penalty, ScoreFactor } from "../qualification-result";
const f = (raw: number, weight: number): ScoreFactor => ({ raw: Math.max(0, Math.min(1, raw)), weighted: Math.round(Math.max(0, Math.min(1, raw)) * weight) });
const bandScore: Record<string, number> = { XS:0.1, S:0.35, M:0.6, L:0.85, XL:1 };
export function scoreProfile(p: CompanyProfile, icp: IcpConfig): { score: number; factors: ScoreFactors; penalties: Penalty[] } {
  const w = icp.weights;
  const factors: ScoreFactors = {
    industria: f(p.dentroMercadoObjetivo ? 1 : p.industry ? 0.4 : 0, w.industria),
    tamano: f(p.employeeBand ? bandScore[p.employeeBand] : 0, w.tamano),
    actividadLogistica: f([p.hasDepositos, p.hasCds, p.tercerizaAlmacenamiento, p.hasImportExport].filter(Boolean).length / 4, w.actividadLogistica),
    presenciaArgentina: f(p.isArgentina ? 1 : 0, w.presenciaArgentina),
    potencialEconomico: f(p.revenueBand ? 0.8 : p.employeeBand ? bandScore[p.employeeBand] : 0, w.potencialEconomico),
    crecimiento: f(p.growthSignal === "high" ? 1 : p.growthSignal === "mid" ? 0.6 : p.growthSignal === "low" ? 0.3 : 0, w.crecimiento),
  };
  const penalties: Penalty[] = [];
  if (p.isB2B === false) penalties.push({ code: "NO_B2B", points: 30, reason: "no es B2B" });
  if (!p.dentroMercadoObjetivo && p.industry) penalties.push({ code: "FUERA_MERCADO", points: 25, reason: "fuera del mercado objetivo" });
  const base = Object.values(factors).reduce((a, x) => a + x.weighted, 0);
  const score = Math.max(0, Math.min(100, base - penalties.reduce((a, x) => a + x.points, 0)));
  return { score, factors, penalties };
}
```
- [ ] **Step 4: Run → PASS.** A8 OK. **Commit** `feat(qualification): scoring-policy (Lead Score 0-100, weighted 6-dim + penalties)`.

---

## Task 5: Domain — `confidence-policy.ts` + `priority-policy.ts` (A2/A3)

**Files:** Create `domain/services/confidence-policy.ts`, `domain/services/priority-policy.ts`, `confidence-priority.test.ts`.
**Produces:** `computeConfidence(profile): number`; `computePriority(score, confidence, profile, icp): { tier, value }`; `CONFIDENCE_VERSION`.

- [ ] **Step 1: Failing test:**
```ts
import { describe, it, expect } from "vitest";
import { computeConfidence } from "./confidence-policy";
import { computePriority } from "./priority-policy";
import { buildCompanyProfile } from "./company-profiler";
import { selectIcp, DEFAULT_ICP_REGISTRY } from "../icp-config";
const icp = selectIcp(DEFAULT_ICP_REGISTRY);
const full = buildCompanyProfile({ Industry:"Warehousing", "# Employees":"600", Country:"Argentina", "Annual Revenue":"5M" }, icp);
const sparse = buildCompanyProfile({ Company:"X" }, icp);
describe("confidence & priority (separate metrics)", () => {
  it("confidence high when evidence complete, low when sparse", () => {
    expect(computeConfidence(full)).toBeGreaterThan(computeConfidence(sparse));
    expect(computeConfidence(sparse)).toBeLessThan(50);
  });
  it("priority does not equal score (high score + low confidence ⇒ not 'alta')", () => {
    const pr = computePriority(90, 20, sparse, icp);
    expect(pr.tier).not.toBe("alta");
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `confidence-policy.ts`:
```ts
import type { CompanyProfile } from "../company-profile";
export const CONFIDENCE_VERSION = "conf-v1";
export function computeConfidence(p: CompanyProfile): number {
  const present = [p.industry, p.employeesRaw, p.country, p.revenueBand].filter((x) => x != null).length;
  return Math.round((present / 4) * 100); // completitud de evidencia firmográfica
}
```
`priority-policy.ts`:
```ts
import type { CompanyProfile } from "../company-profile";
import type { IcpConfig } from "../icp-config";
import type { PriorityTier } from "../qualification-result";
export function computePriority(score: number, confidence: number, _p: CompanyProfile, _icp: IcpConfig): { tier: PriorityTier; value: number } {
  const value = Math.round(score * (0.5 + confidence / 200)); // score modulado por confianza (0.5..1.0)
  const tier: PriorityTier = score >= 80 && confidence >= 60 ? "alta" : score >= 60 ? "media" : "baja";
  return { tier, value };
}
```
- [ ] **Step 4: Run → PASS.** A8 OK. **Commit** `feat(qualification): confidence + priority policies (A2/A3, métricas independientes)`.

---

## Task 6: Domain — `decision-policy.ts`

**Files:** Create `domain/services/decision-policy.ts`, `decision-policy.test.ts`.
**Produces:** `decide(score, profile, icp): { decision, hardFails }`.

- [ ] **Step 1: Failing test** (límites exactos 79/80, 59/60; hardFail fuerza discard):
```ts
import { describe, it, expect } from "vitest";
import { decide } from "./decision-policy";
import { buildCompanyProfile } from "./company-profiler";
import { selectIcp, DEFAULT_ICP_REGISTRY } from "../icp-config";
const icp = selectIcp(DEFAULT_ICP_REGISTRY);
const p = buildCompanyProfile({ Industry:"Warehousing", Country:"Argentina" }, icp);
describe("decide", () => {
  it("thresholds", () => {
    expect(decide(80,p,icp).decision).toBe("import");
    expect(decide(79,p,icp).decision).toBe("review");
    expect(decide(60,p,icp).decision).toBe("review");
    expect(decide(59,p,icp).decision).toBe("discard");
  });
  it("hardFail no-B2B forces discard", () => {
    const out = decide(95, { ...p, isB2B:false }, icp);
    expect(out.hardFails).toContain("NO_B2B"); expect(out.decision).toBe("discard");
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:**
```ts
import type { CompanyProfile } from "../company-profile";
import type { IcpConfig } from "../icp-config";
import type { Decision } from "../qualification-result";
export function decide(score: number, p: CompanyProfile, icp: IcpConfig): { decision: Decision; hardFails: string[] } {
  const hardFails: string[] = [];
  if (p.isB2B === false) hardFails.push("NO_B2B");
  if (p.industry && !p.dentroMercadoObjetivo) hardFails.push("FUERA_MERCADO");
  if (hardFails.length) return { decision: "discard", hardFails };
  const decision: Decision = score >= icp.thresholds.import ? "import" : score >= icp.thresholds.review ? "review" : "discard";
  return { decision, hardFails };
}
```
- [ ] **Step 4: Run → PASS.** **Commit** `feat(qualification): decision-policy (umbrales config + hardFails)`.

---

## Task 7: Domain — `explanation-policy.ts` (A6)

**Files:** Create `domain/services/explanation-policy.ts`, `explanation-policy.test.ts`.
**Produces:** `explain(profile, factors, penalties, decision): string`.

- [ ] **Step 1: Failing test** (cubre import Y discard; determinista):
```ts
import { describe, it, expect } from "vitest";
import { explain } from "./explanation-policy";
import { scoreProfile } from "./scoring-policy";
import { decide } from "./decision-policy";
import { buildCompanyProfile } from "./company-profiler";
import { selectIcp, DEFAULT_ICP_REGISTRY } from "../icp-config";
const icp = selectIcp(DEFAULT_ICP_REGISTRY);
describe("explain (A6 — also rejections)", () => {
  it("explains an import with the strong factors", () => {
    const p = buildCompanyProfile({ Industry:"Warehousing", "# Employees":"600", Country:"Argentina", Keywords:"3PL pallets cd import" }, icp);
    const { factors, penalties } = scoreProfile(p, icp); const { decision } = decide(100, p, icp);
    const s = explain(p, factors, penalties, decision);
    expect(s.length).toBeGreaterThan(0); expect(s.toLowerCase()).toContain("logística");
  });
  it("explains a discard with the reason", () => {
    const p = buildCompanyProfile({ Industry:"Retail B2C", Country:"Brasil" }, icp);
    const { factors, penalties } = scoreProfile(p, icp); const { decision } = decide(40, p, icp);
    const s = explain(p, factors, penalties, decision);
    expect(s.toLowerCase()).toMatch(/descart|fuera|bajo|rechaz/);
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:**
```ts
import type { CompanyProfile } from "../company-profile";
import type { ScoreFactors, Penalty, Decision } from "../qualification-result";
export function explain(p: CompanyProfile, factors: ScoreFactors, penalties: ReadonlyArray<Penalty>, decision: Decision): string {
  const parts: string[] = [];
  if (p.industryNormalized) parts.push(`industria ${p.industry} (${factors.industria.weighted}/${20})`);
  if (p.employeeBand) parts.push(`${p.employeesRaw ?? "?"} empleados (banda ${p.employeeBand})`);
  if (factors.actividadLogistica.weighted > 0) parts.push(`actividad logística ${factors.actividadLogistica.weighted}/25`);
  if (p.isArgentina) parts.push("presencia AR");
  const pos = parts.length ? parts.join(" + ") : "evidencia firmográfica limitada";
  if (decision === "import") return `Importar: ${pos}.`;
  if (decision === "review") return `Revisar: ${pos}; falta evidencia para aprobar automáticamente.`;
  const why = penalties.length ? penalties.map((x) => x.reason).join(", ") : "score por debajo del umbral";
  return `Descartar: ${why} (${pos}).`;
}
```
- [ ] **Step 4: Run → PASS.** **Commit** `feat(qualification): explanation-policy (explica import/review/discard, A6)`.

---

## Task 8: Domain — `decision-trace.ts` + `qualify.ts` + `ScoringStrategy` + `index.client.ts`

**Files:** Create `domain/services/decision-trace.ts`, `domain/qualify.ts`, `domain/index.client.ts`, `qualify.test.ts`.
**Produces:** `buildDecisionTrace(result)`, `qualify(raw, icp)`, `ScoringStrategy`, `csvEvidenceStrategy`, `MODEL_VERSION`.

- [ ] **Step 1: Failing test** (determinismo + 3 métricas + trace reconstruye):
```ts
import { describe, it, expect } from "vitest";
import { qualify, csvEvidenceStrategy } from "./qualify";
import { buildDecisionTrace } from "./services/decision-trace";
import { selectIcp, DEFAULT_ICP_REGISTRY } from "./icp-config";
const icp = selectIcp(DEFAULT_ICP_REGISTRY);
const raw = { Industry:"Warehousing distribution", "# Employees":"600", Country:"Argentina", Keywords:"3PL import pallets cd" };
describe("qualify facade", () => {
  it("returns score+confidence+priority+decision+explanation, deterministic", () => {
    const a = qualify(raw, icp); const b = qualify(raw, icp);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) { expect(a.value).toEqual(b.value); expect(a.value.score).toBeGreaterThanOrEqual(80); expect(typeof a.value.confidence).toBe("number"); expect(a.value.priority.tier).toBeDefined(); }
  });
  it("strategy id + decision trace reconstructs the decision", () => {
    expect(csvEvidenceStrategy.id).toBe("csv-evidence-v1");
    const r = qualify(raw, icp); if (!r.ok) throw new Error();
    const t = buildDecisionTrace(r.value);
    expect(t.score).toBe(r.value.score); expect(t.decision).toBe(r.value.decision); expect(t.factors).toEqual(r.value.factors);
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `decision-trace.ts`:
```ts
import type { QualificationResult, DecisionTrace } from "../qualification-result";
export function buildDecisionTrace(r: QualificationResult): DecisionTrace {
  return { icpConfigVersion: r.icpConfigVersion, businessUnit: r.businessUnit, modelVersion: r.modelVersion, strategyId: r.strategyId, confidenceVersion: r.confidenceVersion, profileInputs: r.profile.profileInputs, factors: r.factors, penalties: r.penalties, hardFails: r.hardFails, score: r.score, confidence: r.confidence, priority: r.priority, decision: r.decision, explanation: r.explanation };
}
```
`qualify.ts`:
```ts
import { ok, type Result } from "./result";
import type { IcpConfig } from "./icp-config";
import type { QualificationResult } from "./qualification-result";
import { buildCompanyProfile } from "./services/company-profiler";
import { scoreProfile } from "./services/scoring-policy";
import { computeConfidence, CONFIDENCE_VERSION } from "./services/confidence-policy";
import { computePriority } from "./services/priority-policy";
import { decide } from "./services/decision-policy";
import { explain } from "./services/explanation-policy";
export const MODEL_VERSION = "qual-v1";
export interface ScoringStrategy { readonly id: string; readonly modelVersion: string; qualify(raw: Record<string, unknown>, icp: IcpConfig): Result<QualificationResult> }
export function qualify(raw: Record<string, unknown>, icp: IcpConfig): Result<QualificationResult> {
  const profile = buildCompanyProfile(raw, icp);
  const { score, factors, penalties } = scoreProfile(profile, icp);
  const confidence = computeConfidence(profile);
  const { decision, hardFails } = decide(score, profile, icp);
  const priority = computePriority(score, confidence, profile, icp);
  const explanation = explain(profile, factors, penalties, decision);
  return ok({ profile, score, confidence, priority, factors, penalties, hardFails, decision, explanation, businessUnit: icp.businessUnit, modelVersion: MODEL_VERSION, strategyId: "csv-evidence-v1", icpConfigVersion: icp.version, confidenceVersion: CONFIDENCE_VERSION });
}
export const csvEvidenceStrategy: ScoringStrategy = { id: "csv-evidence-v1", modelVersion: MODEL_VERSION, qualify };
```
`index.client.ts` (barrel client-safe):
```ts
export * from "./company-profile"; export * from "./qualification-result"; export * from "./icp-config";
export { qualify, csvEvidenceStrategy, MODEL_VERSION, type ScoringStrategy } from "./qualify";
export { buildDecisionTrace } from "./services/decision-trace";
```
- [ ] **Step 4: Run → PASS.** Run full domain suite + A8 + tsc: `npx vitest run src/lib/prospeccion/qualification && node scripts/qualification-boundary.mjs && npx tsc --noEmit`. **Commit** `feat(qualification): qualify facade + ScoringStrategy + DecisionTrace + client barrel`.

---

## Task 9: Migración 0106 (tablas + vista + RPC + RLS)

**Files:** Create `supabase/migrations/0106_prospeccion_qualification.sql`, `ROLLBACK_0106.sql`.
**Note:** verificar nº libre real (`ls supabase/migrations | tail`); ajustar si 0106 ya existe.

- [ ] **Step 1: Escribir la migración** (idempotente; 2 tablas append-only + vista `prospeccion_scores_current` + RPC DEFINER `prospeccion_record_qualification(p_rows jsonb)` que hace INSERT en enrichment+scores y flips `imported→enriquecido→scoreado`; RLS select=`has_permission('prospeccion.view')`, sin insert/update de sesión, delete=`is_admin()`; grants a service_role). DDL completa según §6 del doc de arquitectura (firmográficos tipados en `prospeccion_enrichment`; `score/confidence/priority_tier/priority_value/decision/factors/penalties/hard_fails/explanation/business_unit/versiones/decision_trace` en `prospeccion_scores`).
- [ ] **Step 2: Validar el DDL en Postgres efímero (PGLite)** — mismo harness que F1 (G3 pre-check): stub de prereqs (roles, `has_permission`, `is_admin`, enum `prospeccion_status_t`, tabla `prospeccion_prospects`), correr 0106 → smoke del RPC (insert 1 fila qualifica + status flips) → rollback 0106. Resultado esperado: PASS, 0 errores.
- [ ] **Step 3: Commit** `feat(qualification): migración 0106 (prospeccion_enrichment + prospeccion_scores append-only + RPC record_qualification + RLS)`. **NO aplicar a prod (G3 a mano por Martín).**

---

## Task 10: Ports + adapters Supabase

**Files:** Create `ports/qualification-write.port.ts`, `ports/prospect-reader.port.ts`, `ports/enrichment.port.ts`, `ports/ai-narrative.port.ts`, `ports/crm-sync.port.ts`; `adapters/supabase/supabase-qualification-write.adapter.ts`, `adapters/supabase/supabase-prospect-reader.adapter.ts`; `supabase-adapters.test.ts`.
**Interfaces — Produces:** `QualificationWritePort`, `ProspectReaderPort`, reserved ports; adapters sobre RPC.

- [ ] **Step 1: Implement ports** (firmas del doc §8; los 3 reservados sin adapter):
```ts
// qualification-write.port.ts
import type { Result } from "../domain/result";
import type { QualificationResult } from "../domain/qualification-result";
export interface QualificationWriteRow { prospectId: string; result: QualificationResult }
export interface QualificationWritePort { record(rows: ReadonlyArray<QualificationWriteRow>): Promise<Result<{ persisted: number }>> }
// prospect-reader.port.ts
import type { Result as R } from "../domain/result";
export interface PendingProspect { id: string; raw: Record<string, unknown> }
export interface ProspectReaderPort { loadPendingByIds(ids: ReadonlyArray<string>): Promise<R<ReadonlyArray<PendingProspect>>> }
// enrichment.port.ts / ai-narrative.port.ts / crm-sync.port.ts — interfaces RESERVADAS (sin impl), ver doc §8/§11.
```
- [ ] **Step 2: Failing test** for the write adapter (RPC capable client fake → maps `record_qualification`); reader adapter (select fake).
- [ ] **Step 3: Implement adapters** — `supabase-qualification-write.adapter.ts` (llama `rpc('prospeccion_record_qualification', { p_rows })`, mapea a `{persisted}`; serializa `decision_trace` via `buildDecisionTrace`); `supabase-prospect-reader.adapter.ts` (select `id, raw` de `prospeccion_prospects` por ids bajo service_role). Patrón espejo de `supabase-ingest.adapter.ts` de F1.
- [ ] **Step 4: Run → PASS.** A8 OK (adapters fuera de `domain/`, pueden importar supabase). **Commit** `feat(qualification): write/reader ports + supabase adapters (RPC) + reserved ports`.

---

## Task 11: Application — `qualify-prospects.use-case.ts`

**Files:** Create `application/qualify-prospects.use-case.ts`, `qualify-prospects.use-case.test.ts`.
**Interfaces — Consumes:** `ProspectReaderPort`, `QualificationWritePort`, `qualify`, `IcpConfig`. **Produces:** `QualifyProspectsUseCase`.

- [ ] **Step 1: Failing test** con fakes de ports: dado ids + raws, qualifica cada uno y persiste; idempotente (re-correr produce mismo result determinista). 
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (orquesta reader→qualify(puro)→write; inyecta `IcpConfig` seleccionado; espejo de `import-prospects.use-case.ts`).
- [ ] **Step 4: Run → PASS.** A8 OK. **Commit** `feat(qualification): QualifyProspectsUseCase (orquesta reader+qualify+write)`.

---

## Task 12: Driving action + read model

**Files:** Create `adapters/driving/qualify-actions.ts`, `read/qualification-data.ts`; `qualify-actions.test.ts`.
**Produces:** `qualifyAndImportAction(input)`, `listQualifiedProspects()`, `getQualificationDashboard()`.

- [ ] **Step 1: Implement `qualify-actions.ts`** ("use server", composition root): RBAC (`canAccess('prospeccion.create')` + sesión), paso1 = `importProspectsAction(input)` (sin modificarla), paso2 = cargar prospectos recién importados (vía Outbox `prospect.imported` / status=imported sin score) → `QualifyProspectsUseCase` con `createAdminClient`. Si no hay admin client → degrada (mensaje claro, sin romper). Devuelve resumen (importados/calificados/decisiones).
- [ ] **Step 2: Implement `read/qualification-data.ts`** — read model: `listQualifiedProspects(filters)` (join `prospeccion_scores_current` + enrichment, filtros por score/confidence/priority/business_unit/decision/industria) y `getQualificationDashboard()` (conteos import/review/discard + avg score + by-industry). Degrada a muestra local si no hay Supabase (patrón `prospects-data.ts`).
- [ ] **Step 3: Failing test** (action con mocks de importProspectsAction + use-case fake → resumen correcto; read model agrega bien + degrada).
- [ ] **Step 4: Run → PASS · tsc · A8.** **Commit** `feat(qualification): qualifyAndImportAction + read model (bandeja + dashboard)`.

---

## Task 13: UI — preview/bandeja con 3 métricas (isomorfo)

**Files:** Modify `src/app/(app)/comercial/prospeccion/ImportWizard.tsx`, `ProspeccionView.tsx`.

- [ ] **Step 1: ImportWizard (preview)** — importar `qualify` + `DEFAULT_ICP_REGISTRY/selectIcp` del barrel `index.client.ts`; por cada fila válida del preview, calcular `qualify(row.raw, selectIcp(reg))` (memoizado) y renderizar columnas **Lead Score** (+estrellas mapper puro), **Confidence**, **Prioridad** (badge tier), **decisión** (badge), **explicación** (tooltip). Cero lógica de negocio (solo importa y pinta). Tokens del design system.
- [ ] **Step 2: ProspeccionView (bandeja)** — agregar columnas Lead Score + decisión leídas de `listQualifiedProspects()`; filas `imported` sin score → "Pendiente de calificación".
- [ ] **Step 3: Gates** — `npx tsc --noEmit` · `npx vitest run` (suite completa verde) · `node scripts/qualification-boundary.mjs` · `node scripts/udie-boundary.mjs` (F1 intacto) · `npx next build` (ruta compila). Verificación en navegador la hace Dirección (auth).
- [ ] **Step 4: Commit** `feat(prospeccion): preview/bandeja con Lead Score + Confidence + Prioridad (isomorfo)`.

---

## Task 14: UI — `QualificationDashboard.tsx` + filtros

**Files:** Create `src/app/(app)/comercial/prospeccion/QualificationDashboard.tsx`; Modify la page/route para montarlo.

- [ ] **Step 1: Dashboard** (server-rendered): tarjetas importados/revisión/descartados + avg score + by-industry, de `getQualificationDashboard()`. Filtros (query params) por score/confidence/priority/business_unit/decisión/industria. Tokens design system; sin charts lib.
- [ ] **Step 2: Gates** (tsc/vitest/build/boundary). **Commit** `feat(prospeccion): QualificationDashboard + filtros (score/confidence/prioridad/unidad)`.

---

## Task 15: Cierre — gates finales + Release Report

**Files:** Create `docs/prospeccion/F2/RELEASE-REPORT-F2.md`.

- [ ] **Step 1: Gates finales completos** — `npx tsc --noEmit` · `npx vitest run` · `node scripts/qualification-boundary.mjs` · `node scripts/udie-boundary.mjs` · `npx next build`.
- [ ] **Step 2: Release Report** — alcance, archivos, gates, cumplimiento (A1–A8, INV-PR-1/2/3, ADR-012, A8), tablas/migración 0106 (no aplicada), deuda diferida (enrichment/IA/F3/feedback), checklist no-deploy.
- [ ] **Step 3: Push + PR (sin merge)** `feat/prospeccion-f2-qualification` → `main`, cuerpo con "NO MERGEAR sin gate de Dirección; sin deploy; migración a mano".

---

## Self-Review

- **Cobertura del spec:** ICP multi-variante (T1) · 3 métricas separadas score/confidence/priority (T4/T5) · perfil CSV (T3) · decisión+hardFails (T6) · explicación incl. rechazo A6 (T7) · Decision Trace A7 (T8/T9) · regla de dependencia A8 (T0 + boundary) · auditoría A1 (T8/T9 trace) · transición legal imported→enriquecido→scoreado + tablas append-only (T9) · isomorfo preview (T13) · dashboard+filtros (T14) · sin tocar F1/UDIE/RPC (global). ✔
- **Placeholders:** ninguno; código real por step. (T9 deja la DDL completa para el implementador siguiendo §6 — es SQL extenso; el step exige escribirla idempotente + validar PGLite, no un placeholder.)
- **Consistencia de tipos:** `CompanyProfile`/`QualificationResult`/`DecisionTrace`/`IcpConfig` definidos en T1/T2 y usados igual en T3-T8; `qualify` firma estable consumida por use-case (T11), action (T12), UI (T13).
- **Riesgo a vigilar:** calibración de pesos/keywords del ICP contra casos reales (golden fixtures en los tests); el commit en 2 pasos no atómico (mitigado: idempotencia + "Pendiente de calificación").

---

## Execution Handoff

**Plan completo en `docs/prospeccion/F2/PLAN-IMPLEMENTACION-F2.md`. Dos opciones de ejecución:**
1. **Subagent-Driven (recomendada)** — subagente fresco por tarea + review por tarea + review final de rama (igual que F1).
2. **Inline** — ejecución en sesión con checkpoints.

**¿Cuál preferís?** (La ejecución crea la rama y el código; recordá que autorizaste avanzar, pero confirmo modo + go antes de crear la rama.)
