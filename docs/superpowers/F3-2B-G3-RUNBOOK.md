# Runbook G3 — Aplicación de Nexus Link RC1 (migraciones 0142–0155)

> **Estado:** PREPARADO, NO EJECUTADO. Ejecutar SOLO tras autorización explícita de Dirección para la ventana G3.
> **Ejecutor:** cualquier integrante con acceso al SQL Editor del proyecto prod. Seguir este documento paso a paso, sin improvisar.
> **Proyecto autorizado (ÚNICO):** `tops-ordenes-prod` = `arsksytgdnzukbmfgkju` = `https://arsksytgdnzukbmfgkju.supabase.co`. **STOP** si el editor apunta a otro proyecto.
> **Rama del código:** `feat/nexus-link-integration` (commit `5093ecc`). Las migraciones viven en `supabase/migrations/`.

## 0. Alcance y principios
- Aplicar **13 migraciones** en orden: `0142`→`0155` (bloque connect + RBAC piloto). Todo **aditivo/greenfield** (connect no existe en prod → 0 regresión a módulos existentes).
- **Método:** aplicación MANUAL en el SQL Editor de Supabase, **un archivo por vez**, validando entre pasos.
- **Duración estimada total:** < 5 minutos de ejecución (operaciones de metadata sobre tablas vacías/pequeñas). Sin ventana de downtime.
- **Punto de restauración (marcar ANTES de empezar):** PITR LSN de referencia previo = **`29/17000060`** (2026-07-01 00:01 UTC). Registrar el LSN/timestamp REAL al inicio de la ventana (cambia con el tiempo).

## 1. Pre-flight gate (obligatorio antes de aplicar)
Ejecutar y confirmar CADA punto:
```sql
-- P1: proyecto correcto + estado de migraciones (prod numera por TIMESTAMP)
select current_database(),
       (select count(*) from supabase_migrations.schema_migrations) as migs,
       (select max(version) from supabase_migrations.schema_migrations) as ultima;
-- ESPERADO: ultima = '20260630040905' (0141_compliance_cases). Si es MAYOR → prod se movió → PARAR y re-evaluar.

-- P2: connect es greenfield (no debe existir nada connect)
select count(*) as connect_objs from information_schema.tables where table_schema='public' and table_name like 'connect\_%';
-- ESPERADO: 0. Si > 0 → PARAR (connect ya parcialmente aplicado).

-- P3: dependencias presentes (Knowledge vivo + RBAC base)
select
  (select count(*) from information_schema.routines where routine_name='knowledge_emit_event') as emisor,
  (select count(*) from information_schema.tables where table_name='knowledge_events') as knowledge,
  (select count(*) from information_schema.routines where routine_name='has_permission') as rbac;
-- ESPERADO: emisor=1, knowledge=1, rbac>=1.

-- P4: PITR sano (red de seguridad)
select case when (select last_archived_time from pg_stat_archiver) > now()-interval '10 min'
            and (select failed_count from pg_stat_archiver)=0
       then 'PITR OK' else 'PITR REVISAR' end;
-- ESPERADO: 'PITR OK'. Registrar pg_current_wal_lsn() como restore point.
```
Checklist pre-flight: [ ] proyecto correcto · [ ] ultima=0141 · [ ] connect greenfield · [ ] deps OK · [ ] PITR OK · [ ] backup lógico confirmado (dashboard) · [ ] autorización G3.

## 2. Secuencia de ejecución con checkpoints
> Para cada paso: (1) abrir el archivo `supabase/migrations/<mig>.sql`, (2) pegar su contenido íntegro en el SQL Editor, (3) ejecutar, (4) correr la validación del checkpoint, (5) solo avanzar si PASA.

| Paso | Migración(es) | Checkpoint | Validación (SQL read-only) |
|---|---|---|---|
| **1** | `0142` (tx aislada) | C1: enum | `select 'connect' = any(enum_range(null::permission_module_t)::text[]) as ok;` → true |
| **2** | `0143` | C2: 11 tablas + RLS | `select count(*) from information_schema.tables where table_schema='public' and table_name like 'connect\_%';` → 11 · `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'connect\_%' and c.relrowsecurity;` → 11 |
| **3** | `0144` | C3: RPCs + trigger | `select count(*) from information_schema.routines where routine_schema='public' and routine_name like 'connect\_%';` → ≥15 |
| **4** | `0145` | C4: vistas | `select count(*) from information_schema.views where table_schema='public' and table_name like 'v_connect\_%';` → 3 |
| **5** | `0146` | C5: permisos | `select count(*) from public.permissions where slug like 'connect.%';` → 5 |
| **6** | `0147` | C6: notif + realtime | `select count(*) from information_schema.columns where table_name='notifications' and column_name in ('priority','remind_at','delegated_to');` → 3 · `select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='connect_messages';` → 1 |
| **7** | `0148` | C7: buckets | `select count(*) from storage.buckets where id in ('connect-files','connect-files-pii');` → 2 |
| **8** | `0149` | C8: adapter | `select count(*) from information_schema.routines where routine_name in ('project_connect_links','knowledge_backfill_connect_links');` → 2 |
| **9** | `0150`,`0151`,`0152`,`0153` | C9: RPCs feature | `select count(*) from information_schema.routines where routine_name in ('connect_join_channel','connect_get_or_create_entity_conversation','connect_search');` → 3 |
| **10** | `0154` | C10: profiles | `select count(*) from information_schema.columns where table_name='profiles' and column_name in ('avatar_url','presence_status','profile_meta','notif_freq_default');` → 4 |
| **11** | `0155` | C11: RBAC piloto | `select count(distinct ur.user_id) from public.user_roles ur join public.roles ro on ro.id=ur.role_id where ro.slug in ('admin','director_ops','gerencia','jefe_deposito','operaciones','comercial','compliance','seguridad','rrhh_admin');` → **7** (usuarios que verán Nexus Link) |

## 3. Criterios de abortar
Abortar la ventana y pasar a Rollback (§4) si: cualquier migración devuelve **error**; un checkpoint **no da el valor esperado**; `get_advisors(security)` reporta un **nuevo crítico**; el smoke de fail-closed (§5) **falla**; `schema_migrations` muestra una **migración inesperada** durante la ventana.

## 4. Rollback paso a paso (orden inverso, idempotente)
> Solo si se aborta. Ejecutar en el SQL Editor. Todo `if exists`. El enum `0142` **permanece** (inerte). Red final: **PITR restore** al LSN registrado en §1.
```sql
-- 0155/0146: quitar catálogo RBAC connect
delete from public.role_permissions rp using public.permissions p where rp.permission_id=p.id and p.slug like 'connect.%';
delete from public.permissions where slug like 'connect.%';
-- 0154: columnas profiles
alter table public.profiles drop column if exists avatar_url, drop column if exists presence_status,
  drop column if exists profile_meta, drop column if exists notif_freq_default, drop column if exists last_activity_at;
-- 0147: columnas notifications + publicación
alter table public.notifications drop column if exists priority, drop column if exists remind_at, drop column if exists delegated_to;
-- (ALTER PUBLICATION supabase_realtime DROP TABLE public.connect_messages, connect_conversations, connect_participants;)
-- 0148: buckets (BACKUP de binarios ANTES si hubiera; en apply limpio están vacíos)
delete from storage.buckets where id in ('connect-files','connect-files-pii');
-- 0143-0153: funciones + tablas connect (cascade)  → drop de las 11 tablas connect_* + funciones connect_*/_connect_*
--   drop function if exists ... ; drop table if exists public.connect_<t> cascade;  (usar ROLLBACK_0142_0149.md como base + extender a 0150-0155)
-- 0142: NO reversible (enum) — queda inerte.
```
Referencia: `supabase/migrations/ROLLBACK_0142_0149.md` (extender a 0150–0155). Datos de runtime: no existen en un apply limpio (greenfield).

## 5. Smoke tests (post-apply, read-only salvo indicado)
```sql
-- S1: fail-closed — RLS niega a no-miembro/no-permiso (correr como usuario real, NO como postgres)
--     begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid_sin_connect>"}';
--     select count(*) from public.connect_conversations;  -- ESPERADO: 0 ; rollback;
-- S2: cobertura RBAC — usuarios que ven connect
select count(distinct ur.user_id) as usuarios_connect from public.user_roles ur join public.roles ro on ro.id=ur.role_id
where ro.slug in ('admin','director_ops','gerencia','jefe_deposito','operaciones','comercial','seguridad','compliance','rrhh_admin');
-- ESPERADO: 7
-- S3: externos SIN connect
select count(*) as externos_con_connect from public.role_permissions rp
join public.roles ro on ro.id=rp.role_id join public.permissions p on p.id=rp.permission_id
where p.slug like 'connect.%' and ro.slug in ('cliente_b2b','employee_self_service','rrhh_manager','rrhh_viewer');
-- ESPERADO: 0
-- S4: advisors
--   get_advisors(security) y get_advisors(performance) → sin nuevos críticos.
-- S5 (opcional, mutación en tx con rollback): probar connect_get_or_create_entity_conversation en un savepoint y hacer rollback.
```

## 6. Validaciones posteriores + Deploy
- Confirmar `schema_migrations` incorporó las 13 migraciones (nuevos timestamps).
- `get_advisors` security/performance limpios.
- **Deploy de UI (paso SEPARADO, post-apply):** las páginas/nav de `/connect` viven solo tras el deploy (Netlify CLI manual). Aplicar migraciones NO expone la UI. Deploy = decisión/acción de Dirección tras validar la capa DB.
- Registrar en el Run Log de F3.2B: timestamps aplicados, checkpoints, resultados de smoke, LSN pre/post.

## 7. Resumen operativo
- **Riesgo:** BAJO (aditivo/greenfield, segundos, sin downtime, PITR vivo). Único irreversible = enum 0142 (benigno).
- **Prerrequisitos de la ventana:** rama ✓ · backup lógico (dashboard) · autorización G3.
- **Resultado esperado:** capa DB de Nexus Link viva en prod; 7/10 usuarios habilitados; UI pendiente de deploy.
