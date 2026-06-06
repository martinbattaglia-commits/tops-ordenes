-- =========================================================================
-- CRM_WRITE_PATH_VALIDATION.sql — Validación del Write-Path (W-1) en STAGING
--
-- Ejecutar en STAGING (rol postgres/service_role). ⚠️ NO PRODUCCIÓN.
-- Requiere: 0041–0046 aplicadas + 0047_crm_write_path_fns.sql aplicada.
--
-- NO DESTRUCTIVO: corre en una transacción que termina en ROLLBACK. No crea
-- tablas/columnas/policies; solo ejercita las 3 funciones RPC de 0047.
--
-- Cobertura QA (8 obligatorios + ciclo de vida + RLS):
--   1 transición válida      5 visita opcional (D-3)
--   2 transición inválida    6 stage_history consistente
--   3 idempotencia           7 auth.uid() correcto (changed_by)
--   4 bloqueo duro ganado    8 rollback en error
--   + reserve_capacity · complete_onboarding · anti-doble-conteo · RLS por rol
--
-- UUIDs de prueba (deterministas; descartados en el rollback):
--   comercial = ...0c0001 · sin-perm = ...0c0002 · admin = ...0c0003
--   opps      = ...0a01 (lifecycle) · ...0a02 (invalid) · ...0a03 (block) · ...0a04 (idem)
-- =========================================================================

begin;

create temp table _wp_val(
  section text, test text, pass boolean, detail text
) on commit drop;

-- -------------------------------------------------------------------------
-- 0 · PREFLIGHT — las 3 funciones de 0047 existen
-- -------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname in
     ('crm_advance_stage','crm_reserve_capacity','crm_complete_onboarding');
  insert into _wp_val values('0-preflight','3 funciones RPC de 0047 existen', n=3, 'count='||n);

  -- todas SECURITY INVOKER (prosecdef=false)
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname in
     ('crm_advance_stage','crm_reserve_capacity','crm_complete_onboarding')
     and p.prosecdef = false;
  insert into _wp_val values('0-preflight','3 funciones son SECURITY INVOKER (R-G2)', n=3, 'invoker='||n);
end $$;

-- -------------------------------------------------------------------------
-- 1 · FIXTURES — usuarios RBAC + oportunidades semilla
-- -------------------------------------------------------------------------
do $$
declare v_role_comercial uuid; v_role_operaciones uuid;
begin
  select id into v_role_comercial   from public.roles where slug='comercial'   limit 1;
  select id into v_role_operaciones from public.roles where slug='operaciones' limit 1;

  -- auth.users (mínimos; el trigger handle_new_user crea el profile)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000c0001','authenticated','authenticated','wp.comercial@crmval.test','',now(),now(),now()),
    ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000c0002','authenticated','authenticated','wp.noperm@crmval.test','',now(),now(),now()),
    ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000c0003','authenticated','authenticated','wp.admin@crmval.test','',now(),now(),now())
  on conflict (id) do nothing;

  update public.profiles p
     set full_name = v.full_name, role = v.role::public.user_role_t, active = true
  from (values
    ('00000000-0000-0000-0000-0000000c0001'::uuid,'WP Comercial','operaciones'),
    ('00000000-0000-0000-0000-0000000c0002'::uuid,'WP NoPerm',   'operaciones'),
    ('00000000-0000-0000-0000-0000000c0003'::uuid,'WP Admin',    'admin')
  ) as v(id, full_name, role)
  where p.id = v.id;

  insert into public.user_roles(user_id, role_id) values
    ('00000000-0000-0000-0000-0000000c0001', v_role_comercial)
  on conflict do nothing;

  -- Oportunidades semilla (como postgres → RLS bypass para el setup).
  insert into public.crm_opportunities (id, service_type, estado, m2, assigned_site, committed_state) values
    ('00000000-0000-0000-0000-000000000a01','anmat',  'calificado',  200, null, 'none'),
    ('00000000-0000-0000-0000-000000000a02','general','nuevo_lead',  100, null, 'none'),
    ('00000000-0000-0000-0000-000000000a03','anmat',  'negociacion', 300, null, 'reservado'),
    ('00000000-0000-0000-0000-000000000a04','general','propuesta',   150, 'PEDRO_LUJAN_3159', 'reservado')
  on conflict (id) do nothing;

  -- onboarding para la opp de lifecycle (se completa al final).
  insert into public.crm_onboarding (id, opportunity_id, status, progress_pct) values
    ('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-000000000a01','pendiente', 0)
  on conflict (id) do nothing;

  insert into _wp_val values('1-fixtures','usuarios + 4 opps + onboarding semilla', true, 'ok');
exception when others then
  insert into _wp_val values('1-fixtures','fixtures creados', false, 'ERROR: '||SQLERRM);
end $$;

-- -------------------------------------------------------------------------
-- 2 · RESERVE CAPACITY — assigned_site + committed=reservado + ledger + auth.uid
-- -------------------------------------------------------------------------
do $$
declare v_site text; v_committed text; v_feasible boolean; v_changed uuid; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin
    perform public.crm_reserve_capacity(
      '00000000-0000-0000-0000-000000000a01', 'PEDRO_LUJAN_3159',
      '["Cubículos 2º piso (PA4-PA5)"]'::jsonb, 5000);
  exception when others then v_err := SQLERRM; end;
  set local role postgres;

  select assigned_site, committed_state::text, capacity_feasible
    into v_site, v_committed, v_feasible
  from public.crm_opportunities where id='00000000-0000-0000-0000-000000000a01';

  select changed_by into v_changed from public.crm_stage_history
   where opportunity_id='00000000-0000-0000-0000-000000000a01' order by id desc limit 1;

  insert into _wp_val values('2-reserve','reserve_capacity fija assigned_site',
     v_site='PEDRO_LUJAN_3159', coalesce('site='||v_site, 'ERR '||v_err));
  insert into _wp_val values('2-reserve','reserve_capacity → committed_state=reservado',
     v_committed='reservado', 'committed='||coalesce(v_committed,'null'));
  insert into _wp_val values('2-reserve','reserve_capacity → capacity_feasible=true',
     v_feasible is true, 'feasible='||coalesce(v_feasible::text,'null'));
  insert into _wp_val values('2-reserve','reserve_capacity escribe ledger con auth.uid() correcto [QA-7]',
     v_changed='00000000-0000-0000-0000-0000000c0001', 'changed_by='||coalesce(v_changed::text,'null'));
end $$;

-- reserve INSUFFICIENT_CAPACITY (presupuesto físico insuficiente)
do $$
declare v_raised boolean := false; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin
    perform public.crm_reserve_capacity('00000000-0000-0000-0000-000000000a03','MAGALDI_1765','["S1"]'::jsonb, 50);
  exception when others then v_raised := true; v_err := SQLERRM; end;
  set local role postgres;
  insert into _wp_val values('2-reserve','reserve_capacity rechaza si m²(300) > disponible(50)',
     v_raised and v_err like 'INSUFFICIENT_CAPACITY%', coalesce(v_err,'no raise'));
end $$;

-- -------------------------------------------------------------------------
-- 3 · TRANSICIÓN VÁLIDA + VISITA OPCIONAL (D-3) — calificado → propuesta directo
-- -------------------------------------------------------------------------
do $$
declare v_estado text; v_committed text; v_err text; v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin
    perform public.crm_advance_stage('00000000-0000-0000-0000-000000000a01','propuesta','cotización enviada');
  exception when others then v_err := SQLERRM; end;
  set local role postgres;

  select estado::text, committed_state::text into v_estado, v_committed
  from public.crm_opportunities where id='00000000-0000-0000-0000-000000000a01';
  select count(*) into v_n from public.crm_stage_history
   where opportunity_id='00000000-0000-0000-0000-000000000a01' and from_stage='calificado' and to_stage='propuesta';

  insert into _wp_val values('3-advance','transición VÁLIDA calificado→propuesta (visita opcional D-3) [QA-1,QA-5]',
     v_estado='propuesta' and v_err is null, coalesce('estado='||v_estado, 'ERR '||v_err));
  insert into _wp_val values('3-advance','committed_state se mantiene reservado (assigned_site presente)',
     v_committed='reservado', 'committed='||coalesce(v_committed,'null'));
  insert into _wp_val values('3-advance','ledger registró la transición calificado→propuesta [QA-6]',
     v_n=1, 'filas='||v_n);
end $$;

-- -------------------------------------------------------------------------
-- 4 · TRANSICIÓN INVÁLIDA + ROLLBACK — nuevo_lead → ganado (no permitida)
-- -------------------------------------------------------------------------
do $$
declare v_raised boolean := false; v_err text; v_estado text; v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin
    perform public.crm_advance_stage('00000000-0000-0000-0000-000000000a02','ganado');
  exception when others then v_raised := true; v_err := SQLERRM; end;
  set local role postgres;

  select estado::text into v_estado from public.crm_opportunities where id='00000000-0000-0000-0000-000000000a02';
  select count(*) into v_n from public.crm_stage_history where opportunity_id='00000000-0000-0000-0000-000000000a02';

  insert into _wp_val values('4-invalid','transición INVÁLIDA nuevo_lead→ganado rechazada [QA-2]',
     v_raised and v_err like 'INVALID_TRANSITION%', coalesce(v_err,'no raise'));
  insert into _wp_val values('4-invalid','ROLLBACK: estado intacto tras error [QA-8]',
     v_estado='nuevo_lead', 'estado='||coalesce(v_estado,'null'));
  insert into _wp_val values('4-invalid','ROLLBACK: sin filas en ledger tras error [QA-8]',
     v_n=0, 'filas='||v_n);
end $$;

-- -------------------------------------------------------------------------
-- 5 · BLOQUEO DURO (D-2) — negociacion → ganado sin assigned_site + ROLLBACK
-- -------------------------------------------------------------------------
do $$
declare v_raised boolean := false; v_err text; v_estado text; v_committed text; v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin
    perform public.crm_advance_stage('00000000-0000-0000-0000-000000000a03','ganado');
  exception when others then v_raised := true; v_err := SQLERRM; end;
  set local role postgres;

  select estado::text, committed_state::text into v_estado, v_committed
  from public.crm_opportunities where id='00000000-0000-0000-0000-000000000a03';
  select count(*) into v_n from public.crm_stage_history where opportunity_id='00000000-0000-0000-0000-000000000a03';

  insert into _wp_val values('5-hardblock','BLOQUEO DURO: ganar sin assigned_site rechazado [QA-4]',
     v_raised and v_err like 'GANADO_REQUIRES_CAPACITY%', coalesce(v_err,'no raise'));
  insert into _wp_val values('5-hardblock','ROLLBACK: estado/committed intactos tras bloqueo [QA-8]',
     v_estado='negociacion', 'estado='||coalesce(v_estado,'null')||' committed='||coalesce(v_committed,'null'));
  insert into _wp_val values('5-hardblock','ROLLBACK: sin filas en ledger tras bloqueo [QA-8]',
     v_n=0, 'filas='||v_n);
end $$;

-- -------------------------------------------------------------------------
-- 6 · IDEMPOTENCIA — propuesta → propuesta (no-op, sin ledger nuevo)
-- -------------------------------------------------------------------------
do $$
declare v_before int; v_after int; v_estado text; v_err text;
begin
  select count(*) into v_before from public.crm_stage_history where opportunity_id='00000000-0000-0000-0000-000000000a04';
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin
    perform public.crm_advance_stage('00000000-0000-0000-0000-000000000a04','propuesta');
  exception when others then v_err := SQLERRM; end;
  set local role postgres;
  select count(*) into v_after from public.crm_stage_history where opportunity_id='00000000-0000-0000-0000-000000000a04';
  select estado::text into v_estado from public.crm_opportunities where id='00000000-0000-0000-0000-000000000a04';

  insert into _wp_val values('6-idempotencia','from==to es no-op (sin error) [QA-3]',
     v_err is null and v_estado='propuesta', coalesce('estado='||v_estado,'ERR '||v_err));
  insert into _wp_val values('6-idempotencia','from==to NO agrega fila al ledger [QA-3]',
     v_after=v_before, 'antes='||v_before||' despues='||v_after);
end $$;

-- -------------------------------------------------------------------------
-- 7 · CICLO DE VIDA COMPLETO (opp a01) — propuesta→negociacion→ganado→ocupado
-- -------------------------------------------------------------------------
do $$
declare v_estado text; v_committed text; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin
    perform public.crm_advance_stage('00000000-0000-0000-0000-000000000a01','negociacion');
    perform public.crm_advance_stage('00000000-0000-0000-0000-000000000a01','ganado');  -- con assigned_site → permitido
  exception when others then v_err := SQLERRM; end;
  set local role postgres;

  select estado::text, committed_state::text into v_estado, v_committed
  from public.crm_opportunities where id='00000000-0000-0000-0000-000000000a01';

  insert into _wp_val values('7-lifecycle','negociacion→ganado con capacidad → committed=comprometido',
     v_estado='ganado' and v_committed='comprometido', coalesce('estado='||v_estado||' committed='||v_committed, 'ERR '||v_err));
end $$;

-- complete_onboarding → ocupado + onboarding completado
do $$
declare v_committed text; v_onb_status text; v_onb_pct int; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin
    perform public.crm_complete_onboarding('00000000-0000-0000-0000-000000000a01');
  exception when others then v_err := SQLERRM; end;
  set local role postgres;

  select committed_state::text into v_committed from public.crm_opportunities where id='00000000-0000-0000-0000-000000000a01';
  select status::text, progress_pct into v_onb_status, v_onb_pct from public.crm_onboarding where opportunity_id='00000000-0000-0000-0000-000000000a01';

  insert into _wp_val values('7-lifecycle','complete_onboarding → committed_state=ocupado',
     v_committed='ocupado', coalesce('committed='||v_committed,'ERR '||v_err));
  insert into _wp_val values('7-lifecycle','complete_onboarding → onboarding completado/100%',
     v_onb_status='completado' and v_onb_pct=100, 'status='||coalesce(v_onb_status,'null')||' pct='||coalesce(v_onb_pct::text,'null'));
end $$;

-- anti-doble-conteo: ocupado NO entra al CommittedSnapshot (estado de la query F2.1-4)
do $$
declare v_counts boolean;
begin
  select (committed_state in ('reservado','comprometido')) into v_counts
  from public.crm_opportunities where id='00000000-0000-0000-0000-000000000a01';
  insert into _wp_val values('7-lifecycle','anti-doble-conteo: ocupado fuera del snapshot (F2.1-4)',
     v_counts = false, 'cuenta_en_snapshot='||coalesce(v_counts::text,'null'));
end $$;

-- idempotencia onboarding: segunda llamada no duplica evento
do $$
declare v_before int; v_after int; v_err text;
begin
  select count(*) into v_before from public.crm_stage_history where opportunity_id='00000000-0000-0000-0000-000000000a01';
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0001","role":"authenticated"}', true);
  begin perform public.crm_complete_onboarding('00000000-0000-0000-0000-000000000a01'); exception when others then v_err := SQLERRM; end;
  set local role postgres;
  select count(*) into v_after from public.crm_stage_history where opportunity_id='00000000-0000-0000-0000-000000000a01';
  insert into _wp_val values('7-lifecycle','complete_onboarding idempotente (ya ocupado → no-op)',
     v_after=v_before and v_err is null, 'antes='||v_before||' despues='||v_after);
end $$;

-- -------------------------------------------------------------------------
-- 8 · CONSISTENCIA stage_history (opp a01) [QA-6, QA-7]
-- -------------------------------------------------------------------------
do $$
declare v_transitions int; v_events int; v_total int; v_last_to text; v_estado text; v_bad_uid int;
begin
  select count(*) filter (where from_stage <> to_stage),
         count(*) filter (where from_stage = to_stage),
         count(*)
    into v_transitions, v_events, v_total
  from public.crm_stage_history where opportunity_id='00000000-0000-0000-0000-000000000a01';

  -- última transición real de etapa
  select to_stage::text into v_last_to from public.crm_stage_history
   where opportunity_id='00000000-0000-0000-0000-000000000a01' and from_stage <> to_stage
   order by id desc limit 1;
  select estado::text into v_estado from public.crm_opportunities where id='00000000-0000-0000-0000-000000000a01';

  -- todos los changed_by deben ser el usuario comercial impersonado
  select count(*) into v_bad_uid from public.crm_stage_history
   where opportunity_id='00000000-0000-0000-0000-000000000a01'
     and (changed_by is distinct from '00000000-0000-0000-0000-0000000c0001');

  -- transiciones reales esperadas: calificado→propuesta, propuesta→negociacion, negociacion→ganado = 3
  insert into _wp_val values('8-consistencia','3 transiciones reales de etapa registradas [QA-6]',
     v_transitions=3, 'transiciones='||v_transitions);
  -- eventos de capacidad (from==to): reserve + onboarding = 2
  insert into _wp_val values('8-consistencia','2 eventos de capacidad (reserve+onboarding) registrados',
     v_events=2, 'eventos='||v_events||' total='||v_total);
  insert into _wp_val values('8-consistencia','estado de la opp coincide con la última transición del ledger [QA-6]',
     v_estado=v_last_to, 'opp='||coalesce(v_estado,'null')||' ledger='||coalesce(v_last_to,'null'));
  insert into _wp_val values('8-consistencia','todos los changed_by = usuario comercial [QA-7]',
     v_bad_uid=0, 'filas_con_uid_distinto='||v_bad_uid);
end $$;

-- -------------------------------------------------------------------------
-- 9 · RLS por rol sobre el write-path (R-G2 sobre RPC)
-- -------------------------------------------------------------------------
-- usuario SIN permiso comercial → la RPC falla (RLS bloquea el UPDATE interno)
do $$
declare v_raised boolean := false; v_err text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000c0002","role":"authenticated"}', true);
  begin
    perform public.crm_advance_stage('00000000-0000-0000-0000-000000000a04','negociacion');
  exception when others then v_raised := true; v_err := SQLERRM; end;
  set local role postgres;
  insert into _wp_val values('9-rls','usuario SIN comercial.edit no puede avanzar etapa (RLS) [R-G2]',
     v_raised, coalesce('bloqueado: '||left(v_err,60),'NO bloqueado — fuga'));
end $$;

-- -------------------------------------------------------------------------
-- RESULTADOS
-- -------------------------------------------------------------------------
select section, test, case when pass then 'PASS' else 'FAIL' end as resultado, detail
from _wp_val order by section, test;

select count(*) as total,
       count(*) filter (where pass) as passed,
       count(*) filter (where not pass) as failed
from _wp_val;

rollback;
