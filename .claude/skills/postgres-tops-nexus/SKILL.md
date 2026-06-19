---
name: postgres-tops-nexus
description: >-
  Autoría y gobernanza de SQL/PostgreSQL en TOPS NEXUS: migraciones idempotentes y numeradas,
  RLS y policies, funciones/RPC SECURITY DEFINER, constraints, índices, particionamiento, PostGIS,
  y kits de validación SQL read-only. Usar al escribir una migración, diseñar o cambiar RLS,
  crear una RPC, agregar constraints/índices o auditar el esquema. NO usar para optimización de
  runtime ya escrito (performance-tops-nexus), diseño de dónde vive un módulo (architecture-tops-nexus),
  ni para aplicar/deployar migraciones (devops-tops-nexus).
---

# postgres-tops-nexus

> **Antes de actuar, leé y aplicá [`../_shared/GOVERNANCE.md`](../_shared/GOVERNANCE.md) (G1–G11).
> En particular G3 (migraciones a mano / idempotentes / numeradas) y G10 (inmutabilidad / RPC).**

## Propósito
Que toda escritura de SQL produzca migraciones **correctas, idempotentes, numeradas y seguras**,
listas para que Martín las aplique a mano en el SQL Editor del Supabase productivo
(`arsksytgdnzukbmfgkju`, G4), sin romper la disciplina del esquema.

## Cuándo usarla
- Escribir una migración nueva.
- Diseñar o modificar una policy RLS.
- Crear una RPC `SECURITY DEFINER`.
- Agregar constraints / FK / índices.
- Trabajar PostGIS / geodatos.
- Auditar integridad del esquema o resolver una colisión de numeración.

## Cuándo NO usarla
- Optimizar performance de SQL ya escrito → `performance-tops-nexus`.
- Decidir arquitectura / ubicación de un módulo → `architecture-tops-nexus`.
- Aplicar / deployar migraciones → `devops-tops-nexus`.

## Reglas obligatorias (además de G1–G11)

### Migraciones idempotentes (re-ejecutables sin error) — patrones canónicos del repo
- `create table if not exists` → `supabase/migrations/0008_purchase_orders.sql:78`, `0009_rbac.sql:42`.
- `add column if not exists` → `0004_extended_schema.sql:9`, `0011_arca_billing.sql:61`.
- `create (unique) index if not exists` → **212 usos** en `supabase/migrations/`.
- `on conflict do nothing` en seeds (permissions/role_permissions/catálogos) → `0009_rbac.sql:234`, `0046_crm_rbac_seed.sql:29`.
- `drop policy if exists` antes de `create policy` → `0008_purchase_orders.sql:185` (en `0076`/`0081` vía `execute format()` en loop por tabla).
- `create or replace` para funciones/vistas/RPCs → `0005_fix_rls_recursion.sql:23`.
- **Enums idempotentes:** envolver en `do $$ begin create type … exception when duplicate_object then null; end $$;` → `0076_crm_contracts.sql:32`, `0041_crm_enums.sql:16` (mitigación FM-3 de `docs/ERP-FASE0-GOBERNANZA-DB.md`).
- ⚠️ **Anti-patrón a NO repetir:** `0001_init.sql:9` crea enums **sin guard** → no idempotente, catalogado como `❌` en `docs/ERP-FASE0-GOBERNANZA-DB.md:97`.

### Numeración de migraciones
- Numerar al **siguiente libre**; **no reusar huecos** (`0012` gap histórico, `0028` reservado a Digital Twin v2) → `docs/handoff/MASTER_HANDOFF.md:61`.
- **Existen 6 colisiones de prefijo `0052–0059`** (linajes paralelos CRM/tesorería vs AP/RRHH: `0052_crm_*`+`0052_treasury_*`, etc.), **no documentadas en gobernanza**. No agregar colisiones nuevas; si una es inevitable, documentar el orden de aplicación.
- **`alter type … add value` va SIEMPRE en su propia migración aislada**, commiteada **antes** de la migración que usa el valor (Postgres prohíbe usar un valor de enum nuevo en la misma transacción: *"unsafe use of new value of enum type"*) → `0021_wms_permission_module.sql:12`, `0029_pedidos_permission_module.sql:14`, `0052_treasury_permission_module.sql:15` (su header documenta la regla).
- **Prohibido `supabase db push`** → `docs/ERP-DEPENDENCY-GRAPH.md:223`.

### RLS y Policies (97 `enable row level security`, 228 `create policy` en el árbol)
- Toda tabla nueva: `enable row level security`. Lectura amplia (`auth.uid() is not null`) + escritura `for all` restringida por rol con `using` + `with check` sobre `current_role()` → `0016_tracking_foundation.sql:108-123`, `0011_arca_billing.sql:322-326`.
- Nunca subconsultar `profiles` directo dentro de una policy de `profiles` (recursión); usar los helpers → `0005_fix_rls_recursion.sql:74-89`.
- Nunca `using(true)` en tablas con PII / datos sensibles (lección `compliance_items`).

### SECURITY DEFINER (106 funciones `security definer` en el árbol)
- Helpers de autorización RLS = `language sql` + `stable` + `security definer` + **`set search_path = public, pg_temp`** → `0005_fix_rls_recursion.sql:23-34` (`current_role`), `:36-51` (`is_staff`), `:53-67` (`is_admin`).
- ⚠️ **Footgun de hardening (real):** conviven `set search_path = public, pg_temp` (24×, recomendado) y `set search_path = public` a secas (35×, más débil ante schema hijacking; ej. `0059_rrhh_workflows.sql:219`). **Usar siempre la forma con `pg_temp`.**
- `has_permission(p_slug)` es `language sql stable` **sin** `SECURITY DEFINER` → `0009_rbac.sql:164-175` (es el path RBAC gestionable, distinto de los helpers de RLS base).

### RPC (G10)
- Escrituras de stock / ledgers / dinero **solo vía RPC `SECURITY DEFINER`** que auto-validan permiso adentro (porque bypassean RLS). Concentrado en tesorería (`0053`/`0054`), WMS packing (`0033`), AP (`0058`).

### Constraints (157 `check`, 184 `references` en el árbol)
- CHECK de dominio: singleton `id=1` (`0011_arca_billing.sql:70`), rangos (`amount > 0`), CHECK nombrados cross-column con sufijo `_ck` → `0053_treasury_core.sql:216-221` (`treasury_movements_type_direction_ck`), `:329` (`retention_le_gross`).
- Estados como enum / CHECK, no `text` libre.
- FK siempre con `on delete` explícito: `cascade` (hijo dependiente, `0016_tracking_foundation.sql:63`), `set null` (auditoría/usuario, `0011_arca_billing.sql:195`), `restrict` (integridad fiscal/contable, `0011_arca_billing.sql:137`).
- Inmutabilidad por trigger `BEFORE UPDATE` que `raise exception` ante cambio de comprobante autorizado → `0011_arca_billing.sql:257-281`.

### Índices (209 `create index` en el árbol) — elegir por tipo de carga
- **GIST** sobre `geom` → `0016_tracking_foundation.sql:87-88`.
- **BRIN** sobre la columna de tiempo en series append-only masivas → `0016:83-84`.
- **GIN** para tags / FTS / jsonb → `0010_documents.sql:114`.
- **Compuesto** `(vehicle_id, recorded_at desc)` para la query caliente → `0016:79-80`.
- **Parciales** `create index … where` → `0004_extended_schema.sql:65`.

### PostGIS y Particionamiento
- **PostGIS:** extensión en schema `extensions` (convención Supabase), referencias schema-qualified (`extensions.ST_*`), `geom` = `GENERATED ALWAYS AS (…) STORED` SRID 4326 → `0016_tracking_foundation.sql:21-22,66-69`. El path de ingesta nunca toca PostGIS, solo inserta lat/lng.
- ⚠️ **Particionamiento: NO existe** (`grep 'partition by'` en `supabase/migrations/` = 0). `fleet_positions` se describe "para millones de filas" (`0016:55`) pero es monolítica, **sin retención ni `pg_cron`** (confirmado 0 resultados). **Regla: antes de tracking de alta frecuencia, diseñar `PARTITION BY RANGE(recorded_at)` + purga.** (Es el gap de escala #1; el detalle de optimización vive en `performance-tops-nexus`.)

### EXPLAIN ANALYZE / pg_stat_statements (medición del impacto de una migración)
- ⚠️ **Estado real:** el repo **NO** tiene instrumentación de performance (`grep` de `explain (`, `pg_stat_statements`, `auto_explain` = 0). La intención existe solo como prosa de staging → `docs/ERP-FASE2-GATE2-STAGING-VALIDATION.md:181-183` (criterio p95 < 200 ms, sin Seq Scan indebido).
- **Estándar prescripto (a futuro, marcar siempre que no es estado actual):** medir el plan con `EXPLAIN (ANALYZE, BUFFERS)` **desde una sesión de usuario real** (no el SQL Editor, que es BYPASSRLS); para hotspots recurrentes, habilitar `pg_stat_statements`.

## Kit de validación (patrones reales del repo, todos read-only)
- **Checks de catálogo (cero escrituras):** aserciones `OK/FALLO` sobre `pg_class.relrowsecurity`, `pg_policies`, `pg_proc` → `docs/handoff/RLS_0040_SMOKE_TEST.sql:18,24-28,62-64`.
- **Comportamiento RLS sin mutar:** `begin; set local role authenticated; set_config('request.jwt.claims', …); select count(*); rollback;` → `RLS_0040_SMOKE_TEST.sql:87-119`.
- **Fixtures con 0 footprint:** `do $$ … raise exception '__qa_rollback__'` (rollback por savepoint, append-only-safe) → `docs/handoff/gate5_core_validation_report.sql:10-12,41`; **18 kits** usan este sentinel.
- **Smoke de PROD 100% read-only** (conteos / RLS / triggers / buckets) → `docs/PROD-SMOKE-REPORT.md:5,27-34`.
- **Script Node read-only:** `scripts/supabase-check.mjs:75-77` (`count exact head:true`, no trae filas ni escribe).

## Comandos sugeridos (todos de solo lectura / diagnóstico)
```bash
ls supabase/migrations/                                   # auditar numeración / colisiones / huecos
grep -rniE 'create (unique )?index if not exists' supabase/migrations/ | wc -l
grep -rin 'partition by' supabase/migrations/             # confirmar ausencia de particionamiento
node scripts/supabase-check.mjs                           # diagnóstico read-only (count head:true + buckets)
```
> El SQL de migración se **entrega** (idempotente, listo para pegar); **lo aplica Martín** a mano (G3).
> El kit de validación se entrega para que Martín lo corra; nunca lo ejecuta el asistente en prod.

## Checklist de cierre
- [ ] Idempotente (los 7 patrones según corresponda).
- [ ] Número libre, sin colisión, sin reusar huecos.
- [ ] `alter type … add value` aislado y commiteado antes de su uso.
- [ ] RLS habilitada + policy por rol (`current_role()`).
- [ ] `SECURITY DEFINER` con `set search_path = public, pg_temp`.
- [ ] CHECK de dominio + FK con `on delete` explícito.
- [ ] Índice del tipo correcto (GIST/BRIN/GIN/compuesto/parcial).
- [ ] Kit de validación read-only adjunto.
- [ ] **Entregado, NO aplicado** (G3).

## Relación con las otras skills (sin duplicar)
- **architecture-tops-nexus** = *qué y dónde* (bounded context, RPC-first como decisión de diseño). Esta skill = *cómo del SQL* (DDL correcto e idempotente).
- **performance-tops-nexus** = *que el SQL escale* (estrategia de índices a escala, partición, medición con EXPLAIN). Esta skill = *correctness y gobernanza del DDL*.
- **devops-tops-nexus** = *release* (aplicar a mano, orden ascendente, rollback). Esta skill no aplica ni deploya.

## Ejemplos de prompts internos
- *"Escribí la migración `<NNNN>_<modulo>_<feature>.sql`: idempotente (los 7 patrones), RLS por `current_role()`, CHECK de dominio, índices por tipo; si necesita un valor de enum nuevo, sepáralo en una migración previa aislada. Entregá SQL + kit de validación read-only. No apliques."*
- *"Auditá la numeración de `supabase/migrations/`: listá colisiones y huecos; proponé el siguiente número libre."*
- *"Revisá esta policy RLS contra recursión y `using(true)` en tablas sensibles; citá `file:línea`."*
