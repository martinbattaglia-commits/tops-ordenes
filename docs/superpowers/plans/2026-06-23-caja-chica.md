# Caja Chica (Tesorería) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replicar diariamente la solapa de ejercicio de la planilla `Caja chica .xlsx` (Google Drive) hacia Supabase y mostrarla en Nexus › Tesorería › Caja Chica (saldo conciliado, KPIs, dashboard, tabla).

**Architecture:** Submódulo **espejo read-only**. Un job diario (GitHub Actions 21:05 ART) baja **un** archivo XLSX por ID, parsea N solapas de ejercicio (`periodo`), y hace **snapshot-replace atómico por período** (RPC `cash_box_replace_periodo`) con guardas anti-borrado. UI en Server Components leyendo vistas. Todo **aditivo**; Nexus nunca escribe el Excel.

**Tech Stack:** Next.js (App Router, runtime nodejs), Supabase (`@supabase/ssr`), `exceljs`, service-account de Drive ya existente (`src/lib/drive/client.ts`), `zod`, `vitest` (nuevo, solo dev/test de lógica pura).

**Spec:** `docs/superpowers/specs/2026-06-23-caja-chica-design.md`

## Global Constraints

- Próxima migración = `0082` (la última en disco es `0081`). Migración **aditiva**: cero `ALTER` sobre tablas existentes.
- Convenciones DB: `id uuid default gen_random_uuid()`; logs en `bigserial`; trigger `public.tg_touch_updated_at()` (ya existe, def. en `0004`); RLS con `public.current_role()`; enums idempotentes `do $$ … duplicate_object … $$`; single-tenant (sin `org_id`).
- El job escribe con **service-role** (`createAdminClient()`) → bypassa RLS. La UI lee con **anon** (`createClient()`) → respeta RLS. Agregaciones **siempre en vistas**, nunca en TS.
- Patrón de ruta cron: `export const runtime="nodejs"; export const dynamic="force-dynamic"; export const maxDuration=60;` + auth `Authorization: Bearer ${process.env.CRON_SECRET}` (si está seteado) + `?dry=1`.
- Charts: **sin librería externa** — SVG propio estilo `CategoryDonut`/`SpendChart`.
- Rama de trabajo: `feat/tesoreria-caja-chica`. Commits frecuentes. **Nada a prod sin OK explícito de Martín.**
- `periodo` = año (int). Lista a procesar = `CAJA_CHICA_PERIODOS` (default `[año_actual]`).

---

## Pre-flight (operativo, antes de Task 7 — sync real)

- [ ] **P1:** Compartir `Caja chica .xlsx` (id `1g2ZJ0IjQnElVE3NLKeQGw4Aeqpx_uQSf`) — o su carpeta `1j5z7-SX_zOiJLsU9NLBh5MtkX_bJT9Uf` — con el email del service-account de Nexus (el `client_email` dentro de `GOOGLE_SERVICE_ACCOUNT_JSON`). Para obtenerlo: `node -e "console.log(JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON).client_email)"`.
- [ ] **P2:** Setear en Netlify + GitHub Secrets: `CAJA_CHICA_DRIVE_FILE_ID=1g2ZJ0IjQnElVE3NLKeQGw4Aeqpx_uQSf`. (`CRON_SECRET` ya existe.)
- [ ] **P3:** Confirmar `CAJA_CHICA_PERIODOS` (propuesta: vacío → default año actual).

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/lib/tesoreria/caja-chica/types.ts` | Tipos compartidos (ParsedRow, report, rules, matrix) |
| `src/lib/tesoreria/caja-chica/parse.ts` | `parseImporte`, `parseArgDate`, `findSaldo`, `parseMatrix` (**puro, testeable**) + `extractMatrix(ws)` (adaptador exceljs) |
| `src/lib/tesoreria/caja-chica/categorize.ts` | `categorize(concepto, rules)` (**puro**) |
| `src/lib/tesoreria/caja-chica/guards.ts` | `evaluateGuards(...)` + `computeDiff(prev,next)` (**puro**) |
| `src/lib/tesoreria/caja-chica/sync-engine.ts` | `runCajaChicaSync({trigger,dryRun})` — orquesta download→parse→guards→replace→snapshot→log |
| `src/lib/tesoreria/caja-chica/data.ts` | Lectura UI (getters desde vistas, anon client) |
| `src/app/api/tesoreria/caja-chica/sync/route.ts` | Endpoint cron (Bearer + `?dry=1`) |
| `src/app/(app)/tesoreria/caja-chica/page.tsx` | Pantalla (Server Component) |
| `src/components/tesoreria/caja-chica/*` | KPIs, banner conciliación, BarGastos, DonutCategorias, TablaMovimientos |
| `supabase/migrations/0082_cash_box_foundation.sql` | Tablas/vistas/RPC/seed (del spec §4) |
| `supabase/migrations/0083_cash_box_rollback.sql` | Rollback (no aplicar) |
| `.github/workflows/caja-chica-drive-sync.yml` | Cron 21:05 ART |
| `src/components/shell/Sidebar.tsx` | +1 ítem (modificar) |
| `src/lib/env.ts`, `.env.example` | +`cajaChica` (modificar) |
| `vitest.config.ts`, `package.json` | Test runner acotado (nuevo/modificar) |

---

### Task 1: Test harness + tipos

**Files:**
- Create: `vitest.config.ts`, `src/lib/tesoreria/caja-chica/types.ts`
- Modify: `package.json` (devDeps + script `test`)

**Interfaces — Produces:** todos los tipos del módulo (ver código).

- [ ] **Step 1: Instalar vitest (dev).**
```bash
npm i -D vitest@^2
```

- [ ] **Step 2: Config acotada a caja-chica.** Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/lib/tesoreria/caja-chica/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Script de test.** En `package.json` agregar a `scripts`: `"test": "vitest run"`.

- [ ] **Step 4: Tipos.** Create `src/lib/tesoreria/caja-chica/types.ts`:
```ts
export type CashBoxDirection = "acreditado" | "gasto";

export interface Cell { value: unknown; text: string }
export type CellMatrix = Cell[][];

export interface ParsedRow {
  periodo: number;
  direction: CashBoxDirection;
  tx_date: string | null;     // ISO yyyy-mm-dd
  tx_date_raw: string;
  concepto: string;
  importe: number;
  categoria: string | null;   // resuelta luego por categorize()
  source_row: number;         // fila 1-based en el Excel
  row_hash: string;
}

export interface ParsedSheet {
  periodo: number;
  rows: ParsedRow[];
  saldoExcel: number | null;
  totalAcreditado: number;
  totalGasto: number;
  corruptCount: number;       // celdas con importe presente pero no parseable
}

export interface CategoryRule {
  match_type: "contains" | "regex" | "exact";
  pattern: string;
  categoria: string;
  prioridad: number;
  activo: boolean;
}

export type SyncTrigger = "cron" | "manual" | "api";
export type SyncStatus = "running" | "completed" | "partial" | "error" | "skipped";

export interface PeriodoResult {
  periodo: number;
  status: "completed" | "partial" | "skipped" | "error";
  rowsParsed: number;
  rowsInserted: number;
  rowsChanged: number;
  rowsRemoved: number;
  saldoExcel: number | null;
  saldoCalc: number;
  saldoDelta: number | null;
  guard?: string;
}

export interface CajaChicaSyncReport {
  runId: string | null;
  trigger: SyncTrigger;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  fileId: string | null;
  periodos: number[];
  rowsParsed: number;
  rowsInserted: number;
  rowsChanged: number;
  rowsRemoved: number;
  errors: number;
  dryRun: boolean;
  message: string;
  perPeriodo: PeriodoResult[];
  events: { level: "info" | "warn" | "error"; msg: string }[];
}
```

- [ ] **Step 5: Smoke test.** Create `src/lib/tesoreria/caja-chica/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { ParsedRow } from "./types";
describe("harness", () => {
  it("compila y corre", () => {
    const r: ParsedRow = { periodo: 2026, direction: "gasto", tx_date: null, tx_date_raw: "02/01", concepto: "x", importe: 10, categoria: null, source_row: 4, row_hash: "h" };
    expect(r.periodo).toBe(2026);
  });
});
```

- [ ] **Step 6: Correr.** `npm test` → Expected: 1 passed. **Commit:** `chore(caja-chica): vitest acotado + tipos base`.

---

### Task 2: Parser puro (`parse.ts`)

**Files:**
- Create: `src/lib/tesoreria/caja-chica/parse.ts`, `src/lib/tesoreria/caja-chica/parse.test.ts`

**Interfaces:**
- Consumes: `CellMatrix`, `ParsedSheet`, `ParsedRow` (Task 1).
- Produces: `parseImporte(raw): number|null`, `parseArgDate(raw, periodo): string|null`, `findSaldo(m): number|null`, `parseMatrix(m, periodo): ParsedSheet`, `extractMatrix(ws): CellMatrix`, `rowHash(r): string`.

- [ ] **Step 1: Tests de `parseImporte`.** En `parse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseImporte, parseArgDate, parseMatrix, findSaldo } from "./parse";

describe("parseImporte", () => {
  it("numérico de exceljs pasa derecho", () => expect(parseImporte(10000)).toBe(10000));
  it("redondea a 2 decimales", () => expect(parseImporte(10.005)).toBe(10.01));
  it("US string $2,349,395.00", () => expect(parseImporte("$2,349,395.00")).toBe(2349395));
  it("AR string $8.430.000,00", () => expect(parseImporte("$8.430.000,00")).toBe(8430000));
  it("vacío → null", () => expect(parseImporte("")).toBeNull());
  it("basura → null", () => expect(parseImporte("n/a")).toBeNull());
});
```

- [ ] **Step 2: Verificar fallo.** `npm test` → FAIL (`parseImporte` no existe).

- [ ] **Step 3: Implementar `parseImporte`.** En `parse.ts`:
```ts
import type { Cell, CellMatrix, ParsedRow, ParsedSheet } from "./types";
import { createHash } from "node:crypto";

/** Importes reales vienen de exceljs como number; el path string es defensivo. */
export function parseImporte(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null;
  let s = String(raw).replace(/[^0-9.,-]/g, "").trim();
  if (!s || s === "-") return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  const dec = lastDot > lastComma ? "." : lastComma > -1 ? "," : "";
  if (dec) {
    const thou = dec === "." ? "," : ".";
    s = s.split(thou).join("").replace(dec, ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
```

- [ ] **Step 4: Verificar pasa.** `npm test` → PASS.

- [ ] **Step 5: Tests de `parseArgDate`.** Agregar:
```ts
describe("parseArgDate", () => {
  it("02/01 con periodo 2026", () => expect(parseArgDate("02/01", 2026)).toBe("2026-01-02"));
  it("acepta guiones", () => expect(parseArgDate("5-3", 2026)).toBe("2026-03-05"));
  it("inválida 31/02 → null", () => expect(parseArgDate("31/02", 2026)).toBeNull());
  it("texto suelto → null", () => expect(parseArgDate("varios", 2026)).toBeNull());
  it("vacío → null", () => expect(parseArgDate("", 2026)).toBeNull());
});
```

- [ ] **Step 6: Implementar `parseArgDate`.** Agregar a `parse.ts`:
```ts
export function parseArgDate(raw: unknown, periodo: number): string | null {
  if (raw == null) return null;
  if (raw instanceof Date) {
    const dd = String(raw.getUTCDate()).padStart(2, "0");
    const mm = String(raw.getUTCMonth() + 1).padStart(2, "0");
    return `${periodo}-${mm}-${dd}`;
  }
  const m = String(raw).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(periodo, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null; // overflow real (ej 31/02)
  return dt.toISOString().slice(0, 10);
}
```

- [ ] **Step 7: Test de `parseMatrix` + `findSaldo`** (libro de dos columnas independientes). Agregar:
```ts
const HEADER = (...c: string[]): any => c.map((t) => ({ value: t, text: t }));
const cell = (v: any, t?: string): any => ({ value: v, text: t ?? (v == null ? "" : String(v)) });
const blank = (): any => ({ value: null, text: "" });

function fixture() {
  // fila1 título, fila2 secciones, fila3 headers, fila4+ datos
  const m: any[][] = [];
  m.push(HEADER("2026 Caja Chica"));
  m.push([cell("ACREDITADOS"), blank(), blank(), cell("GASTOS"), blank(), blank(), blank(), blank(), cell("SALDO")]);
  m.push([cell("FECHA"), cell("ORIGEN"), cell("IMPORTE"), cell("FECHA"), cell("DESTINO"), cell("IMPORTE"), blank(), blank(), cell(5512186, "$5,512,186.00")]);
  m.push([cell("02/01"), cell("Planilla del 2025"), cell(2349395), cell("02/01"), cell("Recolector de residuos"), cell(10000)]);
  m.push([cell("07/01"), cell("Pago de Divanlito"), cell(8430000), cell("08/01"), cell("Almuerzo"), cell(13000)]);
  // acreditados se cortan acá; gastos siguen
  m.push([blank(), blank(), blank(), cell("12/01"), cell("Quartier"), cell(4000)]);
  return m as any;
}

describe("parseMatrix", () => {
  const ps = parseMatrix(fixture(), 2026);
  it("separa entradas y gastos por largo distinto", () => {
    expect(ps.rows.filter((r) => r.direction === "acreditado")).toHaveLength(2);
    expect(ps.rows.filter((r) => r.direction === "gasto")).toHaveLength(3);
  });
  it("totales", () => {
    expect(ps.totalAcreditado).toBe(10779395);
    expect(ps.totalGasto).toBe(27000);
  });
  it("lee saldo del Excel", () => expect(ps.saldoExcel).toBe(5512186));
  it("concepto = ORIGEN/DESTINO", () => {
    expect(ps.rows.find((r) => r.direction === "acreditado")!.concepto).toBe("Planilla del 2025");
    expect(ps.rows.find((r) => r.direction === "gasto")!.concepto).toBe("Recolector de residuos");
  });
  it("row_hash estable y único por fila", () => {
    const hashes = new Set(ps.rows.map((r) => r.row_hash));
    expect(hashes.size).toBe(ps.rows.length);
  });
});
```

- [ ] **Step 8: Implementar `findSaldo`, `rowHash`, `parseMatrix`.** Agregar a `parse.ts`:
```ts
export function rowHash(r: Pick<ParsedRow, "direction" | "periodo" | "source_row" | "tx_date_raw" | "concepto" | "importe">): string {
  return createHash("sha1")
    .update([r.direction, r.periodo, r.source_row, r.tx_date_raw, r.concepto, r.importe].join("|"))
    .digest("hex");
}

export function findSaldo(m: CellMatrix): number | null {
  for (let i = 0; i < Math.min(m.length, 6); i++) {
    const row = m[i] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (/saldo/i.test(row[c]?.text ?? "")) {
        // buscar primer numérico en esa columna, en las próximas 4 filas
        for (let k = i; k < Math.min(m.length, i + 4); k++) {
          const n = parseImporte((m[k]?.[c])?.value ?? (m[k]?.[c])?.text);
          if (n != null) return n;
        }
      }
    }
  }
  return null;
}

function headerRowIndex(m: CellMatrix): number {
  for (let i = 0; i < Math.min(m.length, 8); i++) {
    const txt = (m[i] ?? []).map((c) => (c?.text ?? "").toUpperCase());
    if (txt.includes("ORIGEN") && txt.includes("DESTINO")) return i;
    if (txt.filter((t) => t === "FECHA").length >= 2) return i;
  }
  return 2; // default observado: headers en fila 3 (índice 2)
}

function sideRows(
  m: CellMatrix, start: number, periodo: number,
  dateCol: number, conceptCol: number, importeCol: number,
  direction: ParsedRow["direction"], corrupt: { n: number },
): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (let i = start; i < m.length; i++) {
    const row = m[i] ?? [];
    const dateRaw = (row[dateCol]?.text ?? "").trim();
    const concepto = (row[conceptCol]?.text ?? "").trim();
    const importeCell = row[importeCol]?.value ?? row[importeCol]?.text;
    const hasImporte = importeCell != null && String(importeCell).trim() !== "";
    if (!dateRaw && !concepto && !hasImporte) break; // fin de la lista de este lado
    if (!concepto && !hasImporte) continue;          // fila ruido
    const importe = parseImporte(importeCell);
    if (importe == null) { corrupt.n++; continue; }
    const base = {
      periodo, direction,
      tx_date: parseArgDate(dateRaw, periodo),
      tx_date_raw: dateRaw, concepto, importe,
      source_row: i + 1,
    };
    out.push({ ...base, categoria: null, row_hash: rowHash(base) });
  }
  return out;
}

export function parseMatrix(m: CellMatrix, periodo: number): ParsedSheet {
  const start = headerRowIndex(m) + 1;
  const corrupt = { n: 0 };
  const acred = sideRows(m, start, periodo, 0, 1, 2, "acreditado", corrupt);
  const gastos = sideRows(m, start, periodo, 3, 4, 5, "gasto", corrupt);
  const rows = [...acred, ...gastos];
  const totalAcreditado = acred.reduce((s, r) => s + r.importe, 0);
  const totalGasto = gastos.reduce((s, r) => s + r.importe, 0);
  return {
    periodo, rows,
    saldoExcel: findSaldo(m),
    totalAcreditado: Math.round(totalAcreditado * 100) / 100,
    totalGasto: Math.round(totalGasto * 100) / 100,
    corruptCount: corrupt.n,
  };
}
```

- [ ] **Step 9: Verificar.** `npm test` → PASS (todos).

- [ ] **Step 10: Adaptador exceljs `extractMatrix`** (no unit-test; se valida en dry-run real). Agregar a `parse.ts`:
```ts
import type { Worksheet } from "exceljs";
export function extractMatrix(ws: Worksheet): CellMatrix {
  const m: CellMatrix = [];
  const maxCol = 9; // A..I
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: Cell[] = [];
    for (let c = 1; c <= maxCol; c++) {
      const cell = row.getCell(c);
      cells.push({ value: cell.value, text: cell.text ?? "" });
    }
    m.push(cells);
  });
  return m;
}
```

- [ ] **Step 11: Commit.** `feat(caja-chica): parser puro del libro 2026 + tests`.

---

### Task 3: Categorización por reglas (`categorize.ts`)

**Files:** Create `src/lib/tesoreria/caja-chica/categorize.ts`, `categorize.test.ts`
**Interfaces:** Produces `categorize(concepto: string, rules: CategoryRule[]): string | null`.

- [ ] **Step 1: Tests.**
```ts
import { describe, it, expect } from "vitest";
import { categorize } from "./categorize";
import type { CategoryRule } from "./types";
const R = (pattern: string, categoria: string, prioridad: number, match_type: CategoryRule["match_type"] = "contains"): CategoryRule =>
  ({ pattern, categoria, prioridad, match_type, activo: true });
const rules = [R("nafta", "Combustible", 10), R("anticipo", "Anticipos", 50), R("^pago de ruth", "Préstamos", 5, "regex")];

describe("categorize", () => {
  it("contains, case-insensitive", () => expect(categorize("Nafta para Qubo", rules)).toBe("Combustible"));
  it("respeta prioridad (menor primero)", () => expect(categorize("Pago de Ruth 200", rules)).toBe("Préstamos"));
  it("sin match → null (fallback 'Otros' lo pone la vista)", () => expect(categorize("Cosa rara", rules)).toBeNull());
});
```

- [ ] **Step 2: Verificar fallo.** `npm test` → FAIL.

- [ ] **Step 3: Implementar.**
```ts
import type { CategoryRule } from "./types";
export function categorize(concepto: string, rules: CategoryRule[]): string | null {
  const c = (concepto || "").toLowerCase().trim();
  if (!c) return null;
  const sorted = rules.filter((r) => r.activo).sort((a, b) => a.prioridad - b.prioridad);
  for (const r of sorted) {
    const p = r.pattern.toLowerCase();
    if (r.match_type === "exact" && c === p) return r.categoria;
    if (r.match_type === "contains" && c.includes(p)) return r.categoria;
    if (r.match_type === "regex") { try { if (new RegExp(r.pattern, "i").test(concepto)) return r.categoria; } catch { /* regla inválida → ignorar */ } }
  }
  return null;
}
```

- [ ] **Step 4: Verificar.** `npm test` → PASS. **Commit:** `feat(caja-chica): categorización por reglas`.

---

### Task 4: Guardas + diff (`guards.ts`)

**Files:** Create `src/lib/tesoreria/caja-chica/guards.ts`, `guards.test.ts`
**Interfaces:** Produces `evaluateGuards(parsed: ParsedSheet, currentCount: number, opts?): { ok: boolean; reason?: string }` y `computeDiff(prevHashes: string[], next: ParsedRow[]): { inserted: number; changed: number; removed: number }`.

- [ ] **Step 1: Tests.**
```ts
import { describe, it, expect } from "vitest";
import { evaluateGuards, computeDiff } from "./guards";
import type { ParsedSheet, ParsedRow } from "./types";
const sheet = (rows: number, corrupt = 0): ParsedSheet =>
  ({ periodo: 2026, rows: Array.from({ length: rows }, (_, i) => ({ row_hash: "h" + i } as ParsedRow)), saldoExcel: 1, totalAcreditado: 0, totalGasto: 0, corruptCount: corrupt });

describe("evaluateGuards", () => {
  it("0 filas → bloquea", () => expect(evaluateGuards(sheet(0), 100).ok).toBe(false));
  it("caída >40% → bloquea", () => expect(evaluateGuards(sheet(50), 100).ok).toBe(false));
  it("caída leve → ok", () => expect(evaluateGuards(sheet(95), 100).ok).toBe(true));
  it(">5% corruptos → bloquea", () => expect(evaluateGuards(sheet(100, 6), 100).ok).toBe(false));
  it("primera corrida (current=0) con filas → ok", () => expect(evaluateGuards(sheet(80), 0).ok).toBe(true));
});

describe("computeDiff", () => {
  it("cuenta inserted/changed/removed", () => {
    const prev = ["a", "b", "c"];
    const next = [{ row_hash: "a" }, { row_hash: "x" }] as ParsedRow[];
    expect(computeDiff(prev, next)).toEqual({ inserted: 1, changed: 0, removed: 2 });
  });
});
```

- [ ] **Step 2: Verificar fallo.** `npm test` → FAIL.

- [ ] **Step 3: Implementar.**
```ts
import type { ParsedSheet, ParsedRow } from "./types";
export interface GuardOpts { maxDropPct?: number; maxCorruptPct?: number }
export function evaluateGuards(parsed: ParsedSheet, currentCount: number, opts: GuardOpts = {}): { ok: boolean; reason?: string } {
  const maxDrop = opts.maxDropPct ?? 0.4, maxCorrupt = opts.maxCorruptPct ?? 0.05;
  const n = parsed.rows.length;
  if (n === 0) return { ok: false, reason: "0 filas parseadas" };
  if (n + parsed.corruptCount > 0 && parsed.corruptCount / (n + parsed.corruptCount) > maxCorrupt)
    return { ok: false, reason: `importes no parseables ${parsed.corruptCount} > ${Math.round(maxCorrupt * 100)}%` };
  if (currentCount > 0 && n < currentCount * (1 - maxDrop))
    return { ok: false, reason: `caída de filas ${currentCount}→${n} > ${Math.round(maxDrop * 100)}%` };
  return { ok: true };
}
export function computeDiff(prevHashes: string[], next: ParsedRow[]): { inserted: number; changed: number; removed: number } {
  const prev = new Set(prevHashes), nextSet = new Set(next.map((r) => r.row_hash));
  const inserted = next.filter((r) => !prev.has(r.row_hash)).length;
  const removed = prevHashes.filter((h) => !nextSet.has(h)).length;
  return { inserted, changed: 0, removed }; // snapshot-replace: cambios reales = inserted/removed
}
```

- [ ] **Step 4: Verificar.** `npm test` → PASS. **Commit:** `feat(caja-chica): guardas anti-borrado + diff`.

---

### Task 5: Migración `0082` + rollback `0083`

**Files:** Create `supabase/migrations/0082_cash_box_foundation.sql` (copiar **literal** del spec §4, con la función ya renombrada a `cash_box_replace_periodo`), `supabase/migrations/0083_cash_box_rollback.sql`.

- [ ] **Step 1:** Crear `0082_*.sql` = bloque SQL del spec §4 (enum, 4 tablas, triggers, RPC `cash_box_replace_periodo`, 2 vistas, RLS read/write, seed reglas). Encabezado con bloque de comentarios estilo `0081`.
- [ ] **Step 2:** Crear `0083_cash_box_rollback.sql`:
```sql
-- 0083_cash_box_rollback — revierte 0082 (NO aplicar salvo rollback)
drop view if exists public.v_cash_box_resumen;
drop view if exists public.v_cash_box_movimientos;
drop function if exists public.cash_box_replace_periodo(int, jsonb, uuid);
drop table if exists public.cash_box_snapshots;
drop table if exists public.cash_box_sync_log;
drop table if exists public.cash_box_category_rules;
drop table if exists public.cash_box_transactions;
drop type if exists public.cash_box_direction_t;
notify pgrst, 'reload schema';
```
- [ ] **Step 3: Validar en branch efímero (NO prod).** Vía MCP Supabase: `create_branch` → `apply_migration(0082)` → `list_tables` confirma las 4 tablas + 2 vistas + RPC → `execute_sql("select public.cash_box_replace_periodo(2099,'[]'::jsonb, gen_random_uuid())")` devuelve 0 → `delete_branch`. (Detalle en checklist V1–V4.)
- [ ] **Step 4: Commit.** `feat(caja-chica): migración 0082 + rollback 0083 (no aplicada a prod)`.

---

### Task 6: Env + `.env.example`

**Files:** Modify `src/lib/env.ts`, `.env.example`
**Interfaces:** Produces `env.cajaChica.fileId: string|undefined`, `env.cajaChica.periodos: number[]`.

- [ ] **Step 1:** En `src/lib/env.ts`, replicando el patrón del bloque `CONTRATOS_*`, agregar:
```ts
// Caja Chica (Tesorería) — espejo de planilla Drive
cajaChica: {
  fileId: process.env.CAJA_CHICA_DRIVE_FILE_ID,
  periodos: (process.env.CAJA_CHICA_PERIODOS ?? "")
    .split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n)),
},
```
- [ ] **Step 2:** En `.env.example` documentar `CAJA_CHICA_DRIVE_FILE_ID=` y `CAJA_CHICA_PERIODOS=` (vacío = año actual).
- [ ] **Step 3:** `npm run typecheck` → sin errores. **Commit:** `chore(caja-chica): env CAJA_CHICA_*`.

---

### Task 7: Motor de sync (`sync-engine.ts`)

**Files:** Create `src/lib/tesoreria/caja-chica/sync-engine.ts`
**Interfaces:** Consumes `extractMatrix/parseMatrix` (T2), `categorize` (T3), `evaluateGuards/computeDiff` (T4), `createAdminClient` (`@/lib/supabase/server`), `downloadFileBuffer` (`@/lib/drive/client` — **confirmar export exacto con `grep -n "export.*downloadFileBuffer\|export.*download" src/lib/drive/client.ts`** antes de codear). Produces `runCajaChicaSync(opts): Promise<CajaChicaSyncReport>`.

> **Verificación (no unit-test):** se prueba con `?dry=1` contra el archivo real (checklist V5–V8). Lógica pura ya cubierta por T2–T4.

- [ ] **Step 1: Confirmar la firma del downloader.** `grep -n "downloadFileBuffer\|exportGoogleFile" src/lib/drive/client.ts`. Ajustar el import al nombre real.
- [ ] **Step 2: Implementar el engine** (download → exceljs → por período: extract→parse→categorize→guards→replace→snapshot→log). Código completo:
```ts
import ExcelJS from "exceljs";
import { createAdminClient } from "@/lib/supabase/server";
import { downloadFileBuffer } from "@/lib/drive/client"; // ajustar si difiere (Step 1)
import { env } from "@/lib/env";
import { extractMatrix, parseMatrix } from "./parse";
import { categorize } from "./categorize";
import { evaluateGuards, computeDiff } from "./guards";
import type { CajaChicaSyncReport, CategoryRule, PeriodoResult, ParsedRow, SyncTrigger } from "./types";

export async function runCajaChicaSync(opts: { trigger: SyncTrigger; dryRun?: boolean }): Promise<CajaChicaSyncReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const events: CajaChicaSyncReport["events"] = [];
  const log = (level: "info" | "warn" | "error", msg: string) => events.push({ level, msg });
  const periodos = env.cajaChica.periodos.length ? env.cajaChica.periodos : [new Date().getFullYear()];
  const fileId = env.cajaChica.fileId ?? null;

  const base: CajaChicaSyncReport = {
    runId: null, trigger: opts.trigger, status: "running", startedAt, finishedAt: null, durationMs: 0,
    fileId, periodos, rowsParsed: 0, rowsInserted: 0, rowsChanged: 0, rowsRemoved: 0,
    errors: 0, dryRun: !!opts.dryRun, message: "", perPeriodo: [], events,
  };

  const db = createAdminClient();
  if (!db || !fileId) {
    return { ...base, status: "skipped", finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, message: "Sin DB o sin CAJA_CHICA_DRIVE_FILE_ID" };
  }

  // run row
  let runId: string | null = null;
  if (!opts.dryRun) {
    const { data } = await db.from("cash_box_sync_log").insert({ trigger: opts.trigger, status: "running", file_id: fileId, periodos }).select("run_id").single();
    runId = data?.run_id ?? null;
  }

  let buf: Buffer;
  try { buf = await downloadFileBuffer(fileId); }
  catch (e) { return finalize({ ...base, runId, status: "error", errors: 1, message: `Descarga falló: ${e instanceof Error ? e.message : e}` }); }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  const { data: ruleRows } = await db.from("cash_box_category_rules").select("match_type,pattern,categoria,prioridad,activo");
  const rules = (ruleRows ?? []) as CategoryRule[];

  for (const periodo of periodos) {
    const ws = wb.getWorksheet(String(periodo));
    if (!ws) { base.perPeriodo.push({ periodo, status: "skipped", rowsParsed: 0, rowsInserted: 0, rowsChanged: 0, rowsRemoved: 0, saldoExcel: null, saldoCalc: 0, saldoDelta: null, guard: "solapa ausente" }); log("warn", `Solapa ${periodo} ausente`); continue; }

    const parsed = parseMatrix(extractMatrix(ws), periodo);
    for (const r of parsed.rows) r.categoria = categorize(r.concepto, rules);

    const { count: currentCount } = await db.from("cash_box_transactions").select("*", { count: "exact", head: true }).eq("periodo", periodo);
    const guard = evaluateGuards(parsed, currentCount ?? 0);
    const saldoCalc = Math.round((parsed.totalAcreditado - parsed.totalGasto) * 100) / 100;
    const saldoDelta = parsed.saldoExcel == null ? null : Math.round((parsed.saldoExcel - saldoCalc) * 100) / 100;

    if (!guard.ok) {
      base.perPeriodo.push({ periodo, status: "partial", rowsParsed: parsed.rows.length, rowsInserted: 0, rowsChanged: 0, rowsRemoved: 0, saldoExcel: parsed.saldoExcel, saldoCalc, saldoDelta, guard: guard.reason });
      log("warn", `Período ${periodo} bloqueado por guarda: ${guard.reason}`); base.errors++; continue;
    }

    const { data: prevRows } = await db.from("cash_box_transactions").select("row_hash").eq("periodo", periodo);
    const diff = computeDiff((prevRows ?? []).map((x: { row_hash: string }) => x.row_hash), parsed.rows);

    if (!opts.dryRun) {
      const payload = parsed.rows.map((r: ParsedRow) => ({ ...r, sync_run_id: runId }));
      const { error } = await db.rpc("cash_box_replace_periodo", { p_periodo: periodo, p_rows: payload, p_run_id: runId });
      if (error) { base.perPeriodo.push({ periodo, status: "error", rowsParsed: parsed.rows.length, rowsInserted: 0, rowsChanged: 0, rowsRemoved: 0, saldoExcel: parsed.saldoExcel, saldoCalc, saldoDelta, guard: error.message }); base.errors++; log("error", `RPC ${periodo}: ${error.message}`); continue; }
      const porCat = aggByCategoria(parsed.rows);
      await db.from("cash_box_snapshots").upsert({ periodo, snapshot_date: new Date().toISOString().slice(0, 10), sync_run_id: runId, total_acreditado: parsed.totalAcreditado, total_gasto: parsed.totalGasto, saldo_excel: parsed.saldoExcel, saldo_calc: saldoCalc, saldo_delta: saldoDelta, movimientos: parsed.rows.length, por_categoria: porCat }, { onConflict: "periodo,snapshot_date" });
    }

    base.perPeriodo.push({ periodo, status: "completed", rowsParsed: parsed.rows.length, rowsInserted: diff.inserted, rowsChanged: diff.changed, rowsRemoved: diff.removed, saldoExcel: parsed.saldoExcel, saldoCalc, saldoDelta });
    base.rowsParsed += parsed.rows.length; base.rowsInserted += diff.inserted; base.rowsRemoved += diff.removed;
  }

  const anyOk = base.perPeriodo.some((p) => p.status === "completed");
  const anyBad = base.perPeriodo.some((p) => p.status === "partial" || p.status === "error");
  return finalize({ ...base, status: !anyOk ? "error" : anyBad ? "partial" : "completed", message: `Períodos: ${base.perPeriodo.map((p) => `${p.periodo}:${p.status}`).join(", ")}` });

  function aggByCategoria(rows: ParsedRow[]): Record<string, number> {
    const acc: Record<string, number> = {};
    for (const r of rows) if (r.direction === "gasto") { const k = r.categoria ?? "Otros"; acc[k] = Math.round(((acc[k] ?? 0) + r.importe) * 100) / 100; }
    return acc;
  }
  async function finalize(rep: CajaChicaSyncReport): Promise<CajaChicaSyncReport> {
    const finishedAt = new Date().toISOString(); const durationMs = Date.now() - t0;
    const out = { ...rep, finishedAt, durationMs };
    if (!opts.dryRun && runId) await db!.from("cash_box_sync_log").update({ status: out.status, finished_at: finishedAt, duration_ms: durationMs, rows_parsed: out.rowsParsed, rows_inserted: out.rowsInserted, rows_changed: out.rowsChanged, rows_removed: out.rowsRemoved, errors: out.errors, message: out.message, report: { perPeriodo: out.perPeriodo, events: out.events.slice(0, 200) } }).eq("run_id", runId);
    return out;
  }
}
```
- [ ] **Step 3:** `npm run typecheck` → sin errores (ajustar import del downloader si hace falta). **Commit:** `feat(caja-chica): motor de sync snapshot-replace`.

---

### Task 8: Endpoint `/api/tesoreria/caja-chica/sync`

**Files:** Create `src/app/api/tesoreria/caja-chica/sync/route.ts` (espeja `compliance/sync/route.ts`).

- [ ] **Step 1:** Implementar:
```ts
import { NextResponse } from "next/server";
import { runCajaChicaSync } from "@/lib/tesoreria/caja-chica/sync-engine";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  try {
    const r = await runCajaChicaSync({ trigger: "cron", dryRun });
    return NextResponse.json({ success: r.status !== "error", status: r.status, sync_log_id: r.runId, periodos: r.periodos, rows_parsed: r.rowsParsed, rows_inserted: r.rowsInserted, rows_removed: r.rowsRemoved, per_periodo: r.perPeriodo, errors: r.errors, dry_run: r.dryRun, message: r.message }, { status: r.status === "error" ? 502 : 200 });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }
```
- [ ] **Step 2: Verificar dry-run real** (requiere Pre-flight P1/P2 + `0082` en branch o local): `curl -s "$APP_URL/api/tesoreria/caja-chica/sync?dry=1" -H "Authorization: Bearer $CRON_SECRET" | jq` → `status:"completed"`, `rows_parsed > 0`, `per_periodo[].saldoExcel` ≈ saldo de la planilla. **Commit:** `feat(caja-chica): endpoint de sync cron`.

---

### Task 9: Data layer UI (`data.ts`)

**Files:** Create `src/lib/tesoreria/caja-chica/data.ts`
**Interfaces:** Produces `getResumen(periodo?)`, `getMovimientos(periodo, filtros)`, `getGastosMensuales(periodo)`, `getMixCategorias(periodo)`, `getTopConceptos(periodo)`, `getTendencia90(periodo)`, `getUltimaSync()`. Todos usan `createClient()` (anon) y devuelven `[]`/`null` en demo-mode.

- [ ] **Step 1:** Implementar getters leyendo `v_cash_box_resumen`, `v_cash_box_movimientos`, `cash_box_snapshots`, `cash_box_sync_log` (filtros server-side, sin agregación en TS salvo `reduce` triviales sobre la vista). Patrón idéntico a `src/lib/tesoreria/data.ts`.
- [ ] **Step 2:** `npm run typecheck`. **Commit:** `feat(caja-chica): data layer del dashboard`.

---

### Task 10: UI — pantalla + componentes + sidebar

**Files:** Create `src/app/(app)/tesoreria/caja-chica/page.tsx`, `src/components/tesoreria/caja-chica/{KpiRow,ConciliacionBanner,BarGastosMensuales,DonutCategorias,TablaMovimientos}.tsx`; Modify `src/components/shell/Sidebar.tsx`.

- [ ] **Step 1:** `BarGastosMensuales` y `DonutCategorias` = SVG propio (clonar estructura de `src/components/charts/SpendChart.tsx` y `CategoryDonut.tsx`).
- [ ] **Step 2:** `page.tsx` (Server Component): `Promise.all` sobre los getters de `data.ts`; render = header + última sync, `ConciliacionBanner`, `KpiRow` (Saldo verde/rojo, Gastado mes, Gastado año, Movimientos), grid charts, `TablaMovimientos` (búsqueda/orden/filtros/export CSV-Excel). Reusar `Kpi` de `src/components/tesoreria/ui.tsx` y clases `.nx-*`/`.card`.
- [ ] **Step 3:** Sidebar: agregar al dominio `tesoreria` `{ href: "/tesoreria/caja-chica", label: "Caja Chica", icon: "wallet" }`, gated por permiso `finanzas.*` igual que el resto.
- [ ] **Step 4: Verificar en dev** (preview tools): `npm run dev` (puerto del proyecto) → navegar `/tesoreria/caja-chica` → snapshot del DOM confirma KPIs/banner/charts/tabla; sin errores en consola. **Commit:** `feat(caja-chica): pantalla Tesorería › Caja Chica`.

---

### Task 11: Cron (GitHub Actions)

**Files:** Create `.github/workflows/caja-chica-drive-sync.yml` (espeja `compliance-drive-sync.yml`).

- [ ] **Step 1:** Implementar:
```yaml
name: Caja Chica Drive Sync
on:
  schedule:
    - cron: "5 0 * * *"   # 00:05 UTC = 21:05 ART
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Trigger sync
        run: |
          curl -fsS -X POST --max-time 120 \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.APP_URL || 'https://tops-ordenes.netlify.app' }}/api/tesoreria/caja-chica/sync"
```
- [ ] **Step 2:** Documentar en el PR los secrets requeridos (`CRON_SECRET` ya existe; `CAJA_CHICA_DRIVE_FILE_ID` en Netlify). **Commit:** `ci(caja-chica): workflow diario 21:05 ART`.

---

### Task 12: Validación final + PR

- [ ] **Step 1:** Correr el **checklist de validación** completo (`docs/superpowers/plans/2026-06-23-caja-chica-validation-checklist.md`).
- [ ] **Step 2:** `npm run typecheck` + `npm run lint` + `npm test` verdes; `npm run build` OK.
- [ ] **Step 3:** Abrir PR de `feat/tesoreria-caja-chica` con resumen + link al spec. **No mergear ni aplicar `0082` a prod sin OK de Martín.**

---

## Self-Review (cobertura spec → plan)

- §3 decisión 1 (tabla única + direction) → T1 tipos, T5 migración, T2 parser. ✅
- §3 decisión 2 (snapshot-replace atómico) → T5 RPC `cash_box_replace_periodo`, T7 engine. ✅
- §3 decisión 3 (reglas categoría) → T3 categorize, T5 seed. ✅
- §3 decisión 4 (saldo Excel + Σ + delta) → T2 `findSaldo`, T7 saldoCalc/Delta, T5 snapshot. ✅
- §3 decisión 5 (multi-ejercicio) → `periodo` en T1/T5, loop por `CAJA_CHICA_PERIODOS` en T6/T7. ✅
- §3 decisión 6 (`cash_box_snapshots`) → T5 tabla, T7 upsert diario, T9/T10 tendencia 90d. ✅
- §5 guardas anti-borrado → T4 `evaluateGuards`, T7 aplicación. ✅
- §6 UI (KPIs/banner/charts/tabla/sidebar) → T9 data, T10 UI. ✅
- §5 sync flow (download/parse/log) → T7 engine, T8 endpoint, T11 cron. ✅
- §8 performance (sin walk, 1 archivo) → T7 `downloadFileBuffer` por ID. ✅
- §9 rollback → T5 `0083`, T12 PR sin merge. ✅
- §10 prerrequisitos → Pre-flight P1–P3. ✅
