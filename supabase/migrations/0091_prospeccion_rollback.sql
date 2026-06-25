-- =========================================================================
-- 0091_prospeccion_rollback — Rollback espejo de F0 (0088 + 0089)
-- =========================================================================
-- Deshace el núcleo de Prospección F0 de forma idempotente. ADVERTENCIA: destructivo
-- (borra prospectos, eventos y bitácora). Aplicar SOLO con aprobación explícita.
--
-- LIMITACIÓN DE POSTGRES: un valor agregado a un enum (permission_module_t='prospeccion',
-- agregado en 0088) NO se puede quitar. Permanece. El enum prospeccion_status_t SÍ se
-- puede drop-ear una vez que ninguna columna lo referencia (tras drop de prospeccion_prospects).
-- =========================================================================

-- ---- RPC ----------------------------------------------------------------
drop function if exists public.prospeccion_ingest(jsonb, text);

-- ---- Triggers + función de short_id -------------------------------------
drop trigger if exists trg_prospeccion_prospects_touch    on public.prospeccion_prospects;
drop trigger if exists trg_prospeccion_prospects_short_id on public.prospeccion_prospects;
drop trigger if exists trg_prospeccion_crm_refs_touch     on public.prospeccion_crm_refs;
drop function if exists public.prospeccion_set_short_id();

-- ---- Policies (idempotente) ---------------------------------------------
drop policy if exists "prospeccion_sources select"   on public.prospeccion_sources;
drop policy if exists "prospeccion_sources insert"   on public.prospeccion_sources;
drop policy if exists "prospeccion_sources update"   on public.prospeccion_sources;
drop policy if exists "prospeccion_sources delete"   on public.prospeccion_sources;
drop policy if exists "prospeccion_prospects select" on public.prospeccion_prospects;
drop policy if exists "prospeccion_prospects insert" on public.prospeccion_prospects;
drop policy if exists "prospeccion_prospects update" on public.prospeccion_prospects;
drop policy if exists "prospeccion_prospects delete" on public.prospeccion_prospects;
drop policy if exists "prospeccion_crm_refs select"  on public.prospeccion_crm_refs;
drop policy if exists "prospeccion_crm_refs delete"  on public.prospeccion_crm_refs;

-- ---- Tablas (orden por FK; crm_refs→prospects, events/jobs sin FK al resto) ----
drop table if exists public.prospeccion_events;
drop table if exists public.prospeccion_import_jobs;
drop table if exists public.prospeccion_crm_refs;    -- FK a prospects (on delete cascade): se dropea antes
drop table if exists public.prospeccion_prospects;   -- libera prospeccion_status_t y la FK a sources
drop table if exists public.prospeccion_sources;

-- ---- Secuencia ----------------------------------------------------------
drop sequence if exists public.prospeccion_prospect_seq;

-- ---- Enum de estado (ya sin columnas que lo usen) -----------------------
drop type if exists public.prospeccion_status_t;

-- ---- Seed RBAC (borrar role_permissions ANTES que permissions por la FK) -
delete from public.role_permissions rp
using public.permissions p
where rp.permission_id = p.id
  and p.slug in ('prospeccion.view','prospeccion.create','prospeccion.edit',
                 'prospeccion.delete','prospeccion.admin');

delete from public.permissions
where slug in ('prospeccion.view','prospeccion.create','prospeccion.edit',
               'prospeccion.delete','prospeccion.admin');

-- ---- NO se quita el valor de enum permission_module_t='prospeccion' -------
-- Postgres no soporta DROP VALUE en un enum. Queda como huérfano benigno (sin filas
-- en permissions que lo usen tras el delete de arriba). Es inocuo.

notify pgrst, 'reload schema';
