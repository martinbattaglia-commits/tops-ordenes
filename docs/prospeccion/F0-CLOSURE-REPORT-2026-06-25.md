# F0 CLOSURE REPORT — Prospección Inteligente
## Plataforma Comercial de Nexus

**Fecha:** 2026-06-25 | **Fase:** F0 (rebanada vertical: import + bandeja read-only + Outbox) | **Estado:** ✅ COMPLETA — **detenido en el gate de F0** (esperando aprobación para F1).

> **Restricciones respetadas:** migraciones **entregadas, NO aplicadas**; **sin deploy**, **sin cambios en producción**, **sin ejecutar migraciones sobre prod**. Cambios en el working tree, **sin commitear** (a la espera de tu decisión). No se incorporó ninguna funcionalidad de fases posteriores.

---

## 1. ALCANCE ENTREGADO (estrictamente F0)

| Ítem autorizado | Estado |
|---|:--:|
| Migraciones 0088 / 0089 / 0091 (entregadas, no aplicadas) | ✅ |
| Importación CSV / manual / pegado | ✅ |
| Creación de `prospeccion_prospects` (+ 4 tablas F0) | ✅ |
| Bandeja read-only (`/comercial/prospeccion`) | ✅ |
| Event Outbox (`prospeccion_events`) | ✅ |
| Emisión de `prospect.created` y `prospect.imported` | ✅ (en la RPC, atómica) |
| Validaciones (VOs + invariante de identidad) | ✅ |
| Typecheck · Tests · Build | ✅ verdes |

**NO incluido (fases posteriores, fuera de alcance):** enriquecimiento (F2), scoring (F3), IA (F4), gate humano/aprobación (F1), sync a Clientify (F5), dashboard (F6). Sus tablas figuran en el catálogo `§1.1` como backlog declarado; sus eventos ya tienen lugar reservado en el Outbox.

---

## 2. CÓDIGO (inventario)

Bounded context `src/lib/prospeccion/` con arquitectura hexagonal estratificada:

**Dominio** (`domain/`, capa 0 — pura, cero infra):
- `result.ts`, `errors.ts` (Result<T,DomainError> tipado, AP-12)
- `vo/`: `email.ts`, `cuit.ts` (dígito verificador AR), `phone.ts`, `website.ts`, `source-slug.ts`, `prospect-status.ts`, `prospect-id.ts` — VOs inmutables `create()→Result`
- `events.ts` (ProspectCreated, ProspectImported — versionados)
- `prospect.ts` (Aggregate Root + factory estática `fromImportRow`; invariante de identidad mínima)
- `services/deduplication-policy.ts` (Domain Service puro)

**Ports** (`ports/`, capa 2): `id-generator.port.ts`, `clock.port.ts`, `ingest.port.ts` (+ DTOs).

**Application** (`application/`, capa 1): `import-prospects.use-case.ts` (orquesta validación → DTO → IngestPort; tope de lote 500, CONS-H1).

**Adapters** (`adapters/`, capa 3):
- `id/uuid-id-generator.ts`, `clock/system-clock.ts`
- `supabase/supabase-ingest.adapter.ts` (IngestPort sobre RPC DEFINER `prospeccion_ingest`, service_role)
- `import/csv-parser.ts` (parser CSV puro con alias ES/EN)
- `driving/import-actions.ts` (Composition Root: `"use server"`, guard `canAccess`, cablea use case + adapters)

**Read side** (`read/`, capa liviana HEX-4): `prospects-data.ts` (bandeja read-only, RLS, fallback demo).

**UI** (`src/app/(app)/comercial/prospeccion/`): `page.tsx` (server, guard `prospeccion.view`) + `ProspeccionView.tsx` (client: tabla read-only + panel de import).

**Config:** `src/lib/rbac/types.ts` (+`prospeccion` en `PermissionModule` y `MODULE_LABELS`), `vitest.config.ts` (+glob prospeccion), `package.json` (+script `lint:boundaries`), `scripts/prospeccion-boundaries.mjs` (DoD-11).

---

## 3. MIGRACIONES (entregadas · NO aplicadas)

`supabase/migrations/`:
- `0088_prospeccion_module_enum.sql` — `add value 'prospeccion'` (enum de módulo).
- `0089_prospeccion_core.sql` — 5 tablas (`sources`, `prospects`, `events`, `import_jobs`, `crm_refs`), enum `prospeccion_status_t`, 10 índices, 10 policies RLS, 3 triggers, RPC `prospeccion_ingest` (DEFINER), seed RBAC.
- `0091_prospeccion_rollback.sql` — rollback espejo.

**Byte-idénticas al DDL validado** (con el fix CONS-C1: columna `seq bigint generated always as identity`, índices `dispatch`/`aggregate` correctos, sin `next_attempt_at`, sin `clientify_*` en la raíz). **NO se aplicaron** (G3 = a mano, por Dirección). No se ejecutó `supabase db push` ni nada contra prod.

---

## 4. TESTS (DoD-3)

`vitest run` — **128/128 tests OK** (15 archivos), de los cuales **18 nuevos** de prospeccion:
- `domain/vo/cuit.test.ts` (3), `domain/vo/email.test.ts` (3)
- `domain/services/deduplication-policy.test.ts` (2)
- `domain/prospect.test.ts` (4 — incl. invariante de identidad)
- `application/import-prospects.use-case.test.ts` (3 — con fakes de IdGen/IngestPort, sin red)
- `adapters/import/csv-parser.test.ts` (3)

Dominio testeable sin Postgres/Supabase/red (HEX-7).

---

## 5. REPORTE DE VALIDACIÓN (gates)

| Gate | Comando | Resultado |
|---|---|:--:|
| **DoD-1 Typecheck** | `npm run typecheck` (tsc --noEmit) | ✅ 0 errores (proyecto completo) |
| **DoD-2 Build** | `npm run build` (next build) | ✅ exit 0 · ruta `ƒ /comercial/prospeccion` (89.7 kB) |
| **DoD-3 Tests** | `npm run test` (vitest run) | ✅ 128/128 |
| **DoD-11 Boundaries** | `npm run lint:boundaries` | ✅ 16 archivos domain/ports/application sin violación de la Regla de Dependencia |
| **DDL (motor real, Pre-G5)** | PGLite PG17.5 | ✅ PASS (ver `DDL-VALIDATION-REPORT-2026-06-25.md`; SQL byte-idéntico al entregado) |

---

## 6. CHECKLIST DEFINITION OF DONE (Cap. 5 + DoD-11)

| # | DoD | Estado | Evidencia |
|---|---|:--:|---|
| DoD-0 | Plan cumple los ítems antes de implementar | ✅ | Blueprint v1.0 + ARB/Consistency/DDL reports |
| DoD-1 | Typecheck 0 | ✅ | exit 0 |
| DoD-2 | Build (Node 22) | ✅ | exit 0 |
| DoD-3 | vitest verde (dominio + …) | ✅ | 128/128 |
| DoD-4 | Migración idempotente + rollback | ✅ | 0088/0089/0091 `if not exists`/`on conflict` + 0091 espejo; validadas en motor |
| DoD-5 | RLS sin `using(true)` | ✅ | 0089: 10 policies por `has_permission`/`is_admin`; events/import_jobs deny-all; PII jamás `using(true)` |
| DoD-6 | ADRs escritos | ✅ | ADR-001..019 en `55-adr-ledger`; F0 no introdujo decisiones nuevas |
| DoD-7 | Architecture review (Regla de Dependencia, ACL, no-bypass) | ✅ | boundaries 16/16; cero escritura a Clientify; ingest vía RPC DEFINER |
| DoD-8 | Observabilidad mínima | ◑ parcial | la RPC retorna `{inserted,duplicates}`; MetricsPort/lag = F2 (fuera de F0) |
| DoD-9 | Evidencia G5 | ✅ | este reporte + logs de typecheck/build/test |
| DoD-10 | Privacidad (fases con proveedores) | n/a | F0 no toca proveedores externos ni IA (aplica desde F2/F4) |
| DoD-11 | Import Boundaries verificado | ✅ (forma zero-dep) | `lint:boundaries` verde; ver §8 nota eslint-plugin-boundaries |

---

## 7. EVIDENCIA DE CUMPLIMIENTO DEL BLUEPRINT

| Regla del Blueprint | Cómo se cumple en F0 |
|---|---|
| **DDD** | AR `Prospect` + VOs `create()→Result` + DeduplicationPolicy pura + Domain Events versionados |
| **Hexagonal** | 5 capas; Regla de Dependencia verificada por `lint:boundaries`; dominio sin infra |
| **Event-Driven** | Outbox `prospeccion_events`; la RPC inserta `prospect.created`+`imported` en la MISMA tx que el agregado |
| **Canonical Model / DTO** | DTO `ProspectIngestRow` (primitivos normalizados); ningún tipo de proveedor entra al dominio |
| **RLS-First** | toda tabla `prospeccion_*` con RLS; PII nunca `using(true)`; Outbox/jobs deny-all a sesión |
| **RPC-First** | escritura masiva SOLO vía RPC `SECURITY DEFINER` `prospeccion_ingest`; el front nunca escribe directo |
| **Zero Trust** | guard `canAccess('prospeccion.create/view')` en el borde + RLS como frontera real + service_role solo en el adapter de ingest |
| **ADR Governance** | decisiones en `55-adr-ledger` (ADR-001..019); F0 sin desviaciones |
| **Blueprint Build System** | docs regeneradas por `tools/build.mjs`; código bajo la misma disciplina de capas (BB/CS-BOUNDARY-1) |

---

## 8. OBSERVACIONES / DEUDA ACOTADA (no bloqueante)

1. **DoD-11 — eslint-plugin-boundaries:** no se pudo `npm i` (entorno sin red). Se entregó un **enforcement determinístico equivalente** (`scripts/prospeccion-boundaries.mjs`, `npm run lint:boundaries`, verde). **Paso de producción pendiente:** `npm i -D eslint-plugin-boundaries` + zonas en `.eslintrc.json` (CS-BOUNDARY-1) — queda como migración del check al ecosistema eslint, sin cambiar la regla.
2. **DoD-8 observabilidad:** F0 entrega el contador `{inserted,duplicates}`; `MetricsPort`/lag del Outbox/DLQ son de F2 (no se adelantaron, por alcance).
3. **Identidad del prospecto:** en F0 el `ProspectId` (IdGeneratorPort) se usa para validar el AR; la **fila persistida** toma su `id` de `gen_random_uuid()` en la RPC (la RPC es la unidad atómica). Coherente con CS-RPC-2; se unifica en F1 cuando haya mutaciones por-agregado vía `ProspectRepositoryPort`.
4. **Working tree sin commitear:** los cambios están en disco, rama `main`, sin commit (no se pidió). Recomendación: crear rama `feat/prospeccion-f0` y commitear para revisión — a tu orden.

---

## 9. GATE SIGUIENTE

**Desarrollo DETENIDO en el cierre de F0.** No se inicia F1. Cada fase requiere su gate de aprobación.

**Para habilitar la ejecución real de F0 en prod (cuando lo autorices):**
1. Aplicar a mano (G3) en el SQL Editor de prod: `0088` → (commit) → `0089`; verificar con `get_advisors` (RLS) y `generate_typescript_types`.
2. (Opcional) crear rama git `feat/prospeccion-f0` + commit para PR/revisión.

**Próximo gate de fase:** tu aprobación para iniciar **F1** (estados + gate humano), que llegará con su propio diseño de detalle, DoD y evidencia.

---

*F0 Closure Report — 2026-06-25 — sin deploy · sin prod · migraciones sin aplicar · detenido a la espera de aprobación de F1.*
