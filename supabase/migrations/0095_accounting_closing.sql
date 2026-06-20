-- =========================================================================
-- 0095_accounting_closing.sql — Fase 12.F · Base de cierre / refundición
--   (simulación read-only + ejecución gateada, nunca automática)
--
-- PRUDENCIA MÁXIMA (reglas 12.F):
--   · acc_simulate_closing → READ-ONLY: NO escribe nada (acepta criterio #10).
--   · acc_execute_closing  → escribe SOLO con p_confirm=true + contabilidad.admin,
--     y rechaza si hay descuadrados / comprobantes sin asiento / período cerrado.
--   · Toda refundición genera un asiento trazable (source_type='adjustment',
--     source_id = closing_run). Reapertura auditada (acc_reopen_period).
--
-- COMPATIBILIDAD: ADITIVA. Reusa acc_create_posted_entry (0085) y las vistas de
-- control 0086/0089. No modifica nada existente. No aplica migraciones.
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. Enums + tabla de corridas de cierre
-- -------------------------------------------------------------------------
do $$ begin
  create type public.accounting_closing_type_t as enum (
    'monthly_check', 'annual_closing', 'income_statement_closing',
    'retained_earnings_transfer', 'adjustment'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.accounting_closing_status_t as enum (
    'draft', 'simulated', 'posted', 'reversed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.accounting_closing_runs (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete restrict,
  closing_type public.accounting_closing_type_t not null,
  status public.accounting_closing_status_t not null default 'draft',
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists acr_period_idx on public.accounting_closing_runs (period_id);
create index if not exists acr_status_idx on public.accounting_closing_runs (status);

drop trigger if exists trg_acr_updated_at on public.accounting_closing_runs;
create trigger trg_acr_updated_at
before update on public.accounting_closing_runs
for each row execute function public.touch_updated_at();

-- DELETE prohibido (append-only) — reutiliza el guard financiero (0053).
drop trigger if exists trg_acr_no_delete on public.accounting_closing_runs;
create trigger trg_acr_no_delete
before delete on public.accounting_closing_runs
for each row execute function public.tg_forbid_delete_financial();

alter table public.accounting_closing_runs enable row level security;
drop policy if exists "acr read internal" on public.accounting_closing_runs;
create policy "acr read internal" on public.accounting_closing_runs for select
  using (public.current_role() in ('admin','operaciones','supervisor')
         or public.has_permission('contabilidad.view'));
drop policy if exists "acr write" on public.accounting_closing_runs;
create policy "acr write" on public.accounting_closing_runs for all
  using (public.current_role() = 'admin' or public.has_permission('contabilidad.admin'))
  with check (public.current_role() = 'admin' or public.has_permission('contabilidad.admin'));

-- -------------------------------------------------------------------------
-- 2. Helper interno: blockers de cierre de un período (jsonb).
-- -------------------------------------------------------------------------
create or replace function public.acc_closing_blockers(p_period_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.accounting_period_status_t; v_start date; v_end date; v_per text;
  v_desc int; v_sin int; v_iva int; v_block jsonb := '[]'::jsonb;
begin
  select status, start_date, end_date into v_status, v_start, v_end
  from public.accounting_periods where id = p_period_id;
  if v_start is null then
    return jsonb_build_object('found', false);
  end if;
  v_per := to_char(v_start, 'YYYY-MM');

  if v_status in ('closed','locked') then
    v_block := v_block || jsonb_build_array('periodo_'||v_status::text);
  end if;

  select count(*) into v_desc from public.v_asientos_descuadrados d
   where d.entry_date between v_start and v_end;
  if v_desc > 0 then v_block := v_block || jsonb_build_array('asientos_descuadrados:'||v_desc); end if;

  select count(*) into v_sin from public.v_comprobantes_sin_asiento c
   where c.fecha between v_start and v_end;
  if v_sin > 0 then v_block := v_block || jsonb_build_array('comprobantes_sin_asiento:'||v_sin); end if;

  select count(*) into v_iva from public.v_iva_fiscal_vs_contable f
   where f.periodo = v_per and (abs(f.dif_debito) > 0.02 or abs(f.dif_credito) > 0.02);
  if v_iva > 0 then v_block := v_block || jsonb_build_array('iva_fiscal_vs_contable:'||v_iva); end if;

  return jsonb_build_object('found', true, 'periodo', v_per, 'status', v_status,
    'descuadrados', v_desc, 'comprobantes_sin_asiento', v_sin, 'iva_diffs', v_iva,
    'blockers', v_block, 'ready', jsonb_array_length(v_block) = 0);
end; $$;
revoke all on function public.acc_closing_blockers(uuid) from public;
grant execute on function public.acc_closing_blockers(uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 3. Helper interno: líneas de refundición del período (jsonb) + resultado.
-- -------------------------------------------------------------------------
create or replace function public.acc_closing_proposed_lines(p_period_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_start date; v_end date; v_lines jsonb; v_resultado numeric; v_res_acct uuid;
begin
  select start_date, end_date into v_start, v_end from public.accounting_periods where id = p_period_id;
  if v_start is null then return jsonb_build_object('lines','[]'::jsonb,'resultado',0); end if;

  with raw as (
    select coa.id as account_id, coa.code, coa.type,
           round(sum(l.credit - l.debit), 2) as ingreso_net,   -- ingresos: saldo acreedor
           round(sum(l.debit - l.credit), 2) as gasto_net       -- gastos: saldo deudor
    from public.journal_entry_lines l
    join public.journal_entries je on je.id = l.journal_entry_id
    join public.chart_of_accounts coa on coa.id = l.account_id
    where je.status = 'posted' and je.entry_date between v_start and v_end
      and coa.type in ('ingreso','gasto')
    group by coa.id, coa.code, coa.type
  ),
  closes as (
    select account_id, code,
           case when type = 'ingreso' then ingreso_net else 0 end as deb,
           case when type = 'gasto'   then gasto_net   else 0 end as cre
    from raw
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'account_id', account_id, 'debit', deb, 'credit', cre,
           'description', 'Refundición '||code, 'cost_center_id', null,
           'line_no', row_number() over (order by code)
         )), '[]'::jsonb)
    into v_lines
  from closes where deb <> 0 or cre <> 0;

  select coalesce(sum(l.credit - l.debit), 0) into v_resultado
  from public.journal_entry_lines l
  join public.journal_entries je on je.id = l.journal_entry_id
  join public.chart_of_accounts coa on coa.id = l.account_id
  where je.status = 'posted' and je.entry_date between v_start and v_end
    and coa.type in ('ingreso','gasto');

  if jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('lines','[]'::jsonb,'resultado',0);
  end if;

  -- Contrapartida: 3.2.02 Resultado del Ejercicio (HABER si ganancia, DEBE si pérdida).
  v_res_acct := public.acc_account_id('3.2.02');
  if v_resultado > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_res_acct, 'debit', 0, 'credit', round(v_resultado,2),
      'description', 'Resultado del ejercicio (ganancia)', 'cost_center_id', null, 'line_no', 999));
  elsif v_resultado < 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_res_acct, 'debit', round(-v_resultado,2), 'credit', 0,
      'description', 'Resultado del ejercicio (pérdida)', 'cost_center_id', null, 'line_no', 999));
  end if;

  return jsonb_build_object('lines', v_lines, 'resultado', round(v_resultado,2));
end; $$;
revoke all on function public.acc_closing_proposed_lines(uuid) from public;
grant execute on function public.acc_closing_proposed_lines(uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 4. RPC · SIMULAR cierre (READ-ONLY — no escribe). Criterio de aceptación #10.
-- -------------------------------------------------------------------------
create or replace function public.acc_simulate_closing(
  p_period_id uuid,
  p_closing_type text default 'income_statement_closing'
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_block jsonb; v_prop jsonb;
begin
  if not (public.has_permission('contabilidad.view') or public.current_role() = 'admin') then
    raise exception 'FORBIDDEN: requiere permiso contabilidad.view' using errcode='42501';
  end if;
  v_block := public.acc_closing_blockers(p_period_id);
  if not (v_block->>'found')::boolean then
    raise exception 'PERIOD_NOT_FOUND: %', p_period_id using errcode='no_data_found';
  end if;
  v_prop := public.acc_closing_proposed_lines(p_period_id);

  return jsonb_build_object(
    'ok', true,
    'dry_run', true,
    'closing_type', p_closing_type,
    'period_id', p_period_id,
    'periodo', v_block->>'periodo',
    'ready', (v_block->>'ready')::boolean,
    'blockers', v_block->'blockers',
    'descuadrados', v_block->'descuadrados',
    'comprobantes_sin_asiento', v_block->'comprobantes_sin_asiento',
    'iva_diffs', v_block->'iva_diffs',
    'resultado', v_prop->'resultado',
    'proposed_lines', v_prop->'lines',
    'nota', 'Simulación READ-ONLY: no modifica datos. Ejecutar el cierre requiere acc_execute_closing(confirm=true) y permiso contabilidad.admin.'
  );
end; $$;
revoke all on function public.acc_simulate_closing(uuid, text) from public;
grant execute on function public.acc_simulate_closing(uuid, text) to authenticated;

-- -------------------------------------------------------------------------
-- 5. RPC · EJECUTAR cierre (escribe; gateado: confirm + contabilidad.admin).
-- -------------------------------------------------------------------------
create or replace function public.acc_execute_closing(
  p_period_id uuid,
  p_closing_type text default 'income_statement_closing',
  p_confirm boolean default false,
  p_notes text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_block jsonb; v_prop jsonb; v_lines jsonb; v_resultado numeric;
  v_run_id uuid; v_entry jsonb; v_end date;
begin
  if not (public.has_permission('contabilidad.admin') or public.current_role() = 'admin') then
    raise exception 'FORBIDDEN: requiere permiso contabilidad.admin' using errcode='42501';
  end if;
  if not p_confirm then
    raise exception 'CONFIRM_REQUIRED: el cierre real exige p_confirm=true (usá acc_simulate_closing primero)' using errcode='check_violation';
  end if;

  v_block := public.acc_closing_blockers(p_period_id);
  if not (v_block->>'found')::boolean then
    raise exception 'PERIOD_NOT_FOUND: %', p_period_id using errcode='no_data_found';
  end if;
  if not (v_block->>'ready')::boolean then
    raise exception 'PERIOD_NOT_READY: hay bloqueos para el cierre: %', (v_block->'blockers')::text using errcode='check_violation';
  end if;
  if exists (select 1 from public.accounting_closing_runs
             where period_id = p_period_id and closing_type = p_closing_type::public.accounting_closing_type_t
               and status = 'posted') then
    raise exception 'ALREADY_CLOSED: ya existe un cierre % posteado para el período', p_closing_type using errcode='check_violation';
  end if;

  v_prop := public.acc_closing_proposed_lines(p_period_id);
  v_lines := v_prop->'lines';
  v_resultado := (v_prop->>'resultado')::numeric;
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'NO_RESULT_TO_CLOSE: el período no tiene movimientos de resultado' using errcode='check_violation';
  end if;

  select end_date into v_end from public.accounting_periods where id = p_period_id;

  insert into public.accounting_closing_runs (period_id, closing_type, status, started_at, created_by, notes)
  values (p_period_id, p_closing_type::public.accounting_closing_type_t, 'draft', now(), auth.uid(), p_notes)
  returning id into v_run_id;

  -- Asiento de refundición (período aún abierto). Trazable: source_id = run.
  v_entry := public.acc_create_posted_entry('adjustment', v_run_id, v_end,
    'Refundición de resultados '||(v_block->>'periodo')||' (run '||v_run_id||')',
    v_lines, false);

  update public.accounting_closing_runs
    set status = 'posted', completed_at = now(),
        journal_entry_id = nullif(v_entry->>'entry_id','')::uuid
  where id = v_run_id;

  -- Recién ahora se cierra el período.
  update public.accounting_periods
    set status = 'closed', closed_at = now(), closed_by = auth.uid()
  where id = p_period_id;

  return jsonb_build_object('ok', true, 'closing_run_id', v_run_id,
    'journal_entry_id', v_entry->>'entry_id', 'resultado', v_resultado,
    'periodo', v_block->>'periodo', 'period_status', 'closed');
end; $$;
revoke all on function public.acc_execute_closing(uuid, text, boolean, text) from public;
grant execute on function public.acc_execute_closing(uuid, text, boolean, text) to authenticated;

-- -------------------------------------------------------------------------
-- 6. RPC · REABRIR período (auditado: reversa del asiento + run 'reversed').
-- -------------------------------------------------------------------------
create or replace function public.acc_reopen_period(p_period_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_run record; v_rev jsonb;
begin
  if not (public.has_permission('contabilidad.admin') or public.current_role() = 'admin') then
    raise exception 'FORBIDDEN: requiere permiso contabilidad.admin' using errcode='42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REOPEN_REASON_REQUIRED' using errcode='check_violation';
  end if;

  -- Reabrir el período.
  update public.accounting_periods set status = 'open', closed_at = null, closed_by = null
  where id = p_period_id and status in ('closed','locked');

  -- Revertir los cierres posteados (asiento inverso + marcar run reversed).
  for v_run in
    select id, journal_entry_id from public.accounting_closing_runs
    where period_id = p_period_id and status = 'posted'
  loop
    if v_run.journal_entry_id is not null then
      v_rev := public.acc_reverse_entry(v_run.journal_entry_id, 'Reapertura período: '||p_reason);
    end if;
    update public.accounting_closing_runs set status = 'reversed', notes = coalesce(notes,'')||' | reabierto: '||p_reason
    where id = v_run.id;
  end loop;

  return jsonb_build_object('ok', true, 'period_id', p_period_id, 'status', 'open', 'reason', p_reason);
end; $$;
revoke all on function public.acc_reopen_period(uuid, text) from public;
grant execute on function public.acc_reopen_period(uuid, text) to authenticated;

-- -------------------------------------------------------------------------
-- 7. Vistas de control de cierre
-- -------------------------------------------------------------------------
create or replace view public.v_periodos_para_cierre
with (security_invoker = true) as
select *,
  case when status in ('closed','locked') then false
       when descuadrados = 0 and comprobantes_sin_asiento = 0 and iva_diffs = 0 then true
       else false end as listo
from (
  select
    p.id as period_id, p.year, p.month, p.start_date, p.end_date, p.status,
    (select count(*) from public.v_asientos_descuadrados d where d.entry_date between p.start_date and p.end_date) as descuadrados,
    (select count(*) from public.v_comprobantes_sin_asiento c where c.fecha between p.start_date and p.end_date) as comprobantes_sin_asiento,
    (select count(*) from public.v_iva_fiscal_vs_contable f
       where f.periodo = to_char(p.start_date,'YYYY-MM')
         and (abs(f.dif_debito) > 0.02 or abs(f.dif_credito) > 0.02)) as iva_diffs
  from public.accounting_periods p
) q;

comment on view public.v_periodos_para_cierre is
  'Estado de cierre por período: descuadrados, comprobantes sin asiento, diffs IVA y flag listo.';

create or replace view public.v_refundicion_simulacion
with (security_invoker = true) as
select
  to_char(je.entry_date, 'YYYY-MM') as periodo,
  coalesce(sum(l.credit - l.debit) filter (where coa.type = 'ingreso'), 0)  as ingresos,
  coalesce(-sum(l.credit - l.debit) filter (where coa.type = 'gasto'), 0)   as gastos,
  coalesce(sum(l.credit - l.debit) filter (where coa.type in ('ingreso','gasto')), 0) as resultado_estimado
from public.journal_entries je
join public.journal_entry_lines l on l.journal_entry_id = je.id
join public.chart_of_accounts coa on coa.id = l.account_id
where je.status = 'posted' and coa.type in ('ingreso','gasto')
group by to_char(je.entry_date, 'YYYY-MM');

comment on view public.v_refundicion_simulacion is
  'Resultado estimado por período (ingresos − gastos) que la refundición transferiría a 3.2.02.';

grant select on public.v_periodos_para_cierre   to authenticated;
grant select on public.v_refundicion_simulacion to authenticated;

notify pgrst, 'reload schema';
