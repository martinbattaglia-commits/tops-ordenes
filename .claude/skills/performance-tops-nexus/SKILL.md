---
name: performance-tops-nexus
description: >-
  Performance de TOPS NEXUS: índices PostgreSQL (compuesto/BRIN/GIST), costo de RLS, PostGIS y
  tracking de flota, queries pesadas (última posición, libros IVA, dashboards), presupuesto de boot
  de Next.js App Router, performance de build (Node 22 + heap 4GB) y caching seguro bajo RLS. Usar
  al optimizar una query lenta, diseñar índices, revisar la escala de fleet_positions/tracking,
  diagnosticar boot/layout lento o un build con OOM. NO usar para diseño arquitectónico nuevo
  (architecture-tops-nexus), bugs funcionales ni observabilidad (observability-tops-nexus).
---

# performance-tops-nexus

> **Antes de actuar, leé y aplicá [`../_shared/GOVERNANCE.md`](../_shared/GOVERNANCE.md) (G1–G11).**

## Propósito
Estándares de rendimiento de DB, frontend y build **sin** romper RLS ni disponibilidad del shell.

## Cuándo usarla
- Optimizar una query lenta o diseñar índices.
- Revisar la escala de `fleet_positions` / tracking GPS.
- Diagnosticar boot/layout lento del shell autenticado.
- Resolver un build con OOM / lento.
- Decidir qué se puede cachear sin romper RLS/tenancy.

## Cuándo NO usarla
- Diseño arquitectónico nuevo → `architecture-tops-nexus`.
- Bug funcional (no de rendimiento).
- Telemetría/monitoreo → `observability-tops-nexus`.

## Reglas obligatorias (además de G1–G11)
- **Series temporales append-only** (`fleet_positions`, `fleet_events`) llevan SIEMPRE 3 índices: compuesto `(vehicle_id, recorded_at DESC)` + **BRIN** `(recorded_at)` + **GIST** `(geom)`. No reemplazar el compuesto por un B-tree simple ni omitir el BRIN. → `supabase/migrations/0016_tracking_foundation.sql:78-88`; `0018_tracking_events.sql:45-52`.
- **Funciones de autorización RLS no-recursivas** (`current_role`, `is_staff`, `is_admin`) = `SECURITY DEFINER` + `STABLE` + `set search_path = public, pg_temp` (corta la recursión RLS; costo constante por request). → `supabase/migrations/0005_fix_rls_recursion.sql:23-67`. Nota: `has_permission(p_slug)` se define aparte en `supabase/migrations/0009_rbac.sql:164` como `language sql stable` (sin `SECURITY DEFINER`).
- **Boot budget duro = 3000 ms** (`BOOT_BUDGET_MS`): `(app)/layout.tsx` espera **un solo** `await getBootContext()` envuelto en `Promise.race`; deduplicar boot/RBAC con `React.cache()`. Prohibido sumar awaits bloqueantes sin presupuesto. → `src/lib/rbac/boot-permissions.ts:51,136-188`; `src/app/(app)/layout.tsx:16-18`.
- **Ingesta de posiciones solo `service_role`** (sin policy de INSERT) y **Realtime CDC, no polling** client-side. → `0016:104-106,125-140`.
- **Build: Node 22 + heap 4 GB** obligatorio (`--max-old-space-size=4096`); con 1024 MB hay OOM en el type-check estricto de ~447 archivos. No bajar heap ni Node version. → `netlify.toml:14-19`; `tsconfig.json:7` (`strict`).
- **`geom`** = `GENERATED ALWAYS … STORED` SRID 4326; PostGIS schema-qualified (`extensions.ST_*`); el path de ingesta nunca toca PostGIS. → `0016:13-16,60-69`.
- **Vistas derivadas** (libros/reportes fiscales) con `security_invoker = true` + patrón D5 (leen del detalle canónico, nunca duplican/escriben). → `0059_iva_compras_views.sql:1-10`.
- **Índices parciales** (`WHERE`) para unicidad condicional / filtros estables (soft-delete, estado terminal). → `0035_wms_dispatch.sql:82`; `0010_documents.sql:122-130`.
- **Medir el costo de RLS desde la app/API con sesión de usuario real**, NUNCA con `SELECT` en el SQL Editor (corre como `postgres` con BYPASSRLS y ve todas las filas). → `docs/handoff/RLS_0040_EXECUTION_RUNBOOK.md:96-99`.

## Gaps prioritarios que la skill debe encarar
1. **`fleet_positions` sin partición ni retención** — `grep PARTITION = 0`. Definir `PARTITION BY RANGE(recorded_at)` (mensual) + purga (pg_cron) **antes** de tracking de alta frecuencia. → `0016:55,82`.
2. **Query "última posición por vehículo"** (`src/lib/tracking/data.ts:55-73`) trae TODO el histórico y deduplica en JS con un `Map` (sin `.limit`). No escala. Migrar a `DISTINCT ON (vehicle_id) … ORDER BY vehicle_id, recorded_at DESC` (RPC/vista) sobre el índice compuesto existente.
3. **Sin política de caching escrita** — abundan `export const dynamic = 'force-dynamic'`; la única dedupe es `React.cache()` por request. Definir qué es cacheable (catálogos globales `client_id null`) vs qué nunca (cualquier dato RLS-bound).

## Comandos sugeridos
```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run build   # reproducir el build de prod sin OOM
npm run typecheck                                      # tsc --noEmit (strict) — superficie de type-check
node scripts/supabase-check.mjs                        # diagnóstico read-only del schema
```

## Checklist de validación
- [ ] ¿Índices correctos por tipo de tabla (compuesto/BRIN/GIST en series; parciales donde aplica)?
- [ ] ¿Funciones RLS `SECURITY DEFINER` + `search_path` fijo?
- [ ] ¿Boot path con presupuesto duro (un solo await, `cache()`)?
- [ ] ¿La query escala (`DISTINCT ON`/`limit`, no traer todo)?
- [ ] ¿Medición con **sesión de usuario real**, no SQL Editor?
- [ ] ¿Build reproducido local con Node 22 + 4 GB sin OOM?

## Criterios de cierre
- Mejora **medida con evidencia real** (antes/después), no teórica (G5/G6).
- Índice/partición entregado como **SQL idempotente numerado, NO aplicado** (G3).
- Sin regresión de RLS (verificada desde la app).

## Ejemplos de prompts internos
- *"Optimizá 'última posición por vehículo': proponé RPC/vista con `DISTINCT ON (vehicle_id)` apoyada en `fleet_positions_vehicle_recorded_idx`; SQL idempotente numerado; medí antes/después con sesión de usuario real. No apliques."*
- *"Diseñá el particionamiento + retención de `fleet_positions` (rango mensual + purga). Entregá el SQL idempotente y el plan de migración de datos. No apliques."*
- *"Auditá el boot path: confirmá un solo await con presupuesto de 3s y dedupe por `cache()`; señalá cualquier await bloqueante nuevo con `file:línea`."*
