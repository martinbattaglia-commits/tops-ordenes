# F0.5.1 Knowledge Layer — Checklist de Aplicación Manual

**Entregadas, NO aplicadas · Revisar antes de ejecutar**
**Prod oficial:** `arsksytgdnzukbmfgkju` · SQL Editor de Supabase

---

> **ADVERTENCIA G3 — Governance de migraciones**
>
> Las migraciones de F0.5.1 están **entregadas pero NO aplicadas** en producción.
> No usar `supabase db push` ni ningún CLI automatizado.
> Cada archivo debe pegarse **manualmente** en el SQL Editor de Supabase prod
> (`arsksytgdnzukbmfgkju`), uno por uno, en el orden indicado, esperando
> confirmación de éxito antes de continuar con el siguiente.
>
> La aplicación es responsabilidad exclusiva de **Martín (Dirección)**.
> El asistente NO ejecuta WRITES en producción.

---

## 1. Pre-requisitos: confirmar F0.5.0 aplicada

F0.5.1 (0108/0109/0111) depende de las migraciones de F0.5.0 (0106/0107/0110).
Ejecutar las siguientes verificaciones en el SQL Editor **antes de aplicar cualquier archivo**:

### 1.1 Confirmar existencia de las tablas núcleo (F0.5.0 / 0107)

```sql
-- Ejecutar en prod: deben devolver el nombre de la tabla, no NULL.
select
  to_regclass('public.knowledge_events')      as knowledge_events,
  to_regclass('public.knowledge_sources')     as knowledge_sources,
  to_regclass('public.knowledge_annotations') as knowledge_annotations,
  to_regclass('public.knowledge_entities')    as knowledge_entities;
```

**Resultado esperado:** las 4 columnas muestran el nombre del objeto (ej. `public.knowledge_events`).
Si alguna devuelve `NULL`, F0.5.0 no está aplicada → aplicar primero 0106 → 0107 → 0110.

### 1.2 Confirmar enum `knowledge` registrado (F0.5.0 / 0106)

```sql
select exists(
  select 1 from pg_enum e
  join pg_type t on t.oid = e.enumtypid
  where t.typname = 'permission_module_t'
    and e.enumlabel = 'knowledge'
) as knowledge_enum_exists;
```

**Resultado esperado:** `true`.

### 1.3 Confirmar permisos knowledge.* insertados (F0.5.0 / 0110)

```sql
select slug from public.permissions
where slug like 'knowledge.%'
order by slug;
```

**Resultado esperado:** 5 filas: `knowledge.admin`, `knowledge.create`, `knowledge.delete`, `knowledge.edit`, `knowledge.view`.

### 1.4 Verificar numeración libre en prod (landmine de timestamps)

Prod rastrea migraciones por **timestamp**, no por prefijo `0xxx`. Verificar qué está
pendiente comparando el worktree contra prod antes de aplicar:

```bash
# En la máquina local (no en prod):
ls supabase/migrations | sort
```

Si prod ya registra un archivo con timestamp mayor, el orden por número puede diferir.
Confirmar con `list_migrations` en la UI de Supabase o con `supabase migration list`
(read-only) **antes de aplicar**.

---

## 2. Decisión D-1 — Visibilidad de entidades operativas (confirmar ANTES del backfill)

**Ubicación:** `0108_knowledge_rpc.sql`, función `public.knowledge_visibility_for`, líneas 55-56.

```sql
when 'purchase_order','supplier_invoice','vendor','fleet_vehicle','warehouse','compliance_item'
  then return 'public_auth';  -- DECISIÓN Dirección: endurecer a 'staff' con cliente_b2b
```

Las entidades `purchase_order`, `supplier_invoice`, `vendor`, `fleet_vehicle`,
`warehouse` y `compliance_item` se proyectan con `visibility_key = 'public_auth'`,
lo que significa que **cualquier usuario autenticado con `knowledge.view`** puede
verlas en el timeline (incluyendo roles con acceso limitado).

**Opciones:**

| Opción | Valor | Efecto |
|--------|-------|--------|
| A (default spec) | `'public_auth'` | Todo usuario autenticado con `knowledge.view` ve estas entidades |
| B (conservador) | `'staff'` | Solo staff interno; `cliente_b2b` excluido |

**Si se elige opción B**, editar en `0108_knowledge_rpc.sql` **antes de aplicarlo**:

```sql
-- Cambiar línea 56 de:
then return 'public_auth';
-- a:
then return 'staff';
```

El mismo `visibility_key` aplica a las entidades proyectadas por `audit_log` hacia
`knowledge_events`. Una vez aplicado el backfill, cambiar la visibilidad requiere
actualizar las filas ya insertadas en `knowledge_events`.

> **Verificar ANTES de decidir D-1 — literales reales en `audit_log`**
>
> La función `knowledge_visibility_for` hace un `CASE` exacto contra los literales
> `'purchase_order'`, `'supplier_invoice'`, `'vendor'`, `'fleet_vehicle'`,
> `'warehouse'`, `'compliance_item'`. Si `audit_log.entity` usa otros literales
> (p.ej. en español: `'orden'`, `'proveedor'`, etc.), esas filas caen al `default 'staff'`
> y D-1 **no las afecta**. Confirmar qué literales existen en prod antes de decidir:
>
> ```sql
> SELECT DISTINCT entity FROM audit_log ORDER BY entity;
> ```
>
> Si los literales en prod no coinciden exactamente con los del `CASE`, la decisión
> D-1 (`'public_auth'` → `'staff'`) solo afecta las filas que sí coinciden; las demás
> ya caen al default `'staff'` independientemente de la opción elegida.

**Decisión de Dirección (marcar antes de aplicar):**
- [ ] Opción A — mantener `public_auth`
- [ ] Opción B — endurecer a `staff`

---

## 3. Orden de aplicación (R-H)

Aplicar en este orden exacto. Esperar el mensaje `Success. No rows returned` (o similar)
antes de continuar con el siguiente.

```
0106_knowledge_module_enum.sql      ← F0.5.0 (si no está aplicada)
0107_knowledge_core.sql             ← F0.5.0 (si no está aplicada)
0108_knowledge_rpc.sql              ← F0.5.1 ← APLICAR AQUÍ
0109_knowledge_projection_triggers.sql ← F0.5.1
0110_knowledge_rbac_seed.sql        ← F0.5.0 (si no está aplicada; no depende de 0108/0109)
0111_knowledge_views.sql            ← F0.5.1
```

> **Nota sobre 0110:** la migración 0110 (`knowledge_rbac_seed`) fue entregada como parte
> de F0.5.0 y no tiene dependencia DDL con 0108/0109 (solo inserta permisos y grants
> en tablas de RBAC que existen desde 0009). Puede aplicarse en cualquier momento
> después de 0107, pero por orden numérico va entre 0109 y 0111.

**Pegar el contenido de cada archivo completo** en el SQL Editor y ejecutar.
No fragmentar archivos. No saltar archivos.

---

## 4. Smokes de verificación (POST-aplicación)

Ejecutar en orden después de aplicar los 3 archivos de F0.5.1 (0108, 0109, 0111).

### 4.1 Positivo — Proyección en vivo desde `audit_log`

Insertar una fila de prueba en `audit_log` y verificar que el trigger la proyecta
automáticamente hacia `knowledge_events` y aparece en `v_knowledge_timeline`.

```sql
-- PASO A: Insertar fila de prueba.
-- Columnas reales de public.audit_log (0001_init.sql:154):
--   id bigserial PK (autoincrement), ts timestamptz, user_id uuid,
--   entity text, entity_id uuid, action text, payload jsonb, ip text.
INSERT INTO public.audit_log (entity, entity_id, action, payload)
VALUES (
  'test_smoke',
  NULL,             -- entity_id puede ser NULL (ver constraint)
  'create',
  '{"smoke": "F0.5.1", "note": "borrar post-verificacion"}'::jsonb
);

-- PASO B: Verificar que aparece en el timeline.
SELECT id, seq, event_type, entity_type, entity_id,
       visibility_key, source_table, occurred_at
FROM public.v_knowledge_timeline
WHERE source_table = 'audit_log'
ORDER BY seq DESC
LIMIT 5;
```

**Resultado esperado (fila top):**
- `event_type` = `'audit.create'`
- `entity_type` = `'test_smoke'`
- `source_table` = `'audit_log'`
- `visibility_key` = `'staff'` (entidad no mapeada → default conservador en `knowledge_visibility_for`)

Si no aparece ninguna fila nueva, verificar que `knowledge_sources.enabled = true` para `audit_log`
(ver smoke 4.3) y que el trigger `tg_project_audit_log` existe sobre `audit_log`.

### 4.2 Backfill idempotente

```sql
-- Primera corrida: proyecta hasta 100 filas existentes en audit_log.
SELECT public.knowledge_backfill_audit_log(100);

-- Segunda corrida inmediata: debe devolver 0 (sin duplicados).
-- La unicidad está garantizada por knowledge_events_idem_uq (source_table, source_pk, event_type).
SELECT public.knowledge_backfill_audit_log(100);
```

**Resultado esperado:** primera corrida devuelve `N >= 0` (filas nuevas materializadas);
segunda corrida devuelve exactamente `0`.

### 4.3 Gate de habilitación (`enabled` flag)

```sql
-- PASO A: Deshabilitar la fuente.
UPDATE public.knowledge_sources SET enabled = false WHERE source_table = 'audit_log';

-- PASO B: Insertar fila de prueba (NO debe proyectar evento).
INSERT INTO public.audit_log (entity, entity_id, action, payload)
VALUES ('test_gate', NULL, 'update', '{"smoke": "gate-test"}'::jsonb);

-- PASO C: Verificar que NO apareció evento nuevo desde la fila anterior.
SELECT count(*) as nuevos_desde_gate
FROM public.v_knowledge_timeline
WHERE source_table = 'audit_log'
  AND event_type = 'audit.update'
  AND entity_type = 'test_gate';
```

**Resultado esperado:** `nuevos_desde_gate = 0`.

```sql
-- PASO D: Revertir (siempre revertir antes de continuar).
UPDATE public.knowledge_sources SET enabled = true WHERE source_table = 'audit_log';
```

### 4.4 Sub-timeline por entidad (`v_knowledge_entity_360`)

```sql
-- Reemplazar <tipo> y <id> con una entidad real que exista en audit_log.
-- Ejemplo: entity_type = 'order', entity_id = '<uuid de una orden real>'
SELECT event_id, event_type, entity_type, entity_id,
       occurred_at, summary, visibility_key,
       annotation_id, concept_label
FROM public.v_knowledge_entity_360
WHERE entity_type = '<tipo>'
  AND entity_id   = '<id>'
ORDER BY occurred_at DESC
LIMIT 5;
```

**`<tipo>` y `<id>` a completar por Dirección** con un registro real conocido
(ej. una orden reciente o un compliance_item existente).

**Resultado esperado:** filas de `knowledge_events` correspondientes a esa entidad,
con `annotation_id = NULL` (aún no hay anotaciones en F0.5.1).

### 4.5 RLS / Negativo — Usuario sin permiso no ve el timeline

Las vistas `v_knowledge_timeline` y `v_knowledge_entity_360` son `security_invoker`:
respetan RLS del usuario que las consulta. La policy `knowledge_events_select` exige
`has_permission('knowledge.view')`.

**Procedimiento de verificación:**

```sql
-- Opción A: impersonar un usuario sin knowledge.view (ej. cliente_b2b o un usuario de prueba).
-- En el SQL Editor de Supabase, ejecutar como service_role y cambiar el rol:
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "<uuid-usuario-sin-permiso>", "role": "authenticated"}';

SELECT count(*) FROM public.v_knowledge_timeline;
-- Resultado esperado: 0 (RLS bloquea todas las filas) o error de política.

-- Restaurar:
RESET ROLE;
```

> **Nota:** el bloque `SET LOCAL ROLE` simula la identidad de fila; el comportamiento
> exacto depende de cómo PostgREST inyecta el JWT. Para una verificación completa,
> usar un cliente Supabase JS autenticado con un usuario real sin el permiso
> `knowledge.view` y confirmar que `select * from v_knowledge_timeline` devuelve 0 filas.
>
> **`<uuid-usuario-sin-permiso>` a completar por Dirección** con un usuario de prueba
> o con el UUID de un rol `cliente_b2b`.

### 4.6 Advisors (Security & Performance)

Tras aplicar 0111, verificar que no hay nuevos warnings de `security_definer view`
en los Advisors de Supabase. Las vistas entregadas son `security_invoker` (correcto).

```sql
-- Ejecutar get_advisors() — o usar el panel Advisors de la UI de Supabase.
-- Filtrar por categoría 'security' y 'performance'.
-- Resultado esperado: 0 nuevos warnings de security_definer sobre v_knowledge_*.
```

En la UI: Database → Advisors → verificar que no aparecen `v_knowledge_timeline`
ni `v_knowledge_entity_360` en la lista de `SECURITY DEFINER view` warnings.

### 4.7 Realtime — `knowledge_events` en la publicación

```sql
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename = 'knowledge_events';
```

**Resultado esperado:** 1 fila con `tablename = 'knowledge_events'`.

Si no aparece, verificar que 0111 se aplicó correctamente (el bloque `alter publication`
es idempotente y solo lo agrega si no existe).

### 4.8 Limpieza de datos de prueba

Borrar (o anular) las filas de prueba insertadas durante los smokes anteriores:

```sql
-- audit_log es append-only por convención operativa, pero NO tiene trigger de forbid_delete
-- (solo knowledge_events y knowledge_annotations son append-only DDL).
-- Si se quiere anonimizar en lugar de borrar, actualizar payload:
UPDATE public.audit_log
SET payload = '{"smoke": "BORRADO", "note": "datos de prueba F0.5.1"}'::jsonb
WHERE entity IN ('test_smoke', 'test_gate')
  AND action IN ('create', 'update');

-- Verificar cuántas filas se actualizaron:
SELECT id, entity, action, payload FROM public.audit_log
WHERE entity IN ('test_smoke', 'test_gate')
ORDER BY id DESC;
```

> **Alternativa:** si Dirección prefiere no tocar audit_log (inmutabilidad operativa),
> documentar los `id` de las filas de prueba y excluirlas de consultas de producción
> filtrando por `entity != 'test_smoke'`.

---

## 5. Rollback

Las 3 migraciones de F0.5.1 son **100% aditivas**: solo agregan objetos nuevos,
no modifican DDL existente ni datos de tablas de negocio. El rollback es trivial.

### Rollback rápido (apagar proyección sin DDL)

```sql
-- Deshabilitar la fuente sin eliminar nada. Nuevas filas en audit_log
-- no generarán eventos. Los eventos ya materializados permanecen.
UPDATE public.knowledge_sources SET enabled = false WHERE source_table = 'audit_log';
```

### Rollback completo (eliminar objetos DDL de F0.5.1)

```sql
-- 1) Eliminar trigger de proyección (0109).
DROP TRIGGER IF EXISTS tg_project_audit_log ON public.audit_log;

-- 2) Eliminar funciones de 0108 y 0109.
DROP FUNCTION IF EXISTS public.knowledge_visibility_for(text, text);
DROP FUNCTION IF EXISTS public.knowledge_emit_event(public.knowledge_event_canonical);
DROP FUNCTION IF EXISTS public.knowledge_audit_log_to_canonical(public.audit_log);
DROP FUNCTION IF EXISTS public.project_audit_log();
DROP FUNCTION IF EXISTS public.knowledge_backfill_audit_log(int);

-- 3) Eliminar tipo compuesto de 0108.
DROP TYPE IF EXISTS public.knowledge_event_canonical;

-- 4) Eliminar vistas de 0111.
DROP VIEW IF EXISTS public.v_knowledge_entity_360;
DROP VIEW IF EXISTS public.v_knowledge_timeline;

-- 5) Opcional: eliminar registro de la fuente en el Source Registry.
DELETE FROM public.knowledge_sources WHERE source_table = 'audit_log';
```

> **IMPORTANTE:** el rollback NO elimina las tablas `knowledge_events`, `knowledge_sources`,
> `knowledge_annotations`, `knowledge_entities` ni ninguna otra tabla fuente.
> Esos objetos pertenecen a F0.5.0 (0107) y son independientes de F0.5.1.
> Si se quiere revertir también F0.5.0, requiere una sesión de rollback separada.

---

## 6. Resumen de objetos entregados en F0.5.1

| Archivo | Objetos creados/modificados |
|---------|----------------------------|
| `0108_knowledge_rpc.sql` | `TYPE public.knowledge_event_canonical`, `FUNCTION knowledge_visibility_for(text,text)`, `FUNCTION knowledge_emit_event(knowledge_event_canonical)` |
| `0109_knowledge_projection_triggers.sql` | `INSERT INTO knowledge_sources` (registro fuente), `FUNCTION knowledge_audit_log_to_canonical(audit_log)`, `FUNCTION project_audit_log()`, `TRIGGER tg_project_audit_log ON audit_log`, `FUNCTION knowledge_backfill_audit_log(int)` |
| `0111_knowledge_views.sql` | `VIEW v_knowledge_timeline` (security_invoker), `VIEW v_knowledge_entity_360` (security_invoker), `ALTER PUBLICATION supabase_realtime ADD TABLE knowledge_events` |

---

*Checklist generado: 2026-06-28 · F0.5.1 · TOPS Nexus Knowledge Layer*
