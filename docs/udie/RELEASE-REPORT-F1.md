# Release Report — UDIE + Prospección F1

> **Estado:** implementación COMPLETA en la rama `feat/prospeccion-f1-import`. **SIN merge, SIN deploy, SIN cambios de migración/RPC.** PR abierto solo para revisión.
> **Fecha:** 2026-06-28 · **Base:** `origin/main` @ `b46905c` · **HEAD:** `2dd0a8c`
> **Diseño (fuente de verdad):** [`docs/udie/ARQUITECTURA-UDIE.md`](ARQUITECTURA-UDIE.md) · **Plan:** [`docs/superpowers/plans/2026-06-28-udie-prospeccion-f1.md`](../superpowers/plans/2026-06-28-udie-prospeccion-f1.md)

## 1. Resumen técnico

Se construyó **UDIE (Universal Data Import Engine)** — un motor de importación **genérico y agnóstico del dominio** en `src/lib/udie/` — y su **primer consumidor**, la ingesta de prospectos, en `src/lib/prospeccion/adapters/import/udie/`, más una UI **drag & drop** con vista previa rica y clasificación de duplicados (🟢/🟡/🔴) en `src/app/(app)/comercial/prospeccion/`.

- **Arquitectura:** UDIE-B (Hexágono de Stage-Ports + DomainPack). El Core orquesta `Reader → Detector → Normalizer → (Enricher?) → Mapper → Validator → Preview` genéricamente sobre `TRow`/`TReport`; el consumidor aporta un `DomainPack` (MappingPack + CommitPack).
- **Dos fases:** `plan(file)` (cliente, best-effort) y `commit(decision, rows)` que envuelve la **server action existente** `importProspectsAction` — el servidor sigue siendo la autoridad de validación y deduplicación.
- **Formatos:** CSV (PapaParse) + XLSX (exceljs, `import()` dinámico). Detección automática de 7 herramientas: LinkedIn Sales Navigator, Evaboot, Apollo, Wiza, Phantombuster, Clientify, CSV genérico.
- **17 tareas** ejecutadas por TDD (subagent-driven), una por vez, con revisión de diff entre tareas + revisión final de toda la rama.

## 2. Cumplimiento de las reglas de gobernanza

- **AP-UDIE-1 (Core agnóstico del dominio):** `src/lib/udie/**` no importa NADA de `prospeccion/clientify/recon/comercial/compliance` ni de `**/domain/*`. Enforcement mecánico: CI grep (`scripts/udie-boundary.mjs`, excluye `*.test.ts`) **+** zona ESLint `no-restricted-imports` **+** test durable `__boundary.test.ts` (prueba con import prohibido → exit 1; limpio → exit 0). Canary: `orchestrator.test.ts` corre el pipeline con un `DomainPack<FakeRow,FakeReport>` (entidad NO-Prospect).
- **AP-UDIE-2 (evolución conservadora):** no se agregó capacidad especulativa al Core; todo lo específico vive en el consumidor o en plugins (Readers/Detectors/Profiles). `EnricherPort` queda **reservado opcional no-op**.
- **Sin cambios** en `importProspectsAction`, la RPC `prospeccion_ingest`, el modelo, las migraciones ni el catálogo. `detected_format` viaja en `raw._detected_format`.

## 3. Gates finales (verdes)

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | **0 errores** |
| `npx vitest run` (suite completa) | **202/202** (36 files) |
| `node scripts/udie-boundary.mjs` | **AP-UDIE-1 OK** |
| `npx next build` | **exit 0** · ruta `/comercial/prospeccion` 14.1 kB |

## 4. Archivos (48 archivos, +1243/−84)

**UDIE Core (genérico) — `src/lib/udie/`:** `kernel/{result,types,ports}.ts`; `core/{detector-registry,reader-registry,default-normalizer,mapper,preview-model,orchestrator}.ts`; `readers/{csv-reader,xlsx-reader,reader-for-file}.ts`; `__boundary.test.ts` + tests por módulo.
**Consumidor — `src/lib/prospeccion/adapters/import/`:** `header-aliases.ts`, `csv-parser.ts` (refactor sync); `udie/{prospect-dedup-keys,prospect-validator,prospect-mapper,profiles,prospect-preview,prospect-commit,prospect-import-engine}.ts` + tests.
**Fixtures — `tests/fixtures/import/`:** `linkedin.csv`, `evaboot.csv`, `apollo.csv`, `wiza.csv`, `phantombuster.csv`, `clientify.csv`, `generic.csv` (BOM + `;`), `sample.xlsx`.
**UI:** `ImportWizard.tsx` (nuevo) + `ProspeccionView.tsx` (swap del panel viejo).
**Config:** `package.json` (+papaparse), `.eslintrc.json` (zona udie), `scripts/udie-boundary.mjs`, `vitest.config.ts` (include udie).

## 5. Tests ejecutados (evidencia)

- 9 tests de integración con **fixtures reales** (7 CSV + XLSX + caso "fila LinkedIn sin email se conserva" — linkedin_url es identidad): detectan formato + slug correctos en la 1ª corrida, sin tunear `profiles.ts`.
- Tests unitarios por módulo del Core (registries, normalizer, mapper, preview-classifier, readers, orchestrator-canary) y del consumidor (dedup, validator, mapper/profiles, commit).
- Suite total del proyecto: **202 tests verdes** (incluye los 35 pre-existentes de prospección + los nuevos).

## 5b. Validación funcional (comportamiento del producto)

> Registro de qué se validó y qué quedó **deliberadamente fuera de alcance**. NO es evidencia de aprobación final — la aprobación funcional final es la revisión manual de Dirección sobre el PR.

Se ejercitó el **motor real** (`runProspectImportPreview` / `confirmProspectImport`, el mismo código que invoca la UI) contra los 5 tipos de archivo reales (`tests/fixtures/import/`) + un archivo con duplicados, mediante un arnés de validación temporal (NO commiteado).

### Validado (con evidencia funcional)
- **Detección automática** — LinkedIn→`linkedin_sales_navigator`; Evaboot→`Evaboot`/csv; Apollo→`Apollo`/csv; CSV genérico→`Generic CSV`/csv; XLSX→parseado por exceljs.
- **Parser** — CSV (PapaParse: BOM, `;`/`,`, comillas, saltos de línea) y XLSX (exceljs dinámico).
- **Normalización** — trim + strip de BOM; canonicalización de headers.
- **Mapper** — alias ES/EN (incl. headers con espacio), combinación `First Name`+`Last Name`→`full_name`, estampado de `raw._detected_format`.
- **Preview** — registros, % válidos/rechazados, errores, empresas/contactos únicos, posibles/exactos, headers no reconocidos (p. ej. Evaboot→`Evaboot Cleaned Company Name`, Apollo→`# Employees`), aviso `excedeMaxBatch`.
- **Clasificación de duplicados** — 🟢 nuevo / 🟡 posible / 🔴 exacto, con motivo por fila; rechazo de filas sin clave de identidad.
- **Wiring del commit** — solo las filas válidas se envían; `source` correcto; resumen `insertados/duplicados/rechazados` consistente con lo enviado (server action mockeada para no escribir en prod).
- **Integración del motor** — pipeline end-to-end por fixture (9 casos en `prospect-import-engine.test.ts`, verdes).

### No ejecutado deliberadamente
- **Escritura de datos de prueba en producción.**
  **Motivo:** el mecanismo de persistencia (`importProspectsAction` → RPC `prospeccion_ingest`) es **el mismo validado previamente en F0** (smoke en prod: insert + verify + delete + reset de secuencia) y **no sufrió modificaciones en esta implementación**. Repetir una escritura de prueba en la tabla viva solo para revalidar un camino ya probado se consideró innecesario.

### Validación pendiente (manual, bajo responsabilidad de Dirección)
- **UI visual** logueada (modo claro/oscuro, responsive, drag & drop, selector de archivos, barra de progreso) → se recorrerá durante la revisión manual del PR con la checklist preparada.

## 6. Historial de revisión

- **Por tarea (17):** cada una con subagente revisor (spec + calidad). Hallazgos corregidos: Task 1 `RowStatus "novo"→"nuevo"`; Task 5 "Critical" del revisor adjudicado como **falso positivo** (verificado tsc+test); Minors registrados.
- **Review final de rama (opus):** `Ready-to-merge WITH FIXES` — 0 Critical, 2 Important + 3 Minor + 1 recomendación. **TODO corregido** en `2dd0a8c`: (#1) DRY de `MAX_BATCH` + el wizard recorta a 500 antes de confirmar; (#2) `unmappedHeaders` ya no lista falsamente las columnas de nombre (fix consumer-side, Core intacto); (#3) listas de boundary unificadas (grep ↔ eslint); (#5) factory de mapper deduplicada; (+) test de contrato de tipos contra la firma de `importProspectsAction`.

## 7. Riesgos remanentes (reales, aceptados/diferidos)

1. **Calibración de detectores con fixtures sintéticos.** Mitigado: degradación a Generic CSV + override de formato en UI. Cerrar con exports reales cuando se obtengan.
2. **Preview ≠ servidor (ADR-2).** Preview best-effort **intra-archivo**; dedup cross-batch y el tope `MAX_BATCH=500` los resuelve el commit (autoridad). El wizard ya recorta a 500 y avisa (`excedeMaxBatch`).
3. **`detected_format` no es columna queryable** (vive en `raw`). Reporting por herramienta = vista/índice futuro externo a UDIE (ADR-3).
4. **Deuda menor diferida (no bloqueante):** import `buildPreview` sin usar en `orchestrator.ts`; `primaryKey` usa `this.keysOf` (frágil solo si se desestructura — en la práctica se llama como método). Candidatas a `/simplify`.

## 8. Checklist de NO-deploy (respetado)

- [x] Rama aislada `feat/prospeccion-f1-import` en worktree, desde `origin/main`.
- [x] Sin merge. Sin deploy. Sin migraciones. Sin tocar RPC/modelo/catálogo.
- [x] PR abierto **solo para revisión** (no auto-merge; prod auto-publica desde `main`, por eso NO se mergea sin gate de Dirección).
- [x] El WIP de otra sesión en el checkout principal quedó intacto (worktree aislado).

## 9. Próximos pasos (gateados a Dirección)

1. Revisión funcional/visual del PR (click-through logueado en `/comercial/prospeccion`).
2. Si se aprueba: merge a `main` (dispara auto-publish) **bajo decisión de Dirección**.
3. Futuro (fuera de F1): activar `EnricherPort` (Apollo/Wiza), promover `detected_format` a columna/vista para analítica, agregar el 2º consumidor de UDIE (Clientes/Productos) reusando el Core sin tocarlo.
