# F0.5.1 — Knowledge Timeline Projection (audit_log → knowledge_events) · Plan de Implementación (DEFINITIVO v2)

> **For agentic workers:** REQUIRED SUB-SKILL: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar este plan **tarea por tarea**, con un *reviewer de máxima capacidad* en cada **Checkpoint**. Los pasos usan checkboxes (`- [ ]`) y siguen TDD bite-sized: **escribir test que falla → correr y ver fallar → implementación mínima → correr y ver pasar → commit (SOLO tras OK humano)**.
>
> **GATE G7:** este documento **espera aprobación de Dirección antes de construir**. No se escribe código hasta el OK explícito del plan. Al cerrar F0.5.1 — **detenerse**; F0.5.2 es sesión separada.

---

> **Estado de gobernanza (2026-06-28):** **ADR-KNW-ADAPTER** y **ADR-KNW-REGISTRY** APROBADOS por Dirección. Revisión adversarial: 2 críticos (completitud + conformidad arquitectónica) → **APROBADO_CON_AJUSTES**; ajustes incorporados en esta revisión (desviación **R-A** marcada como APROBADA; desambiguación del *sub-timeline por entidad*; narrativa *"sin captura pending"* **R-12**; cobertura diferida de `correlation_id` en proyección en vivo; límite **OCP** del contrato del emisor). Pendiente: **aprobación de este plan (G7)** para iniciar la implementación.

**Goal:** Entregar el **primer flujo real** del Knowledge Layer: proyectar la **fuente #1 (`audit_log`)** hacia el read-model `knowledge_events` mediante un **adaptador** (`project_audit_log`) que es una **implementación de referencia de un contrato canónico estable**, enrutando **TODA escritura de proyección a través del único emisor canónico `knowledge_emit_event(...)`** (Adapter Pattern + Source Registry); exponer el timeline (`v_knowledge_timeline`) y el sub-timeline por entidad (`v_knowledge_entity_360`) respetando RLS por `visibility_key`; y dejar el backfill idempotente listo para correr a mano. Al cerrar F0.5.1, **detenerse**: NO recon/po/orders/worker de drenado (eso es F0.5.2).

**Architecture:** Topología obligatoria por **ADR-KNW-ADAPTER** (APROBADO POR DIRECCIÓN) + **ADR-KNW-REGISTRY** (APROBADO POR DIRECCIÓN):

```
   AuditLogAdapter (project_audit_log)  ─┐
   [ReconAdapter]      ── definido, NO impl ─┤   ┌─ Source Registry ──────────┐
   [OrdersAdapter]     ── definido, NO impl ─┤   │ knowledge_sources           │
   [ComplianceAdapter] ── definido, NO impl ─┼──►│  (source_table, enabled,    │
   [CRMAdapter]        ── definido, NO impl ─┤   │   last_backfill_at)         │
   [TrackingAdapter]   ── definido, NO impl ─┤   └────────────┬───────────────┘
   [ConnectAdapter]    ── definido, NO impl ─┘                │ gate enabled (cada adaptador
                                                              │  consulta SU fila)
                                                              ▼
        cada project_<source>()  ──llama──►  knowledge_emit_event(...)  ──►  knowledge_events  ──►  v_knowledge_timeline
        (conoce SU schema fuente,            (EMISOR CANÓNICO ÚNICO:           (read-model           v_knowledge_entity_360
         deriva forma canónica,               único punto que ESCRIBE          append-only,          (vistas security_invoker,
         deriva visibility_key,               en knowledge_events;             0107)                 RLS por visibility_key)
         guard to_regclass,                   AGNÓSTICO de toda fuente)
         exception when others)
```

- **Knowledge Projection Pipeline** = el emisor `knowledge_emit_event` + la tabla `knowledge_events` + las vistas `v_knowledge_*` + el catálogo `knowledge_sources` (Source Registry). Es **agnóstico del módulo**: NUNCA referencia una tabla-fuente concreta y NUNCA tiene ramas `if audit / if crm / case por source`. Ya existe (F0.5.0) salvo el emisor (0108) y las vistas (0111).
- Un **Adaptador** = exactamente una función SQL `public.project_<source>()` que (a) conoce el schema de SU fuente; (b) consulta SU fila en `knowledge_sources` (gate `enabled`); (c) mapea a la **forma canónica**; (d) deriva `visibility_key` con `knowledge_visibility_for`; (e) **LLAMA a `knowledge_emit_event(...)`** (jamás inserta directo); (f) incluye guard `to_regclass` (degradación grácil) y manejo defensivo `exception when others` (**jamás aborta la tx de negocio** — G11). **ALCANCE AHORA: SOLO `AuditLogAdapter`** como implementación de referencia.
- **OCP / Open-Closed:** registrar una fuente futura = ÚNICAMENTE *un* `project_<source>()` nuevo + *una* fila idempotente en `knowledge_sources`. **Sin tocar** `knowledge_emit_event`, las vistas, la tabla, `knowledge_sources` (DDL), ni los adaptadores existentes. **PROHIBIDO** en F0.5.1: más adaptadores, reflexión, dispatch dinámico (`EXECUTE`/`format()` que arme el nombre del adaptador), orquestador genérico que itere el registry.
- **D12** ya define proyección por triggers AFTER INSERT con emisor compartido; este contrato lo **formaliza y refuerza**, no introduce capacidad nueva. El adaptador vive en SQL (trigger/función). La capa TS `src/lib/knowledge/data.ts` es **SOLO LECTURA** del read-model; **no** se inventa un pipeline de escritura en TS (contradiría D12 y RPC-first).

**Tech Stack:** Next.js 15 (App Router) · TypeScript · Supabase/Postgres 17.6 · Vitest · pnpm. Sin SDK nuevos, sin shadcn, **sin pgvector** (diferido a `0119`).

## Global Constraints (aplican a TODA tarea)

- **Gobernanza G1–G11.** El plan **PREPARA y MUESTRA**; nunca push/merge/deploy/`db push`/`apply_migration`. Los commits son **locales en el worktree y SOLO tras OK humano** por Checkpoint (G1). SQL **idempotente, ENTREGADO-NO-APLICADO** (G3), numerado al siguiente libre, cada migración cierra con `select pg_notify('pgrst','reload schema')`.
- **Aditividad estricta (G2).** Cero `ALTER` de DDL sobre tablas fuente. `audit_log` queda **intacto**. Solo objetos nuevos (`knowledge_emit_event`, `knowledge_visibility_for`, `knowledge_backfill_audit_log`, `project_audit_log`, `tg_project_audit_log`, vistas `v_knowledge_*`) + escrituras de datos vía RPC/triggers + **1 fila** en `knowledge_sources` (DML aditivo, `on conflict do nothing`).
- **Adapter Pattern (emisor agnóstico) — load-bearing.** El emisor `knowledge_emit_event` es el **único punto que escribe en `knowledge_events`**. Adaptadores y backfill **NO insertan directo**: construyen la forma canónica y **llaman al emisor**. (Ver **R-A** abajo: F0.5.1 DESVÍA del SQL literal del spec §5.3/§5.4 que insertaba directo y dejaba el emisor como código muerto.)
- **Source Registry (`knowledge_sources`) — sin condicionales por fuente.** El catálogo de qué fuentes existen/están activas vive SOLO en `knowledge_sources`. El emisor y las vistas **NO** contienen lógica condicional por `source_table` (PROHIBIDO `if audit/if crm`, `case` por source). Cada adaptador consulta SU fila (gate `enabled`) y pasa su `source_table` al emisor genérico. **Nota de columna:** el Source Registry usa la columna `source_table` (verificado en 0107:214, `text not null unique`), **no** `source_key`.
- **Trigger defensivo (G11).** `project_audit_log()` envuelve su lógica en `exception when others` → registra `warning` (canal técnico) y `return null`; **nunca propaga error a la tx de negocio**. El INSERT real en `audit_log` jamás se aborta por la capa de conocimiento.
- **RPC-first + SECURITY DEFINER + search_path fijo (G10).** Toda escritura a `knowledge_events` entra por el emisor `SECURITY DEFINER set search_path = public, pg_temp` (invocado por trigger AFTER INSERT que corre como dueño, o por el backfill RPC) con `grant ... to service_role`. `knowledge_events` es append-only (`tg_knowledge_forbid_delete`, ya en 0107:88-89). **Ninguna** policy INSERT/UPDATE/DELETE para `authenticated`.
- **RLS por `visibility_key` + vistas `security_invoker`.** Las vistas `v_knowledge_*` son `with (security_invoker = true)` → la policy `knowledge_events_select` (0107:236-250) se evalúa fila por fila por el usuario. `audit_log` NO trae `visibility_key`; se **DERIVA** con `public.knowledge_visibility_for(entity, entity_id::text)`.
- **EOL obligatoria (D20 / ADR-ENG-1) — F0.5.1 es la PRIMERA fase obligada.** Eventos técnicos `KnowledgeProjection*`/`KnowledgeBackfill*` en **canal SEPARADO** (NUNCA en `knowledge_events`); `correlation_id` **end-to-end vía GUC** (ver **R-C**); **structured logging JSON** (campos mínimos §6); **contratos de métricas** preparados (sin dashboards/infra); **auditoría del backfill** (rango, duración, resultado). La EOL **no agrega columnas** a tablas funcionales ni implementa infra.
- **Numeración (LANDMINE).** F0.5 = `0106`–`0111`; esta sub-fase autora `0108`, `0109`, `0111`. **Verificar libres con `ls supabase/migrations/ | sort`** (NO `list_migrations` de prod — rastrea por timestamp, no detecta choque de prefijos). **Verificado hoy en vivo:** existen `0106`/`0107`/`0110`; `0108`/`0109`/`0111` ausentes (libres). **0110 ya fue entregado por F0.5.0**; el orden de aplicación es por número (ver **R-H**).
- **Fuente única de verdad del SQL.** El SQL aprobado vive en el spec `docs/superpowers/specs/2026-06-28-nexus-connect-design.md`. Las tareas de SQL **transcriben** el rango citado (audit_log SÍ; recon/po/orders/searchable NO) **con la única modificación dictada por R-A** (enrutar por el emisor). Esto **no es placeholder**: es transcripción acotada de diseño aprobado más una desviación explícita y documentada.
- **Worktree aislado.** Todo el trabajo ocurre en `/Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation` (rama `worktree-feat+f05-knowledge-foundation`, HEAD `5803fa9`, 9 commits de F0.5.0 sobre `3ea0de1`).

---

## 1) Objetivos

1. **Contrato del adaptador (ADR-KNW-ADAPTER) + contrato del Source Registry (ADR-KNW-REGISTRY).** Definir explícitamente la interfaz estable del Pipeline: signatura canónica de `knowledge_emit_event`, forma canónica del evento, derivación de `visibility_key`, guard `to_regclass`, gate `enabled` por fila de `knowledge_sources`, manejo defensivo, idempotencia (`on conflict do nothing` sobre `knowledge_events_idem_uq unique(source_table, source_pk, event_type)`), propagación de `correlation_id` vía GUC. Documentar como **comentario-contrato en 0108** + **ADR**.
2. **Pipeline (0108).** Entregar el emisor canónico `knowledge_emit_event` (con default GUC de `correlation_id`, **R-C**) + el helper transversal `knowledge_visibility_for` + el backfill de referencia `knowledge_backfill_audit_log` **que llama al emisor** (R-A), todos idempotentes, `SECURITY DEFINER`, `grant service_role`.
3. **AuditLogAdapter (0109).** Entregar `project_audit_log()` (que **llama al emisor**, gate `enabled`, manejo defensivo) + `tg_project_audit_log` AFTER INSERT con guard `to_regclass`, + el **INSERT idempotente de la fila `'audit_log'` en `knowledge_sources`** (registro de la fuente).
4. **Timeline (0111).** Entregar `v_knowledge_timeline` y `v_knowledge_entity_360` (sub-timeline por entidad), ambas `security_invoker`, + realtime de `knowledge_events`. **`v_knowledge_search` se DIFIERE a F0.5.2** (R-E).
5. **Read-model TS (lectura).** Implementar `listTimeline()` real en `src/lib/knowledge/data.ts` contra `v_knowledge_timeline` (keyset por `seq desc`, filtro por entidad), con guard `isMock()`; **extender los tipos** `KnowledgeEvent`/`TimelineEntry` para cubrir las columnas reales de la vista (R-F). Tests unitarios verdes en CI.
6. **EOL (primera fase).** Dejar el canal técnico, los contratos de logging/métricas y la auditoría de backfill **preparados y tipados** (TS conceptual), sin infra.
7. **Extensibilidad verificable (OCP, R-B).** Demostrar por la propiedad determinante (no por grep cosmético) que el emisor no referencia ninguna tabla-fuente ni ramifica por source, y que la firma del emisor + columnas de `knowledge_events` cubren el mapeo → sumar `ReconAdapter` en F0.5.2 = nuevo `project_recon()` + nueva fila en `knowledge_sources`, sin tocar el Pipeline.

---

## 2) Alcance

### 2.1 IN (F0.5.1, audit_log-only)

- **0108** (`0108_knowledge_rpc.sql`): `knowledge_emit_event` (emisor canónico, ON CONFLICT DO NOTHING, **default GUC `correlation_id`** por R-C) · `knowledge_visibility_for` (helper transversal del mapa de visibilidad) · `knowledge_backfill_audit_log` (backfill idempotente de fuente #1 **vía emisor** por R-A; gate `enabled`; actualiza `knowledge_sources.last_backfill_at`) · **comentario-contrato del adaptador + del registry**.
- **0109** (`0109_knowledge_projection_triggers.sql`): `project_audit_log()` (AuditLogAdapter, **llama al emisor**, gate `enabled`, manejo defensivo `exception when others`) + `tg_project_audit_log` (guard `to_regclass('public.audit_log')`) + **INSERT idempotente de la fila `'audit_log'` en `knowledge_sources`** (registro de la fuente).
- **0111** (`0111_knowledge_views.sql`): `v_knowledge_timeline` + `v_knowledge_entity_360` (sub-timeline por entidad), ambas `security_invoker` · realtime add table `knowledge_events` (idempotente) · `pg_notify` reload.
- **TS lectura:** `listTimeline()` real en `src/lib/knowledge/data.ts` + tipos `KnowledgeEvent`/`TimelineEntry` extendidos (R-F); tests Vitest.
- **EOL:** tipos conceptuales `StructuredLogEvent`/`MetricContract`/eventos técnicos en `src/lib/knowledge/observability.ts` (canal separado, no toca `knowledge_events`); helper de propagación de `correlation_id` (set_config GUC) preparado.
- **Verificación smoke SQL** (a aplicar a mano por Dirección): insert en `audit_log` → aparece en `v_knowledge_timeline` con `visibility_key` correcta; **caso negativo** (usuario sin permiso NO la ve); backfill idempotente (correr 2× ⇒ 0 nuevos); `get_advisors` tras 0111.
- **ADR-KNW-ADAPTER** + **ADR-KNW-REGISTRY** (estado: APROBADO POR DIRECCIÓN) en `docs/superpowers/adr/`.

### 2.2 OUT (frontera explícita — NO entra)

- **Cualquier otro adaptador / fuente:** `project_recon_events`, `project_po_events`, `project_search_orders` y todas las fuentes del callout post-0109 (recon/po/treasury/crm_stage/custody/contracts/compliance/RRHH/sync_logs/tracking/connect) → **F0.5.2**. Quedan **definidas-en-el-contrato pero NO implementadas** (ni su fila en `knowledge_sources`).
- **`knowledge_upsert_searchable`, `knowledge_backfill_search_orders`, `v_knowledge_search`** (dependen de `searchable_items` poblado por orders) → **F0.5.2/F0.5.3**. `v_knowledge_search` se **OMITE** de 0111-F0.5.1 (R-E). Nota: `searchable_items` SÍ existe como tabla en 0107 (`create table` en 0107:92; `visibility_key` en 0107:101), pero su poblado y el contrato de búsqueda son de fases posteriores; crear la vista ahora sería entregar superficie muerta.
- **`knowledge_annotate`** → **diferido** (no es parte del MVP del timeline; las tablas `knowledge_annotations`/`knowledge_entities` existen en 0107, pero la RPC de anotación se entrega cuando exista UI; ver Riesgo R-7). `v_knowledge_entity_360` se entrega con el `left join` a esas tablas igualmente (es read-only y degrada a NULL si no hay filas).
- **Worker `/api/knowledge/drain`, workflow, allowlist middleware** → **F0.5.2**. La captura por trigger síncrona es suficiente para el MVP de F0.5.1.
- **Reflexión / dispatch dinámico / orquestador genérico del registry** → **prohibido en toda F0.5.1** (límite duro del Source Registry).
- **Búsqueda universal / Cmd-K / graph / scaffold semántico / embeddings (`0119`)** → fases posteriores.
- **Renumeración de F1 Connect a `0112`–`0118`** → tarea previa a construir F1, NO parte de F0.5.1.

---

## 3) File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `docs/superpowers/adr/ADR-KNW-ADAPTER-knowledge-projection-adapter.md` | Crear | ADR aprobado: contrato del adaptador, **desviación R-A (emisor load-bearing)**, alternativa descartada, consecuencia OCP, criterio de extensibilidad (R-B) |
| `docs/superpowers/adr/ADR-KNW-REGISTRY-source-registry.md` | Crear | ADR hermano aprobado: contrato del Source Registry (`knowledge_sources`), gate `enabled`, sin condicionales por fuente, prohibición de reflexión/dispatch dinámico |
| `docs/superpowers/adr/ADR-KNW-CONTRACT-knowledge-event-canonical.md` | Crear | **ADR aprobado: contrato canónico `KnowledgeEventCanonical` (composite type SQL)** — responsabilidades adaptador/registry/pipeline; el emisor acepta SOLO el contrato; límite (sin validaciones complejas/serialización/reflexión/carga dinámica) |
| `supabase/migrations/0108_knowledge_rpc.sql` | Crear | **Pipeline AGNÓSTICO (cero conocimiento de fuentes — Opción A):** composite type `knowledge_event_canonical` (contrato, §13) + `knowledge_emit_event(p_event knowledge_event_canonical)` (valida contrato + defaults + GUC correlation_id + observabilidad EOL; ÚNICO punto de escritura) + `knowledge_visibility_for` (helper transversal) + comentario-contrato |
| `supabase/migrations/0109_knowledge_projection_triggers.sql` | Crear | **AuditLogAdapter (TODA la lógica de la fuente — Opción A):** mapeo único `knowledge_audit_log_to_canonical(...)` (audit_log→`KnowledgeEventCanonical`) + `project_audit_log()` trigger (vía emisor, gate enabled, defensivo) + `tg_project_audit_log` (guard `to_regclass`) + `knowledge_backfill_audit_log` (vía emisor, idempotente) + INSERT fila `'audit_log'` en `knowledge_sources` |
| `supabase/migrations/0111_knowledge_views.sql` | Crear | **Vistas:** `v_knowledge_timeline` + `v_knowledge_entity_360` (security_invoker) + realtime + reload |
| `src/lib/knowledge/types.ts` | Modificar | Extender `KnowledgeEvent` con `ingestedAt`, `actorId`, `payload`, `sourceTable`, `correlationId` (cubren las columnas reales de `v_knowledge_timeline`) — R-F |
| `src/lib/knowledge/data.ts` | Modificar | `listTimeline()` real contra `v_knowledge_timeline` (keyset `seq desc`, filtro por entidad), mapeo snake→camel |
| `src/lib/knowledge/data.test.ts` | Crear | Tests del read-model (mapeo fila→`TimelineEntry` con shape R-F, scope, `isMock`) |
| `src/lib/knowledge/observability.ts` | Crear | EOL: tipos `StructuredLogEvent`, `MetricContract`, eventos técnicos `KnowledgeProjection*`/`KnowledgeBackfill*` (canal separado) + helper `withKnowledgeCorrelation()` (set_config GUC) |
| `src/lib/knowledge/observability.test.ts` | Crear | Tests del builder de log estructurado (campos mínimos, status enum) y del nombre/valor de GUC |
| `docs/superpowers/F05-1-APPLY-CHECKLIST.md` | Crear | Checklist de aplicación manual para Dirección (orden por número, smoke positivo/negativo, idempotencia, advisors, R-H) |
| `docs/superpowers/F05-1-ENGINEERING-READINESS-REVIEW.md` | Crear | Gate de cierre (de cero, R-G; conformidad EOL + Adapter + Registry) — se completa al final |

> **Nota de fuente del SQL (rangos verificados en vivo hoy):**
> - `knowledge_emit_event`: `spec:4144-4184` — **modificación R-C:** cambiar `p_correlation_id text default null` → `p_correlation_id text default nullif(current_setting('knowledge.correlation_id', true), '')`.
> - `knowledge_backfill_audit_log`: `spec:4264-4315` — **modificación R-A:** reemplazar el `insert into public.knowledge_events ... select ... on conflict ...` por un bucle/`select`-over-`src` que llama a `public.knowledge_emit_event(...)` por fila (el emisor mantiene la idempotencia ON CONFLICT). Añadir gate `enabled` y propagar `p_correlation_id`.
> - `knowledge_visibility_for`: `spec:4321-4351` (se transcribe textual).
> - `project_audit_log` + trigger: `spec:4410-4448` — **modificación R-A:** reemplazar el `insert into public.knowledge_events ... values ... on conflict` por una llamada a `public.knowledge_emit_event(...)`; **modificación G11:** envolver en `exception when others`; **gate `enabled`** consultando la fila `'audit_log'` de `knowledge_sources`.
> - `v_knowledge_timeline`: `spec:4667-4675` (textual; columnas verificadas: `id, seq, event_type, occurred_at, ingested_at, actor_kind, actor_id, actor_label, entity_type, entity_id, summary, payload, visibility_key, source_table, correlation_id`).
> - `v_knowledge_entity_360`: `spec:4693-4706` (textual).
> - realtime + reload: `spec:4712-4725` (textual).
> **Excluir** de los mismos archivos del spec: `knowledge_upsert_searchable` (4189-4218), `knowledge_backfill_search_orders` (4357+), `project_recon_events`/`project_po_events`/`project_search_orders` (4450+), `v_knowledge_search` (4683-4688).
> **No es placeholder:** cada cuerpo se transcribe del rango citado; las únicas ediciones son las tres desviaciones documentadas (R-A enrutar por emisor; R-C GUC; G11 manejo defensivo + gate `enabled`).

---

## 4) Tareas (right-sized, TDD bite-sized)

### Task 0: Verificación de numeración y base (preparación, sin commit)

**Files:** ninguno.

- [ ] **Step 1:** Confirmar slots libres.
  `ls /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/ | sort | grep -E '^010[6-9]|^011[01]'`
  **Esperado (verificado hoy):** `0106_knowledge_module_enum.sql`, `0107_knowledge_core.sql`, `0110_knowledge_rbac_seed.sql` (es decir, `0108`/`0109`/`0111` **ausentes**).
- [ ] **Step 2 (R-D — base del read-model y Source Registry):** Confirmar interfaces de F0.5.0.
  `grep -nE 'create table.*knowledge_(events|sources|annotations|entities)|knowledge_events_idem_uq|correlation_id|enabled|last_backfill_at|source_table' /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0107_knowledge_core.sql`
  **Esperado (verificado hoy):** `knowledge_events` (48), `correlation_id text` (65), `constraint knowledge_events_idem_uq unique (source_table, source_pk, event_type)` (72), `knowledge_entities` (125), `knowledge_annotations` (138), `knowledge_sources` (212) con columnas `source_table text not null unique` (214), `enabled boolean not null default true` (215), `last_backfill_at timestamptz` (217). `knowledge_visibility_for` **no** debe existir aún (nace en 0108).
  > **Gate de la tarea:** si `knowledge_sources`, `knowledge_annotations` o `knowledge_entities` NO existen en 0107, **DETENERSE** y escalar a Dirección (el plan asume R-D verificado).
- [ ] **Step 3:** Confirmar HEAD limpio.
  `git -C /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation status --short && git -C /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation rev-parse HEAD`
  **Esperado:** sin salida (limpio); HEAD = `5803fa9...`.

→ **CHECKPOINT 0** (ver §5).

---

### Task 1: ADR-KNW-ADAPTER + ADR-KNW-REGISTRY + ADR-KNW-CONTRACT + contrato canónico (documentación primero)

Define el contrato ANTES de codificar el Pipeline. Es la pieza que hace verificable la OCP y registra la desviación R-A.

**Files:** Create `docs/superpowers/adr/ADR-KNW-ADAPTER-knowledge-projection-adapter.md`, `docs/superpowers/adr/ADR-KNW-REGISTRY-source-registry.md`.

- [ ] **Step 1 (ADR-KNW-ADAPTER):** Escribir el ADR con secciones:
  - **Estado:** `APROBADO POR DIRECCIÓN — 2026-06-28`.
  - **Contexto:** D12 ya define proyección por triggers AFTER INSERT con emisor compartido; este ADR formaliza el patrón.
  - **Decisión:** topología `<Source>Adapter → knowledge_emit_event → knowledge_events`; el Pipeline es agnóstico; un adaptador = `project_<source>()` + fila en `knowledge_sources`.
  - **Contrato canónico:** signatura de `knowledge_emit_event(p_event_type, p_entity_type, p_entity_id, p_visibility_key, p_occurred_at, p_actor_kind, p_actor_id, p_actor_label, p_summary, p_payload, p_source_table, p_source_pk, p_correlation_id)`; forma canónica del evento; **precondición:** el adaptador deriva `visibility_key` vía `knowledge_visibility_for` y consulta el gate `enabled`; **poscondición:** 0 o 1 fila nueva en `knowledge_events` (idempotencia `knowledge_events_idem_uq`); **degradación:** guard `to_regclass` + `exception when others`. **Límite del contrato (OCP no absoluto):** la firma de `knowledge_emit_event` no expone `p_status/p_retry_count/p_available_at`; un adaptador **asíncrono** futuro (modelo `pending` + worker `/api/knowledge/drain`, F0.5.2+) podría requerir ampliar el emisor. Para fuentes de proyección **síncrona** (como `audit_log`) el contrato es cerrado-a-modificación.
  - **DESVIACIÓN R-A (load-bearing) — APROBADA POR DIRECCIÓN (2026-06-28, ADR-KNW-ADAPTER):** El SQL literal del spec (§5.3/§5.4, `spec:4282` y `spec:4417`) hace que `knowledge_backfill_audit_log` y `project_audit_log` **inserten directo** en `knowledge_events`, dejando `knowledge_emit_event` como **código muerto**. Eso contradice el mandato Adapter Pattern + Source Registry. **F0.5.1 DESVÍA:** toda escritura de proyección se enruta por el emisor canónico, único punto que escribe en `knowledge_events`. **Justificación:** hacer el contrato *load-bearing* (un emisor que nadie usa no es un contrato). **Estado:** APROBADA por Dirección el 2026-06-28 — "la arquitectura tiene prioridad sobre la implementación literal cuando ambas entran en contradicción"; queda autorizado modificar el SQL del spec. Construir 0108/0109 una vez aprobado este plan (G7).
  - **Alternativa descartada:** acoplar el Pipeline a cada fuente (insert directo por adaptador / branching por source en el emisor) — viola OCP y deja el emisor inútil.
  - **Consecuencia:** extensibilidad por adición; F0.5.1 entrega SOLO `AuditLogAdapter`.
  - **Manejo defensivo del contrato:** registrar que el `exception when others` + `return null` en `project_audit_log` (exigido por EOL §7.2 / G11) es parte del contrato del adaptador, no un ADR adicional.
- [ ] **Step 2 (criterio OCP verificable — R-B, reemplaza el grep cosmético):** Incluir el **checklist de propiedad determinante**, cada ítem falsable:
  1. `knowledge_emit_event` no referencia ninguna tabla-fuente (`audit_log`, `recon_events`, `po_events`, `orders`, `documents`, …): su entrada es 100% paramétrica. *(Verificable: Task 2 Step 6.)*
  2. `knowledge_emit_event` no contiene branching por `source_table`/`source_key` (`if`/`case` por source). *(Verificable: Task 2 Step 6.)*
  3. Las vistas `v_knowledge_*` no contienen condicionales por fuente. *(Verificable: Task 4 Step 6.)*
  4. La firma de `knowledge_emit_event` + las columnas de `knowledge_events` cubren el mapeo de una fuente típica (event_type, entity_type, entity_id, visibility_key, occurred_at, actor_*, summary, payload, source_table, source_pk, correlation_id). *(Verificable por inspección de la firma vs. el INSERT de la tabla.)*
  5. **Por construcción:** agregar `ReconAdapter` en F0.5.2 = crear `project_recon()` que llama al MISMO emisor + `insert into knowledge_sources` (fila `'recon_events'`); NO modifica el emisor, ni las vistas, ni la tabla, ni `knowledge_sources` (DDL), ni `project_audit_log`.
- [ ] **Step 3 (ADR-KNW-REGISTRY):** Escribir el ADR hermano:
  - **Estado:** `APROBADO POR DIRECCIÓN — 2026-06-28`.
  - **Decisión:** el Source Registry ES la tabla declarativa `knowledge_sources` (0107, §2.9 del spec). Cada fila = una fuente registrada: `source_table` (clave, p.ej. `'audit_log'`), `enabled boolean` (gate de proyección + degradación grácil), `last_backfill_at`, `visibility_mode`, `notes`.
  - **Contrato duro:** (a) el emisor y las vistas NO contienen lógica condicional por fuente (PROHIBIDO `if audit/if crm`, `case` por source); (b) cada adaptador consulta SU fila (gate `enabled`) y pasa su `source_table` al emisor genérico; (c) el catálogo vive SOLO en `knowledge_sources`.
  - **Registrar una fuente =** implementar `project_<source>()` + INSERT idempotente de su fila. NADA MÁS.
  - **Límites duros:** sin reflexión, sin dispatch dinámico (`EXECUTE`/`format()`), sin orquestador genérico que itere el registry. Backfill es POR-FUENTE (el adaptador es dueño de su backfill).
  - **Alcance ahora:** registrar ÚNICAMENTE `'audit_log'`.
  - **Criterio de aceptación:** el pipeline no contiene condicionales por fuente y registrar una fuente futura no toca el pipeline (cruza con R-B).

→ **CHECKPOINT 1**.

---

### Task 2: Pipeline — migración 0108 (emisor + helper + backfill vía emisor)

**Files:** Create `supabase/migrations/0108_knowledge_rpc.sql`.

**Interfaces — Produces:** `public.knowledge_emit_event(...)`, `public.knowledge_visibility_for(text,text)`, `public.knowledge_backfill_audit_log(int)`.
**Consumes:** `public.knowledge_events` (0107), `public.knowledge_sources` (0107), `public.orders`/`public.documents` (mapa de visibilidad).

- [ ] **Step 1 (test que falla — verificación estática):** Crear el archivo con SOLO el header `-- ENTREGADA, NO APLICADA — F0.5.1 Knowledge RPC (Pipeline). Verificar numeración contra prod arsksytgdnzukbmfgkju.` y nada más.
  Run: `grep -c 'create or replace function public.knowledge_emit_event' /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0108_knowledge_rpc.sql`
  **Esperado (falla):** `0`.
- [ ] **Step 2 (comentario-contrato):** Pegar al tope del archivo el bloque de comentario que resume ADR-KNW-ADAPTER + ADR-KNW-REGISTRY: topología, "emisor = único punto de escritura (R-A)", "Source Registry = `knowledge_sources`; sin condicionales por fuente", forma canónica, idempotencia, degradación.
- [ ] **Step 3 (emisor canónico + R-C):** Transcribir `knowledge_emit_event` desde `spec:4144-4184`, con **una sola modificación (R-C):** la línea `4157` pasa de `p_correlation_id text default null` a `p_correlation_id text default nullif(current_setting('knowledge.correlation_id', true), '')`. Incluir `revoke all` + `grant ... to service_role` (4181-4184). Cuando no hay GUC seteada, `current_setting(..., true)` devuelve NULL → `correlation_id` queda NULL explícito y aceptado.
  Run: `grep -E "current_setting\('knowledge.correlation_id', true\)|on conflict \(source_table, source_pk, event_type\) do nothing|grant execute on function public.knowledge_emit_event" /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0108_knowledge_rpc.sql`
  **Esperado:** las 3 líneas presentes.
- [ ] **Step 4 (helper de visibilidad):** Transcribir textualmente `knowledge_visibility_for` desde `spec:4321-4351` (incluye `revoke all` + `grant service_role`).
  Run: `grep -E "when 'order','orders' then|return 'client:'\|\|p_entity_id|return 'public_auth'|else return 'staff'" /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0108_knowledge_rpc.sql`
  **Esperado:** ramas presentes (order→client, client→client, compras→public_auth, default→staff).
- [ ] **Step 5 (backfill vía emisor — R-A):** Transcribir `knowledge_backfill_audit_log` desde `spec:4264-4315` con **modificación R-A:** reemplazar el bloque `with src ... ins as (insert into public.knowledge_events ... select ... on conflict ... returning 1)` por un recorrido de `src` que **llama al emisor por fila** y cuenta los IDs no nulos. Mantener: guard `to_regclass('public.audit_log')` (4272-4274), gate `enabled` (nuevo: `if (select enabled from public.knowledge_sources where source_table='audit_log') is distinct from true then return 0; end if;`), derivación de `visibility_key` vía helper, propagación de `p_correlation_id` (nuevo parámetro o GUC por lote), `update knowledge_sources set last_backfill_at = now()`, `grant service_role`. Patrón exacto del cuerpo:
  ```sql
  v_count := 0;
  for r in
    select a.id, a.ts, a.user_id, a.entity, a.entity_id, a.action, a.payload
    from public.audit_log a order by a.id limit p_limit
  loop
    if public.knowledge_emit_event(
         'audit.' || r.action, r.entity, coalesce(r.entity_id::text,'∅'),
         public.knowledge_visibility_for(r.entity, r.entity_id::text), r.ts,
         case when r.user_id is null then 'system' else 'user' end, r.user_id, null,
         r.entity || ' ' || r.action, coalesce(r.payload,'{}'::jsonb),
         'audit_log', r.id::text,
         nullif(current_setting('knowledge.correlation_id', true), '')
       ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  update public.knowledge_sources set last_backfill_at = now() where source_table='audit_log';
  return v_count;
  ```
  Cerrar el archivo con `select pg_notify('pgrst','reload schema');`.
  Run: `grep -E "to_regclass\('public.audit_log'\)|knowledge_emit_event\(|where source_table='audit_log'|pg_notify" /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0108_knowledge_rpc.sql`
  **Esperado:** las 4 líneas presentes; **ausencia** de `insert into public.knowledge_events` dentro del backfill (R-A).
  Run (anti-insert-directo): `awk '/function public.knowledge_backfill_audit_log/,/\$\$;/' /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0108_knowledge_rpc.sql | grep -c 'insert into public.knowledge_events'`
  **Esperado:** `0`.
- [ ] **Step 6 (test OCP — R-B, el emisor es agnóstico y sin branching):** Verificar las propiedades determinantes acotadas al cuerpo del emisor.
  Run (sin referencia a tabla-fuente): `awk '/function public.knowledge_emit_event/,/\$\$;/' /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0108_knowledge_rpc.sql | grep -Ei 'audit_log|recon_events|po_events|from public.orders|from public.documents' | wc -l`
  **Esperado:** `0`.
  Run (sin branching por source): `awk '/function public.knowledge_emit_event/,/\$\$;/' /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0108_knowledge_rpc.sql | grep -Eic 'p_source_table[[:space:]]*=|case[[:space:]]+p_source|if[[:space:]].*source_table'`
  **Esperado:** `0`. *(El emisor recibe `source_table` como parámetro pero NUNCA ramifica por su valor.)* *(Nota: `knowledge_visibility_for` SÍ referencia `orders`/`documents` — es el helper, no el emisor; el grep está acotado con `awk` al cuerpo del emisor.)*

> **G3:** este archivo NO se aplica. Las únicas verificaciones son estáticas (grep/awk) hasta la aplicación manual de Dirección.

→ **CHECKPOINT 2**.

---

### Task 3: AuditLogAdapter — migración 0109 (trigger vía emisor, defensivo, + registro de fuente)

**Files:** Create `supabase/migrations/0109_knowledge_projection_triggers.sql`.

**Interfaces — Produces:** `public.project_audit_log()`, trigger `tg_project_audit_log` on `public.audit_log`, fila `'audit_log'` en `public.knowledge_sources`.
**Consumes:** `knowledge_emit_event` + `knowledge_visibility_for` (0108), `knowledge_sources` (0107), `audit_log` (shape: `id bigserial, ts, user_id, entity, entity_id uuid, action, payload` — `spec/0001:154-163`).

- [ ] **Step 1 (test que falla):** Crear `0109_…sql` con SOLO el header `-- ENTREGADA, NO APLICADA — F0.5.1 AuditLogAdapter. Verificar numeración contra prod.`.
  Run: `grep -c 'create trigger tg_project_audit_log' /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0109_knowledge_projection_triggers.sql` → **Esperado:** `0`.
- [ ] **Step 2 (adaptador — vía emisor + gate enabled + defensivo, R-A/G11):** Transcribir `project_audit_log()` desde `spec:4410-4448` con **modificaciones:** (R-A) reemplazar el `insert into public.knowledge_events ... values ... on conflict` por una llamada a `public.knowledge_emit_event(...)`; (Source Registry) gate `enabled` por fila `'audit_log'`; (G11) `exception when others` que emite warning al canal técnico y `return null`. Cuerpo:
  ```sql
  begin
    -- gate del Source Registry (degradación por toggle de fila)
    if (select enabled from public.knowledge_sources where source_table = 'audit_log') is distinct from true then
      return null;
    end if;
    perform public.knowledge_emit_event(
      'audit.' || new.action, new.entity, coalesce(new.entity_id::text,'∅'),
      public.knowledge_visibility_for(new.entity, new.entity_id::text), new.ts,
      case when new.user_id is null then 'system' else 'user' end, new.user_id, null,
      new.entity || ' ' || new.action, coalesce(new.payload,'{}'::jsonb),
      'audit_log', new.id::text,
      nullif(current_setting('knowledge.correlation_id', true), '')
    );
    return null;  -- AFTER trigger
  exception when others then
    -- EOL: KnowledgeProjectionFailed al canal técnico (structured log); NUNCA re-raise (G11).
    raise warning 'KnowledgeProjectionFailed source=audit_log pk=% err=%', new.id, sqlerrm;
    return null;
  end;
  ```
  > *El spec base no incluye el `exception` block ni el gate `enabled` ni el enrutado por emisor; las tres son desviaciones documentadas en ADR-KNW-ADAPTER/ADR-KNW-REGISTRY. NO contradicen la arquitectura — la refuerzan (Adapter load-bearing + Source Registry + G11). No requieren ADR adicional.*
  Run: `grep -E "knowledge_emit_event\(|exception when others|enabled.*is distinct from true|current_setting\('knowledge.correlation_id'" /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0109_knowledge_projection_triggers.sql`
  **Esperado:** las 4 líneas presentes.
  Run (anti-insert-directo): `awk '/function public.project_audit_log/,/\$\$;/' /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0109_knowledge_projection_triggers.sql | grep -c 'insert into public.knowledge_events'`
  **Esperado:** `0` (R-A).
- [ ] **Step 3 (trigger con guard):** Transcribir el bloque `do $$ begin if to_regclass('public.audit_log') is not null then drop trigger if exists ... create trigger tg_project_audit_log after insert ... end if; end $$;` desde `spec:4441-4448`.
  Run: `grep -E "to_regclass\('public.audit_log'\) is not null|after insert on public.audit_log" /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0109_knowledge_projection_triggers.sql`
  **Esperado:** ambas líneas.
- [ ] **Step 4 (registrar la fuente en el Source Registry):** Añadir el INSERT idempotente de la fila `'audit_log'`:
  ```sql
  insert into public.knowledge_sources (source_table, enabled, notes)
  values ('audit_log', true, 'F0.5.1 AuditLogAdapter — fuente #1 (~30 RPCs WMS/custody)')
  on conflict (source_table) do nothing;
  ```
  Run: `grep -E "insert into public.knowledge_sources|on conflict \(source_table\) do nothing" /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0109_knowledge_projection_triggers.sql`
  **Esperado:** ambas líneas.
- [ ] **Step 5 (cierre):** Añadir `select pg_notify('pgrst','reload schema');` al final.
  Run: `tail -1 /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0109_knowledge_projection_triggers.sql` → **Esperado:** `select pg_notify('pgrst', 'reload schema');`
- [ ] **Step 6 (test de exclusión F0.5.2):** Confirmar que NO se coló ningún adaptador de F0.5.2.
  Run: `grep -Ec 'project_recon_events|project_po_events|project_search_orders|searchable_items' /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0109_knowledge_projection_triggers.sql`
  **Esperado:** `0`.

→ **CHECKPOINT 3**.

---

### Task 4: Vistas del timeline — migración 0111

**Files:** Create `supabase/migrations/0111_knowledge_views.sql`.

**Interfaces — Produces:** `public.v_knowledge_timeline`, `public.v_knowledge_entity_360` (ambas `security_invoker`).
**Consumes:** `knowledge_events` (0107), `knowledge_annotations`/`knowledge_entities` (0107, verificado R-E — el `left join` resuelve en tiempo de creación).

- [ ] **Step 1 (test que falla):** Crear `0111_…sql` con SOLO el header `-- ENTREGADA, NO APLICADA — F0.5.1 Vistas de consumo (timeline + entity-360). security_invoker.`.
  Run: `grep -c 'create or replace view public.v_knowledge_timeline' /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0111_knowledge_views.sql` → **Esperado:** `0`.
- [ ] **Step 2 (timeline):** Transcribir textualmente `v_knowledge_timeline` desde `spec:4667-4675` (incluye `with (security_invoker = true)`, las 15 columnas y `order by e.occurred_at desc, e.seq desc`).
  Run: `grep -E "security_invoker = true|order by e.occurred_at desc, e.seq desc|e.payload, *$|correlation_id" /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0111_knowledge_views.sql` → **Esperado:** líneas presentes.
- [ ] **Step 3 (sub-timeline por entidad):** Transcribir textualmente `v_knowledge_entity_360` desde `spec:4693-4706` (left joins a `knowledge_annotations`/`knowledge_entities` — existen en 0107, R-E; degradan a NULL si no hay filas; read-only).
  Run: `grep -c 'create or replace view public.v_knowledge_entity_360' /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0111_knowledge_views.sql` → **Esperado:** `1`.
- [ ] **Step 4 (EXCLUIR `v_knowledge_search` — R-E):** Verificar que NO se incluyó la vista de búsqueda (depende de `searchable_items` poblado por orders → F0.5.2/F0.5.3; crearla ahora sería superficie muerta).
  Run: `grep -c 'v_knowledge_search' /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0111_knowledge_views.sql` → **Esperado:** `0`.
- [ ] **Step 5 (realtime + cierre):** Transcribir el bloque realtime idempotente desde `spec:4712-4723` y cerrar con `select pg_notify('pgrst','reload schema');`.
  Run: `grep -E "pg_publication_tables|alter publication supabase_realtime add table public.knowledge_events|pg_notify" /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0111_knowledge_views.sql` → **Esperado:** las 3 líneas.
- [ ] **Step 6 (test OCP de las vistas — R-B punto 3):** Confirmar que las vistas no ramifican por fuente.
  Run: `grep -Eic "when source_table|case .*source_table|where source_table *=|if .*source_table" /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation/supabase/migrations/0111_knowledge_views.sql`
  **Esperado:** `0`.

→ **CHECKPOINT 4**.

---

### Task 5: Read-model TS — tipos extendidos (R-F) + `listTimeline()` real + tests

La capa TS es **solo lectura** (D12). El test se escribe primero contra el contrato de mapeo, sin tocar la DB.

**Files:** Modify `src/lib/knowledge/types.ts`, `src/lib/knowledge/data.ts`; Create `src/lib/knowledge/data.test.ts`.

- [ ] **Step 1 (test que falla — R-F shape):** En `data.test.ts`, testear: (a) `isMock()` (vía mock de `env`) ⇒ `listTimeline()` devuelve `[]`; (b) dada una fila simulada del shape REAL de `v_knowledge_timeline` (`id, seq, event_type, occurred_at, ingested_at, actor_kind, actor_id, actor_label, entity_type, entity_id, summary, payload, visibility_key, source_table, correlation_id`) vía mock del query builder de Supabase, `listTimeline()` mapea a `TimelineEntry` (camelCase) y el objeto resultante **incluye** `ingestedAt`, `actorId`, `payload`, `sourceTable`, `correlationId` (assert explícito del shape extendido); (c) respeta `scope.entityType/entityId/limit`; (d) ordena por `seq desc`.
  Run: `pnpm --dir /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation test src/lib/knowledge/data.test.ts`
  **Esperado (falla):** assertions de mapeo/shape/scope fallan (hoy `listTimeline` devuelve `[]` siempre y el tipo no tiene los campos nuevos).
- [ ] **Step 2 (extender tipos — R-F):** En `types.ts`, agregar a `interface KnowledgeEvent` los campos que la vista expone y hoy faltan:
  ```ts
  ingestedAt: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  sourceTable: string | null;
  correlationId: string | null;
  ```
  (Mantener los existentes: `id, seq, eventType, occurredAt, actorKind, actorLabel, entityType, entityId, summary, visibilityKey`.) `TimelineEntry extends KnowledgeEvent` sigue válido. **Nota (asimetría `ActorKind`):** el tipo admite `'user'|'system'|'integration'`, pero la proyección de `audit_log` en F0.5.1 solo produce `'system'|'user'` (`case when user_id is null then 'system' else 'user'`); `'integration'` queda para fuentes futuras. El test fija el shape completo sin falsear cobertura.
- [ ] **Step 3 (implementación mínima):** En `data.ts`, conservar `if (isMock()) return []` y el guard `if (!supabase) return []`; implementar el query real: `supabase.from('v_knowledge_timeline').select('id,seq,event_type,occurred_at,ingested_at,actor_kind,actor_id,actor_label,entity_type,entity_id,summary,payload,visibility_key,source_table,correlation_id')` con filtros condicionales `.eq('entity_type', scope.entityType)` / `.eq('entity_id', scope.entityId)` cuando estén presentes, `.order('seq', { ascending: false })`, `.limit(scope.limit ?? 50)`; mapear filas snake→camel a `TimelineEntry`.
  Run: `pnpm --dir /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation test src/lib/knowledge/data.test.ts` → **Esperado:** verde.
- [ ] **Step 4 (typecheck + build):** `pnpm --dir /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation typecheck` → **Esperado:** `0` errores. `pnpm --dir /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation build` → **Esperado:** build verde.

→ **CHECKPOINT 5**.

---

### Task 6: EOL — canal técnico + contratos + propagación correlation_id (TS conceptual)

**Files:** Create `src/lib/knowledge/observability.ts`, `src/lib/knowledge/observability.test.ts`.

- [ ] **Step 1 (test que falla):** Testear: (a) un builder `structuredLog(event)` que produce un objeto con **campos mínimos**: `timestamp, component, operation, correlation_id, duration_ms, status('ok'|'error'|'skipped'), actor{kind,id,label}, entity, entity_id, version, error{code,message,detail}|null`; (b) constantes de eventos técnicos `KnowledgeProjectionStarted/Finished/Failed`, `KnowledgeBackfillStarted/Completed`; (c) la constante del **nombre de la GUC** `KNOWLEDGE_CORRELATION_GUC === 'knowledge.correlation_id'` y que `withKnowledgeCorrelation(id)` produce el par `('knowledge.correlation_id', id)` para `set_config(..., true)` (R-C, lado app).
  Run: `pnpm --dir /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation test src/lib/knowledge/observability.test.ts` → **Esperado (falla):** módulo inexistente.
- [ ] **Step 2 (implementación mínima):** Crear `observability.ts` con los tipos `StructuredLogEvent`, `MetricContract` (`{name, kind:'counter'|'gauge'|'histogram', labels:string[], unit:string}`), las constantes de eventos técnicos, `KNOWLEDGE_CORRELATION_GUC` y `withKnowledgeCorrelation()`. **Comentario en cabecera:** *"CANAL SEPARADO — estos tipos NUNCA se escriben en `knowledge_events`; `version` es dato del canal técnico (engine@version), no una columna de tabla funcional (D20). La app setea la GUC con `set_config('knowledge.correlation_id', <uuid>, true)` en la tx; el trigger/backfill la leen (R-C)."* Sin infra/dashboards.
  Run: `pnpm --dir /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation test src/lib/knowledge/observability.test.ts` → **Esperado:** verde.
- [ ] **Step 3:** `pnpm --dir /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation typecheck` → **Esperado:** `0` errores.

→ **CHECKPOINT 6**.

---

### Task 7: Checklist de aplicación manual + smoke SQL (para Dirección)

**Files:** Create `docs/superpowers/F05-1-APPLY-CHECKLIST.md` (de cero — R-G; tomar tono/estilo de los commits `eba2bc8`/`5803fa9` de F0.5.0 si existen como markdown en el worktree, sin copiar plantilla inexistente).

- [ ] **Step 1 (orden y precondiciones — R-H):** Escribir el checklist con:
  - **Orden de aplicación por número:** `0106 → 0107 → 0108 → 0109 → 0110 → 0111`. **Aclaración R-H:** `0110` (RBAC seed) **ya fue entregado por F0.5.0**; el orden es estrictamente por número y `0110` NO depende de `0108`/`0109` (puede haberse aplicado antes). F0.5.1 autora `0108`/`0109`/`0111`; cada una se aplica en su propia ejecución, verificando entre cada una, y cierra con `pg_notify`. No se reutilizan números con hueco histórico.
  - **Precondición dura:** `0106`/`0107`/`0110` ya aplicados en el entorno (dependencia de F0.5.0). Confirmar antes de `0108`.
  - **Landmine enum:** `0106` (enum) y `0110` (que usa el valor del enum) NO se aplican en la misma transacción (Postgres no permite usar un valor de enum nuevo en la tx donde se creó). Pertenece a F0.5.0; se recuerda, no es responsabilidad de F0.5.1.
  - **Numeración:** `ls supabase/migrations/ | sort` en el REPO confirma slots; `list_migrations` de prod NO sirve (rastrea por timestamp).
  - **Decisión `public_auth` vs `staff`** para compras/flota/compliance **antes** de correr el backfill (Riesgo R-5).
  - **Garantía Source Registry (R-D):** la fila `'audit_log'` la crea `0109` (`on conflict do nothing`); confirmar que existe antes del backfill (`select * from knowledge_sources where source_table='audit_log';`). Si por algún motivo la tabla `knowledge_sources` no estuviera, el guard `to_regclass`/gate `enabled` degrada (backfill devuelve 0).
- [ ] **Step 2 (smoke SQL — a aplicar a mano):** Documentar los comandos exactos (Dirección los corre tras aplicar):
  - **Positivo (trigger en vivo):** `insert into public.audit_log (entity, entity_id, action, payload) values ('order', '<uuid_orden_real>', 'test_smoke', '{}'::jsonb);` → `select event_type, entity_type, entity_id, visibility_key, source_table, correlation_id from public.v_knowledge_timeline where source_table='audit_log' order by seq desc limit 1;` **Esperado:** `audit.test_smoke`, `order`, `client:<uuid_del_cliente_de_esa_orden>`, `audit_log`, `correlation_id` NULL o el de la GUC si se seteó.
  - **Negativo (RLS):** como usuario `cliente_b2b` distinto / sin `knowledge.view`: `select count(*) from public.v_knowledge_timeline where entity_id='<uuid_orden_real>';` **Esperado:** `0` (la `security_invoker` + policy `knowledge_events_select` filtra la fila).
  - **Idempotencia backfill:** `select public.knowledge_backfill_audit_log();` (1ª vez ⇒ N>0) y de nuevo `select public.knowledge_backfill_audit_log();` (2ª vez ⇒ `0`). Verificar sin duplicados: `select source_pk, count(*) from public.knowledge_events where source_table='audit_log' group by 1 having count(*)>1;` ⇒ 0 filas.
  - **Gate `enabled` (degradación):** `update public.knowledge_sources set enabled=false where source_table='audit_log';` → insert de prueba en `audit_log` → NO aparece evento nuevo; revertir `enabled=true`.
  - **Sub-timeline por entidad (`v_knowledge_entity_360`):** `select event_id, entity_type, entity_id, summary from public.v_knowledge_entity_360 where entity_type='<tipo>' and entity_id='<id>' order by occurred_at desc limit 5;` → devuelve los eventos de la entidad (columnas de anotación en NULL: superficie SQL anticipada sin productor en F0.5.1).
  - **Advisors:** `mcp__supabase__get_advisors` (security + performance) tras `0111` ⇒ **0** vistas `security_definer` accidentales, RLS activa en `knowledge_events`.
  - **Limpieza:** borrar la fila de smoke de `audit_log` **NO** elimina su evento (append-only por diseño); documentar que el evento de prueba queda y es inerte (usar un `action='test_smoke'` reconocible).

→ **CHECKPOINT 7** (revisión del checklist con reviewer de máxima capacidad antes de entregar a Dirección).

---

## 5) Checkpoints (revisión entre tareas, reviewer de máxima capacidad)

Cada Checkpoint = **pausa obligatoria**: el reviewer (máxima capacidad) valida el incremento; recién con OK humano se hace el **commit local** correspondiente (G1). Nunca push/merge.

| CP | Tras Task | Qué revisa el reviewer | Gate |
|---|---|---|---|
| **CP0** | 0 | Numeración libre (`ls`), base F0.5.0 presente (R-D: `knowledge_sources`/`knowledge_annotations`/`knowledge_entities`/`correlation_id`), HEAD limpio | No avanzar si `0108/0109/0111` ocupados o si falta una tabla base |
| **CP1** | 1 | ADR-ADAPTER captura contrato + **desviación R-A (APROBADA por Dirección 2026-06-28)** + alternativa + consecuencia + criterio OCP falsable (R-B); ADR-REGISTRY captura gate `enabled` + prohibición de condicionales/reflexión | ADRs aprobables; desviación R-A explícitamente marcada |
| **CP2** | 2 | 0108: emisor agnóstico (grep OCP R-B pasa; **cero mención de audit_log/recon/po/orders/searchable** — Opción A), **default GUC correlation_id (R-C)**, composite type contrato, `SECURITY DEFINER`+`search_path`, grants `service_role`, observabilidad EOL, comentario-contrato | Pipeline agnóstico + G10 |
| **CP3** | 3 | 0109: mapeo único `knowledge_audit_log_to_canonical` (DRY — trigger y backfill lo comparten), guard `to_regclass`, **trigger y backfill vía emisor (R-A), sin INSERT directo**, **gate `enabled`**, **defensivo `exception when others`** (G11), backfill idempotente, **INSERT fila `'audit_log'`**, **nada de recon/po/orders/searchable** | Trigger jamás aborta tx; fuente registrada; DRY |
| **CP4** | 4 | 0111: `security_invoker` en ambas vistas, sub-timeline por entidad, **`v_knowledge_search` excluida (R-E)**, sin condicionales por fuente (R-B), realtime idempotente | RLS por vista + OCP |
| **CP5** | 5 | tipos extendidos (R-F shape completo), `listTimeline()` real, tests verdes, typecheck+build verdes, capa **solo lectura** (sin escritura TS) | D12 + CI verde |
| **CP6** | 6 | EOL: canal separado, campos mínimos, `version` no es columna funcional, **helper GUC correlation_id (R-C)** | D20 conformidad |
| **CP7** | 7 | Checklist aplicable (orden por número R-H), smoke positivo+negativo+idempotencia+gate, advisors | Listo para Dirección |

→ Tras CP7: **Architectural Health Check** (§9) y **Engineering Readiness Review** (§10). **Detenerse en F0.5.1.**

---

## 6) Tests

**Unitarios TS (corren en CI — `pnpm test`):**
- `src/lib/knowledge/data.test.ts`: mapeo fila `v_knowledge_timeline`→`TimelineEntry` **con shape extendido R-F** (`ingestedAt`/`actorId`/`payload`/`sourceTable`/`correlationId` presentes), scope por entidad, `limit`, orden `seq desc`, `isMock()`⇒`[]`.
- `src/lib/knowledge/observability.test.ts`: builder de log estructurado (campos mínimos §EOL, enum `status`), constantes de eventos técnicos, nombre/valor de la GUC `knowledge.correlation_id` (R-C).
- `src/lib/knowledge/visibility.test.ts` (ya existe, F0.5.0): debe seguir verde (no se toca su lógica).
- Comando: `pnpm --dir /Users/martinbattaglia/CODE/tops-ordenes/.claude/worktrees/feat+f05-knowledge-foundation test` → **Esperado:** suite verde, incluyendo los 2 archivos nuevos.

**Smoke SQL (NO corren en CI — migraciones ENTREGADAS-NO-APLICADAS; los aplica Dirección a mano, §4 Task 7):**
- Proyección en vivo (positivo), RLS por `visibility_key` (negativo), idempotencia del backfill, gate `enabled`, `get_advisors`. Comandos exactos en `F05-1-APPLY-CHECKLIST.md`.

**Verificaciones estáticas (grep/awk, durante build del plan):** presencia/ausencia de funciones por archivo (audit_log SÍ / recon-po-orders-searchable NO); **R-A** (backfill y adaptador NO insertan directo; llaman al emisor); **R-B** (emisor sin referencias a tabla-fuente ni branching por source; vistas sin condicionales por fuente); **R-C** (default GUC en el emisor); **R-E** (`v_knowledge_search` ausente); `security_invoker`; guard `to_regclass`; defensivo; fila `'audit_log'` registrada.

**Campos mínimos del structured log (EOL §4 spec):** `timestamp, component, operation, correlation_id, duration_ms, status, actor{kind,id,label}, entity, entity_id, version, error{code,message,detail}`.

---

## 7) Criterios de aceptación (mapeados a la fila roadmap F0.5.1 + R-B + R-C)

| Criterio de cierre (roadmap, textual) | Cómo se verifica en este plan |
|---|---|
| **"audit_log nuevo aparece en `v_knowledge_timeline`"** | Smoke positivo (Task 7): insert en `audit_log` ⇒ fila en `v_knowledge_timeline` con `event_type='audit.<action>'`, `source_table='audit_log'` y `visibility_key` derivada correcta |
| **"backfill idempotente corrido"** | Smoke idempotencia (Task 7): 2ª corrida de `knowledge_backfill_audit_log` ⇒ `0`; sin duplicados por `knowledge_events_idem_uq` |
| **"sub-timeline por entidad funcional"** | **Satisfecho por `listTimeline({entityType, entityId})` sobre `v_knowledge_timeline`** (Task 5, test TS en CI). `v_knowledge_entity_360` (Task 4) se entrega como read-model SQL anticipado y se **ejercita por smoke SQL** (Task 7); en F0.5.1 NO tiene binding TS ni productor de anotaciones (ver §10, R-12 nota) |
| **EOL (primera fase obligada, D20)** | Canal técnico + structured logging + métricas + auditoría de backfill + **correlation_id end-to-end vía GUC (R-C)** (Task 6 + checklist) — sin infra |
| **typecheck + build verdes** | Task 5 Step 4 / Task 6 Step 3 |
| **Esfuerzo 1,5–2 d · 4–5 commits** | §8 (5 commits previstos) |
| **Aditividad / RLS / RPC-first** | §9 Architectural Health Check |

**Criterio de extensibilidad OCP (ADR-KNW-ADAPTER, R-B — propiedad determinante, no grep cosmético):**
1. El emisor `knowledge_emit_event` no referencia ninguna tabla-fuente (Task 2 Step 6, grep negativo acotado por `awk`).
2. El emisor no ramifica por `source_table`/`source_key` (Task 2 Step 6).
3. Las vistas no contienen condicionales por fuente (Task 4 Step 6).
4. La firma del emisor + columnas de `knowledge_events` cubren el mapeo de una fuente típica (inspección de firma `spec:4144-4158` vs. INSERT de la tabla 0107:48-72).
5. **Conclusión falsable:** sumar `ReconAdapter` en F0.5.2 = `project_recon()` que llama al MISMO emisor + fila en `knowledge_sources`, sin tocar emisor/vistas/tabla/`knowledge_sources` DDL/`project_audit_log`.

**Criterio EOL correlation_id (R-C):** el emisor acepta y persiste `correlation_id`; default desde GUC `knowledge.correlation_id`; el backfill y `project_audit_log` leen la misma GUC; cuando no hay id, queda NULL explícito y aceptado. Verificado por test (`observability.test.ts`) + grep (Task 2 Step 3 / Task 3 Step 2).

---

## 8) Commits previstos (locales, SOLO tras OK por Checkpoint — G1)

Estilo F0.5.0 (`feat(knowledge):` / `docs(knowledge):`, sufijo "entregada, no aplicada" en migraciones):

1. `docs(knowledge): ADR-KNW-ADAPTER + ADR-KNW-REGISTRY — contrato del adaptador y Source Registry (APROBADO por Dirección; incl. desviación R-A)` *(tras CP1)*
2. `feat(knowledge): mig 0108 — Pipeline AGNÓSTICO (composite type knowledge_event_canonical + knowledge_emit_event + knowledge_visibility_for), entregada no aplicada` *(tras CP2)*
3. `feat(knowledge): mig 0109 — AuditLogAdapter (mapeo único + project_audit_log + backfill, todo vía emisor + gate enabled + trigger defensivo + registro fuente), entregada no aplicada` *(tras CP3)*
4. `feat(knowledge): mig 0111 — vistas v_knowledge_timeline + entity_360 (security_invoker) + realtime, entregada no aplicada` *(tras CP4)*
5. `feat(knowledge): read-model listTimeline() real + tipos extendidos + EOL (canal técnico/structured log/métricas/correlation GUC) + checklist + readiness` *(tras CP5/CP6/CP7)*

> Total: **5 commits** (dentro del rango 4–5). Si CP5/CP6 se separan, pueden ser 6; mantener ≤5 fusionando read-model+EOL+docs de cierre como arriba. **Ningún `git commit` sin OK humano explícito del Checkpoint correspondiente.** Nunca push/merge/deploy.

---

## 9) Architectural Health Check esperado (conformidad de capas)

Se ejecuta tras CP7. Pasa si:
- **Adapter Pattern (load-bearing):** TODA escritura a `knowledge_events` pasa por `knowledge_emit_event`; ni el backfill ni `project_audit_log` insertan directo (grep R-A en CP2/CP3). El emisor es el único punto de escritura.
- **Source Registry:** la fuente `'audit_log'` está registrada con `on conflict do nothing`; cada adaptador consulta su gate `enabled`; el emisor/vistas NO ramifican por fuente (R-B puntos 2-3). Sin reflexión ni dispatch dinámico.
- **Capas / RPC-first:** escritura solo por el emisor `SECURITY DEFINER` `service_role` (invocado por trigger AFTER INSERT dueño o backfill RPC); ninguna policy INSERT/UPDATE/DELETE para `authenticated`. La capa TS es **solo lectura** (`data.ts` → `v_knowledge_timeline`), sin pipeline de escritura en TS (D12).
- **RLS:** vistas `security_invoker=true`; `visibility_key` derivada por `knowledge_visibility_for`; smoke negativo confirma que un usuario sin permiso NO ve la fila. `get_advisors` ⇒ 0 `security_definer` views accidentales, RLS activa.
- **Aditividad (G2):** cero `ALTER` sobre `audit_log`; `audit_log` intacto; solo objetos `knowledge_*` nuevos + 1 fila aditiva en `knowledge_sources`. Rollback trivial (drop trigger/view; `knowledge_sources.enabled=false`).
- **No-duplicación / DRY:** SQL transcrito del spec (fuente única) con desviaciones documentadas; mapa de visibilidad centralizado en `knowledge_visibility_for` (usado por backfill y trigger); escritura centralizada en el emisor.
- **OCP (R-B):** propiedad determinante verificada (emisor agnóstico + sin branching + columnas cubren mapeo); adaptador único `project_audit_log`; los demás adaptadores definidos-en-contrato, no implementados.
- **G11:** trigger defensivo verificado (`exception when others`, `return null`, gate `enabled`).
- **EOL correlation_id (R-C):** GUC `knowledge.correlation_id` propagada end-to-end (emisor default + backfill + trigger leen; app setea).

**Health Check esperado: VERDE.** La desviación R-A (enrutar por el emisor, alterando el SQL literal del spec) fue **APROBADA por Dirección el 2026-06-28** (ADR-KNW-ADAPTER): refuerza la arquitectura aprobada al hacer el contrato Adapter+Registry *load-bearing*. Sin banderas pendientes; habilitada la construcción de 0108/0109 una vez aprobado este plan (G7).

---

## 10) Engineering Readiness Review esperado (gate de cierre — de cero, R-G; incl. EOL + Adapter + Registry)

Se redacta de cero en `docs/superpowers/F05-1-ENGINEERING-READINESS-REVIEW.md` (no existe plantilla previa F05*/READINESS/CHECKLIST en el worktree — R-G; tomar tono de los commits `eba2bc8`/`5803fa9` de F0.5.0). Veredicto esperado: **APROBADO PARA CONTINUAR (a F0.5.2, en sesión separada)**. Secciones:

1. **Criterio de cierre roadmap:** los 3 puntos de §7 verificados (smoke positivo / backfill idempotente / sub-timeline) — evidencia real (G5), capturas de los comandos del checklist.
2. **Conformidad EOL (§9 spec):** eventos técnicos en canal separado ✔; **`correlation_id` end-to-end vía GUC `knowledge.correlation_id` (R-C)** ✔ (emisor default + backfill + trigger leen; app setea; NULL aceptado cuando no hay origen). **Cobertura diferida:** en proyección EN VIVO el `correlation_id` será NULL para los ~30 RPCs existentes de `audit_log` (no se instrumentan en F0.5.1 — la EOL prohíbe instrumentación retroactiva); la cobertura funcional end-to-end se completa al instrumentar las fuentes (F0.5.2+); el backfill puede setear la GUC por lote. **Invariante:** `correlation_id` NO integra la unique key `(source_table, source_pk, event_type)`, por lo que re-corridas del backfill conservan el `correlation_id` de la 1ª corrida y no duplican. structured logging JSON ✔; contratos de métricas preparados ✔; auditoría de backfill (rango/duración/resultado) ✔; `version` como dato de canal (no columna) ✔.
3. **Conformidad Adapter Pattern + Source Registry:** emisor único de escritura (R-A) ✔; emisor/vistas agnósticos sin branching por fuente (R-B) ✔; fuente `'audit_log'` registrada en `knowledge_sources` con gate `enabled` ✔; sin reflexión/dispatch dinámico/orquestador genérico ✔; solo `AuditLogAdapter` implementado ✔.
4. **Gobernanza:** G1 (nada aplicado/pusheado) ✔; G2 (aditivo) ✔; G3 (3 migraciones idempotentes entregadas-no-aplicadas, numeradas 0108/0109/0111, cierran con `pg_notify`; orden por número R-H) ✔; G7 (plan aprobado antes de build) ✔; G10/G11 ✔.
5. **Calidad:** typecheck+build verdes, suite Vitest verde (incluye 2 tests nuevos + shape extendido R-F).
6. **Extensibilidad (R-B):** checklist de propiedad determinante verificado.
7. **Frontera:** confirmar que **NO** se incluyó nada de F0.5.2 (recon/po/orders/search/worker/otros adaptadores/otras filas de `knowledge_sources`). **Detenerse.**

---

## 11) Riesgos + mitigaciones

| # | Riesgo | Mitigación |
|---|---|---|
| **R-1** | Numeración: shift +6 de F1 es por nombre de archivo; prod rastrea por timestamp y no detecta el choque | Task 0 Step 1 con `ls … \| sort` (verificado hoy: `0108/0109/0111` libres); el checklist prohíbe `list_migrations` de prod para esto (R-H) |
| **R-2** | Trigger `project_audit_log` aborta la tx de negocio si la proyección falla | **Manejo defensivo `exception when others` + `return null`** (Task 3 Step 2, G11); CP3 lo valida |
| **R-3** | `v_knowledge_search` falla al crearse / entrega superficie muerta (depende de `searchable_items` poblado por orders, F0.5.2/F0.5.3) | **Omitida** de 0111-F0.5.1 (Task 4 Step 4, R-E); se entrega en su fase |
| **R-4** | Backfill no idempotente ⇒ duplicados | Enrutado por emisor con `on conflict (source_table, source_pk, event_type) do nothing` + smoke de idempotencia (2ª corrida ⇒ 0) |
| **R-5** | `public_auth` para compras/flota/compliance sobre-expone eventos de `audit_log` de esas entidades | Checklist exige **confirmar `public_auth` vs `staff` con Dirección antes del backfill**; el helper `knowledge_visibility_for` centraliza el mapa para un cambio de una línea (`spec:4343` ya prevé endurecer a `staff` con `cliente_b2b`). **No ADR nuevo** |
| **R-6** | Propagación de `correlation_id` a un trigger AFTER INSERT no iniciado por la capa knowledge | **RESUELTO por R-C:** GUC `knowledge.correlation_id` (la app setea con `set_config(..., true)`; emisor/backfill/trigger leen vía `current_setting(..., true)`); NULL explícito aceptado cuando no hay origen. Sin infra nueva. Helper TS `withKnowledgeCorrelation()` (Task 6) |
| **R-7** | `knowledge_annotate` referencia `knowledge_annotations`/`knowledge_entities` (existen en 0107) pero su UI no es MVP del timeline | **Diferida** (OUT §2.2); `v_knowledge_entity_360` igual se entrega (left join degrada a NULL). Si Dirección la quiere en F0.5.1, es tarea aditiva (transcribir `spec:4226-4259`) sin tocar el resto |
| **R-8** | Aplicar 0106 (enum) y 0110 en misma tx rompe (Postgres) | Pertenece a F0.5.0, ya entregado; el checklist recuerda el orden (R-H), pero **NO** es responsabilidad de F0.5.1 |
| **R-9** | Dependencia dura de F0.5.0 aplicado (tablas + RLS + `knowledge_sources`) | Checklist exige confirmar que `0106/0107/0110` están aplicados antes de `0108`; Task 0 Step 2 verifica la base en el repo (R-D, gate de la tarea) |
| **R-10** | Desviación R-A cambia SQL ya aprobado del spec | **APROBADA por Dirección (2026-06-28)** vía ADR-KNW-ADAPTER; la arquitectura prima sobre la implementación literal; autorizado modificar el SQL del spec. Construir 0108/0109 tras aprobación del plan (G7) |
| **R-11** | Gate `enabled` mal aplicado bloquea la proyección silenciosamente | Smoke de gate (Task 7 Step 2): `enabled=false` ⇒ no proyecta; revertir; la fila se crea `enabled=true` por defecto en 0109 |
| **R-12** | Falsa expectativa de captura "pending": si el emisor fallara dentro del `exception when others`, el evento NO se materializa (no queda pending) | **En F0.5.1 NO hay captura pending.** El emisor inserta `status='processed'` fijo; las columnas `status/retry_count/available_at` de 0107 quedan **inertes** hasta el worker de drenado (F0.5.2). Única red de recuperación: re-correr `knowledge_backfill_audit_log` (idempotente). Declarado en el Readiness para no sobre-afirmar conformidad de degradación |

---

## 12) Banderas "REQUIERE ADR / DECISIÓN" (Dirección decide antes de construir)

- **ADR-KNW-ADAPTER** y **ADR-KNW-REGISTRY:** marcados **APROBADO POR DIRECCIÓN** (mandato de este turno) — se documentan en Task 1, no requieren nueva aprobación de la *decisión arquitectónica*.
- **✅ DESVIACIÓN R-A — APROBADA POR DIRECCIÓN (2026-06-28, ADR-KNW-ADAPTER):** F0.5.1 desvía del SQL literal del spec (§5.3/§5.4) que insertaba directo en `knowledge_events`; en su lugar enruta TODA escritura por `knowledge_emit_event` (único punto de materialización). Dirección resolvió que "la arquitectura tiene prioridad sobre la implementación literal cuando ambas entran en contradicción" y autorizó expresamente modificar el SQL originalmente redactado. **Ya NO es bloqueante**; habilita construir 0108/0109 una vez aprobado este plan (G7).
- **DECISIÓN D-1 (no-ADR):** `public_auth` vs `staff` para compras/flota/compliance en `knowledge_visibility_for` (Riesgo R-5). Ajuste de una línea, contemplado en `spec:4343`. Confirmar antes del backfill.
- **DECISIÓN D-2 (RESUELTA por R-C, no-ADR):** mecanismo de propagación de `correlation_id` a triggers = **GUC `knowledge.correlation_id`**. Queda fijado en este plan; no es open-question.
- **DECISIÓN D-3 (no-ADR):** incluir o diferir `knowledge_annotate` (Riesgo R-7). Default del plan: **diferir**.
- **Open-questions residuales para Dirección (no bloquean redacción; sí los pasos afectados):**
  - Sink técnico concreto de los eventos EOL en F0.5.1: solo logs estructurados (stdout/Netlify) vs. bitácora técnica propia del esquema `knowledge`. Default del plan: **logs estructurados (TS conceptual)**; sin tabla técnica nueva (la EOL no agrega columnas/tablas funcionales).
  - Confirmar slug RBAC de RRHH (no es la fuente #1; solo afecta `knowledge_visibility_for` si una fila de `audit_log` de RRHH se proyecta).

---

**Fin del plan. Esperando aprobación (G7) y confirmación de la desviación R-A antes de construir. Al cerrar F0.5.1 — detenerse; F0.5.2 es sesión separada.**

---

## 13) Contrato Canónico de Eventos — `KnowledgeEventCanonical` (ADR-KNW-CONTRACT, APROBADO por Dirección 2026-06-28)

**AUTORITATIVO.** Esta sección consolida el contrato único entre adaptadores y pipeline. Donde difiera de la transcripción literal del spec / Task 2 (emisor con 13 parámetros sueltos), **PREVALECE esta sección**: el emisor acepta **UN solo argumento** del tipo canónico.

### 13.1 El tipo canónico (composite type SQL) — se crea en `0108` (idempotente)
Campos = columnas de **negocio** de `knowledge_events` (0107:48-72), EXCLUYENDO las gestionadas por el pipeline (`id, seq, ingested_at, status, retry_count, available_at, processed_at, error`):

```sql
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'knowledge_event_canonical' and n.nspname = 'public'
  ) then
    create type public.knowledge_event_canonical as (
      event_type     text,
      occurred_at    timestamptz,
      actor_kind     text,
      actor_id       uuid,
      actor_label    text,
      entity_type    text,
      entity_id      text,
      summary        text,
      payload        jsonb,
      visibility_key text,
      source_table   text,   -- source_key: clave de la fuente en el Source Registry
      source_pk      text,
      correlation_id text
    );
  end if;
end $$;
```

### 13.2 El emisor acepta SOLO el contrato
`public.knowledge_emit_event(p_event public.knowledge_event_canonical) returns uuid` — `language plpgsql security definer set search_path = public, pg_temp`. Responsabilidades del emisor (y SOLO del emisor):
- **Validar el contrato:** obligatorios NOT NULL (`event_type, occurred_at, entity_type, entity_id, visibility_key, source_table`); defaults (`actor_kind := coalesce(p_event.actor_kind,'system')`, `payload := coalesce(p_event.payload,'{}'::jsonb)`).
- **Propagar `correlation_id`:** `coalesce(p_event.correlation_id, nullif(current_setting('knowledge.correlation_id', true), ''))`.
- **Materializar** (único punto de escritura): `insert into public.knowledge_events (event_type, occurred_at, actor_kind, actor_id, actor_label, entity_type, entity_id, summary, payload, visibility_key, source_table, source_pk, correlation_id) values (...) on conflict (source_table, source_pk, event_type) do nothing returning id`.
- **Observabilidad (EOL):** evento técnico en **canal separado** (`raise log` estructurado) con resultado/duración — NUNCA en `knowledge_events`.
- **Estabilidad del formato:** único lugar donde evoluciona el shape canónico.
- **Agnóstico del origen:** no referencia ninguna tabla-fuente; no ramifica por `source_table`.

### 13.3 Responsabilidades (frontera dura)
| Componente | Hace | NO hace |
|---|---|---|
| **Adaptador** `project_<source>()` | lee su fuente; traduce a `KnowledgeEventCanonical`; resuelve `source_table` (source_key); calcula `visibility_key` (vía `knowledge_visibility_for`); consulta su gate `enabled`; **entrega el contrato al emisor** | NO persiste; NO conoce `knowledge_events`; NO conoce las vistas |
| **Source Registry** `knowledge_sources` | registra y resuelve fuentes (fila + `enabled`) | NO transforma; NO contiene lógica de proyección |
| **Pipeline** `knowledge_emit_event` | valida contrato; materializa; observabilidad; propaga `correlation_id`; mantiene estabilidad del formato | NUNCA conoce detalles del origen |

### 13.4 Impacto en las tareas (modifica el plan)
- **Task 1:** agrega **ADR-KNW-CONTRACT** (3er ADR) documentando `KnowledgeEventCanonical`, las responsabilidades y el límite.
- **Task 2 (0108) — pipeline AGNÓSTICO (Opción A, Dirección 2026-06-28):** composite type (13.1) + `knowledge_emit_event(p_event public.knowledge_event_canonical)` + `knowledge_visibility_for` (helper transversal). **Sin ninguna lógica ni mención de `audit_log`.**
- **Task 3 (0109) — AuditLogAdapter:** mapeo **único** `knowledge_audit_log_to_canonical(...)` (la SOLA definición del mapeo audit_log→canónico) usado por el trigger `project_audit_log` Y por `knowledge_backfill_audit_log`; ambos construyen `KnowledgeEventCanonical` y lo pasan al emisor; gate `enabled`; defensivo `exception when others`; registro de la fila `'audit_log'`.
- **Aceptación (OCP):** sumar `ReconAdapter` = construir el MISMO `KnowledgeEventCanonical` + fila en `knowledge_sources`; el tipo, el emisor, las vistas y la tabla **no cambian**.
- **Límite (Dirección):** NO validaciones complejas (solo NOT NULL de obligatorios + defaults), NO serialización adicional, NO reflexión, NO carga dinámica.
