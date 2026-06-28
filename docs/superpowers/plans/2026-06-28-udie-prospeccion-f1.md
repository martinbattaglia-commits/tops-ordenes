# UDIE + Prospección F1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir UDIE (Universal Data Import Engine) — un motor de importación genérico y agnóstico del dominio en `src/lib/udie/` — y su primer consumidor, la ingesta de prospectos en `src/lib/prospeccion/adapters/import/udie/`, con drag&drop + vista previa rica + clasificación de duplicados, reusando el dominio y la server action existentes.

**Architecture:** Hexágono de Stage-Ports (UDIE-B). El Core orquesta `Reader → Detector → Normalizer → (Enricher?) → Mapper → Validator → Preview` de forma genérica sobre `TRow`/`TReport`; el consumidor aporta un `DomainPack` (MappingPack volátil + CommitPack estable). Dos fases: `plan(file)` (cliente, best-effort) y `commit(decision, rows)` (envuelve la `importProspectsAction` existente; el servidor es la autoridad). Referencia oficial: `docs/udie/ARQUITECTURA-UDIE.md`.

**Tech Stack:** TypeScript, Next.js (app router), Supabase, vitest, Tailwind (design tokens), PapaParse (CSV, dep nueva), exceljs (XLSX, ya instalado `^4.4.0`, `import()` dinámico).

## Global Constraints

- **El Core (`src/lib/udie/**`) JAMÁS conoce conceptos de negocio** (Lead/Prospect/Cliente/Producto/Inventario/CUIT/SourceSlug/CRM). Solo conceptos universales de importación. (ADR-9 / AP-UDIE-1)
- **Sin cambios** en la RPC `prospeccion_ingest`, el modelo, las migraciones ni el catálogo.
- **No mergear, no deployar.** Rama `feat/prospeccion-f1-import` desde `main`. Prod auto-publica desde `main` → nunca mergear sin gate de Dirección.
- **No introducir dependencias innecesarias.** Solo `papaparse` + `@types/papaparse`.
- **Clean Architecture + DDD + Ports & Adapters.** Cero lógica de negocio en React.
- **`detected_format`** viaja en `row.raw._detected_format` (cero cambio de modelo). `source_slug` sigue siendo el enum cerrado pasado a `commit()`.
- **`papaparse` va en `dependencies`** (corre en el browser); `@types/papaparse` en `devDependencies`.
- **Preview = best-effort, dedup intra-archivo.** El servidor (RPC) es la autoridad de validación y dedup cross-batch.
- **`MAX_BATCH = 500`** (de `import-prospects.use-case.ts`): el preview debe avisar cuando `filas > 500`.
- **Confidence de detectores en escala `0..1`** con tie-break determinista (mayor score gana; empate → el de `id` menor alfabético; piso `generic` = `0.01`).
- **TDD estricto:** test que falla → mínimo código → test pasa → commit. Commits frecuentes.
- **Gates por tarea cuando aplique:** `npx tsc --noEmit`, `npx vitest run <archivo>`, y el grep de boundary.
- **`ValidatorPort.validate` devuelve `RowOutcome = { valid: boolean; diagnostics }`** — refinamiento deliberado del `{ outcome: 'kept'|'rejected' }` del §7.2 (semánticamente equivalente; el doc de arquitectura quedó alineado). `PreviewBuilderPort.build` recibe en impl. también `(sourceSlug, unmappedHeaders, columnas)`.

---

## File Structure

**UDIE Core (genérico) — `src/lib/udie/`**
- `kernel/result.ts` — `Result<T>` + `ok/err` + `DomainError` (clon local; el Core no importa de prospeccion).
- `kernel/types.ts` — `RawRow`, `RawTable`, `DetectedFormat`, `FieldDiagnostic`, `RowStatus`, `RowOutcome`, `PreviewRow`, `PreviewStats`, `PreviewModel`, `ImportReport`.
- `kernel/ports.ts` — todas las interfaces de puerto + `MappingPack`/`CommitPack`/`DomainPack` + `ReaderRegistry`/`DetectorRegistry`.
- `core/detector-registry.ts` — registry de detectores (fail-closed, max-confidence).
- `core/reader-registry.ts` — registry de readers (resolve por `accepts()`).
- `core/default-normalizer.ts` — normalizer agnóstico por defecto (trim + BOM).
- `core/mapper.ts` — mapper genérico (aliases + normalizers → `TRow`, `unmappedHeaders`).
- `core/preview-model.ts` — builder de `PreviewModel` + clasificador nuevo/posible/exacto + stats.
- `core/orchestrator.ts` — `ImportOrchestrator` (`plan`/`commit`).
- `readers/csv-reader.ts` — `ReaderPort` CSV (PapaParse).
- `readers/xlsx-reader.ts` — `ReaderPort` XLSX (exceljs dinámico).
- `readers/reader-for-file.ts` — switch csv|xlsx por extensión/MIME (rechaza `.xls`).
- tests `*.test.ts` junto a cada módulo.

**Consumidor Prospección — `src/lib/prospeccion/adapters/import/`**
- `header-aliases.ts` — `HEADER_ALIASES` compartido (extraído de `csv-parser.ts`).
- `csv-parser.ts` (MOD) — importa `HEADER_ALIASES` del módulo compartido; sigue SYNC.
- `udie/prospect-dedup-keys.ts` — `DedupKeyExtractorPort<ProspectImportInput>`.
- `udie/prospect-validator.ts` — `ValidatorPort<ProspectImportInput>` (delega a `ProspectFactory`).
- `udie/prospect-mapper.ts` — `MapperPort<ProspectImportInput>` + `toRow` (estampa `raw._detected_format`).
- `udie/profiles.ts` — 7 `ProspectSourceProfile` + sus `FormatDetectorPort`.
- `udie/prospect-preview.ts` — `PreviewBuilderPort` (projector empresa/contacto).
- `udie/prospect-commit.ts` — `CommitPack` (executor envuelve `importProspectsAction`; reporter).
- `udie/prospect-import-engine.ts` — wiring (`buildProspectOrchestrator`, `runProspectImportPreview`, `confirmProspectImport`).
- tests `*.test.ts` + `src/lib/prospeccion/adapters/import/udie/prospect-import-engine.test.ts` (integración por fixture).

**Fixtures — `tests/fixtures/import/`**
- `linkedin.csv`, `evaboot.csv`, `apollo.csv`, `wiza.csv`, `phantombuster.csv`, `clientify.csv`, `generic.csv`, `sample.xlsx`.

**UI — `src/app/(app)/comercial/prospeccion/`**
- `ImportWizard.tsx` (NEW) — client island.
- `ProspeccionView.tsx` (MOD) — usa `<ImportWizard/>`.

**Config**
- `package.json` (MOD), `.eslintrc.json` (MOD), `scripts/udie-boundary.mjs` (NEW, grep CI), `vitest.config.ts` (verificar include).

---

## Task 0: Setup — rama, dependencias y enforcement de boundary

**Files:**
- Modify: `package.json`
- Modify: `.eslintrc.json`
- Create: `scripts/udie-boundary.mjs`
- Create: `src/lib/udie/.gitkeep` (placeholder hasta Task 1)

**Interfaces:**
- Produces: dependencia `papaparse` disponible; comando `node scripts/udie-boundary.mjs` que falla si `src/lib/udie/**` importa de contextos hermanos.

- [ ] **Step 1: Crear la rama desde `main`**

```bash
git fetch origin
git switch -c feat/prospeccion-f1-import origin/main
git status   # working tree limpio sobre main
```

- [ ] **Step 2: Instalar dependencias**

```bash
npm install papaparse
npm install -D @types/papaparse
```
Expected: `papaparse` en `dependencies`, `@types/papaparse` en `devDependencies` de `package.json`.

- [ ] **Step 3: Escribir el script de boundary (grep CI, guardia primaria)**

Create `scripts/udie-boundary.mjs`:
```js
// Falla el build si el Core de UDIE importa de cualquier contexto de dominio.
// Regla AP-UDIE-1: src/lib/udie/** no conoce ningún dominio.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/lib/udie";
const FORBIDDEN = /(from|import)\s+["'](@\/lib\/(prospeccion|clientify|recon|comercial|compliance)|\.\.\/\.\.\/(prospeccion|clientify))/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if ((p.endsWith(".ts") || p.endsWith(".tsx")) && !p.endsWith(".test.ts") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of walk(ROOT)) {
  const src = readFileSync(file, "utf8");
  if (FORBIDDEN.test(src)) offenders.push(file);
}

if (offenders.length > 0) {
  console.error("AP-UDIE-1 VIOLADO — el Core importa de un dominio:\n" + offenders.join("\n"));
  process.exit(1);
}
console.log(`AP-UDIE-1 OK: ${ROOT} no importa de ningún contexto de dominio.`);
```

- [ ] **Step 4: Añadir el script a package.json y la zona ESLint**

En `package.json` `scripts`, agregar:
```json
"lint:udie-boundary": "node scripts/udie-boundary.mjs"
```
En `.eslintrc.json`, agregar al array `overrides` (zona secundaria; la primaria es el grep):
```json
{
  "files": ["src/lib/udie/**/*.ts", "src/lib/udie/**/*.tsx"],
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": ["@/lib/prospeccion/*", "@/lib/clientify/*", "@/lib/recon/*", "@/lib/comercial/*", "**/domain/*"]
    }]
  }
}
```

- [ ] **Step 5: Demostrar que el boundary dispara (test rojo deliberado)**

```bash
mkdir -p src/lib/udie/core
printf 'import { Email } from "@/lib/prospeccion/domain/vo/email";\nexport const x = Email;\n' > src/lib/udie/core/__boundary_probe.ts
node scripts/udie-boundary.mjs   # Expected: EXIT 1 con "AP-UDIE-1 VIOLADO"
rm src/lib/udie/core/__boundary_probe.ts
node scripts/udie-boundary.mjs   # Expected: EXIT 0 con "AP-UDIE-1 OK"
```

- [ ] **Step 6: Habilitar la colección de tests de UDIE en vitest**

En `vitest.config.ts`, agregar al array `test.include` el glob de UDIE. **Sin esto, `npx vitest run` NO colecta los tests del Core, y `npx vitest run <ruta-udie>` devuelve "No test files found"** (vitest intersecta la ruta-filtro con `include`).
```ts
include: [
  // ...los globs existentes (tesoreria/comercial/prospeccion/clientify)...
  "src/lib/udie/**/*.test.ts",
],
```
Verificar: `npx vitest run src/lib/udie/kernel/types.test.ts` ahora intenta colectar el archivo (fallará por módulo inexistente en Task 1, que es lo correcto), no por "No test files found".

- [ ] **Step 7: Test durable que prueba que el boundary dispara (guardia de regresión, no manual)**

Create `src/lib/udie/__boundary.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";

const PROBE = "src/lib/udie/core/__boundary_probe.ts";
function runBoundary(): number {
  try { execFileSync("node", ["scripts/udie-boundary.mjs"], { stdio: "pipe" }); return 0; }
  catch (e) { return (e as { status?: number }).status ?? 1; }
}

describe("AP-UDIE-1 boundary guard", () => {
  it("exits 0 on a clean udie tree", () => {
    expect(runBoundary()).toBe(0);
  });
  it("exits 1 when the Core imports a domain context", () => {
    mkdirSync("src/lib/udie/core", { recursive: true });
    writeFileSync(PROBE, 'import { Email } from "@/lib/prospeccion/domain/vo/email";\nexport const x = Email;\n');
    try { expect(runBoundary()).toBe(1); } finally { rmSync(PROBE, { force: true }); }
    expect(runBoundary()).toBe(0);
  });
});
```
> El grep (Step 3) **excluye `*.test.ts`**, por lo que el string `"@/lib/prospeccion/..."` que este test escribe como dato NO dispara el propio guard; solo lo dispara el archivo-probe real (no-test).

Run: `npx vitest run src/lib/udie/__boundary.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .eslintrc.json scripts/udie-boundary.mjs vitest.config.ts src/lib/udie/__boundary.test.ts
git commit -m "chore(udie): branch setup, papaparse dep, AP-UDIE-1 boundary (grep + lint zone + durable vitest guard) + vitest include"
```

---

## Task 1: Kernel — `result.ts` y `types.ts`

**Files:**
- Create: `src/lib/udie/kernel/result.ts`
- Create: `src/lib/udie/kernel/types.ts`
- Test: `src/lib/udie/kernel/types.test.ts`

**Interfaces:**
- Produces: `Result<T>`, `ok`, `err`, `domainError`; `RawRow`, `RawTable`, `DetectedFormat`, `FieldDiagnostic`, `RowStatus`, `RowOutcome<TRow>`, `PreviewRow<TRow>`, `PreviewStats`, `PreviewModel<TRow>`, `ImportReport`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/udie/kernel/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ok, err, domainError } from "./result";

describe("udie kernel result", () => {
  it("ok wraps a value", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });
  it("err wraps a domain error", () => {
    const r = err(domainError("X", "boom"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/udie/kernel/types.test.ts`
Expected: FAIL — `Cannot find module './result'`.

- [ ] **Step 3: Write `result.ts` (clon local, sin imports de dominio)**

Create `src/lib/udie/kernel/result.ts`:
```ts
export interface DomainError { code: string; message: string; meta?: Record<string, unknown> }
export const domainError = (code: string, message: string, meta?: Record<string, unknown>): DomainError => ({ code, message, meta });
export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(error: DomainError): Result<T> => ({ ok: false, error });
```

- [ ] **Step 4: Write `types.ts`**

Create `src/lib/udie/kernel/types.ts`:
```ts
export type RawRow = Record<string, string>;
export interface RawTable { headers: string[]; rows: RawRow[]; sourceName: string }
export type DetectedFormat = string & { readonly __brand: "DetectedFormat" };
export const asDetectedFormat = (s: string): DetectedFormat => s as DetectedFormat;

export interface FieldDiagnostic { level: "error" | "warn"; code: string; field?: string; message: string }
export type RowStatus = "nuevo" | "posible" | "exacto"; // 🟢 / 🟡 / 🔴

export interface RowOutcome { valid: boolean; diagnostics: FieldDiagnostic[] }
export interface PreviewRow<TRow> {
  index: number;
  row: TRow;
  valid: boolean;
  diagnostics: FieldDiagnostic[];
  dedupStatus: RowStatus;
  dedupReason: string;
}
export interface PreviewStats {
  registros: number;
  columnas: number;
  errores: number;
  pctValidos: number;
  pctRechazados: number;
  empresasUnicas: number;
  contactosUnicos: number;
  posiblesDuplicados: number;
  duplicadosExactos: number;
  detectedFormat: string;
  sourceSlug: string;
  unmappedHeaders: string[];
  excedeMaxBatch: boolean;
}
export interface PreviewModel<TRow> { rows: PreviewRow<TRow>[]; stats: PreviewStats }
export interface ImportReport { inserted: number; duplicates: number; rejected: number; message: string }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/udie/kernel/types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/udie/kernel/result.ts src/lib/udie/kernel/types.ts src/lib/udie/kernel/types.test.ts
git rm --cached src/lib/udie/.gitkeep 2>/dev/null || true
git commit -m "feat(udie): kernel Result + import value types (domain-agnostic)"
```

---

## Task 2: Kernel — puertos (`ports.ts`)

**Files:**
- Create: `src/lib/udie/kernel/ports.ts`

**Interfaces:**
- Consumes: tipos de `kernel/types.ts`, `Result` de `kernel/result.ts`.
- Produces: `ReaderPort`, `FormatDetectorPort`, `NormalizerPort`, `EnricherPort`, `MapperPort<TRow>`, `ValidatorPort<TRow>`, `DedupKeyExtractorPort<TRow>`, `Projector<TRow>`, `PreviewBuilderPort<TRow>`, `ExecutorPort<TRow,TReport>`, `PersistenceReporterPort<TReport>`, `MappingPack<TRow>`, `CommitPack<TRow,TReport>`, `DomainPack<TRow,TReport>`, `ReaderRegistry`, `DetectorRegistry`.

- [ ] **Step 1: Write `ports.ts` (type-only; lo compilan los dependientes)**

Create `src/lib/udie/kernel/ports.ts`:
```ts
import type { Result } from "./result";
import type {
  RawRow, RawTable, DetectedFormat, FieldDiagnostic, RowOutcome, PreviewModel,
} from "./types";

export type FieldNormalizer = (raw: string) => string;

export interface ReaderPort {
  id: string;
  accepts(file: { name: string; type: string }): boolean;
  read(file: Blob): Promise<Result<RawTable>>;
}
export interface FormatDetectorPort {
  id: string;
  detect(table: RawTable): { format: DetectedFormat; confidence: number } | null; // confidence ∈ [0,1]
}
export interface NormalizerPort { normalize(table: RawTable, fmt: DetectedFormat): RawTable }
export interface EnricherPort { enrich(table: RawTable, fmt: DetectedFormat): Promise<RawTable> }

export interface MapperPort<TRow> { format: DetectedFormat; map(row: RawRow, fmt: DetectedFormat): TRow }
export interface ValidatorPort<TRow> { validate(row: TRow): RowOutcome }
export interface DedupKeyExtractorPort<TRow> {
  keysOf(row: TRow): Record<string, string | null>;
  primaryKey(row: TRow): string | null;
}
export type Projector<TRow> = (row: TRow) => { company: string | null; contactKey: string | null };
export interface PreviewBuilderPort<TRow> {
  build(rows: TRow[], outcomes: RowOutcome[], fmt: DetectedFormat, sourceSlug: string, unmappedHeaders: string[], columnas: number): PreviewModel<TRow>;
}
export interface ExecutorPort<TRow, TReport> { execute(rows: TRow[], source: string): Promise<Result<TReport>> }
export interface PersistenceReporterPort<TReport> { toReport(r: TReport): { inserted: number; duplicates: number; rejected: number; message: string } }

export interface MappingPack<TRow> {
  aliases: Record<string, keyof TRow>;
  mapperFor(fmt: DetectedFormat): MapperPort<TRow>;
  normalizer?: NormalizerPort;
  enricher?: EnricherPort;
  validator: ValidatorPort<TRow>;
  dedup: DedupKeyExtractorPort<TRow>;
  preview: PreviewBuilderPort<TRow>;
}
export interface CommitPack<TRow, TReport> {
  executor: ExecutorPort<TRow, TReport>;
  reporter: PersistenceReporterPort<TReport>;
}
export interface DomainPack<TRow, TReport> {
  contextId: string;
  mapping: MappingPack<TRow>;
  commit: CommitPack<TRow, TReport>;
}

export interface ReaderRegistry {
  register(r: ReaderPort): void;
  resolve(file: { name: string; type: string }): ReaderPort | null;
  list(): readonly ReaderPort[];
}
export interface DetectorRegistry {
  register(d: FormatDetectorPort): void;
  detect(table: RawTable): { format: DetectedFormat; confidence: number } | null;
  list(): readonly FormatDetectorPort[];
}
export type { FieldDiagnostic };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: sin errores en `src/lib/udie/kernel/ports.ts`.

- [ ] **Step 3: Verify boundary still clean**

Run: `node scripts/udie-boundary.mjs`
Expected: `AP-UDIE-1 OK`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/udie/kernel/ports.ts
git commit -m "feat(udie): kernel ports (Reader/Detector/Mapper/Validator/Dedup/Preview/Executor + DomainPack)"
```

---

## Task 3: Core — `detector-registry.ts`

**Files:**
- Create: `src/lib/udie/core/detector-registry.ts`
- Test: `src/lib/udie/core/detector-registry.test.ts`

**Interfaces:**
- Consumes: `DetectorRegistry`, `FormatDetectorPort` de `kernel/ports.ts`; `RawTable`, `asDetectedFormat` de `kernel/types.ts`.
- Produces: `createDetectorRegistry(): DetectorRegistry`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/udie/core/detector-registry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createDetectorRegistry } from "./detector-registry";
import { asDetectedFormat, type RawTable } from "../kernel/types";
import type { FormatDetectorPort } from "../kernel/ports";

const table: RawTable = { headers: ["a"], rows: [], sourceName: "x.csv" };
const det = (id: string, conf: number): FormatDetectorPort => ({
  id, detect: () => (conf > 0 ? { format: asDetectedFormat(id), confidence: conf } : null),
});

describe("DetectorRegistry", () => {
  it("max confidence wins", () => {
    const r = createDetectorRegistry();
    r.register(det("low", 0.3));
    r.register(det("high", 0.9));
    expect(r.detect(table)?.format).toBe("high");
  });
  it("ties break by lower id alphabetically", () => {
    const r = createDetectorRegistry();
    r.register(det("bbb", 0.5));
    r.register(det("aaa", 0.5));
    expect(r.detect(table)?.format).toBe("aaa");
  });
  it("rejects duplicate id (fail-closed)", () => {
    const r = createDetectorRegistry();
    r.register(det("dup", 0.5));
    expect(() => r.register(det("dup", 0.6))).toThrow();
  });
  it("returns null when no detector matches", () => {
    const r = createDetectorRegistry();
    r.register(det("none", 0));
    expect(r.detect(table)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/udie/core/detector-registry.test.ts`
Expected: FAIL — `Cannot find module './detector-registry'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/udie/core/detector-registry.ts`:
```ts
import type { DetectorRegistry, FormatDetectorPort } from "../kernel/ports";
import type { RawTable, DetectedFormat } from "../kernel/types";

export function createDetectorRegistry(): DetectorRegistry {
  const detectors: FormatDetectorPort[] = [];
  return {
    register(d) {
      if (detectors.some((x) => x.id === d.id)) throw new Error(`detector duplicado: ${d.id}`);
      detectors.push(d);
    },
    detect(table: RawTable) {
      let best: { format: DetectedFormat; confidence: number; id: string } | null = null;
      for (const d of detectors) {
        const hit = d.detect(table);
        if (!hit || hit.confidence <= 0) continue;
        if (
          best === null ||
          hit.confidence > best.confidence ||
          (hit.confidence === best.confidence && d.id < best.id)
        ) {
          best = { ...hit, id: d.id };
        }
      }
      return best ? { format: best.format, confidence: best.confidence } : null;
    },
    list: () => detectors.slice(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/udie/core/detector-registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/udie/core/detector-registry.ts src/lib/udie/core/detector-registry.test.ts
git commit -m "feat(udie): detector registry (max-confidence, deterministic tie-break, fail-closed)"
```

---

## Task 4: Core — `reader-registry.ts`

**Files:**
- Create: `src/lib/udie/core/reader-registry.ts`
- Test: `src/lib/udie/core/reader-registry.test.ts`

**Interfaces:**
- Consumes: `ReaderRegistry`, `ReaderPort`.
- Produces: `createReaderRegistry(): ReaderRegistry`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/udie/core/reader-registry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createReaderRegistry } from "./reader-registry";
import { ok } from "../kernel/result";
import type { ReaderPort } from "../kernel/ports";

const reader = (id: string, ext: string): ReaderPort => ({
  id,
  accepts: (f) => f.name.toLowerCase().endsWith(ext),
  read: async () => ok({ headers: [], rows: [], sourceName: "x" }),
});

describe("ReaderRegistry", () => {
  it("resolves by accepts()", () => {
    const r = createReaderRegistry();
    r.register(reader("csv", ".csv"));
    r.register(reader("xlsx", ".xlsx"));
    expect(r.resolve({ name: "leads.csv", type: "text/csv" })?.id).toBe("csv");
    expect(r.resolve({ name: "leads.xlsx", type: "" })?.id).toBe("xlsx");
  });
  it("returns null when nothing accepts", () => {
    const r = createReaderRegistry();
    r.register(reader("csv", ".csv"));
    expect(r.resolve({ name: "leads.xls", type: "" })).toBeNull();
  });
  it("rejects duplicate id", () => {
    const r = createReaderRegistry();
    r.register(reader("csv", ".csv"));
    expect(() => r.register(reader("csv", ".csv"))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/udie/core/reader-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/udie/core/reader-registry.ts`:
```ts
import type { ReaderRegistry, ReaderPort } from "../kernel/ports";

export function createReaderRegistry(): ReaderRegistry {
  const readers: ReaderPort[] = [];
  return {
    register(r) {
      if (readers.some((x) => x.id === r.id)) throw new Error(`reader duplicado: ${r.id}`);
      readers.push(r);
    },
    resolve: (file) => readers.find((r) => r.accepts(file)) ?? null,
    list: () => readers.slice(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/udie/core/reader-registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/udie/core/reader-registry.ts src/lib/udie/core/reader-registry.test.ts
git commit -m "feat(udie): reader registry (resolve by accepts, fail-closed)"
```

---

## Task 5: Core — `default-normalizer.ts`

**Files:**
- Create: `src/lib/udie/core/default-normalizer.ts`
- Test: `src/lib/udie/core/default-normalizer.test.ts`

**Interfaces:**
- Consumes: `NormalizerPort`, `RawTable`.
- Produces: `defaultNormalizer: NormalizerPort`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/udie/core/default-normalizer.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { defaultNormalizer } from "./default-normalizer";
import { asDetectedFormat, type RawTable } from "../kernel/types";

describe("defaultNormalizer", () => {
  it("strips BOM and trims headers and cells", () => {
    const t: RawTable = {
      headers: ["﻿Company Name", " Email "],
      rows: [{ "﻿Company Name": "  ACME ", " Email ": " a@b.co " }],
      sourceName: "x.csv",
    };
    const out = defaultNormalizer.normalize(t, asDetectedFormat("generic"));
    expect(out.headers).toEqual(["Company Name", "Email"]);
    expect(out.rows[0]).toEqual({ "Company Name": "ACME", "Email": "a@b.co" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/udie/core/default-normalizer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/udie/core/default-normalizer.ts`:
```ts
import type { NormalizerPort } from "../kernel/ports";
import type { RawTable, RawRow } from "../kernel/types";

const clean = (s: string): string => s.replace(/^﻿/, "").trim();

export const defaultNormalizer: NormalizerPort = {
  normalize(table: RawTable): RawTable {
    const headers = table.headers.map(clean);
    const rows: RawRow[] = table.rows.map((row) => {
      const out: RawRow = {};
      for (const key of Object.keys(row)) out[clean(key)] = clean(row[key] ?? "");
      return out;
    });
    return { headers, rows, sourceName: table.sourceName };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/udie/core/default-normalizer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/udie/core/default-normalizer.ts src/lib/udie/core/default-normalizer.test.ts
git commit -m "feat(udie): default normalizer (BOM strip + trim, domain-agnostic)"
```

---

## Task 6: Core — `mapper.ts`

**Files:**
- Create: `src/lib/udie/core/mapper.ts`
- Test: `src/lib/udie/core/mapper.test.ts`

**Interfaces:**
- Consumes: `MapperPort`, `RawTable`, `RawRow`, `DetectedFormat`.
- Produces: `mapTable<TRow>(table, mapper, fmt, aliasHeaders): { rows: TRow[]; unmappedHeaders: string[] }`. (El mapeo de aliases lo hace el `MapperPort` del consumidor; el Core solo recolecta `unmappedHeaders` comparando headers contra las claves de alias provistas.)

- [ ] **Step 1: Write the failing test**

Create `src/lib/udie/core/mapper.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapTable } from "./mapper";
import { asDetectedFormat, type RawTable } from "../kernel/types";
import type { MapperPort } from "../kernel/ports";

interface FakeRow { name: string | null; _fmt?: string }
const fakeMapper: MapperPort<FakeRow> = {
  format: asDetectedFormat("fake"),
  map: (row, fmt) => ({ name: row["name"] ?? null, _fmt: fmt }),
};

describe("mapTable", () => {
  it("maps each row via the mapper and stamps via mapper", () => {
    const t: RawTable = { headers: ["name", "extra"], rows: [{ name: "ana", extra: "z" }], sourceName: "x" };
    const out = mapTable<FakeRow>(t, fakeMapper, asDetectedFormat("fake"), ["name"]);
    expect(out.rows[0].name).toBe("ana");
    expect(out.rows[0]._fmt).toBe("fake");
    expect(out.unmappedHeaders).toEqual(["extra"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/udie/core/mapper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/udie/core/mapper.ts`:
```ts
import type { MapperPort } from "../kernel/ports";
import type { RawTable, DetectedFormat } from "../kernel/types";

export function mapTable<TRow>(
  table: RawTable,
  mapper: MapperPort<TRow>,
  fmt: DetectedFormat,
  knownHeaders: string[],
): { rows: TRow[]; unmappedHeaders: string[] } {
  const known = new Set(knownHeaders.map((h) => h.toLowerCase()));
  const unmappedHeaders = table.headers.filter((h) => !known.has(h.toLowerCase()));
  const rows = table.rows.map((row) => mapper.map(row, fmt));
  return { rows, unmappedHeaders };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/udie/core/mapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/udie/core/mapper.ts src/lib/udie/core/mapper.test.ts
git commit -m "feat(udie): generic mapper (delegates row mapping to consumer, collects unmappedHeaders)"
```

---

## Task 7: Core — `preview-model.ts`

**Files:**
- Create: `src/lib/udie/core/preview-model.ts`
- Test: `src/lib/udie/core/preview-model.test.ts`

**Interfaces:**
- Consumes: `RowOutcome`, `PreviewModel`, `DedupKeyExtractorPort`, `Projector`, `DetectedFormat`.
- Produces: `buildPreview<TRow>(args): PreviewModel<TRow>` con `args = { rows, outcomes, dedup, projector, fmt, sourceSlug, unmappedHeaders, columnas, maxBatch }`.
- Reglas dedup intra-archivo: 🔴 `exacto` = TODAS las claves presentes de la fila colisionan con una fila anterior; 🟡 `posible` = ALGUNA (no todas) colisiona; 🟢 `nuevo` = ninguna.

- [ ] **Step 1: Write the failing test**

Create `src/lib/udie/core/preview-model.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildPreview } from "./preview-model";
import { asDetectedFormat } from "../kernel/types";
import type { DedupKeyExtractorPort, Projector } from "../kernel/ports";
import type { RowOutcome } from "../kernel/types";

interface R { email: string | null; cuit: string | null; company: string | null }
const dedup: DedupKeyExtractorPort<R> = {
  keysOf: (r) => ({ cuit: r.cuit, email: r.email }),
  primaryKey: (r) => r.cuit ?? r.email ?? null,
};
const projector: Projector<R> = (r) => ({ company: r.company, contactKey: r.cuit ?? r.email ?? null });
const okOutcome: RowOutcome = { valid: true, diagnostics: [] };

describe("buildPreview", () => {
  it("classifies nuevo/posible/exacto and computes stats", () => {
    const rows: R[] = [
      { email: "a@x.co", cuit: "30", company: "ACME" },        // nuevo
      { email: "a@x.co", cuit: "30", company: "ACME" },        // exacto (email+cuit colisionan)
      { email: "a@x.co", cuit: "99", company: "OTRA" },        // posible (solo email colisiona)
    ];
    const outcomes: RowOutcome[] = [okOutcome, okOutcome, { valid: false, diagnostics: [{ level: "error", code: "X", message: "no" }] }];
    const m = buildPreview<R>({
      rows, outcomes, dedup, projector,
      fmt: asDetectedFormat("Evaboot"), sourceSlug: "csv", unmappedHeaders: ["foo"], columnas: 4, maxBatch: 500,
    });
    expect(m.rows.map((r) => r.dedupStatus)).toEqual(["nuevo", "exacto", "posible"]);
    expect(m.stats.registros).toBe(3);
    expect(m.stats.errores).toBe(1);
    expect(m.stats.duplicadosExactos).toBe(1);
    expect(m.stats.posiblesDuplicados).toBe(1);
    expect(m.stats.empresasUnicas).toBe(2);   // ACME, OTRA
    expect(m.stats.detectedFormat).toBe("Evaboot");
    expect(m.stats.excedeMaxBatch).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/udie/core/preview-model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/udie/core/preview-model.ts`:
```ts
import type { DedupKeyExtractorPort, Projector } from "../kernel/ports";
import type { DetectedFormat, PreviewModel, PreviewRow, RowOutcome, RowStatus } from "../kernel/types";

interface Args<TRow> {
  rows: TRow[];
  outcomes: RowOutcome[];
  dedup: DedupKeyExtractorPort<TRow>;
  projector: Projector<TRow>;
  fmt: DetectedFormat;
  sourceSlug: string;
  unmappedHeaders: string[];
  columnas: number;
  maxBatch: number;
}

export function buildPreview<TRow>(a: Args<TRow>): PreviewModel<TRow> {
  const seen = new Map<string, number>(); // key -> first row index (1-based)
  const previewRows: PreviewRow<TRow>[] = [];
  const companies = new Set<string>();
  const contacts = new Set<string>();

  a.rows.forEach((row, i) => {
    const keys = Object.values(a.dedup.keysOf(row)).filter((k): k is string => !!k);
    const collisions = keys.filter((k) => seen.has(k));
    let status: RowStatus = "nuevo";
    let reason = "registro nuevo";
    if (keys.length > 0 && collisions.length === keys.length) {
      status = "exacto";
      reason = `coincide con la fila #${seen.get(collisions[0])} en todas las claves`;
    } else if (collisions.length > 0) {
      status = "posible";
      reason = `coincide parcialmente con la fila #${seen.get(collisions[0])}`;
    }
    for (const k of keys) if (!seen.has(k)) seen.set(k, i + 1);

    const proj = a.projector(row);
    if (proj.company) companies.add(proj.company.toLowerCase());
    if (proj.contactKey) contacts.add(proj.contactKey);

    const outcome = a.outcomes[i] ?? { valid: false, diagnostics: [] };
    previewRows.push({ index: i, row, valid: outcome.valid, diagnostics: outcome.diagnostics, dedupStatus: status, dedupReason: reason });
  });

  const registros = a.rows.length;
  const errores = previewRows.filter((r) => !r.valid).length;
  const validos = registros - errores;
  const pct = (n: number) => (registros === 0 ? 0 : Math.round((n / registros) * 100));

  return {
    rows: previewRows,
    stats: {
      registros,
      columnas: a.columnas,
      errores,
      pctValidos: pct(validos),
      pctRechazados: pct(errores),
      empresasUnicas: companies.size,
      contactosUnicos: contacts.size,
      posiblesDuplicados: previewRows.filter((r) => r.dedupStatus === "posible").length,
      duplicadosExactos: previewRows.filter((r) => r.dedupStatus === "exacto").length,
      detectedFormat: a.fmt,
      sourceSlug: a.sourceSlug,
      unmappedHeaders: a.unmappedHeaders,
      excedeMaxBatch: registros > a.maxBatch,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/udie/core/preview-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/udie/core/preview-model.ts src/lib/udie/core/preview-model.test.ts
git commit -m "feat(udie): preview model builder (intra-file dedup classifier + stats)"
```

---

## Task 8: Reader — `csv-reader.ts` (PapaParse)

**Files:**
- Create: `src/lib/udie/readers/csv-reader.ts`
- Test: `src/lib/udie/readers/csv-reader.test.ts`

**Interfaces:**
- Consumes: `ReaderPort`, `RawTable`, `ok`/`err`.
- Produces: `csvReader: ReaderPort`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/udie/readers/csv-reader.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { csvReader } from "./csv-reader";

const blob = (s: string) => new Blob([s], { type: "text/csv" });

describe("csvReader", () => {
  it("accepts .csv by name or mime", () => {
    expect(csvReader.accepts({ name: "x.csv", type: "" })).toBe(true);
    expect(csvReader.accepts({ name: "x", type: "text/csv" })).toBe(true);
    expect(csvReader.accepts({ name: "x.xlsx", type: "" })).toBe(false);
  });
  it("parses headers and rows, BOM, semicolon, quoted commas, embedded newlines", async () => {
    const csv = "﻿Company;Note\n\"ACME, SA\";\"line1\nline2\"\n";
    const r = await csvReader.read(blob(csv));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.headers).toEqual(["Company", "Note"]);
    expect(r.value.rows[0]["Company"]).toBe("ACME, SA");
    expect(r.value.rows[0]["Note"]).toBe("line1\nline2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/udie/readers/csv-reader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/udie/readers/csv-reader.ts`:
```ts
import Papa from "papaparse";
import type { ReaderPort } from "../kernel/ports";
import { ok, err, domainError } from "../kernel/result";
import type { RawRow, RawTable } from "../kernel/types";

export const csvReader: ReaderPort = {
  id: "csv",
  accepts: (f) => f.name.toLowerCase().endsWith(".csv") || f.type === "text/csv",
  async read(file) {
    const text = (await file.text()).replace(/^﻿/, "");
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: "greedy",
      delimiter: "", // auto-detect ; or ,
      transformHeader: (h) => h.replace(/^﻿/, "").trim(),
    });
    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      return err(domainError("CSV_PARSE", parsed.errors[0]?.message ?? "CSV inválido"));
    }
    const headers = parsed.meta.fields ?? [];
    const rows: RawRow[] = parsed.data.map((r) => {
      const out: RawRow = {};
      for (const h of headers) out[h] = (r[h] ?? "").toString();
      return out;
    });
    const table: RawTable = { headers, rows, sourceName: (file as File).name ?? "archivo.csv" };
    return ok(table);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/udie/readers/csv-reader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/udie/readers/csv-reader.ts src/lib/udie/readers/csv-reader.test.ts
git commit -m "feat(udie): CSV reader via PapaParse (BOM, auto-delimiter, quotes, embedded newlines)"
```

---

## Task 9: Readers — `xlsx-reader.ts` + `reader-for-file.ts`

**Files:**
- Create: `src/lib/udie/readers/xlsx-reader.ts`
- Create: `src/lib/udie/readers/reader-for-file.ts`
- Test: `src/lib/udie/readers/reader-for-file.test.ts`

**Interfaces:**
- Consumes: `ReaderPort`, `ReaderRegistry`.
- Produces: `xlsxReader: ReaderPort`; `resolveReader(registry, file): Result<ReaderPort>` (rechaza `.xls`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/udie/readers/reader-for-file.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveReader } from "./reader-for-file";
import { csvReader } from "./csv-reader";
import { xlsxReader } from "./xlsx-reader";
import { createReaderRegistry } from "../core/reader-registry";

function reg() {
  const r = createReaderRegistry();
  r.register(csvReader);
  r.register(xlsxReader);
  return r;
}

describe("resolveReader", () => {
  it("resolves csv and xlsx", () => {
    const r = reg();
    expect(resolveReader(r, { name: "x.csv", type: "" }).ok).toBe(true);
    expect(resolveReader(r, { name: "x.xlsx", type: "" }).ok).toBe(true);
  });
  it("rejects legacy .xls with a clear error", () => {
    const out = resolveReader(reg(), { name: "x.xls", type: "" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("UNSUPPORTED_FORMAT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/udie/readers/reader-for-file.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `xlsx-reader.ts` (exceljs dinámico)**

Create `src/lib/udie/readers/xlsx-reader.ts`:
```ts
import type { ReaderPort } from "../kernel/ports";
import { ok, err, domainError } from "../kernel/result";
import type { RawRow, RawTable } from "../kernel/types";

export const xlsxReader: ReaderPort = {
  id: "xlsx",
  accepts: (f) =>
    f.name.toLowerCase().endsWith(".xlsx") ||
    f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  async read(file) {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) return err(domainError("XLSX_EMPTY", "el archivo no tiene hojas"));
      const headerRow = ws.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell({ includeEmpty: false }, (cell) => headers.push(String(cell.value ?? "").trim()));
      const rows: RawRow[] = [];
      for (let i = 2; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        const out: RawRow = {};
        headers.forEach((h, j) => { out[h] = String(row.getCell(j + 1).value ?? "").trim(); });
        if (Object.values(out).some((v) => v !== "")) rows.push(out);
      }
      const table: RawTable = { headers, rows, sourceName: (file as File).name ?? "archivo.xlsx" };
      return ok(table);
    } catch (e) {
      return err(domainError("XLSX_PARSE", e instanceof Error ? e.message : String(e)));
    }
  },
};
```

- [ ] **Step 4: Write `reader-for-file.ts`**

Create `src/lib/udie/readers/reader-for-file.ts`:
```ts
import type { ReaderPort, ReaderRegistry } from "../kernel/ports";
import { ok, err, domainError, type Result } from "../kernel/result";

export function resolveReader(registry: ReaderRegistry, file: { name: string; type: string }): Result<ReaderPort> {
  if (file.name.toLowerCase().endsWith(".xls")) {
    return err(domainError("UNSUPPORTED_FORMAT", "El formato .xls legacy no está soportado. Exportá como .xlsx o .csv."));
  }
  const reader = registry.resolve(file);
  if (!reader) return err(domainError("UNSUPPORTED_FORMAT", `No hay lector para "${file.name}". Use CSV o XLSX.`));
  return ok(reader);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/udie/readers/reader-for-file.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/udie/readers/xlsx-reader.ts src/lib/udie/readers/reader-for-file.ts src/lib/udie/readers/reader-for-file.test.ts
git commit -m "feat(udie): XLSX reader (exceljs dynamic import) + reader-for-file switch (rejects .xls)"
```

---

## Task 10: Core — `orchestrator.ts` (canary de agnosticismo)

**Files:**
- Create: `src/lib/udie/core/orchestrator.ts`
- Test: `src/lib/udie/core/orchestrator.test.ts`

**Interfaces:**
- Consumes: todos los puertos + registries + `mapTable` + `buildPreview` + `resolveReader` + `defaultNormalizer`.
- Produces: `createOrchestrator<TRow,TReport>(deps): { plan, commit }` con
  `plan(file, override?): Promise<Result<PreviewModel<TRow>>>` y
  `commit(decision, rows): Promise<Result<ImportReport>>`.

- [ ] **Step 1: Write the failing test (DomainPack con entidad FALSA — prueba que el Core es agnóstico)**

Create `src/lib/udie/core/orchestrator.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createOrchestrator } from "./orchestrator";
import { createReaderRegistry } from "./reader-registry";
import { createDetectorRegistry } from "./detector-registry";
import { defaultNormalizer } from "./default-normalizer";
import { ok } from "../kernel/result";
import { asDetectedFormat } from "../kernel/types";
import type { DomainPack, ReaderPort, FormatDetectorPort } from "../kernel/ports";

interface FakeRow { name: string | null }
interface FakeReport { saved: number }

const fakeReader: ReaderPort = {
  id: "csv", accepts: () => true,
  read: async () => ok({ headers: ["name"], rows: [{ name: "ana" }, { name: "ana" }], sourceName: "x.csv" }),
};
const fakeDetector: FormatDetectorPort = {
  id: "fake", detect: () => ({ format: asDetectedFormat("Fake Tool"), confidence: 1 }),
};

function pack(executeSpy: ReturnType<typeof vi.fn>): DomainPack<FakeRow, FakeReport> {
  const fmt = asDetectedFormat("Fake Tool");
  return {
    contextId: "fake",
    mapping: {
      aliases: { name: "name" },
      mapperFor: () => ({ format: fmt, map: (r) => ({ name: r["name"] ?? null }) }),
      validator: { validate: (row) => ({ valid: !!row.name, diagnostics: [] }) },
      dedup: { keysOf: (r) => ({ name: r.name }), primaryKey: (r) => r.name },
      preview: {
        build: (rows, outcomes) => ({
          rows: rows.map((row, i) => ({ index: i, row, valid: outcomes[i].valid, diagnostics: [], dedupStatus: "nuevo", dedupReason: "" })),
          stats: { registros: rows.length, columnas: 1, errores: 0, pctValidos: 100, pctRechazados: 0, empresasUnicas: 0, contactosUnicos: 0, posiblesDuplicados: 0, duplicadosExactos: 0, detectedFormat: "Fake Tool", sourceSlug: "csv", unmappedHeaders: [], excedeMaxBatch: false },
        }),
      },
    },
    commit: {
      executor: { execute: executeSpy },
      reporter: { toReport: (r: FakeReport) => ({ inserted: r.saved, duplicates: 0, rejected: 0, message: "ok" }) },
    },
  };
}

function deps(executeSpy: ReturnType<typeof vi.fn>) {
  const readers = createReaderRegistry(); readers.register(fakeReader);
  const detectors = createDetectorRegistry(); detectors.register(fakeDetector);
  return { readers, detectors, defaultNormalizer, pack: pack(executeSpy), maxBatch: 500 };
}

describe("ImportOrchestrator (generic, no domain knowledge)", () => {
  it("plan() reads → detects → maps → validates → previews", async () => {
    const orch = createOrchestrator<FakeRow, FakeReport>(deps(vi.fn()));
    const r = await orch.plan(new Blob(["x"], { type: "text/csv" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.stats.detectedFormat).toBe("Fake Tool");
      expect(r.value.rows).toHaveLength(2);
    }
  });
  it("commit() calls executor once when proceed=true, never when false", async () => {
    const spy = vi.fn(async () => ok({ saved: 2 }));
    const orch = createOrchestrator<FakeRow, FakeReport>(deps(spy));
    const no = await orch.commit({ proceed: false, source: "csv" }, [{ name: "ana" }]);
    expect(no.ok).toBe(false);
    expect(spy).toHaveBeenCalledTimes(0);
    const yes = await orch.commit({ proceed: true, source: "csv" }, [{ name: "ana" }]);
    expect(yes.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    if (yes.ok) expect(yes.value.inserted).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/udie/core/orchestrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/udie/core/orchestrator.ts`:
```ts
import type { DomainPack, ReaderRegistry, DetectorRegistry, NormalizerPort, Projector } from "../kernel/ports";
import { ok, err, domainError, type Result } from "../kernel/result";
import { asDetectedFormat, type DetectedFormat, type ImportReport, type PreviewModel, type RowOutcome } from "../kernel/types";
import { resolveReader } from "../readers/reader-for-file";
import { mapTable } from "./mapper";
import { buildPreview } from "./preview-model";

export interface OrchestratorDeps<TRow, TReport> {
  readers: ReaderRegistry;
  detectors: DetectorRegistry;
  defaultNormalizer: NormalizerPort;
  pack: DomainPack<TRow, TReport>;
  maxBatch: number;
  projector?: Projector<TRow>;
  formatToSlug?: (fmt: DetectedFormat) => string; // el consumidor mapea formato→slug del catálogo; el Core no conoce slugs
}

export function createOrchestrator<TRow, TReport>(deps: OrchestratorDeps<TRow, TReport>) {
  const { mapping, commit } = deps.pack;
  const projector: Projector<TRow> = deps.projector ?? (() => ({ company: null, contactKey: null }));

  return {
    async plan(file: Blob, override?: { format?: DetectedFormat }): Promise<Result<PreviewModel<TRow>>> {
      const meta = { name: (file as File).name ?? "archivo", type: file.type };
      const readerR = resolveReader(deps.readers, meta);
      if (!readerR.ok) return readerR;
      const tableR = await readerR.value.read(file);
      if (!tableR.ok) return tableR;

      const normalizer = mapping.normalizer ?? deps.defaultNormalizer;
      let table = normalizer.normalize(tableR.value, asDetectedFormat("unknown"));

      const detected = override?.format
        ? { format: override.format, confidence: 1 }
        : deps.detectors.detect(table);
      const fmt = detected?.format ?? asDetectedFormat("Generic CSV");

      if (mapping.enricher) table = await mapping.enricher.enrich(table, fmt);

      const aliasHeaders = Object.keys(mapping.aliases);
      const { rows, unmappedHeaders } = mapTable<TRow>(table, mapping.mapperFor(fmt), fmt, aliasHeaders);
      const outcomes: RowOutcome[] = rows.map((row) => mapping.validator.validate(row));

      const sourceSlug = (deps.formatToSlug ?? (() => "csv"))(fmt);
      const model = mapping.preview.build(rows, outcomes, fmt, sourceSlug, unmappedHeaders, table.headers.length);
      return ok(model);
    },

    async commit(decision: { proceed: boolean; source: string }, rows: TRow[]): Promise<Result<ImportReport>> {
      if (!decision.proceed) return err(domainError("CANCELLED", "importación cancelada por el usuario"));
      const r = await commit.executor.execute(rows, decision.source);
      if (!r.ok) return r;
      return ok(commit.reporter.toReport(r.value));
    },
  };
}

// El Core nunca conoce el catálogo de slugs: el consumidor inyecta `formatToSlug` (ver wiring en Task 14).
```

> Nota de diseño: `stats.sourceSlug` lo determina el consumidor vía `deps.formatToSlug` (inyectado en el wiring), de modo que coincide con `slugForDetectedFormat(stats.detectedFormat)`. El Core nunca conoce `SourceSlug`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/udie/core/orchestrator.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full Core suite + boundary**

Run: `npx vitest run src/lib/udie && node scripts/udie-boundary.mjs && npx tsc --noEmit`
Expected: todo verde; `AP-UDIE-1 OK`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/udie/core/orchestrator.ts src/lib/udie/core/orchestrator.test.ts
git commit -m "feat(udie): import orchestrator (plan/commit) + fake-entity conformance test (AP-UDIE-1 canary)"
```

---

## Task 11: Consumer — alias compartidos + refactor de `csv-parser.ts`

**Files:**
- Create: `src/lib/prospeccion/adapters/import/header-aliases.ts`
- Modify: `src/lib/prospeccion/adapters/import/csv-parser.ts`
- Test: `src/lib/prospeccion/adapters/import/csv-parser.test.ts` (existente, debe seguir verde)

**Interfaces:**
- Produces: `HEADER_ALIASES: Record<string, keyof ProspectImportInput>` (incluye alias EN con espacios para LinkedIn/Apollo/etc.).

- [ ] **Step 1: Crear `header-aliases.ts` con el mapa ampliado**

Create `src/lib/prospeccion/adapters/import/header-aliases.ts`:
```ts
import type { ProspectImportInput } from "../../domain/prospect";

// Claves en minúscula. Incluye alias ES/EN y variantes con espacios de exportadores reales.
export const HEADER_ALIASES: Record<string, keyof ProspectImportInput> = {
  company_name: "company_name", "company name": "company_name", company: "company_name",
  empresa: "company_name", organization: "company_name", account: "company_name",
  cuit: "cuit",
  website: "website", "company website": "website", web: "website", sitio: "website", url: "website",
  full_name: "full_name", "full name": "full_name", nombre: "full_name", name: "full_name", contacto: "full_name",
  cargo: "cargo", title: "cargo", "job title": "cargo", "current job": "cargo", position: "cargo", puesto: "cargo", rol: "cargo",
  email: "email", "email address": "email", mail: "email", correo: "email",
  phone: "phone", "phone number": "phone", telefono: "phone", "teléfono": "phone", tel: "phone", celular: "phone",
  linkedin_url: "linkedin_url", linkedin: "linkedin_url", "linkedin url": "linkedin_url",
  "profile url": "linkedin_url", "linkedin profile": "linkedin_url", profileurl: "linkedin_url", perfil: "linkedin_url",
  // Variantes camelCase sin espacio (Phantombuster exporta profileUrl/fullName/companyName):
  fullname: "full_name", companyname: "company_name",
};
```

- [ ] **Step 2: Refactor `csv-parser.ts` para importar el mapa (sigue SYNC)**

En `src/lib/prospeccion/adapters/import/csv-parser.ts`, reemplazar la const `HEADER_ALIASES` inline por:
```ts
import { HEADER_ALIASES } from "./header-aliases";
```
(eliminar la definición local; el resto de `parseCsv`/`splitCsvLine` queda igual.)

- [ ] **Step 3: Run the existing parser test to verify still green**

Run: `npx vitest run src/lib/prospeccion/adapters/import/csv-parser.test.ts`
Expected: PASS (sin cambios de comportamiento).

- [ ] **Step 4: Commit**

```bash
git add src/lib/prospeccion/adapters/import/header-aliases.ts src/lib/prospeccion/adapters/import/csv-parser.ts
git commit -m "refactor(prospeccion): lift HEADER_ALIASES to shared module (+ EN space variants); csv-parser stays sync"
```

---

## Task 12: Consumer — dedup keys + validator

**Files:**
- Create: `src/lib/prospeccion/adapters/import/udie/prospect-dedup-keys.ts`
- Create: `src/lib/prospeccion/adapters/import/udie/prospect-validator.ts`
- Test: `src/lib/prospeccion/adapters/import/udie/prospect-domain-ports.test.ts`

**Interfaces:**
- Consumes: `DedupKeyExtractorPort`, `ValidatorPort` (udie); `ProspectImportInput`, `ProspectFactory`, `makeProspectId`, `SourceSlug`, `DeduplicationPolicy`.
- Produces: `prospectDedupKeys: DedupKeyExtractorPort<ProspectImportInput>`; `prospectValidator: ValidatorPort<ProspectImportInput>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/prospeccion/adapters/import/udie/prospect-domain-ports.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { prospectDedupKeys } from "./prospect-dedup-keys";
import { prospectValidator } from "./prospect-validator";

describe("prospect domain ports", () => {
  it("dedup keys lowercase email and pick primary (cuit first)", () => {
    const k = prospectDedupKeys.keysOf({ cuit: "30-70111223-4", email: "A@B.CO", linkedin_url: "x" });
    expect(k.email).toBe("a@b.co");
    expect(prospectDedupKeys.primaryKey({ cuit: "30701112234", email: "a@b.co" })).toBe("30701112234");
  });
  it("validator rejects a row with no identity", () => {
    const out = prospectValidator.validate({ company_name: "ACME" });
    expect(out.valid).toBe(false);
    expect(out.diagnostics[0].message).toMatch(/identidad/i);
  });
  it("validator accepts a row with a valid email", () => {
    const out = prospectValidator.validate({ email: "laura@acme.test" });
    expect(out.valid).toBe(true);
  });
  it("validator rejects an invalid email", () => {
    const out = prospectValidator.validate({ email: "no-arroba" });
    expect(out.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/prospeccion/adapters/import/udie/prospect-domain-ports.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `prospect-dedup-keys.ts`**

Create `src/lib/prospeccion/adapters/import/udie/prospect-dedup-keys.ts`:
```ts
import type { DedupKeyExtractorPort } from "@/lib/udie/kernel/ports";
import type { ProspectImportInput } from "../../../domain/prospect";
import { DeduplicationPolicy } from "../../../domain/services/deduplication-policy";

const norm = (s: string | null | undefined) => {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
};

export const prospectDedupKeys: DedupKeyExtractorPort<ProspectImportInput> = {
  keysOf(row) {
    const cuit = norm(row.cuit)?.replace(/\D/g, "") ?? null;
    const email = norm(row.email)?.toLowerCase() ?? null;
    const linkedinUrl = norm(row.linkedin_url)?.toLowerCase() ?? null;
    return { cuit, email, linkedinUrl };
  },
  primaryKey(row) {
    const k = this.keysOf(row);
    return DeduplicationPolicy.primaryKey({ cuit: k.cuit, email: k.email, linkedinUrl: k.linkedinUrl });
  },
};
```

- [ ] **Step 4: Write `prospect-validator.ts`**

Create `src/lib/prospeccion/adapters/import/udie/prospect-validator.ts`:
```ts
import type { ValidatorPort } from "@/lib/udie/kernel/ports";
import type { RowOutcome } from "@/lib/udie/kernel/types";
import type { ProspectImportInput } from "../../../domain/prospect";
import { ProspectFactory } from "../../../domain/prospect";
import { makeProspectId } from "../../../domain/vo/prospect-id";
import { SourceSlug } from "../../../domain/vo/source-slug";

const SOURCE = SourceSlug.create("csv");

export const prospectValidator: ValidatorPort<ProspectImportInput> = {
  validate(row): RowOutcome {
    if (!SOURCE.ok) return { valid: false, diagnostics: [{ level: "error", code: "SOURCE", message: "origen inválido" }] };
    const idR = makeProspectId(crypto.randomUUID());
    if (!idR.ok) return { valid: false, diagnostics: [{ level: "error", code: "ID", message: idR.error.message }] };
    const r = ProspectFactory.fromImportRow(idR.value, SOURCE.value, row);
    if (r.ok) return { valid: true, diagnostics: [] };
    return { valid: false, diagnostics: [{ level: "error", code: r.error.code, message: r.error.message }] };
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/prospeccion/adapters/import/udie/prospect-domain-ports.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/prospeccion/adapters/import/udie/prospect-dedup-keys.ts src/lib/prospeccion/adapters/import/udie/prospect-validator.ts src/lib/prospeccion/adapters/import/udie/prospect-domain-ports.test.ts
git commit -m "feat(prospeccion/udie): dedup-keys + validator ports (reuse DeduplicationPolicy + ProspectFactory)"
```

---

## Task 13: Consumer — mapper, perfiles y detectores

**Files:**
- Create: `src/lib/prospeccion/adapters/import/udie/prospect-mapper.ts`
- Create: `src/lib/prospeccion/adapters/import/udie/profiles.ts`
- Test: `src/lib/prospeccion/adapters/import/udie/profiles.test.ts`

**Interfaces:**
- Consumes: `MapperPort`, `FormatDetectorPort`, `asDetectedFormat`, `HEADER_ALIASES`, `ProspectImportInput`.
- Produces: `makeProspectMapper(fmt): MapperPort<ProspectImportInput>`; `PROSPECT_PROFILES: ProspectSourceProfile[]`; `prospectDetectors: FormatDetectorPort[]`; tipo `ProspectSourceProfile = { detectedFormat; sourceSlug; label; signature: string[] }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/prospeccion/adapters/import/udie/profiles.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeProspectMapper, PROSPECT_PROFILES, prospectDetectors, profileFor } from "./profiles";
import { asDetectedFormat, type RawTable } from "@/lib/udie/kernel/types";
import { createDetectorRegistry } from "@/lib/udie/core/detector-registry";

const table = (headers: string[]): RawTable => ({ headers, rows: [], sourceName: "x.csv" });

describe("prospect profiles", () => {
  it("maps LinkedIn-style headers with spaces and combines first+last name", () => {
    const m = makeProspectMapper(asDetectedFormat("LinkedIn Sales Navigator"));
    const row = m.map({ "Company Name": "ACME", "Email": "a@b.co", "First Name": "Ana", "Last Name": "Gómez", "LinkedIn Url": "X" }, asDetectedFormat("LinkedIn Sales Navigator"));
    expect(row.company_name).toBe("ACME");
    expect(row.email).toBe("a@b.co");
    expect(row.full_name).toBe("Ana Gómez");
    expect(row.linkedin_url).toBe("X");
    expect((row.raw as Record<string, unknown>)._detected_format).toBe("LinkedIn Sales Navigator");
  });
  it("detector picks evaboot over generic on evaboot headers", () => {
    const reg = createDetectorRegistry();
    prospectDetectors.forEach((d) => reg.register(d));
    const hit = reg.detect(table(["Company", "Title", "Email", "LinkedIn Url", "Evaboot Cleaned Company Name"]));
    expect(hit?.format).toBe("Evaboot");
  });
  it("falls back to Generic CSV", () => {
    const reg = createDetectorRegistry();
    prospectDetectors.forEach((d) => reg.register(d));
    const hit = reg.detect(table(["foo", "bar", "email"]));
    expect(hit?.format).toBe("Generic CSV");
  });
  it("every profile maps to a valid source slug", () => {
    for (const p of PROSPECT_PROFILES) expect(["linkedin_sales_navigator", "csv"]).toContain(p.sourceSlug);
    expect(profileFor(asDetectedFormat("Apollo")).sourceSlug).toBe("csv");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/prospeccion/adapters/import/udie/profiles.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `prospect-mapper.ts`**

Create `src/lib/prospeccion/adapters/import/udie/prospect-mapper.ts`:
```ts
import type { MapperPort } from "@/lib/udie/kernel/ports";
import type { RawRow, DetectedFormat } from "@/lib/udie/kernel/types";
import type { ProspectImportInput } from "../../../domain/prospect";
import { HEADER_ALIASES } from "../header-aliases";

export function makeProspectMapper(format: DetectedFormat): MapperPort<ProspectImportInput> {
  return {
    format,
    map(rawRow: RawRow, fmt: DetectedFormat): ProspectImportInput {
      const input: ProspectImportInput = {};
      const raw: Record<string, unknown> = {};
      let firstName: string | null = null;
      let lastName: string | null = null;

      for (const header of Object.keys(rawRow)) {
        const value = rawRow[header] ?? "";
        raw[header] = value;
        const key = header.toLowerCase().trim();
        if (key === "first name" || key === "nombre de pila") { firstName = value || null; continue; }
        if (key === "last name" || key === "apellido") { lastName = value || null; continue; }
        const field = HEADER_ALIASES[key];
        if (field && value !== "") (input as Record<string, unknown>)[field] = value;
      }
      if (!input.full_name && (firstName || lastName)) {
        input.full_name = [firstName, lastName].filter(Boolean).join(" ").trim();
      }
      raw._detected_format = fmt;
      input.raw = raw;
      return input;
    },
  };
}
```

- [ ] **Step 4: Write `profiles.ts` (7 perfiles + detectores + helpers)**

Create `src/lib/prospeccion/adapters/import/udie/profiles.ts`:
```ts
import type { FormatDetectorPort, MapperPort } from "@/lib/udie/kernel/ports";
import { asDetectedFormat, type DetectedFormat, type RawTable } from "@/lib/udie/kernel/types";
import type { SourceSlugValue } from "../../../domain/vo/source-slug";
import type { ProspectImportInput } from "../../../domain/prospect";
import { makeProspectMapper } from "./prospect-mapper";

export interface ProspectSourceProfile {
  detectedFormat: DetectedFormat;
  sourceSlug: SourceSlugValue;
  label: string;
  signature: string[]; // headers (lowercase) telltale de la herramienta
}

const P = (label: string, slug: SourceSlugValue, signature: string[]): ProspectSourceProfile => ({
  detectedFormat: asDetectedFormat(label), sourceSlug: slug, label, signature: signature.map((s) => s.toLowerCase()),
});

export const PROSPECT_PROFILES: ProspectSourceProfile[] = [
  P("LinkedIn Sales Navigator", "linkedin_sales_navigator", ["first name", "last name", "company", "title", "linkedin url"]),
  P("Evaboot", "csv", ["evaboot cleaned company name", "linkedin url", "title"]),
  P("Apollo", "csv", ["first name", "last name", "company", "email", "# employees"]),
  P("Wiza", "csv", ["full name", "company", "title", "email status"]),
  P("Phantombuster", "csv", ["profileurl", "fullname", "companyname"]),
  P("Clientify", "csv", ["nombre", "empresa", "correo", "telefono"]),
  P("Generic CSV", "csv", []),
];

const GENERIC = PROSPECT_PROFILES[PROSPECT_PROFILES.length - 1];

export function profileFor(fmt: DetectedFormat): ProspectSourceProfile {
  return PROSPECT_PROFILES.find((p) => p.detectedFormat === fmt) ?? GENERIC;
}

function score(signature: string[], headers: string[]): number {
  if (signature.length === 0) return 0.01; // Generic CSV = catch-all (piso); gana solo si ningún perfil nombrado califica
  const set = new Set(headers.map((h) => h.toLowerCase().trim()));
  const hits = signature.filter((s) => set.has(s)).length;
  const ratio = hits / signature.length;
  // Un perfil nombrado debe cubrir ≥60% de su firma para competir; si no, no participa.
  // Evita que headers ubicuos (email/company/title) hagan ganar a un perfil parcial sobre Generic.
  return ratio >= 0.6 ? ratio : 0;
}

export const prospectDetectors: FormatDetectorPort[] = PROSPECT_PROFILES.map((p) => ({
  id: p.label,
  detect(table: RawTable) {
    const c = score(p.signature, table.headers);
    return c > 0 ? { format: p.detectedFormat, confidence: c } : null;
  },
}));

export function makeProspectMapperFor(fmt: DetectedFormat): MapperPort<ProspectImportInput> {
  return makeProspectMapper(fmt);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/prospeccion/adapters/import/udie/profiles.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/prospeccion/adapters/import/udie/prospect-mapper.ts src/lib/prospeccion/adapters/import/udie/profiles.ts src/lib/prospeccion/adapters/import/udie/profiles.test.ts
git commit -m "feat(prospeccion/udie): mapper (first+last name, raw._detected_format) + 7 source profiles + detectors"
```

---

## Task 14: Consumer — preview builder, commit pack y wiring del motor

**Files:**
- Create: `src/lib/prospeccion/adapters/import/udie/prospect-preview.ts`
- Create: `src/lib/prospeccion/adapters/import/udie/prospect-commit.ts`
- Create: `src/lib/prospeccion/adapters/import/udie/prospect-import-engine.ts`
- Test: `src/lib/prospeccion/adapters/import/udie/prospect-commit.test.ts`

**Interfaces:**
- Consumes: `PreviewBuilderPort`, `CommitPack`, `DomainPack`, `createOrchestrator`, `buildPreview`, `importProspectsAction`, `ImportProspectsActionResult`.
- Produces: `runProspectImportPreview(file): Promise<Result<PreviewModel<ProspectImportInput>>>`; `confirmProspectImport(rows, sourceSlug): Promise<Result<ImportReport>>`.

- [ ] **Step 1: Write the failing test (commit pack mapea ImportProspectsActionResult → ImportReport)**

Create `src/lib/prospeccion/adapters/import/udie/prospect-commit.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../driving/import-actions", () => ({
  importProspectsAction: vi.fn(async () => ({ ok: true, message: "Import: 2 nuevos", inserted: 2, duplicates: 1, rejected: 0 })),
}));

import { prospectCommitPack } from "./prospect-commit";

describe("prospectCommitPack", () => {
  it("executor wraps importProspectsAction and reporter maps to ImportReport", async () => {
    const r = await prospectCommitPack.executor.execute([{ email: "a@b.co" }], "csv");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const report = prospectCommitPack.reporter.toReport(r.value);
    expect(report.inserted).toBe(2);
    expect(report.duplicates).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/prospeccion/adapters/import/udie/prospect-commit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `prospect-preview.ts`**

Create `src/lib/prospeccion/adapters/import/udie/prospect-preview.ts`:
```ts
import type { PreviewBuilderPort, Projector } from "@/lib/udie/kernel/ports";
import type { ProspectImportInput } from "../../../domain/prospect";
import { buildPreview } from "@/lib/udie/core/preview-model";
import { prospectDedupKeys } from "./prospect-dedup-keys";

const MAX_BATCH = 500; // espejo de ImportProspectsUseCase.MAX_BATCH

export const prospectProjector: Projector<ProspectImportInput> = (row) => ({
  company: (row.company_name ?? "").trim() || null,
  contactKey: prospectDedupKeys.primaryKey(row),
});

export const prospectPreviewBuilder: PreviewBuilderPort<ProspectImportInput> = {
  build(rows, outcomes, fmt, sourceSlug, unmappedHeaders, columnas) {
    return buildPreview<ProspectImportInput>({
      rows, outcomes, dedup: prospectDedupKeys, projector: prospectProjector,
      fmt, sourceSlug, unmappedHeaders, columnas, maxBatch: MAX_BATCH,
    });
  },
};
```

- [ ] **Step 4: Write `prospect-commit.ts`**

Create `src/lib/prospeccion/adapters/import/udie/prospect-commit.ts`:
```ts
import type { CommitPack } from "@/lib/udie/kernel/ports";
import { ok, err, domainError } from "@/lib/udie/kernel/result";
import type { ProspectImportInput } from "../../../domain/prospect";
import { importProspectsAction, type ImportProspectsActionResult } from "../../driving/import-actions";

export const prospectCommitPack: CommitPack<ProspectImportInput, ImportProspectsActionResult> = {
  executor: {
    async execute(rows, source) {
      const res = await importProspectsAction({ source, rows });
      if (!res.ok) return err(domainError("INGEST_FAILED", res.message));
      return ok(res);
    },
  },
  reporter: {
    toReport(r) {
      if (!r.ok) return { inserted: 0, duplicates: 0, rejected: 0, message: r.message };
      return { inserted: r.inserted, duplicates: r.duplicates, rejected: r.rejected, message: r.message };
    },
  },
};
```

- [ ] **Step 5: Write `prospect-import-engine.ts` (wiring)**

Create `src/lib/prospeccion/adapters/import/udie/prospect-import-engine.ts`:
```ts
import type { DomainPack } from "@/lib/udie/kernel/ports";
import type { DetectedFormat, ImportReport, PreviewModel } from "@/lib/udie/kernel/types";
import { ok, type Result } from "@/lib/udie/kernel/result";
import { createReaderRegistry } from "@/lib/udie/core/reader-registry";
import { createDetectorRegistry } from "@/lib/udie/core/detector-registry";
import { defaultNormalizer } from "@/lib/udie/core/default-normalizer";
import { createOrchestrator } from "@/lib/udie/core/orchestrator";
import { csvReader } from "@/lib/udie/readers/csv-reader";
import { xlsxReader } from "@/lib/udie/readers/xlsx-reader";
import type { ProspectImportInput } from "../../../domain/prospect";
import { HEADER_ALIASES } from "../header-aliases";
import { prospectValidator } from "./prospect-validator";
import { prospectDedupKeys } from "./prospect-dedup-keys";
import { prospectPreviewBuilder, prospectProjector } from "./prospect-preview";
import { prospectCommitPack } from "./prospect-commit";
import { makeProspectMapperFor, prospectDetectors, profileFor } from "./profiles";

function buildPack(): DomainPack<ProspectImportInput, import("../../driving/import-actions").ImportProspectsActionResult> {
  return {
    contextId: "prospeccion",
    mapping: {
      aliases: HEADER_ALIASES,
      mapperFor: (fmt: DetectedFormat) => makeProspectMapperFor(fmt),
      normalizer: defaultNormalizer,
      validator: prospectValidator,
      dedup: prospectDedupKeys,
      preview: prospectPreviewBuilder,
    },
    commit: prospectCommitPack,
  };
}

function buildOrchestrator() {
  const readers = createReaderRegistry();
  readers.register(csvReader);
  readers.register(xlsxReader);
  const detectors = createDetectorRegistry();
  prospectDetectors.forEach((d) => detectors.register(d));
  return createOrchestrator({ readers, detectors, defaultNormalizer, pack: buildPack(), maxBatch: 500, projector: prospectProjector, formatToSlug: (fmt) => slugForDetectedFormat(fmt) });
}

export function runProspectImportPreview(file: Blob, override?: { format?: DetectedFormat }): Promise<Result<PreviewModel<ProspectImportInput>>> {
  return buildOrchestrator().plan(file, override);
}

export function slugForDetectedFormat(fmt: string): string {
  return profileFor(fmt as DetectedFormat).sourceSlug;
}

export async function confirmProspectImport(rows: ProspectImportInput[], sourceSlug: string): Promise<Result<ImportReport>> {
  // Camino liviano: commit solo necesita el CommitPack; no construye readers/detectors (que no usaría).
  const r = await prospectCommitPack.executor.execute(rows, sourceSlug);
  if (!r.ok) return r;
  return ok(prospectCommitPack.reporter.toReport(r.value));
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/prospeccion/adapters/import/udie/prospect-commit.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/prospeccion/adapters/import/udie/prospect-preview.ts src/lib/prospeccion/adapters/import/udie/prospect-commit.ts src/lib/prospeccion/adapters/import/udie/prospect-import-engine.ts src/lib/prospeccion/adapters/import/udie/prospect-commit.test.ts
git commit -m "feat(prospeccion/udie): preview builder + commit pack (ImportProspectsActionResult) + engine wiring"
```

---

## Task 15: Fixtures reales + tests de integración

**Files:**
- Create: `tests/fixtures/import/linkedin.csv`, `evaboot.csv`, `apollo.csv`, `wiza.csv`, `phantombuster.csv`, `clientify.csv`, `generic.csv`, `sample.xlsx`
- Test: `src/lib/prospeccion/adapters/import/udie/prospect-import-engine.test.ts`

**Interfaces:**
- Consumes: `runProspectImportPreview`, `slugForDetectedFormat`.

- [ ] **Step 1: Crear los fixtures CSV (headers reales por herramienta)**

Create `tests/fixtures/import/linkedin.csv`:
```csv
First Name,Last Name,Company,Title,Email,LinkedIn Url
Laura,Gómez,ACME Logística,Gerenta de Operaciones,laura@acme.test,https://www.linkedin.com/in/lauragomez
Juan,Pérez,FarmaSur,Compras,,https://www.linkedin.com/in/juanperez
```
Create `tests/fixtures/import/evaboot.csv`:
```csv
Company,Title,Email,LinkedIn Url,Evaboot Cleaned Company Name
ACME,Operaciones,laura@acme.test,https://linkedin.com/in/lg,ACME Logística
```
Create `tests/fixtures/import/apollo.csv`:
```csv
First Name,Last Name,Company,Email,# Employees,Title
Ana,Díaz,Trans SA,ana@trans.test,50,Logística
```
Create `tests/fixtures/import/wiza.csv`:
```csv
Full Name,Company,Title,Email Status,Email
Pablo Ruiz,Distribuidora Z,Compras,valid,pablo@dz.test
```
Create `tests/fixtures/import/phantombuster.csv`:
```csv
profileUrl,fullName,companyName,title
https://linkedin.com/in/mr,María Roca,Norte SRL,Dirección
```
Create `tests/fixtures/import/clientify.csv`:
```csv
nombre,empresa,correo,telefono
Sofía López,Andes SA,sofia@andes.test,1144556677
```
Create `tests/fixtures/import/generic.csv` (delimitador `;` + BOM):
```csv
empresa;email;nombre;cargo
ACME;laura@acme.test;Laura Gómez;Operaciones
```
> Para `generic.csv`, asegurar un BOM al inicio (editar con un editor que lo agregue, o anteponer el carácter `﻿`).

- [ ] **Step 2: Crear `sample.xlsx` programáticamente (una vez)**

Run (genera el fixture con exceljs ya instalado):
```bash
node -e "const E=require('exceljs');const wb=new E.Workbook();const ws=wb.addWorksheet('s');ws.addRow(['empresa','email','nombre']);ws.addRow(['ACME','laura@acme.test','Laura Gómez']);wb.xlsx.writeFile('tests/fixtures/import/sample.xlsx').then(()=>console.log('ok'))"
```
Expected: imprime `ok`; existe `tests/fixtures/import/sample.xlsx`.

- [ ] **Step 3: Write the failing integration test**

Create `src/lib/prospeccion/adapters/import/udie/prospect-import-engine.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runProspectImportPreview, slugForDetectedFormat } from "./prospect-import-engine";

vi.mock("../../driving/import-actions", () => ({
  importProspectsAction: vi.fn(async () => ({ ok: true, message: "ok", inserted: 1, duplicates: 0, rejected: 0 })),
}));

const fx = (name: string, type = "text/csv") => {
  const buf = readFileSync(resolve(process.cwd(), "tests/fixtures/import", name));
  return new File([buf], name, { type });
};

const cases: Array<[string, string, string]> = [
  ["linkedin.csv", "LinkedIn Sales Navigator", "linkedin_sales_navigator"],
  ["evaboot.csv", "Evaboot", "csv"],
  ["apollo.csv", "Apollo", "csv"],
  ["wiza.csv", "Wiza", "csv"],
  ["phantombuster.csv", "Phantombuster", "csv"],
  ["clientify.csv", "Clientify", "csv"],
  ["generic.csv", "Generic CSV", "csv"],
];

describe("prospect import engine (integration, real fixtures)", () => {
  it.each(cases)("detects %s as %s and maps rows", async (file, fmt, slug) => {
    const r = await runProspectImportPreview(fx(file));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stats.detectedFormat).toBe(fmt);
    expect(slugForDetectedFormat(r.value.stats.detectedFormat)).toBe(slug);
    expect(r.value.rows.length).toBeGreaterThan(0);
    expect(r.value.rows.every((row) => (row.row.raw as Record<string, unknown>)._detected_format === fmt)).toBe(true);
  });

  it("parses xlsx via exceljs reader", async () => {
    const r = await runProspectImportPreview(
      fx("sample.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rows[0].row.email).toBe("laura@acme.test");
  });

  it("linkedin: row without email is still kept (linkedin_url is identity)", async () => {
    const r = await runProspectImportPreview(fx("linkedin.csv"));
    if (r.ok) expect(r.value.rows.some((row) => row.valid && !row.row.email)).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `npx vitest run src/lib/prospeccion/adapters/import/udie/prospect-import-engine.test.ts`
Expected: primero FAIL si algún detector/score necesita ajuste; ajustar `signature` en `profiles.ts` hasta PASS para los 7 + xlsx. (Iterar score/signature SOLO en `profiles.ts`.)

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/import src/lib/prospeccion/adapters/import/udie/prospect-import-engine.test.ts
git commit -m "test(prospeccion/udie): real-fixture integration tests (linkedin/evaboot/apollo/wiza/phantombuster/clientify/generic/xlsx)"
```

---

## Task 16: UI — `ImportWizard.tsx` + wiring en `ProspeccionView`

**Files:**
- Create: `src/app/(app)/comercial/prospeccion/ImportWizard.tsx`
- Modify: `src/app/(app)/comercial/prospeccion/ProspeccionView.tsx`

**Interfaces:**
- Consumes: `runProspectImportPreview`, `slugForDetectedFormat`, `confirmProspectImport` (vía un client wrapper — ver nota SSR).
- Produces: componente `<ImportWizard/>`.

> **Nota SSR/boundary:** `prospect-validator.ts` usa `crypto.randomUUID()` (disponible en browser). `prospect-commit.ts` importa la server action (`"use server"`), que es seguro invocar desde un client component. El XLSX reader usa `import("exceljs")` dinámico → no entra al bundle hasta soltar un `.xlsx`. El preview corre en el cliente.

- [ ] **Step 1: Escribir `ImportWizard.tsx`**

Create `src/app/(app)/comercial/prospeccion/ImportWizard.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  runProspectImportPreview,
  slugForDetectedFormat,
  confirmProspectImport,
} from "@/lib/prospeccion/adapters/import/udie/prospect-import-engine";
import type { PreviewModel } from "@/lib/udie/kernel/types";
import type { ProspectImportInput } from "@/lib/prospeccion/domain/prospect";

type Preview = PreviewModel<ProspectImportInput>;
const DOT: Record<string, string> = { nuevo: "🟢", posible: "🟡", exacto: "🔴" };

export function ImportWizard() {
  const router = useRouter();
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFile(file: File) {
    setError(null); setDone(null); setPreview(null);
    const r = await runProspectImportPreview(file);
    if (!r.ok) { setError(r.error.message); return; }
    setPreview(r.value);
  }

  function onConfirm() {
    if (!preview) return;
    const rows = preview.rows.filter((r) => r.valid).map((r) => r.row);
    const slug = slugForDetectedFormat(preview.stats.detectedFormat);
    start(async () => {
      const r = await confirmProspectImport(rows, slug);
      if (!r.ok) { setError(r.error.message); return; }
      setDone(`Importados ${r.value.inserted} · duplicados ${r.value.duplicates} · rechazados ${r.value.rejected}`);
      setPreview(null);
      router.refresh();
    });
  }

  const s = preview?.stats;
  return (
    <section className="card p-5 space-y-3">
      <h2 className="text-sm font-semibold">Importar prospectos</h2>
      <label
        className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors ${drag ? "border-tops-red bg-fg-primary/5" : "border-stroke-strong hover:bg-fg-primary/5"}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      >
        <span className="text-sm font-semibold text-fg-secondary">Arrastrá un CSV o XLSX, o hacé clic</span>
        <span className="text-[11px] text-fg-muted">LinkedIn · Evaboot · Apollo · Wiza · Clientify · CSV genérico</span>
        <input type="file" className="hidden" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </label>

      {error && <p className="text-sm text-tops-red">{error}</p>}
      {done && <p className="text-sm text-status-success">{done}</p>}

      {s && (
        <div className="space-y-2 text-sm">
          <p className="text-fg-secondary">Detectado: <span className="font-medium">{s.detectedFormat}</span> · {s.registros} filas · {s.columnas} columnas</p>
          <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
            <span>✔ {s.pctValidos}% válidos</span>
            <span>✖ {s.pctRechazados}% rechazados</span>
            <span>🏢 {s.empresasUnicas} empresas</span>
            <span>👤 {s.contactosUnicos} contactos</span>
            <span>🟡 {s.posiblesDuplicados} posibles</span>
            <span>🔴 {s.duplicadosExactos} exactos</span>
          </div>
          {s.unmappedHeaders.length > 0 && <p className="text-xs text-fg-muted">Columnas no reconocidas: {s.unmappedHeaders.join(", ")}</p>}
          {s.excedeMaxBatch && <p className="text-xs text-tops-red">Se importarán solo las primeras 500 filas (límite por lote).</p>}

          <div className="max-h-64 overflow-auto rounded border border-stroke">
            <table className="min-w-full text-xs">
              <thead className="bg-fg-primary/5 text-left">
                <tr><th className="px-2 py-1">#</th><th className="px-2 py-1">Estado</th><th className="px-2 py-1">Empresa</th><th className="px-2 py-1">Contacto</th><th className="px-2 py-1">Email</th><th className="px-2 py-1">Motivo</th></tr>
              </thead>
              <tbody>
                {preview!.rows.slice(0, 50).map((r) => (
                  <tr key={r.index} className={r.valid ? "" : "bg-tops-red/5"}>
                    <td className="px-2 py-1">{r.index + 1}</td>
                    <td className="px-2 py-1">{DOT[r.dedupStatus]} {r.dedupStatus}</td>
                    <td className="px-2 py-1">{r.row.company_name ?? "—"}</td>
                    <td className="px-2 py-1">{r.row.full_name ?? "—"}</td>
                    <td className="px-2 py-1">{r.row.email ?? "—"}</td>
                    <td className="px-2 py-1 text-tops-red">{r.valid ? r.dedupReason : (r.diagnostics[0]?.message ?? "inválido")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={onConfirm} disabled={pending || s.pctValidos === 0}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {pending ? "Importando…" : `Confirmar importación (${preview!.rows.filter((r) => r.valid).length})`}
          </button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Reemplazar el panel viejo en `ProspeccionView.tsx`**

En `src/app/(app)/comercial/prospeccion/ProspeccionView.tsx`:
- Reemplazar `import { importProspectsAction, ... }` y el componente `ImportPanel` por:
```tsx
import { ImportWizard } from "./ImportWizard";
```
- Cambiar `{canCreate && <ImportPanel />}` por `{canCreate && <ImportWizard />}`.
- Eliminar la función `ImportPanel` completa y los `useState`/`useTransition` que solo usaba ella.

- [ ] **Step 3: Verificar typecheck + build + suite completa + boundary**

Run:
```bash
npx tsc --noEmit
npx vitest run
node scripts/udie-boundary.mjs
npm run lint:udie-boundary
npx next build
```
Expected: typecheck 0 · vitest verde (incluye los nuevos) · `AP-UDIE-1 OK` · build exit 0 con la ruta `/comercial/prospeccion`.

- [ ] **Step 4: Verificación en navegador (preview tools)**

Levantar el dev server, ir a `/comercial/prospeccion`, soltar `tests/fixtures/import/linkedin.csv`, confirmar que aparece "Detectado: LinkedIn Sales Navigator", el preview con 🟢/🟡/🔴 y el resumen. Capturar screenshot.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/comercial/prospeccion/ImportWizard.tsx" "src/app/(app)/comercial/prospeccion/ProspeccionView.tsx"
git commit -m "feat(prospeccion): ImportWizard UI (drag&drop, detección, preview rico, dedup 🟢🟡🔴) over UDIE"
```

---

## Task 17: Cierre — Release Report + PR (sin merge)

**Files:**
- Create: `docs/udie/RELEASE-REPORT-F1.md`

- [ ] **Step 1: Escribir el Release Report**

Create `docs/udie/RELEASE-REPORT-F1.md` con: alcance entregado, mapa de archivos, gates (typecheck/vitest/build/boundary), cobertura de fixtures, cumplimiento de AP-UDIE-1/2, deuda diferida (EnricherPort no-op, planRemote, detected_format no-queryable), y checklist de no-deploy.

- [ ] **Step 2: Abrir el PR (sin merge)**

```bash
git push -u origin feat/prospeccion-f1-import
gh pr create --base main --head feat/prospeccion-f1-import \
  --title "feat(prospeccion): UDIE F1 — motor de ingesta + import LinkedIn/Evaboot/Apollo/Wiza/Clientify" \
  --body "Implementa docs/udie/ARQUITECTURA-UDIE.md (UDIE-B). NO MERGEAR sin gate de Dirección. Sin deploy. Sin cambios de RPC/modelo."
```

- [ ] **Step 3: Commit del release report**

```bash
git add docs/udie/RELEASE-REPORT-F1.md
git commit -m "docs(udie): F1 release report"
git push
```

---

## Self-Review

**1. Spec coverage (vs `docs/udie/ARQUITECTURA-UDIE.md`):**
- §6 pipeline (Reader→Detector→Normalizer→Enricher?→Mapper→Validator→Preview→Confirmation→Executor) → Tasks 3-10, 12-14. ✔ (EnricherPort definido en `ports.ts`, opcional, no-op en F1 — ADR-7.)
- §5 separación Core/Consumidor + 3 enforcement → Task 0 (grep + lint + probe), Task 10 (fake-entity canary). ✔
- §7 interfaces (TReport genérico, MappingPack/CommitPack, SourceProfile consumer-internal) → Task 2, 13, 14. ✔
- §3/§15 dedup intra-archivo, MAX_BATCH, confidence 0..1, register fail-closed, detected_format en raw → Tasks 3,7,12,13,14. ✔
- Fixtures reales + integración → Task 15. ✔
- UX drag&drop + preview rico + 🟢🟡🔴 → Task 16. ✔
- Compatibilidad (RPC/modelo/action sin cambios; csv-parser sync) → Task 11, 14. ✔

**2. Placeholder scan:** sin "TBD/TODO"; cada step de código tiene código real. ✔

**3. Type consistency:** `PreviewModel`/`PreviewStats`/`RowOutcome` definidos en Task 1 y usados consistentes en 7/10/14; `PreviewBuilderPort.build(...)` firma idéntica en Task 2 (def), 7 (consumo vía wrapper), 14 (impl). `ExecutorPort<TRow,TReport>`/`CommitPack` con `ImportProspectsActionResult` consistente en 2/14. `DedupKeyExtractorPort` (keysOf/primaryKey) consistente en 2/12/7. ✔

**Riesgo conocido a vigilar en ejecución:** las `signature` de los detectores (Task 13) pueden requerir calibración contra los fixtures (Task 15) — iterar SOLO en `profiles.ts`, nunca en el Core.

---

## Verificación adversarial — cambios incorporados (una ronda)

Dos revisores independientes: **R1** (fidelidad al diseño + consistencia de tipos) → `ready-with-fixes`; **R2** (ejecutabilidad + compilación contra el repo real) → `needs-rework` (por 3 blockers de configuración/scoring, NO de arquitectura, todos resueltos abajo). Ambos confirmaron contra el código real: firmas de dominio correctas (`ProspectImportInput`, `ProspectFactory.fromImportRow`, `SourceSlug.create`, `makeProspectId`, `DeduplicationPolicy`, `importProspectsAction` → `ImportProspectsActionResult`); `crypto.randomUUID`, `File/Blob/text/arrayBuffer` funcionan en vitest (node v25, `environment:"node"`) sin polyfill; API de PapaParse v5 correcta; import dinámico de exceljs correcto. Las 12 correcciones de la crítica de diseño están todas presentes y bien mapeadas.

| # | Severidad | Hallazgo | Cambio incorporado |
|---|---|---|---|
| 1 | blocker | `vitest.config.ts` no incluía `src/lib/udie/**` → los tests del Core nunca se colectan (FAIL/PASS falsos en Tasks 1-10 y 16) | **Task 0 Step 6:** agrega `"src/lib/udie/**/*.test.ts"` a `test.include` y lo commitea |
| 2 | blocker | El "red probe" del boundary era un paso manual que se auto-borraba → sin guardia de regresión durable | **Task 0 Step 7:** test vitest durable `__boundary.test.ts` (exit 1 con import prohibido / exit 0 limpio). **Step 3:** el grep ahora **excluye `*.test.ts`** (si no, el string-dato del test dispararía el guard) |
| 3 | blocker | Generic CSV casi nunca ganaba (headers ubicuos como `email` superaban el piso); `generic.csv` colisionaba con la firma de Clientify | **Task 13 `score()`:** un perfil nombrado debe cubrir **≥0,6** de su firma para competir; `generic.csv` (0,5 en Clientify) deja de calificar → Generic gana |
| 4 | medium | Empate `Apollo=LinkedIn=1.0` en `apollo.csv` resuelto solo por desempate alfabético (frágil) | **Task 13:** la firma de LinkedIn suma `"linkedin url"` → en `apollo.csv` LinkedIn baja a 0,8 < Apollo 1,0 (gana estricto); `linkedin.csv` da LinkedIn 1,0 |
| 5 | medium | `ValidatorPort` divergía del §7.2 (`outcome` vs `valid`) sin documentar | Documentado en Global Constraints + **doc de arquitectura §7.2 alineado** (`RowOutcome = {valid, diagnostics}`) |
| 6 | low | `resolveSlug` hardcodeaba `"csv"` → `stats.sourceSlug` siempre `csv` | **Task 10/14:** el consumidor inyecta `formatToSlug` → `stats.sourceSlug` coincide con el formato detectado |
| 7 | low | `confirmProspectImport` reconstruía un orquestador completo (readers/detectors sin uso) | **Task 14:** camino liviano que usa solo el `CommitPack` |
| 8 | low | Headers de Phantombuster (`profileUrl/fullName/companyName`) no mapeaban | **Task 11:** alias `profileurl/fullname/companyname` agregados |

## Riesgos remanentes (reales, con evidencia)

1. **Calibración de detectores con fixtures sintéticos.** Las firmas se validan contra fixtures construidos a mano (Task 15); un export real puede traer headers ligeramente distintos. Mitigación: el motor degrada a Generic CSV y el override de formato en la UI siempre gana. Cerrar con fixtures reales cuando se obtengan. *No bloqueante.*
2. **Preview ≠ servidor (doble validación, ADR-2).** El preview es best-effort **intra-archivo**: el conteo de duplicados no ve colisiones contra la base (cross-batch), y `MAX_BATCH=500` recorta en el commit. Decisión de diseño aceptada; el servidor es la autoridad. Mitigado por copy de UI (aviso `excedeMaxBatch`) + el reporte final real del commit.
3. **`detected_format` no es columna queryable** (vive en `raw` JSON). Reporting por herramienta requerirá a futuro una vista/índice externo a UDIE. Fuera de alcance F1 (ADR-3).

**Cierre:** sin inconsistencias arquitectónicas, sin incompatibilidades con el repositorio, plan ejecutable íntegramente por TDD. Las observaciones restantes son los 3 riesgos de arriba (aceptados/diferidos con motivo). No se requiere una tercera ronda.

---

## Execution Handoff

**Plan completo y guardado en `docs/superpowers/plans/2026-06-28-udie-prospeccion-f1.md`. Dos opciones de ejecución:**

**1. Subagent-Driven (recomendada)** — despacho un subagente fresco por tarea, reviso entre tareas, iteración rápida.

**2. Inline Execution** — ejecuto las tareas en esta sesión con `executing-plans`, en lotes con checkpoints de revisión.

**¿Cuál preferís?** (Recordá: la ejecución crea la rama y código; vos pediste no avanzar a implementación sin tu OK — así que esto recién arranca cuando lo autorices.)
