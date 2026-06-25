# DDL VALIDATION REPORT — Pre-G5
## Plataforma Comercial de Nexus — Prospección Inteligente

**Fecha:** 2026-06-25 | **Fase:** Pre-G5 (validación técnica previa a F0) | **Naturaleza:** validación contra **motor Postgres real**, en entorno **completamente efímero**.

> **Alcance y restricciones (cumplidas):** ejecución en un Postgres **real y descartable** (PGLite, build WASM de **PostgreSQL 17.5**, in-memory, en proceso). **NO** se usó producción · **NO** se aplicaron cambios permanentes · **NO** se modificaron datos · **NO** hubo commits ni deploy · sin red · sin costo · sin tocar la organización de Supabase. La base se crea en memoria, se valida y se descarta al terminar el proceso.

---

## 1. RESULTADO DE COMPILACIÓN

| Migración | Contenido | Resultado |
|---|---|:--:|
| **prereqs** (stubs de prod) | roles `anon/authenticated/service_role`, `auth.users`, enums `permission_module_t`/`permission_action_t`, tablas `permissions/roles/role_permissions`, helpers `has_permission()/is_admin()/tg_touch_updated_at()` | ✅ OK |
| **0088_prospeccion_module_enum** | `alter type permission_module_t add value 'prospeccion'` + `pg_notify` | ✅ OK |
| **0089_prospeccion_core** | enum `prospeccion_status_t`, 5 tablas, RLS, triggers, RPC `prospeccion_ingest`, seed RBAC | ✅ OK |
| **0091_prospeccion_rollback** | rollback espejo (`drop … if exists`, `delete` de permisos) | ✅ OK |

**Compilación: 4/4 fases OK. Checks de aceptación: 20/20 PASS. Errores: 0. VEREDICTO: PASS.**

El defecto histórico **CONS-C1** (la migración 0089 que *no compilaba* por índices con columnas inexistentes) queda **validado por el motor**: 0089 compila y ejecuta sin error, con la columna `seq bigint generated always as identity` presente y funcional. Esto **cierra la deuda diferida "compile real del DDL pre-G5"** del Blueprint Consistency Report.

---

## 2. OBJETOS CREADOS (introspección del catálogo Postgres)

**Tablas (5):** `prospeccion_sources`, `prospeccion_prospects`, `prospeccion_events`, `prospeccion_import_jobs`, `prospeccion_crm_refs`.

**Enum:** `prospeccion_status_t` = 10 estados (`raw, imported, enriquecido, scoreado, con_ia, aprobado, sincronizado, cliente_creado, rechazado, duplicado`). `permission_module_t` incluye `'prospeccion'` (agregado por 0088).

**Índices (19):** incluye los operativos del Dispatcher `prospeccion_events_dispatch_idx` y `prospeccion_events_aggregate_idx`, `prospeccion_prospects_status_idx`, los 3 de dedup (`email/cuit/linkedin`), `prospeccion_prospects_source_idx`, `prospeccion_crm_refs_prospect_idx`/`_provider_idx`, `prospeccion_import_jobs_created_idx`, + PK/unique de cada tabla.

**Constraints (16):**
- **FK (3):** `prospeccion_prospects.source_id → sources`, `prospeccion_prospects.dedupe_of → prospects` (self), `prospeccion_crm_refs.prospect_id → prospects`, `prospeccion_import_jobs.created_by → auth.users`. *(El Outbox `prospeccion_events` NO tiene FK física al agregado — correcto para append-only/replay.)*
- **PK (5):** una por tabla.
- **UNIQUE (4):** `sources.slug`, `prospects.short_id`, `import_jobs.run_id`, `crm_refs (prospect_id, crm_provider)`.
- **CHECK (3):** `events.status ∈ {pending,processing,processed,failed,dead}`, `import_jobs.trigger`, `import_jobs.status`.

**Triggers (3):** `trg_prospeccion_prospects_short_id` (BEFORE INSERT, genera `PROS-YYYY-NNNN`), `trg_prospeccion_prospects_touch` y `trg_prospeccion_crm_refs_touch` (BEFORE UPDATE, `tg_touch_updated_at`).

**RLS:** habilitada en las **5** tablas. **Policies (10):** `sources` 4 (select/insert/update/delete), `prospects` 4, `crm_refs` 2 (select + delete); **`events` e `import_jobs` SIN policy = deny-all a sesión** (correcto: superficie de máquina).

**Funciones (2):** `prospeccion_ingest` (**SECURITY DEFINER**), `prospeccion_set_short_id` (trigger).

---

## 3. VALIDACIÓN FUNCIONAL (smoke test del motor)

Se ejecutó `prospeccion_ingest('[{email:a@x.com, company:ACME, cuit:30-1-2}, {email:a@x.com, company:ACME DUP}]', 'csv')`:

| Verificación | Resultado |
|---|:--:|
| RPC retorna `{inserted:1, duplicates:1}` (dedup por email funciona) | ✅ |
| `prospeccion_prospects` = 2 filas; 1 con `status='duplicado'` y `dedupe_of` apuntando al original | ✅ |
| `prospeccion_events` = 4 (2 por fila: `prospect.created` + `prospect.imported`) — Outbox transaccional | ✅ |
| Trigger genera `short_id` = `PROS-2026-0001` (patrón correcto) | ✅ |

Esto valida **end-to-end**: triggers, política de dedup en SQL, inserción atómica en el Outbox y la cadena de constraints — no solo la creación de objetos, sino que el RPC **ejecuta correctamente** sobre el motor.

---

## 4. ROLLBACK (0091)

| Verificación post-rollback | Resultado |
|---|:--:|
| 0 tablas `prospeccion_*` | ✅ |
| 0 funciones `prospeccion_*` | ✅ |
| `prospeccion_status_t` drop-eado | ✅ |
| `permission_module_t = 'prospeccion'` **PERMANECE** (Postgres no permite quitar un valor de enum) | ✅ (esperado y documentado) |
| 0 filas de permisos `prospeccion.*` | ✅ |

El rollback es un **espejo limpio y completo**: deja el esquema en su estado previo salvo el valor de enum (limitación conocida de Postgres, documentada en el propio 0091).

---

## 5. ERRORES ENCONTRADOS

**Ninguno.** 0 errores de compilación, 0 fallos de check, 0 excepciones en el smoke test.

---

## 6. WARNINGS

**Ninguno relevante.** No se emitieron warnings de compilación. Los bloques `do $$ … exception when duplicate_object …$$` (creación idempotente de tipos) y las sentencias `pg_notify`/`notify pgrst` se ejecutaron sin error sobre el motor.

---

## 7. INCOMPATIBILIDADES / OBSERVACIONES DE ALCANCE

Honestidad sobre qué cubre y qué NO cubre esta validación:

1. **Motor:** PGLite es un build **WASM de PostgreSQL 17.5** — un motor Postgres **real** (no un parser). Cubre sintaxis, tipos/enums, PL/pgSQL, triggers, RLS, `SECURITY DEFINER`, índices, constraints y ejecución del RPC. Prod corre Postgres gestionado por Supabase (misma familia); no se detectaron construcciones incompatibles.
2. **Prerrequisitos stubeados:** `has_permission()`/`is_admin()` se reemplazaron por stubs (`select true`) y las tablas/funciones RBAC y `auth.users` por versiones mínimas con la **misma firma/forma** documentada (§0). Por lo tanto esta corrida valida la **estructura y las dependencias** del DDL de F0, **no** la lógica interna de los helpers de prod (que ya están validados en producción). Ninguna dependencia quedó sin resolver.
3. **No reemplaza el apply a producción (G3).** Esta es una validación **pre-G5** de motor. La aplicación real de `0088/0089/0091` la realiza Martín **a mano en el SQL Editor de prod** (gate G3), contra el catálogo real (que tiene drift conocido respecto del registro de migraciones). Recomendación operativa para ese momento: correr `0088` (commit) → `0089` → verificar con `get_advisors` (RLS/seguridad) → `generate_typescript_types` para confirmar paridad Row-type ↔ DDL.
4. **Sin nuevos bloqueantes.** No apareció ningún hallazgo nuevo. El DDL es internamente consistente **y** ejecutable sobre un motor real.

---

## 8. EVIDENCIA

- **Harness:** `/tmp/ddlval/run.mjs` (PGLite in-memory) + `prereqs.sql` + `0088.sql`/`0089.sql`/`0091.sql` (extraídos verbatim de `docs/prospeccion/_parts/35-persistencia-ddl.md`).
- **Salida estructurada:** `/tmp/ddlval/result.json` — `summary: {phases_ok: "4/4", checks_ok: "20/20", errors: 0, verdict: "PASS"}`.
- **Motor reportado:** `PostgreSQL 17.5 on aarch64-unknown-linux-gnu (emscripten/WASM)`.
- **Reproducible:** `node /tmp/ddlval/run.mjs` regenera el resultado de forma determinística.

---

## 9. CRITERIO DE APROBACIÓN — RESULTADO

> Criterio fijado por Dirección: *"Si el DDL compila correctamente y no aparecen nuevos bloqueantes: dar por concluida la fase documental; cerrar oficialmente el Blueprint versión 1.0; declarar habilitado el comienzo de F0."*

| Condición | Estado |
|---|:--:|
| El DDL completo compila contra motor real | ✅ |
| No aparecen nuevos bloqueantes | ✅ |
| Objetos / índices / constraints / triggers / RLS / RPC válidos | ✅ |
| Rollback validado | ✅ |

**RESULTADO: APROBADO.** Se da por **concluida la fase documental**; el Blueprint se **cierra oficialmente como versión 1.0**; **F0 queda HABILITADO**. La **autorización de inicio formal de F0** corresponde a Dirección.

---

*DDL Validation Report — Pre-G5 — 2026-06-25 — validación de motor efímera, sin producción, sin deploy, sin commits.*
