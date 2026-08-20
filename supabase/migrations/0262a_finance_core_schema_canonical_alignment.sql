-- =========================================================================
-- 0262a_finance_core_schema_canonical_alignment.sql
--
-- Expediente: "Remediación del Incidente de Provenance 0262 — Alineación Canónica y Endurecimiento ACL"
-- Autoridad: Dirección Técnica Nexus.
-- Régimen: Aditivo forward-only, dual-state exhaustivo, ACL mínimo privilegio, RLS estricto, fail-closed.
--
-- Propósito:
--   1. Alinear el esquema de base de datos con el contrato canónico autenticado
--      de 0262_finance_core_foundation.sql (SHA-256: 1908587594777b7e9dfd6b2d629f578a6b0edc1985b0f4f47b36038879a42d63).
--   2. Endurecer la ACL de las 10 tablas financieras eliminando privilegios excesivos
--      (TRUNCATE, REFERENCES, TRIGGER de authenticated, y todo privilegio de anon y PUBLIC),
--      estableciendo exactamente SELECT, INSERT, UPDATE, DELETE para authenticated.
--
-- Garantías de Seguridad:
--   - Cero CASCADE: Todas las eliminaciones son estrictamente restrictivas (DROP TABLE ... RESTRICT).
--   - Detección exhaustiva fail-closed de FKs externas, vistas (en cualquier schema),
--     vistas materializadas, triggers de usuario, funciones dependientes y publicaciones.
--   - Identificación dual-state exacta: Comprobación exhaustiva del manifest de las 10 tablas
--     (columnas, tipos, nullability, defaults, constraints, índices, RLS, FORCE RLS, políticas, grants).
--   - Verificación exhaustiva de semillas (códigos, nombres, valores y atributos exactos).
--   - Endurecimiento permanente de ACL: Revocación total a PUBLIC/anon y restricción a 4 privilegios.
-- =========================================================================

do $$
declare
  v_count integer;
  v_dep_count integer;
  v_is_canonical boolean := false;
  v_is_divergent boolean := false;
  v_current_manifest jsonb;
begin
  -- =======================================================================
  -- 1. PRESONDAS FAIL-CLOSED: INTEGRIDAD DE TABLAS Y SEMILLAS
  -- =======================================================================

  -- 1.1 Verificar existencia exclusiva de las 10 tablas finance_%
  select count(*) into v_count
  from information_schema.tables
  where table_schema = 'public'
    and table_name like 'finance_%'
    and table_type = 'BASE TABLE';

  if v_count <> 10 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Se esperaban exactamente 10 tablas finance_*, encontradas: %', v_count;
  end if;

  -- 1.2 Verificar que las 7 tablas transaccionales estén estrictamente vacías
  select count(*) into v_count from public.finance_assumptions;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_assumptions contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_plan_lines;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_plan_lines contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_forecast_adjustments;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_forecast_adjustments contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_scenarios;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_scenarios contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_report_snapshots;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_report_snapshots contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_document_inbox;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_document_inbox contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_quicken_imports;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_quicken_imports contiene % filas', v_count; end if;

  -- 1.3 Verificar integridad y atributos exactos de versión semilla en finance_versions (1 fila)
  select count(*) into v_count from public.finance_versions;
  if v_count <> 1 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_versions contiene % filas (esperada: 1)', v_count;
  end if;
  if not exists (
    select 1 from public.finance_versions
    where code = 'BUDGET-2026-V1'
      and name = 'Presupuesto Operativo 2026 v1.0'
      and status = 'approved'
      and valid_from = '2026-01-01'
      and valid_to = '2026-12-31'
      and is_active = true
  ) then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Versión semilla BUDGET-2026-V1 inválida o alterada';
  end if;

  -- 1.4 Verificar integridad y atributos exactos de categorías semilla en finance_categories (13 filas exactas)
  select count(*) into v_count from public.finance_categories;
  if v_count <> 13 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_categories contiene % filas (esperadas: 13)', v_count;
  end if;
  select count(*) into v_count
  from public.finance_categories
  where (code = 'ING_FLETES' and name = 'Ingresos por Fletes y Distribución' and display_order = 10 and is_active = true and parent_id is null)
     or (code = 'ING_ALMACEN' and name = 'Ingresos por Almacenamiento y M2' and display_order = 20 and is_active = true and parent_id is null)
     or (code = 'ING_LOG_FARMACIA' and name = 'Ingresos Logística Farmacéutica ANMAT' and display_order = 30 and is_active = true and parent_id is null)
     or (code = 'ING_SERVICIOS_ESP' and name = 'Ingresos por Servicios Especiales' and display_order = 40 and is_active = true and parent_id is null)
     or (code = 'EGR_SUELDOS' and name = 'Sueldos y Cargas Sociales' and display_order = 100 and is_active = true and parent_id is null)
     or (code = 'EGR_COMBUSTIBLE' and name = 'Combustible y Peajes' and display_order = 110 and is_active = true and parent_id is null)
     or (code = 'EGR_MANTENIMIENTO' and name = 'Mantenimiento de Flota y Edilicio' and display_order = 120 and is_active = true and parent_id is null)
     or (code = 'EGR_SEGUROS' and name = 'Seguros y Pólizas de Carga' and display_order = 130 and is_active = true and parent_id is null)
     or (code = 'EGR_ALQUILERES' and name = 'Alquileres de Depósitos' and display_order = 140 and is_active = true and parent_id is null)
     or (code = 'EGR_IMPUESTOS' and name = 'Impuestos, Tasas y AFIP/ARBA' and display_order = 150 and is_active = true and parent_id is null)
     or (code = 'EGR_HONORARIOS' and name = 'Honorarios Profesionales y Asesoría' and display_order = 160 and is_active = true and parent_id is null)
     or (code = 'EGR_SERVICIOS' and name = 'Servicios Públicos e Internet' and display_order = 170 and is_active = true and parent_id is null)
     or (code = 'EGR_OTROS' and name = 'Otros Gastos Operativos' and display_order = 180 and is_active = true and parent_id is null);
  if v_count <> 13 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Atributos de semillas de finance_categories incompletos o divergentes';
  end if;

  -- 1.5 Verificar integridad y atributos exactos de centros de costo en finance_cost_centers (5 filas exactas)
  select count(*) into v_count from public.finance_cost_centers;
  if v_count <> 5 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_cost_centers contiene % filas (esperadas: 5)', v_count;
  end if;
  select count(*) into v_count
  from public.finance_cost_centers
  where (code = 'CC_CARGAS_GEN' and name = 'Operaciones Cargas Generales' and is_active = true)
     or (code = 'CC_ANMAT' and name = 'Operaciones Reguladas ANMAT' and is_active = true)
     or (code = 'CC_DEPOSITO' and name = 'Depósito y Almacenamiento' and is_active = true)
     or (code = 'CC_DISTRIB' and name = 'Distribución Urbana y Flota' and is_active = true)
     or (code = 'CC_ADMIN_CORP' and name = 'Administración y Corporativo' and is_active = true);
  if v_count <> 5 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Atributos de semillas de finance_cost_centers incompletos o divergentes';
  end if;

  -- 1.6 Verificar permisos RBAC finanzas.* (4 permisos)
  select count(*) into v_count
  from public.permissions
  where slug in ('finanzas.view', 'finanzas.plan', 'finanzas.approve', 'finanzas.admin');
  if v_count <> 4 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Permisos RBAC finanzas.* incompletos (encontrados: %)', v_count;
  end if;

  -- =======================================================================
  -- 2. PRESONDAS EXHAUSTIVAS DE DEPENDENCIAS (Fail-Closed, Anti-CASCADE)
  -- =======================================================================

  -- 2.1 Foreign Keys entrantes desde tablas ajenas a las 7 tablas transaccionales
  select count(*) into v_dep_count
  from pg_constraint c
  join pg_class r_from on r_from.oid = c.conrelid
  join pg_class r_to on r_to.oid = c.confrelid
  join pg_namespace ns_from on ns_from.oid = r_from.relnamespace
  join pg_namespace ns_to on ns_to.oid = r_to.relnamespace
  where c.contype = 'f'
    and ns_to.nspname = 'public'
    and r_to.relname in (
      'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
      'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
    )
    and not (
      ns_from.nspname = 'public' and r_from.relname in (
        'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
        'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
      )
    );
  if v_dep_count > 0 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Existen % foreign keys externas entrantes hacia tablas financieras', v_dep_count;
  end if;

  -- 2.2 Vistas o Vistas Materializadas en cualquier schema que dependan de las tablas financieras
  select count(distinct v.oid) into v_dep_count
  from pg_depend d
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class v on v.oid = rw.ev_class
  join pg_namespace ns_v on ns_v.oid = v.relnamespace
  join pg_class t on t.oid = d.refobjid
  join pg_namespace ns_t on ns_t.oid = t.relnamespace
  where ns_t.nspname = 'public'
    and t.relname in (
      'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
      'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
    )
    and v.relkind in ('v', 'm')
    and v.oid <> t.oid;
  if v_dep_count > 0 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Existen % vistas o vistas materializadas dependientes', v_dep_count;
  end if;

  -- 2.3 Triggers de usuario no internos en tablas financieras
  select count(*) into v_dep_count
  from pg_trigger tr
  join pg_class t on t.oid = tr.tgrelid
  join pg_namespace ns on ns.oid = t.relnamespace
  where ns.nspname = 'public'
    and t.relname in (
      'finance_versions', 'finance_categories', 'finance_cost_centers',
      'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
      'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
    )
    and not tr.tgisinternal;
  if v_dep_count > 0 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Existen % triggers de usuario no autorizados en tablas financieras', v_dep_count;
  end if;

  -- 2.4 Funciones / procedimientos dependientes (incluyendo tipos compuestos de parámetros)
  select count(*) into v_dep_count
  from pg_depend d
  join pg_proc p on p.oid = d.objid
  left join pg_type pt on pt.oid = d.refobjid
  left join pg_class t on (t.oid = d.refobjid or t.oid = pt.typrelid)
  join pg_namespace ns_t on ns_t.oid = t.relnamespace
  join pg_namespace ns_p on ns_p.oid = p.pronamespace
  where ns_t.nspname = 'public'
    and t.relname in (
      'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
      'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
    )
    and ns_p.nspname not in ('pg_catalog', 'information_schema');
  if v_dep_count > 0 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Existen % funciones dependientes de tablas financieras', v_dep_count;
  end if;

  -- 2.5 Publicaciones de replicación
  select count(*) into v_dep_count
  from pg_publication_rel pr
  join pg_class t on t.oid = pr.prrelid
  join pg_namespace ns on ns.oid = t.relnamespace
  where ns.nspname = 'public'
    and t.relname in (
      'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
      'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
    );
  if v_dep_count > 0 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Tablas financieras integran publicaciones (% relaciones)', v_dep_count;
  end if;

  -- =======================================================================
  -- 3. DISCRIMINACIÓN EXHAUSTIVA DE IDENTIDAD DUAL-STATE (10 Tablas)
  -- =======================================================================

  SELECT jsonb_object_agg(
    t.table_name,
    jsonb_build_object(
      'rls', jsonb_build_object(
        'rowsecurity', tm.rowsecurity,
        'forcerowsecurity', tm.forcerowsecurity
      ),
      'columns', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'column_name', c.column_name,
            'data_type', c.data_type,
            'udt_name', c.udt_name,
            'is_nullable', c.is_nullable,
            'column_default', c.column_default
          ) ORDER BY c.column_name
        )
        FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = t.table_name
      ),
      'constraints', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'constraint_name', con.conname,
            'constraint_type', con.contype,
            'definition', pg_get_constraintdef(con.oid, true)
          ) ORDER BY con.conname
        ), '[]'::jsonb)
        FROM pg_constraint con
        JOIN pg_class r ON con.conrelid = r.oid
        JOIN pg_namespace n ON r.relnamespace = n.oid
        WHERE n.nspname = 'public' AND r.relname = t.table_name
          AND (con.contype != 'c' OR con.conname NOT SIMILAR TO '[0-9]+_[0-9]+_[0-9]+_not_null')
      ),
      'indexes', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'indexname', i.relname,
            'indexdef', pg_get_indexdef(i.oid, 0, true)
          ) ORDER BY i.relname
        ), '[]'::jsonb)
        FROM pg_index x
        JOIN pg_class c ON c.oid = x.indrelid
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'public' AND c.relname = t.table_name
      ),
      'policies', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'policyname', p.policyname,
            'cmd', p.cmd,
            'roles', p.roles,
            'qual', p.qual,
            'with_check', p.with_check
          ) ORDER BY p.policyname
        ), '[]'::jsonb)
        FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = t.table_name
      ),
      'grants', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'grantee', g.grantee,
            'privilege_type', g.privilege_type
          ) ORDER BY g.grantee, g.privilege_type
        ), '[]'::jsonb)
        FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public' AND g.table_name = t.table_name
          AND g.grantee = 'authenticated'
      )
    ) ORDER BY t.table_name
  ) INTO v_current_manifest
  FROM (
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'finance_%'
    ORDER BY table_name
  ) t
  LEFT JOIN (
    SELECT c.relname AS table_name, c.relrowsecurity AS rowsecurity, c.relforcerowsecurity AS forcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND c.relname LIKE 'finance_%' AND c.relkind = 'r'
  ) tm ON tm.table_name = t.table_name;

  -- 3.1 Verificación Exhaustiva de Estado A (Canónico con ACL Endurecida de 4 grants)
  if (v_current_manifest->'finance_categories'->'columns' @> '[{"column_name":"category_type","data_type":"text","is_nullable":"NO"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_categories'->'columns') = 8)
     and (jsonb_array_length(v_current_manifest->'finance_categories'->'constraints') = 4)
     and (jsonb_array_length(v_current_manifest->'finance_categories'->'indexes') = 3)
     and (jsonb_array_length(v_current_manifest->'finance_categories'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_categories'->'grants') = 4)
     and (v_current_manifest->'finance_categories'->'constraints' @> '[{"constraint_name":"finance_categories_category_type_check"}]'::jsonb)

     and (v_current_manifest->'finance_cost_centers'->'columns' @> '[{"column_name":"business_line","data_type":"text","is_nullable":"NO"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'columns') = 6)
     and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'constraints') = 3)
     and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'indexes') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'grants') = 4)

     and (v_current_manifest->'finance_plan_lines'->'columns' @> '[{"column_name":"period","data_type":"text","is_nullable":"NO"},{"column_name":"amount","column_default":"0"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'columns') = 10)
     and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'constraints') = 5)
     and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'indexes') = 3)
     and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'grants') = 4)

     and (v_current_manifest->'finance_forecast_adjustments'->'columns' @> '[{"column_name":"date","data_type":"date","is_nullable":"NO"},{"column_name":"matched_movement_id","data_type":"uuid","is_nullable":"YES"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'columns') = 22)
     and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'constraints') = 5)
     and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'indexes') = 4)
     and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'grants') = 4)

     and (v_current_manifest->'finance_assumptions'->'columns' @> '[{"column_name":"driver_key","data_type":"text","is_nullable":"NO"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'columns') = 12)
     and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'constraints') = 3)
     and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'indexes') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'grants') = 4)

     and (v_current_manifest->'finance_scenarios'->'columns' @> '[{"column_name":"base_scenario_id","data_type":"uuid","is_nullable":"YES"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'columns') = 10)
     and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'constraints') = 3)
     and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'indexes') = 1)
     and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'grants') = 4)

     and (v_current_manifest->'finance_report_snapshots'->'columns' @> '[{"column_name":"period","data_type":"text","is_nullable":"NO"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'columns') = 8)
     and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'constraints') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'indexes') = 1)
     and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'grants') = 4)

     and (v_current_manifest->'finance_document_inbox'->'columns' @> '[{"column_name":"sender","data_type":"text","is_nullable":"NO"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'columns') = 13)
     and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'constraints') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'indexes') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'grants') = 4)

     and (v_current_manifest->'finance_quicken_imports'->'columns' @> '[{"column_name":"filename","data_type":"text","is_nullable":"NO"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'columns') = 10)
     and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'constraints') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'indexes') = 1)
     and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'grants') = 4)

     and (jsonb_array_length(v_current_manifest->'finance_versions'->'columns') = 14)
     and (jsonb_array_length(v_current_manifest->'finance_versions'->'constraints') = 3)
     and (jsonb_array_length(v_current_manifest->'finance_versions'->'indexes') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_versions'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_versions'->'grants') = 4)

     and (v_current_manifest->'finance_categories'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_cost_centers'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_plan_lines'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_forecast_adjustments'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_assumptions'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_scenarios'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_report_snapshots'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_document_inbox'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_quicken_imports'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_versions'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
  then
    -- Verificar que no haya grants a anon o public
    select count(*) into v_count
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name like 'finance_%'
      and grantee in ('anon', 'public');

    if v_count = 0 then
      v_is_canonical := true;
    end if;
  end if;

  -- 3.2 Verificación Exhaustiva de Estado B (Divergente Remoto Certificado)
  if (v_current_manifest->'finance_categories'->'columns' @> '[{"column_name":"category_type","udt_name":"finance_direction_t","is_nullable":"NO"},{"column_name":"pnl_section","data_type":"text","is_nullable":"YES"},{"column_name":"cash_flow_section","data_type":"text","is_nullable":"YES"},{"column_name":"updated_at","data_type":"timestamp with time zone","is_nullable":"NO"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_categories'->'columns') = 11)
     and (jsonb_array_length(v_current_manifest->'finance_categories'->'constraints') = 3)
     and (jsonb_array_length(v_current_manifest->'finance_categories'->'indexes') = 3)
     and (jsonb_array_length(v_current_manifest->'finance_categories'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_categories'->'grants') in (4, 7))
     and (v_current_manifest->'finance_categories'->'grants' @> '[{"privilege_type":"SELECT"},{"privilege_type":"INSERT"},{"privilege_type":"UPDATE"},{"privilege_type":"DELETE"}]'::jsonb)
     and not (v_current_manifest->'finance_categories'->'constraints' @> '[{"constraint_name":"finance_categories_category_type_check"}]'::jsonb)

     and (v_current_manifest->'finance_cost_centers'->'columns' @> '[{"column_name":"business_line","data_type":"text","is_nullable":"YES"},{"column_name":"manager_id","data_type":"uuid","is_nullable":"YES"},{"column_name":"updated_at","data_type":"timestamp with time zone","is_nullable":"NO"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'columns') = 8)
     and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'constraints') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'indexes') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'grants') in (4, 7))
     and (v_current_manifest->'finance_cost_centers'->'grants' @> '[{"privilege_type":"SELECT"},{"privilege_type":"INSERT"},{"privilege_type":"UPDATE"},{"privilege_type":"DELETE"}]'::jsonb)
     and not (v_current_manifest->'finance_cost_centers'->'constraints' @> '[{"constraint_name":"finance_cost_centers_business_line_check"}]'::jsonb)

     and (v_current_manifest->'finance_plan_lines'->'columns' @> '[{"column_name":"period_date","data_type":"date","is_nullable":"NO"},{"column_name":"amount_planned","data_type":"numeric","is_nullable":"NO","column_default":"0"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'columns') = 12)
     and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'constraints') = 5)
     and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'indexes') = 3)
     and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'grants') in (4, 7))
     and (v_current_manifest->'finance_plan_lines'->'grants' @> '[{"privilege_type":"SELECT"},{"privilege_type":"INSERT"},{"privilege_type":"UPDATE"},{"privilege_type":"DELETE"}]'::jsonb)

     and (v_current_manifest->'finance_forecast_adjustments'->'columns' @> '[{"column_name":"forecast_date","data_type":"date","is_nullable":"NO"},{"column_name":"treasury_movement_id","data_type":"uuid","is_nullable":"YES"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'columns') = 19)
     and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'constraints') = 6)
     and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'indexes') = 4)
     and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'grants') in (4, 7))
     and (v_current_manifest->'finance_forecast_adjustments'->'grants' @> '[{"privilege_type":"SELECT"},{"privilege_type":"INSERT"},{"privilege_type":"UPDATE"},{"privilege_type":"DELETE"}]'::jsonb)

     and (v_current_manifest->'finance_assumptions'->'columns' @> '[{"column_name":"key","data_type":"text","is_nullable":"NO"},{"column_name":"value_numeric","data_type":"numeric","is_nullable":"YES"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'columns') = 14)
     and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'constraints') = 3)
     and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'indexes') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'grants') in (4, 7))
     and (v_current_manifest->'finance_assumptions'->'grants' @> '[{"privilege_type":"SELECT"},{"privilege_type":"INSERT"},{"privilege_type":"UPDATE"},{"privilege_type":"DELETE"}]'::jsonb)

     and (v_current_manifest->'finance_scenarios'->'columns' @> '[{"column_name":"code","data_type":"text","is_nullable":"NO"},{"column_name":"is_base_case","data_type":"boolean","is_nullable":"NO"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'columns') = 12)
     and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'constraints') = 3)
     and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'indexes') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'grants') in (4, 7))
     and (v_current_manifest->'finance_scenarios'->'grants' @> '[{"privilege_type":"SELECT"},{"privilege_type":"INSERT"},{"privilege_type":"UPDATE"},{"privilege_type":"DELETE"}]'::jsonb)

     and (v_current_manifest->'finance_report_snapshots'->'columns' @> '[{"column_name":"snapshot_date","data_type":"date","is_nullable":"NO"},{"column_name":"payload","data_type":"jsonb","is_nullable":"NO"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'columns') = 8)
     and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'constraints') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'indexes') = 1)
     and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'grants') in (4, 7))
     and (v_current_manifest->'finance_report_snapshots'->'grants' @> '[{"privilege_type":"SELECT"},{"privilege_type":"INSERT"},{"privilege_type":"UPDATE"},{"privilege_type":"DELETE"}]'::jsonb)

     and (v_current_manifest->'finance_document_inbox'->'columns' @> '[{"column_name":"file_name","data_type":"text","is_nullable":"NO"},{"column_name":"storage_path","data_type":"text","is_nullable":"NO"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'columns') = 13)
     and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'constraints') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'indexes') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'grants') in (4, 7))
     and (v_current_manifest->'finance_document_inbox'->'grants' @> '[{"privilege_type":"SELECT"},{"privilege_type":"INSERT"},{"privilege_type":"UPDATE"},{"privilege_type":"DELETE"}]'::jsonb)

     and (v_current_manifest->'finance_quicken_imports'->'columns' @> '[{"column_name":"file_name","data_type":"text","is_nullable":"NO"},{"column_name":"storage_path","data_type":"text","is_nullable":"NO"}]'::jsonb)
     and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'columns') = 9)
     and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'constraints') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'indexes') = 1)
     and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'grants') in (4, 7))
     and (v_current_manifest->'finance_quicken_imports'->'grants' @> '[{"privilege_type":"SELECT"},{"privilege_type":"INSERT"},{"privilege_type":"UPDATE"},{"privilege_type":"DELETE"}]'::jsonb)

     and (jsonb_array_length(v_current_manifest->'finance_versions'->'columns') = 14)
     and (jsonb_array_length(v_current_manifest->'finance_versions'->'constraints') = 3)
     and (jsonb_array_length(v_current_manifest->'finance_versions'->'indexes') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_versions'->'policies') = 2)
     and (jsonb_array_length(v_current_manifest->'finance_versions'->'grants') in (4, 7))
     and (v_current_manifest->'finance_versions'->'grants' @> '[{"privilege_type":"SELECT"},{"privilege_type":"INSERT"},{"privilege_type":"UPDATE"},{"privilege_type":"DELETE"}]'::jsonb)

     and (v_current_manifest->'finance_categories'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_cost_centers'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_plan_lines'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_forecast_adjustments'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_assumptions'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_scenarios'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_report_snapshots'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_document_inbox'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_quicken_imports'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
     and (v_current_manifest->'finance_versions'->'rls' = '{"rowsecurity":true,"forcerowsecurity":false}'::jsonb)
  then
    v_is_divergent := true;
  end if;

  if not v_is_canonical and not v_is_divergent then
    raise exception 'STOP — 0262a ESTADO HÍBRIDO O NO IDENTIFICABLE: El esquema no coincide unívocamente con Estado A canónico ni con Estado B divergente certificado.';
  end if;

  -- =======================================================================
  -- 4. EJECUCIÓN CONDICIONAL Y ENDURECIMIENTO DE ACL
  -- =======================================================================

  if v_is_canonical then
    -- ESTADO A: Asegurar ACL endurecida como no-op idempotente
    raise notice '0262a: Esquema acreditado en Estado A Canónico. Verificando/endureciendo ACL...';

    revoke all on table
      public.finance_versions,
      public.finance_categories,
      public.finance_cost_centers,
      public.finance_assumptions,
      public.finance_plan_lines,
      public.finance_forecast_adjustments,
      public.finance_scenarios,
      public.finance_report_snapshots,
      public.finance_document_inbox,
      public.finance_quicken_imports
    from public, anon, authenticated;

    grant select, insert, update, delete on table
      public.finance_versions,
      public.finance_categories,
      public.finance_cost_centers,
      public.finance_assumptions,
      public.finance_plan_lines,
      public.finance_forecast_adjustments,
      public.finance_scenarios,
      public.finance_report_snapshots,
      public.finance_document_inbox,
      public.finance_quicken_imports
    to authenticated;

  else
    -- ESTADO B: Aplicación de la alineación canónica exacta y endurecimiento de ACL
    raise notice '0262a: Esquema acreditado en Estado B Divergente. Iniciando alineación canónica y endurecimiento ACL...';

    -- 4.1 Corrección in-place de finance_categories
    alter table public.finance_categories
      drop column pnl_section,
      drop column cash_flow_section,
      drop column updated_at;

    alter table public.finance_categories
      alter column category_type type text using category_type::text;

    alter table public.finance_categories
      add constraint finance_categories_category_type_check
      check (category_type in ('ingreso', 'egreso', 'activo', 'pasivo'));

    alter table public.finance_categories
      drop constraint finance_categories_parent_id_fkey;

    alter table public.finance_categories
      add constraint finance_categories_parent_id_fkey
      foreign key (parent_id) references public.finance_categories(id) on delete restrict;

    -- 4.2 Corrección in-place de finance_cost_centers
    alter table public.finance_cost_centers
      drop column manager_id,
      drop column updated_at;

    alter table public.finance_cost_centers
      alter column business_line set not null;

    alter table public.finance_cost_centers
      add constraint finance_cost_centers_business_line_check
      check (business_line in ('cargas_generales', 'anmat', 'corporativo', 'almacenamiento', 'distribucion'));

    -- 4.3 Eliminación restrictiva (sin CASCADE) de las 7 tablas vacías divergentes
    drop table public.finance_quicken_imports restrict;
    drop table public.finance_document_inbox restrict;
    drop table public.finance_report_snapshots restrict;
    drop table public.finance_scenarios restrict;
    drop table public.finance_forecast_adjustments restrict;
    drop table public.finance_plan_lines restrict;
    drop table public.finance_assumptions restrict;

    -- Table: finance_assumptions (Canónica)
    create table public.finance_assumptions (
      id uuid primary key default gen_random_uuid(),
      version_id uuid not null references public.finance_versions(id) on delete cascade,
      driver_key text not null,
      name text not null,
      category text not null default 'general',
      unit text not null default 'ARS',
      source text,
      value numeric not null default 0,
      period text,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (version_id, driver_key, period)
    );

    -- Table: finance_plan_lines (Canónica)
    create table public.finance_plan_lines (
      id uuid primary key default gen_random_uuid(),
      version_id uuid not null references public.finance_versions(id) on delete cascade,
      category_id uuid not null references public.finance_categories(id) on delete restrict,
      cost_center_id uuid references public.finance_cost_centers(id) on delete set null,
      period text not null, -- YYYY-MM
      amount numeric not null default 0,
      currency public.finance_currency_t not null default 'ARS',
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (version_id, category_id, cost_center_id, period, currency)
    );

    -- Table: finance_forecast_adjustments (Canónica)
    create table public.finance_forecast_adjustments (
      id uuid primary key default gen_random_uuid(),
      date date not null,
      due_date date,
      direction public.finance_direction_t not null,
      amount numeric not null,
      currency public.finance_currency_t not null default 'ARS',
      account_group public.finance_account_group_t not null default 'bancos',
      bank_account_id uuid references public.bank_accounts(id) on delete set null,
      counterpart text,
      concept text not null,
      category_id uuid references public.finance_categories(id) on delete set null,
      cost_center_id uuid references public.finance_cost_centers(id) on delete set null,
      status public.finance_forecast_status_t not null default 'proyectado',
      certainty_level public.finance_certainty_level_t not null default 'alta',
      is_recurring boolean not null default false,
      recurrence_rule text,
      notes text,
      evidence_url text,
      matched_movement_id uuid references public.treasury_movements(id) on delete set null,
      created_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    -- Table: finance_scenarios (Canónica)
    create table public.finance_scenarios (
      id uuid primary key default gen_random_uuid(),
      version_id uuid not null references public.finance_versions(id) on delete cascade,
      name text not null,
      description text,
      base_scenario_id uuid references public.finance_scenarios(id) on delete set null,
      fx_rate_override numeric,
      inflation_override numeric,
      volume_factor numeric not null default 1.0,
      is_active boolean not null default true,
      created_at timestamptz not null default now()
    );

    -- Table: finance_report_snapshots (Canónica)
    create table public.finance_report_snapshots (
      id uuid primary key default gen_random_uuid(),
      period text not null,
      report_type text not null,
      title text not null,
      data jsonb not null,
      version_id uuid references public.finance_versions(id) on delete set null,
      created_by uuid,
      created_at timestamptz not null default now()
    );

    -- Table: finance_document_inbox (Canónica)
    create table public.finance_document_inbox (
      id uuid primary key default gen_random_uuid(),
      sender text not null,
      subject text not null,
      received_at timestamptz not null default now(),
      status text not null check (status in ('borrador', 'en_revision', 'procesado', 'descartado')) default 'borrador',
      extracted_data jsonb not null default '{}'::jsonb,
      raw_email_url text,
      attachment_url text,
      reviewed_by uuid,
      reviewed_at timestamptz,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    -- Table: finance_quicken_imports (Canónica)
    create table public.finance_quicken_imports (
      id uuid primary key default gen_random_uuid(),
      filename text not null,
      file_hash text not null,
      total_records integer not null default 0,
      total_amount_ars numeric not null default 0,
      total_amount_usd numeric not null default 0,
      status text not null check (status in ('preview', 'validated', 'imported', 'failed')) default 'preview',
      summary jsonb not null default '{}'::jsonb,
      created_by uuid,
      created_at timestamptz not null default now()
    );

    -- 4.4 Índices Canónicos
    create index if not exists finance_plan_lines_version_period_idx
      on public.finance_plan_lines (version_id, period);

    create index if not exists finance_forecast_date_idx
      on public.finance_forecast_adjustments (date);

    create index if not exists finance_forecast_status_idx
      on public.finance_forecast_adjustments (status);

    create index if not exists finance_forecast_acc_group_idx
      on public.finance_forecast_adjustments (account_group);

    create index if not exists finance_document_inbox_status_idx
      on public.finance_document_inbox (status);

    create index if not exists finance_categories_type_idx
      on public.finance_categories (category_type);

    -- 4.5 RLS y Políticas Canónicas en las 7 tablas recreadas
    alter table public.finance_assumptions enable row level security;
    alter table public.finance_plan_lines enable row level security;
    alter table public.finance_forecast_adjustments enable row level security;
    alter table public.finance_scenarios enable row level security;
    alter table public.finance_report_snapshots enable row level security;
    alter table public.finance_document_inbox enable row level security;
    alter table public.finance_quicken_imports enable row level security;

    -- Políticas de lectura (finanzas.view)
    create policy "finance_assumptions read" on public.finance_assumptions for select
      using (coalesce(public.has_permission('finanzas.view'), false));

    create policy "finance_plan_lines read" on public.finance_plan_lines for select
      using (coalesce(public.has_permission('finanzas.view'), false));

    create policy "finance_forecast_adjustments read" on public.finance_forecast_adjustments for select
      using (coalesce(public.has_permission('finanzas.view'), false));

    create policy "finance_scenarios read" on public.finance_scenarios for select
      using (coalesce(public.has_permission('finanzas.view'), false));

    create policy "finance_report_snapshots read" on public.finance_report_snapshots for select
      using (coalesce(public.has_permission('finanzas.view'), false));

    create policy "finance_document_inbox read" on public.finance_document_inbox for select
      using (coalesce(public.has_permission('finanzas.view'), false));

    create policy "finance_quicken_imports read" on public.finance_quicken_imports for select
      using (coalesce(public.has_permission('finanzas.view'), false));

    -- Políticas de escritura (finanzas.plan / finanzas.admin)
    create policy "finance_assumptions write" on public.finance_assumptions for all
      using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));

    create policy "finance_plan_lines write" on public.finance_plan_lines for all
      using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));

    create policy "finance_forecast_adjustments write" on public.finance_forecast_adjustments for all
      using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));

    create policy "finance_scenarios write" on public.finance_scenarios for all
      using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));

    create policy "finance_report_snapshots write" on public.finance_report_snapshots for all
      using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));

    create policy "finance_document_inbox write" on public.finance_document_inbox for all
      using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));

    create policy "finance_quicken_imports write" on public.finance_quicken_imports for all
      using (coalesce(public.has_permission('finanzas.admin'), false));

    -- 4.6 Endurecimiento Integral de ACL sobre las diez tablas financieras
    revoke all on table
      public.finance_versions,
      public.finance_categories,
      public.finance_cost_centers,
      public.finance_assumptions,
      public.finance_plan_lines,
      public.finance_forecast_adjustments,
      public.finance_scenarios,
      public.finance_report_snapshots,
      public.finance_document_inbox,
      public.finance_quicken_imports
    from public, anon, authenticated;

    grant select, insert, update, delete on table
      public.finance_versions,
      public.finance_categories,
      public.finance_cost_centers,
      public.finance_assumptions,
      public.finance_plan_lines,
      public.finance_forecast_adjustments,
      public.finance_scenarios,
      public.finance_report_snapshots,
      public.finance_document_inbox,
      public.finance_quicken_imports
    to authenticated;

    raise notice '0262a: Alineación canónica y endurecimiento ACL completados exitosamente.';
  end if;

  -- =======================================================================
  -- 5. POSTSONDAS FAIL-CLOSED: CERTIFICACIÓN INTEGRAL DE ESTADO CANÓNICO Y ACL
  -- =======================================================================

  SELECT jsonb_object_agg(
    t.table_name,
    jsonb_build_object(
      'rls', jsonb_build_object(
        'rowsecurity', tm.rowsecurity,
        'forcerowsecurity', tm.forcerowsecurity
      ),
      'columns', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'column_name', c.column_name,
            'data_type', c.data_type,
            'udt_name', c.udt_name,
            'is_nullable', c.is_nullable,
            'column_default', c.column_default
          ) ORDER BY c.column_name
        )
        FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = t.table_name
      ),
      'constraints', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'constraint_name', con.conname,
            'constraint_type', con.contype,
            'definition', pg_get_constraintdef(con.oid, true)
          ) ORDER BY con.conname
        ), '[]'::jsonb)
        FROM pg_constraint con
        JOIN pg_class r ON con.conrelid = r.oid
        JOIN pg_namespace n ON r.relnamespace = n.oid
        WHERE n.nspname = 'public' AND r.relname = t.table_name
          AND (con.contype != 'c' OR con.conname NOT SIMILAR TO '[0-9]+_[0-9]+_[0-9]+_not_null')
      ),
      'indexes', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'indexname', i.relname,
            'indexdef', pg_get_indexdef(i.oid, 0, true)
          ) ORDER BY i.relname
        ), '[]'::jsonb)
        FROM pg_index x
        JOIN pg_class c ON c.oid = x.indrelid
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'public' AND c.relname = t.table_name
      ),
      'policies', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'policyname', p.policyname,
            'cmd', p.cmd,
            'roles', p.roles,
            'qual', p.qual,
            'with_check', p.with_check
          ) ORDER BY p.policyname
        ), '[]'::jsonb)
        FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = t.table_name
      ),
      'grants', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'grantee', g.grantee,
            'privilege_type', g.privilege_type
          ) ORDER BY g.grantee, g.privilege_type
        ), '[]'::jsonb)
        FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public' AND g.table_name = t.table_name
          AND g.grantee = 'authenticated'
      )
    ) ORDER BY t.table_name
  ) INTO v_current_manifest
  FROM (
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'finance_%'
    ORDER BY table_name
  ) t
  LEFT JOIN (
    SELECT c.relname AS table_name, c.relrowsecurity AS rowsecurity, c.relforcerowsecurity AS forcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND c.relname LIKE 'finance_%' AND c.relkind = 'r'
  ) tm ON tm.table_name = t.table_name;

  if not (
    (v_current_manifest->'finance_categories'->'columns' @> '[{"column_name":"category_type","data_type":"text","is_nullable":"NO"}]'::jsonb)
    and (jsonb_array_length(v_current_manifest->'finance_categories'->'columns') = 8)
    and (jsonb_array_length(v_current_manifest->'finance_categories'->'constraints') = 4)
    and (jsonb_array_length(v_current_manifest->'finance_categories'->'indexes') = 3)
    and (jsonb_array_length(v_current_manifest->'finance_categories'->'policies') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_categories'->'grants') = 4)

    and (v_current_manifest->'finance_cost_centers'->'columns' @> '[{"column_name":"business_line","data_type":"text","is_nullable":"NO"}]'::jsonb)
    and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'columns') = 6)
    and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'constraints') = 3)
    and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'indexes') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'policies') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_cost_centers'->'grants') = 4)

    and (v_current_manifest->'finance_plan_lines'->'columns' @> '[{"column_name":"period","data_type":"text","is_nullable":"NO"}]'::jsonb)
    and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'columns') = 10)
    and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'constraints') = 5)
    and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'indexes') = 3)
    and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'policies') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_plan_lines'->'grants') = 4)

    and (v_current_manifest->'finance_forecast_adjustments'->'columns' @> '[{"column_name":"date","data_type":"date","is_nullable":"NO"},{"column_name":"matched_movement_id","data_type":"uuid","is_nullable":"YES"}]'::jsonb)
    and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'columns') = 22)
    and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'constraints') = 5)
    and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'indexes') = 4)
    and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'policies') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_forecast_adjustments'->'grants') = 4)

    and (v_current_manifest->'finance_assumptions'->'columns' @> '[{"column_name":"driver_key","data_type":"text","is_nullable":"NO"}]'::jsonb)
    and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'columns') = 12)
    and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'constraints') = 3)
    and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'indexes') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'policies') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_assumptions'->'grants') = 4)

    and (v_current_manifest->'finance_scenarios'->'columns' @> '[{"column_name":"base_scenario_id","data_type":"uuid","is_nullable":"YES"}]'::jsonb)
    and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'columns') = 10)
    and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'constraints') = 3)
    and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'indexes') = 1)
    and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'policies') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_scenarios'->'grants') = 4)

    and (v_current_manifest->'finance_report_snapshots'->'columns' @> '[{"column_name":"period","data_type":"text","is_nullable":"NO"}]'::jsonb)
    and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'columns') = 8)
    and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'constraints') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'indexes') = 1)
    and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'policies') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_report_snapshots'->'grants') = 4)

    and (v_current_manifest->'finance_document_inbox'->'columns' @> '[{"column_name":"sender","data_type":"text","is_nullable":"NO"}]'::jsonb)
    and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'columns') = 13)
    and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'constraints') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'indexes') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'policies') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_document_inbox'->'grants') = 4)

    and (v_current_manifest->'finance_quicken_imports'->'columns' @> '[{"column_name":"filename","data_type":"text","is_nullable":"NO"}]'::jsonb)
    and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'columns') = 10)
    and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'constraints') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'indexes') = 1)
    and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'policies') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_quicken_imports'->'grants') = 4)

    and (jsonb_array_length(v_current_manifest->'finance_versions'->'columns') = 14)
    and (jsonb_array_length(v_current_manifest->'finance_versions'->'constraints') = 3)
    and (jsonb_array_length(v_current_manifest->'finance_versions'->'indexes') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_versions'->'policies') = 2)
    and (jsonb_array_length(v_current_manifest->'finance_versions'->'grants') = 4)
  ) then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: El esquema resultante no coincide con el contrato canónico exacto';
  end if;

  -- 5.2 Preservación de semillas
  select count(*) into v_count from public.finance_versions;
  if v_count <> 1 then raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_versions count = %', v_count; end if;

  select count(*) into v_count from public.finance_categories;
  if v_count <> 13 then raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_categories count = %', v_count; end if;

  select count(*) into v_count from public.finance_cost_centers;
  if v_count <> 5 then raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_cost_centers count = %', v_count; end if;

  -- 5.3 Verificación de ausencia absoluta de grants para anon y PUBLIC
  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name like 'finance_%'
    and grantee in ('anon', 'public');

  if v_count > 0 then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: Existen % grants inesperados para anon o public en tablas financieras', v_count;
  end if;

end $$;

notify pgrst, 'reload schema';
