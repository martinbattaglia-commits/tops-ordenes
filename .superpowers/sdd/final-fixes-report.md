# Final Fixes Report — feat/prospeccion-f1-import

Date: 2026-06-28

## Fix #1 — MAX_BATCH: single source of truth + preview/commit alignment

**Problem:** `MAX_BATCH = 500` was hardcoded in three places (`import-prospects.use-case.ts`, `prospect-preview.ts`, `prospect-import-engine.ts`). `ImportWizard.tsx` also sent ALL valid rows to the server (which then sliced to 500), making the "primeras 500 filas" warning technically misleading.

**How fixed:**
- `prospect-preview.ts`: removed `const MAX_BATCH = 500;` comment-mirror; now imports `MAX_BATCH` from `../../../application/import-prospects.use-case`.
- `prospect-import-engine.ts`: removed hardcoded `maxBatch: 500` in `buildOrchestrator`; imports `MAX_BATCH` from the use-case; re-exports it (`export { MAX_BATCH }`) so the wizard can consume it without a direct use-case import.
- `ImportWizard.tsx` `onConfirm`: imports `MAX_BATCH` from the engine and slices valid rows to `.slice(0, MAX_BATCH)` before calling `confirmProspectImport`. The "primeras 500 filas" warning is now literally accurate.

**Files changed:** `prospect-preview.ts`, `prospect-import-engine.ts`, `ImportWizard.tsx`

---

## Fix #2 — unmappedHeaders falsely listed first/last-name columns

**Problem:** `mapTable` (UDIE core) computes `unmappedHeaders` from `Object.keys(mapping.aliases)` only. But `prospect-mapper.ts` also consumes `first name`, `last name`, `nombre de pila`, `apellido` via special-case logic (combined into `full_name`). LinkedIn/Apollo/Phantombuster previews wrongly showed those headers as "not recognised".

**How fixed (consumer-side only — AP-UDIE-1 kept green):**
- `prospect-preview.ts`: defined `MAPPER_CONSUMED_HEADERS` set (`first name`, `last name`, `nombre de pila`, `apellido`, case-insensitive). In `prospectPreviewBuilder.build`, filters `unmappedHeaders` to remove them before passing to `buildPreview`.
- `prospect-import-engine.test.ts`: added test "linkedin: unmappedHeaders does NOT contain first name or last name (Fix #2)".

**Files changed:** `prospect-preview.ts`, `prospect-import-engine.test.ts`

---

## Fix #3 — Unify forbidden-context list (grep ↔ eslint)

**Problem:** `scripts/udie-boundary.mjs` covered `prospeccion|clientify|recon|comercial|compliance` but `.eslintrc.json` was missing `compliance`. The `**/domain/*` pattern was in eslint but not in the grep regex.

**How fixed:**
- `scripts/udie-boundary.mjs`: combined regex now matches `@/lib/(prospeccion|clientify|recon|comercial|compliance)`, relative variants of the same, and any `*/domain/` path — all in one pattern. Excludes `*.test.ts`/`*.test.tsx`.
- `.eslintrc.json` UDIE override: added `@/lib/compliance/*` to `no-restricted-imports` patterns (already had `**/domain/*`).
- Both files now enforce the same set: `prospeccion, clientify, recon, comercial, compliance` + `**/domain/*`.

**Files changed:** `scripts/udie-boundary.mjs`, `.eslintrc.json`

---

## Fix #5 — Collapse redundant mapper factory

**Problem:** `profiles.ts` exported both `makeProspectMapper` (re-export from `prospect-mapper.ts`) and `makeProspectMapperFor` (one-line passthrough: `return makeProspectMapper(fmt)`). Two names for the same thing.

**How fixed:**
- `profiles.ts`: removed `makeProspectMapperFor` function and unused `MapperPort` import.
- `prospect-import-engine.ts`: updated import from `makeProspectMapperFor` to `makeProspectMapper`; updated `buildPack` `mapperFor` lambda accordingly.

**Files changed:** `profiles.ts`, `prospect-import-engine.ts`

---

## Recommendation — Type-level contract test

**How added:**
- `prospect-commit.test.ts`: added a compile-time `satisfies`-style check using conditional type assignment: `type _RowsAreAssignable = ProspectImportInput[] extends NonNullable<ImportProspectsActionInput["rows"]> ? true : never; const _contractCheck: _RowsAreAssignable = true;`. If `importProspectsAction`'s `rows` type ever drifts from `ProspectImportInput[]`, tsc will error at this line.

**Files changed:** `prospect-commit.test.ts`

---

## Gate Results

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx vitest run` | 202 tests passed (36 test files) |
| `node scripts/udie-boundary.mjs` | AP-UDIE-1 OK |
| `npx next build` | exit 0; `/comercial/prospeccion` compiled (14.1 kB) |

---

## Concerns

None. All gates green. The use-case import in `prospect-preview.ts` and `prospect-import-engine.ts` is safe: `import-prospects.use-case.ts` has no `"use server"`, no I/O, no server-only imports — pure application logic. The `HEADER_ALIASES` import in the engine was already present and untouched.
