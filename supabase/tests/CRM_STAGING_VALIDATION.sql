-- =========================================================================
-- CRM_STAGING_VALIDATION.sql — Validación del dominio CRM Comercial en STAGING
--
-- Ejecutar en el SQL editor de Supabase STAGING (rol postgres/service_role).
-- ⚠️ NO PRODUCCIÓN. Requiere migraciones 0041–0046 ya APLICADAS en staging.
--
-- Es NO DESTRUCTIVO: todo corre dentro de una transacción que termina en
-- ROLLBACK (los datos de prueba NO persisten). No activa committed_m2, no crea
-- tablas nuevas, no modifica migraciones.
--
-- Salida: dos tablas de resultados al final (detalle + resumen PASS/FAIL).
-- Cobertura: preflight · public_id · FK · contract-restrict · cascade · enums ·
--   unique · RBAC (has_permission) · RLS enforcement · profiles_public · ledger.
--
-- UUIDs de prueba (deterministas; se descartan en el rollback):
--   comercial = 00000000-0000-0000-0000-0000000c0001
--   sin-perm  = 00000000-0000-0000-0000-0000000c0002
--   admin     = 00000000-0000-0000-0000-0000000c0003
-- =========================================================================

begin;

-- Tabla de resultados (temporal a la transacción).
create temp table _crm_val(
  section text, test text, pass boolean, detail text
) on commit drop;

-- -------------------------------------------------------------------------
-- 0 · PREFLIGHT — existencia de tablas, enums y vista
-- -------------------------------------------------------------------------
do $$
declare v_tables text[] := array[
  'crm_leads','crm_opportunities','crm_quotes','crm_quote_items','crm_proposals',
  'crm_contracts','crm_onboarding','crm_onboarding_tasks','crm_stage_history','clientify_sync_log'];
  t text; n int;
begin
  foreach t in array v_tables loop
    select count(*) into n from information_schema.tables
      where table_schema='public' and table_name=t;
    insert into _crm_val values('0-preflight', 'tabla '||t||' existe', n=1, 'count='||n);
  end loop;

  -- enums (10)
  select count(*) into n from pg_type where typname in (
    'crm_lead_status_t','crm_service_t','crm_stage_t','crm_committed_state_t',
    'crm_quote_status_t','crm_proposal_t','crm_proposal_status_t',
    'crm_contract_status_t','crm_onboarding_status_t','crm_onboarding_task_t');
  insert into _crm_val values('0-preflight','10 enums crm_* existen', n=10, 'count='||n);

  -- vista profiles_public
  select count(*) into n from information_schema.views
    where table_schema='public' and table_name='profiles_public';
  insert into _crm_val values('0-preflight','vista profiles_public existe', n=1, 'count='||n);

  -- RLS habilitada en las 10 tablas
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public' and c.relrowsecurity and c.relname = any(v_tables);
  insert into _crm_val values('0-preflight','RLS habilitada en 10 tablas', n=10, 'con RLS='||n);
end $$;

-- -------------------------------------------------------------------------
-- 1 · public_id triggers (LEAD-/OPP-/COT-/PROP-/CON-/ONB-)
-- -------------------------------------------------------------------------
do $$
declare v_opp uuid; v_pub text; v_q uuid; v_qp text; v_c uuid; v_cp text;
begin
  insert into public.crm_leads(full_name) values('val lead') returning public_id into v_pub;
  insert into _crm_val values('1-public_id','crm_leads → LEAD-', v_pub like 'LEAD-%', coalesce(v_pub,'(null)'));

  insert into public.crm_opportunities(service_type) values('anmat') returning id, public_id into v_opp, v_pub;
  insert into _crm_val values('1-public_id','crm_opportunities → OPP-', v_pub like 'OPP-%', coalesce(v_pub,'(null)'));

  insert into public.crm_quotes(opportunity_id, service_type) values(v_opp,'anmat') returning id, public_id into v_q, v_qp;
  insert into _crm_val values('1-public_id','crm_quotes → COT-', v_qp like 'COT-%', coalesce(v_qp,'(null)'));

  insert into public.crm_proposals(opportunity_id, tipo) values(v_opp,'anmat') returning public_id into v_pub;
  insert into _crm_val values('1-public_id','crm_proposals → PROP-', v_pub like 'PROP-%', coalesce(v_pub,'(null)'));

  insert into public.crm_contracts(opportunity_id) values(v_opp) returning id, public_id into v_c, v_cp;
  insert into _crm_val values('1-public_id','crm_contracts → CON-', v_cp like 'CON-%', coalesce(v_cp,'(null)'));

  insert into public.crm_onboarding(opportunity_id) values(v_opp) returning public_id into v_pub;
  insert into _crm_val values('1-public_id','crm_onboarding → ONB-', v_pub like 'ONB-%', coalesce(v_pub,'(null)'));
end $$;

-- -------------------------------------------------------------------------
-- 2 · FK integridad — insert con opportunity_id inexistente debe fallar
-- -------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.crm_quotes(opportunity_id, service_type)
      values('00000000-0000-0000-0000-0000000fffff','anmat');
    insert into _crm_val values('2-fk','quote con opp inexistente rechazado', false, 'insert ACEPTADO (mal)');
  exception when foreign_key_violation then
    insert into _crm_val values('2-fk','quote con opp inexistente rechazado', true, 'rechazado ok');
  end;
end $$;

-- -------------------------------------------------------------------------
-- 3 · CONTRACT RESTRICT (R-G1) — borrar opp CON contrato debe bloquearse
-- -------------------------------------------------------------------------
do $$
declare v_opp uuid;
begin
  insert into public.crm_opportunities(service_type) values('general') returning id into v_opp;
  insert into public.crm_contracts(opportunity_id) values(v_opp);
  begin
    delete from public.crm_opportunities where id=v_opp;
    insert into _crm_val values('3-restrict','delete opp CON contrato bloqueado', false, 'delete ACEPTADO (mal)');
  exception when foreign_key_violation then
    insert into _crm_val values('3-restrict','delete opp CON contrato bloqueado', true, 'restrict ok');
  end;
end $$;

-- -------------------------------------------------------------------------
-- 4 · CASCADE — borrar opp SIN contrato cascada a quotes/proposals/etc.
-- -------------------------------------------------------------------------
do $$
declare v_opp uuid; n int;
begin
  insert into public.crm_opportunities(service_type) values('general') returning id into v_opp;
  insert into public.crm_quotes(opportunity_id, service_type) values(v_opp,'general');
  insert into public.crm_stage_history(opportunity_id, to_stage) values(v_opp,'calificado');
  delete from public.crm_opportunities where id=v_opp;
  select count(*) into n from public.crm_quotes where opportunity_id=v_opp;
  insert into _crm_val values('4-cascade','delete opp SIN contrato → cascada', n=0, 'quotes restantes='||n);
end $$;

-- -------------------------------------------------------------------------
-- 5 · ENUMS y UNIQUE
-- -------------------------------------------------------------------------
do $$
begin
  -- enum inválido
  begin
    insert into public.crm_opportunities(service_type) values('invalido');
    insert into _crm_val values('5-enum','service_type inválido rechazado', false, 'aceptó inválido (mal)');
  exception when invalid_text_representation then
    insert into _crm_val values('5-enum','service_type inválido rechazado', true, 'rechazado ok');
  end;
end $$;

do $$
begin
  -- unique clientify_deal_id
  insert into public.crm_opportunities(service_type, clientify_deal_id) values('anmat','VAL-DUP-1');
  begin
    insert into public.crm_opportunities(service_type, clientify_deal_id) values('general','VAL-DUP-1');
    insert into _crm_val values('5-unique','clientify_deal_id duplicado rechazado', false, 'aceptó dup (mal)');
  exception when unique_violation then
    insert into _crm_val values('5-unique','clientify_deal_id duplicado rechazado', true, 'rechazado ok');
  end;
end $$;

do $$
declare v_opp uuid;
begin
  -- unique (opportunity_id, tipo, version) en proposals
  insert into public.crm_opportunities(service_type) values('anmat') returning id into v_opp;
  insert into public.crm_proposals(opportunity_id, tipo, version) values(v_opp,'anmat',1);
  begin
    insert into public.crm_proposals(opportunity_id, tipo, version) values(v_opp,'anmat',1);
    insert into _crm_val values('5-unique','proposal (opp,tipo,version) duplicado rechazado', false, 'aceptó dup (mal)');
  exception when unique_violation then
    insert into _crm_val values('5-unique','proposal (opp,tipo,version) duplicado rechazado', true, 'rechazado ok');
  end;
end $$;

-- -------------------------------------------------------------------------
-- 6 · FIXTURES RBAC — usuarios de prueba (auth.users + profiles + user_roles)
--     ⚠️ Sección sensible al esquema de auth.users de tu Supabase. Si falla,
--     ajustar el insert (ver runbook §5). Se captura el error y se reporta.
-- -------------------------------------------------------------------------
do $$
declare v_role_comercial uuid; v_role_operaciones uuid;
begin
  select id into v_role_comercial   from public.roles where slug='comercial';
  select id into v_role_operaciones from public.roles where slug='operaciones';
  if v_role_comercial is null or v_role_operaciones is null then
    insert into _crm_val values('6-fixtures','roles RBAC comercial+operaciones existen', false, 'roles.slug comercial/operaciones NO existe (0009?)');
    return;
  end if;
  insert into _crm_val values('6-fixtures','roles RBAC comercial+operaciones existen', true, 'ok');

  -- auth.users (5): comercial, sin-perm, admin, operaciones, cliente
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000c0001','authenticated','authenticated','val.comercial@crmval.test','',now(),now(),now()),
    ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000c0002','authenticated','authenticated','val.noperm@crmval.test','',now(),now(),now()),
    ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000c0003','authenticated','authenticated','val.admin@crmval.test','',now(),now(),now()),
    ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000c0004','authenticated','authenticated','val.operaciones@crmval.test','',now(),now(),now()),
    ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000c0005','authenticated','authenticated','val.cliente@crmval.test','',now(),now(),now());

  -- profiles: roles user_role_t. admin → bypass; cliente → role 'cliente'; resto 'operaciones'.
  insert into public.profiles(id, full_name, email, role, active) values
    ('00000000-0000-0000-0000-0000000c0001','Val Comercial',   'val.comercial@crmval.test',  'operaciones', true),
    ('00000000-0000-0000-0000-0000000c0002','Val NoPerm',       'val.noperm@crmval.test',     'operaciones', true),
    ('00000000-0000-0000-0000-0000000c0003','Val Admin',        'val.admin@crmval.test',      'admin',       true),
    ('00000000-0000-0000-0000-0000000c0004','Val Operaciones',  'val.operaciones@crmval.test','operaciones', true),
    ('00000000-0000-0000-0000-0000000c0005','Val Cliente',      'val.cliente@crmval.test',    'cliente',     true);

  -- user_roles (RBAC): comercial → rol comercial ; operaciones → rol operaciones.
  -- noperm y cliente NO reciben mapeo (sin permisos comerciales).
  insert into public.user_roles(user_id, role_id) values
    ('00000000-0000-0000-0000-0000000c0001', v_role_comercial),
    ('00000000-0000-0000-0000-0000000c0004', v_role_operaciones);

  insert into _crm_val values('6-fixtures','fixtures auth/profiles/user_roles creados', true, '5 users');
exception when others then
  insert into _crm_val values('6-fixtures','fixtures creados', false, 'ERROR: '||SQLERRM||' — ajustar insert auth.users (runbook §5)');
end $$;

-- Diagnóstico R-G2: ¿user_roles/permissions/role_permissions tienen RLS?
do $$
declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public' and c.relrowsecurity
      and c.relname in ('user_roles','role_permissions','permissions');
  insert into _crm_val values('6-fixtures','[diag] tablas RBAC con RLS (0=mejor para has_permission)', true, 'con RLS='||n||' (si >0, verificar que authenticated puede leerlas)');
end $$;

-- -------------------------------------------------------------------------
-- 7 · RBAC — has_permission() bajo cada usuario (R-G2, el test central)
-- -------------------------------------------------------------------------
-- comercial → true ; sin-perm → false ; admin → true (bypass)
do $$
declare v boolean; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin v := public.has_permission('comercial.view'); exception when others then v:=null; v_err:=SQLERRM; end;
  set local role postgres;
  insert into _crm_val values('7-rbac','has_permission(view) = TRUE para usuario comercial [R-G2]', coalesce(v,false), coalesce('val='||v, 'ERR '||v_err));
end $$;

do $$
declare v boolean; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0002","role":"authenticated"}', true);
  begin v := public.has_permission('comercial.view'); exception when others then v:=null; v_err:=SQLERRM; end;
  set local role postgres;
  insert into _crm_val values('7-rbac','has_permission(view) = FALSE para usuario sin permiso', v is not null and v=false, coalesce('val='||v,'ERR '||v_err));
end $$;

do $$
declare v boolean; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0003","role":"authenticated"}', true);
  begin v := public.has_permission('comercial.view'); exception when others then v:=null; v_err:=SQLERRM; end;
  set local role postgres;
  insert into _crm_val values('7-rbac','has_permission(view) = TRUE para admin (bypass)', coalesce(v,false), coalesce('val='||v,'ERR '||v_err));
end $$;

do $$
declare v boolean; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0004","role":"authenticated"}', true);
  begin v := public.has_permission('comercial.view'); exception when others then v:=null; v_err:=SQLERRM; end;
  set local role postgres;
  insert into _crm_val values('7-rbac','has_permission(view) = TRUE para operaciones', coalesce(v,false), coalesce('val='||v,'ERR '||v_err));
end $$;

do $$
declare v boolean; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0005","role":"authenticated"}', true);
  begin v := public.has_permission('comercial.view'); exception when others then v:=null; v_err:=SQLERRM; end;
  set local role postgres;
  insert into _crm_val values('7-rbac','has_permission(view) = FALSE para cliente', v is not null and v=false, coalesce('val='||v,'ERR '||v_err));
end $$;

-- -------------------------------------------------------------------------
-- 8 · RLS enforcement — INSERT en crm_opportunities por rol
-- -------------------------------------------------------------------------
-- comercial → INSERT permitido
do $$
declare v_ok boolean := false; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin
    insert into public.crm_opportunities(service_type) values('anmat');
    v_ok := true;
  exception when others then v_ok := false; v_err := SQLERRM; end;
  set local role postgres;
  insert into _crm_val values('8-rls','INSERT crm_opportunities PERMITIDO a comercial', v_ok, coalesce(v_err,'ok'));
end $$;

-- sin-perm → INSERT denegado (RLS)
do $$
declare v_ok boolean := false; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0002","role":"authenticated"}', true);
  begin
    insert into public.crm_opportunities(service_type) values('anmat');
    v_ok := true;  -- no debería
  exception when insufficient_privilege then v_ok := false; v_err:='RLS denied (ok)';
            when others then v_ok := false; v_err := SQLERRM; end;
  set local role postgres;
  insert into _crm_val values('8-rls','INSERT crm_opportunities DENEGADO a sin-permiso', v_ok=false, coalesce(v_err,'ACEPTÓ (mal)'));
end $$;

-- operaciones → INSERT permitido (tiene comercial.edit por RBAC)
do $$
declare v_ok boolean := false; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0004","role":"authenticated"}', true);
  begin
    insert into public.crm_opportunities(service_type) values('general');
    v_ok := true;
  exception when others then v_ok := false; v_err := SQLERRM; end;
  set local role postgres;
  insert into _crm_val values('8-rls','INSERT crm_opportunities PERMITIDO a operaciones', v_ok, coalesce(v_err,'ok'));
end $$;

-- operaciones → DELETE denegado (delete = is_admin(); operaciones no es admin) → 0 filas
do $$
declare v_opp uuid; v_rows int; v_err text;
begin
  insert into public.crm_opportunities(service_type) values('general') returning id into v_opp;
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0004","role":"authenticated"}', true);
  begin
    delete from public.crm_opportunities where id=v_opp;
    get diagnostics v_rows = row_count;
  exception when others then v_rows := -1; v_err := SQLERRM; end;
  set local role postgres;
  insert into _crm_val values('8-rls','DELETE crm_opportunities DENEGADO a operaciones (solo admin)', v_rows<=0, 'rows='||v_rows||coalesce(' '||v_err,''));
end $$;

-- cliente → INSERT denegado (sin permiso comercial)
do $$
declare v_ok boolean := false; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0005","role":"authenticated"}', true);
  begin
    insert into public.crm_opportunities(service_type) values('anmat');
    v_ok := true;  -- no debería
  exception when insufficient_privilege then v_ok := false; v_err:='RLS denied (ok)';
            when others then v_ok := false; v_err := SQLERRM; end;
  set local role postgres;
  insert into _crm_val values('8-rls','INSERT crm_opportunities DENEGADO a cliente', v_ok=false, coalesce(v_err,'ACEPTÓ (mal)'));
end $$;

-- Visibilidad SELECT: comercial ve filas (>0) · cliente ve 0 (RLS filtra todo)
do $$
declare n_com int; n_cli int; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin select count(*) into n_com from public.crm_opportunities; exception when others then n_com:=-1; v_err:=SQLERRM; end;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0005","role":"authenticated"}', true);
  begin select count(*) into n_cli from public.crm_opportunities; exception when others then n_cli:=-1; end;
  set local role postgres;
  insert into _crm_val values('8-rls','SELECT comercial ve filas (>0)', n_com>0, 'filas='||n_com);
  insert into _crm_val values('8-rls','SELECT cliente NO ve filas (=0, RLS filtra)', n_cli=0, 'filas='||n_cli);
end $$;

-- -------------------------------------------------------------------------
-- 9 · LEDGER IMMUTABILITY — UPDATE sobre crm_stage_history por comercial = 0 filas
-- -------------------------------------------------------------------------
do $$
declare v_opp uuid; v_id bigint; v_rows int; v_err text;
begin
  -- setup como postgres
  insert into public.crm_opportunities(service_type) values('anmat') returning id into v_opp;
  insert into public.crm_stage_history(opportunity_id, to_stage) values(v_opp,'calificado') returning id into v_id;

  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin
    update public.crm_stage_history set note='hack' where id=v_id;
    get diagnostics v_rows = row_count;
  exception when others then v_rows := -1; v_err := SQLERRM; end;
  set local role postgres;
  -- inmutable: 0 filas afectadas (sin policy UPDATE) o error
  insert into _crm_val values('9-ledger','UPDATE en crm_stage_history bloqueado (ledger inmutable)', v_rows<=0, 'rows='||v_rows||coalesce(' '||v_err,''));
end $$;

-- -------------------------------------------------------------------------
-- 10 · profiles_public (R-G3) — sin email y legible por authenticated
-- -------------------------------------------------------------------------
do $$
declare n int;
begin
  -- estructura: solo id, full_name (sin email)
  select count(*) into n from information_schema.columns
    where table_schema='public' and table_name='profiles_public' and column_name='email';
  insert into _crm_val values('10-profiles_public','vista NO expone email', n=0, 'cols email='||n);
end $$;

do $$
declare n int; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin select count(*) into n from public.profiles_public; exception when others then n:=-1; v_err:=SQLERRM; end;
  set local role postgres;
  insert into _crm_val values('10-profiles_public','authenticated lee profiles_public (>0) [R-G3]', n>0, 'filas='||n||coalesce(' '||v_err,''));
end $$;

-- -------------------------------------------------------------------------
-- 11 · ESTADO DEL HOOK DE CAPACIDAD — committed dormido en la capa de datos
--     (el flag COMMITTED_M2_ENABLED vive en corporate-capacity.ts = false; acá
--      verificamos el contrato a nivel DB: committed_state nace en 'none' y el
--      enum tiene las 4 capas, sin trigger que lo auto-mueva).
-- -------------------------------------------------------------------------
do $$
declare v_state text; n int;
begin
  -- default = 'none' en alta
  insert into public.crm_opportunities(service_type) values('anmat')
    returning committed_state::text into v_state;
  insert into _crm_val values('11-capacity','crm_opportunities.committed_state default = none', v_state='none', 'val='||v_state);

  -- enum con exactamente las 4 capas
  select count(*) into n from pg_enum e join pg_type t on t.oid=e.enumtypid
    where t.typname='crm_committed_state_t' and e.enumlabel in ('none','reservado','comprometido','ocupado');
  insert into _crm_val values('11-capacity','enum crm_committed_state_t = {none,reservado,comprometido,ocupado}', n=4, 'labels='||n);

  -- sin trigger en crm_opportunities que mute committed_state (hook inactivo)
  select count(*) into n from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
    where c.relname='crm_opportunities' and not tg.tgisinternal
      and tg.tgname not in ('trg_set_crm_opportunity_public_id','trg_crm_opp_touch');
  insert into _crm_val values('11-capacity','sin triggers extra que auto-muevan committed (hook inactivo)', n=0, 'triggers extra='||n);
end $$;

-- =========================================================================
-- RESULTADOS
-- =========================================================================
select section,
       test,
       case when pass then 'PASS' else 'FAIL' end as resultado,
       detail
from _crm_val
order by section, test;

select count(*) as total,
       count(*) filter (where pass)      as passed,
       count(*) filter (where not pass)  as failed
from _crm_val;

-- =========================================================================
-- ROLLBACK — nada de lo anterior persiste (validación no destructiva).
-- =========================================================================
rollback;
