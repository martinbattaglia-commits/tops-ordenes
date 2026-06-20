-- =========================================================================
-- 0101_annual_closing.sql — Fase 13.H · Refundición ANUAL (simulación read-only
--   + ejecución gateada)
--
-- Extiende el cierre de Fase 12 (mensual) al ejercicio anual. Modelo:
--   · El cierre mensual (income_statement_closing, 0095) transfiere el resultado
--     de cada mes a 3.2.02 Resultado del Ejercicio.
--   · La refundición ANUAL transfiere el saldo de 3.2.02 → 3.2.01 Resultados No
--     Asignados (retained_earnings_transfer). Compone con lo mensual sin duplicar.
--   · Simulación 100% read-only. Ejecución: confirm=true + contabilidad.admin,
--     sin períodos abiertos con movimiento, sin descuadrados/comprobantes/diffs,
--     sin doble refundición del mismo ejercicio.
--
-- NATURALEZA: ADITIVA. Reusa acc_create_posted_entry / acc_reverse_entry (0085) y
-- accounting_closing_runs (0095). No aplica migraciones.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Blockers del ejercicio anual (jsonb).
-- -------------------------------------------------------------------------
create or replace function public.acc_annual_blockers(p_year int)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_start date := make_date(p_year, 1, 1);
  v_end   date := make_date(p_year, 12, 31);
  v_open int; v_desc int; v_sin int; v_iva int; v_block jsonb := '[]'::jsonb;
begin
  -- Períodos abiertos CON movimiento dentro del año (cierre mensual pendiente).
  select count(*) into v_open
  from public.accounting_periods p
  where p.start_date >= v_start and p.end_date <= v_end and p.status = 'open'
    and exists (select 1 from public.journal_entries je where je.status='posted'
                and je.entry_date between p.start_date and p.end_date);
  if v_open > 0 then v_block := v_block || jsonb_build_array('periodos_abiertos_con_movimiento:'||v_open); end if;

  select count(*) into v_desc from public.v_asientos_descuadrados d where d.entry_date between v_start and v_end;
  if v_desc > 0 then v_block := v_block || jsonb_build_array('asientos_descuadrados:'||v_desc); end if;

  select count(*) into v_sin from public.v_comprobantes_sin_asiento c where c.fecha between v_start and v_end;
  if v_sin > 0 then v_block := v_block || jsonb_build_array('comprobantes_sin_asiento:'||v_sin); end if;

  select count(*) into v_iva from public.v_iva_fiscal_vs_contable f
   where f.periodo between to_char(v_start,'YYYY-MM') and to_char(v_end,'YYYY-MM')
     and (abs(f.dif_debito) > 0.02 or abs(f.dif_credito) > 0.02);
  if v_iva > 0 then v_block := v_block || jsonb_build_array('iva_fiscal_vs_contable:'||v_iva); end if;

  return jsonb_build_object('year', p_year, 'periodos_abiertos', v_open, 'descuadrados', v_desc,
    'comprobantes_sin_asiento', v_sin, 'iva_diffs', v_iva,
    'blockers', v_block, 'ready', jsonb_array_length(v_block) = 0);
end; $$;
revoke all on function public.acc_annual_blockers(int) from public;
grant execute on function public.acc_annual_blockers(int) to authenticated;

-- -------------------------------------------------------------------------
-- 2. SIMULAR refundición anual (READ-ONLY). Acepta criterio #10/#11/#12.
-- -------------------------------------------------------------------------
create or replace function public.acc_simulate_annual_closing(p_year int)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_start date := make_date(p_year, 1, 1);
  v_end   date := make_date(p_year, 12, 31);
  v_block jsonb; v_resultado numeric; v_saldo_re numeric; v_lines jsonb := '[]'::jsonb;
  v_re uuid; v_rna uuid; v_already boolean;
begin
  if not (public.has_permission('contabilidad.view') or public.current_role() = 'admin') then
    raise exception 'FORBIDDEN: requiere permiso contabilidad.view' using errcode='42501';
  end if;
  v_block := public.acc_annual_blockers(p_year);

  -- Resultado del ejercicio (P&L del año) — debe coincidir con el EERR.
  select coalesce(sum(l.credit - l.debit), 0) into v_resultado
  from public.journal_entries je
  join public.journal_entry_lines l on l.journal_entry_id = je.id
  join public.chart_of_accounts coa on coa.id = l.account_id
  where je.status = 'posted' and je.entry_date between v_start and v_end and coa.type in ('ingreso','gasto');

  -- Saldo actual de 3.2.02 (lo que la refundición mensual ya acumuló en el año).
  v_re := public.acc_account_id('3.2.02');
  v_rna := public.acc_account_id('3.2.01');
  select coalesce(sum(l.credit - l.debit), 0) into v_saldo_re
  from public.journal_entries je
  join public.journal_entry_lines l on l.journal_entry_id = je.id
  where je.status = 'posted' and je.entry_date between v_start and v_end and l.account_id = v_re;

  -- Asiento propuesto: transferir saldo de 3.2.02 → 3.2.01.
  if v_saldo_re > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_re,  'debit', round(v_saldo_re,2), 'credit', 0, 'description','Cierre Resultado del Ejercicio','line_no',1),
      jsonb_build_object('account_id', v_rna, 'debit', 0, 'credit', round(v_saldo_re,2), 'description','A Resultados No Asignados','line_no',2));
  elsif v_saldo_re < 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_re,  'debit', 0, 'credit', round(-v_saldo_re,2), 'description','Cierre Resultado del Ejercicio','line_no',1),
      jsonb_build_object('account_id', v_rna, 'debit', round(-v_saldo_re,2), 'credit', 0, 'description','A Resultados No Asignados','line_no',2));
  end if;

  select exists(select 1 from public.accounting_closing_runs r
    join public.accounting_periods p on p.id = r.period_id
    where r.closing_type in ('annual_closing','retained_earnings_transfer') and r.status = 'posted'
      and p.start_date >= v_start and p.end_date <= v_end) into v_already;

  return jsonb_build_object(
    'ok', true, 'dry_run', true, 'year', p_year,
    'ready', (v_block->>'ready')::boolean,
    'blockers', v_block->'blockers',
    'resultado_ejercicio', round(v_resultado,2),
    'saldo_resultado_ejercicio_3_2_02', round(v_saldo_re,2),
    'transferencia_a_resultados_no_asignados', round(v_saldo_re,2),
    'proposed_lines', v_lines,
    'ya_refundido', v_already,
    'nota', case
      when abs(v_saldo_re) < 0.01 and abs(v_resultado) >= 0.01
        then 'Atención: 3.2.02 está en 0 pero el ejercicio tiene resultado. Ejecutá los cierres mensuales (income_statement_closing) antes de la refundición anual.'
      else 'Simulación READ-ONLY: no modifica datos. La refundición real exige acc_execute_annual_closing(confirm=true) + contabilidad.admin.'
    end
  );
end; $$;
revoke all on function public.acc_simulate_annual_closing(int) from public;
grant execute on function public.acc_simulate_annual_closing(int) to authenticated;

-- -------------------------------------------------------------------------
-- 3. EJECUTAR refundición anual (gateado). Transfiere 3.2.02 → 3.2.01.
-- -------------------------------------------------------------------------
create or replace function public.acc_execute_annual_closing(
  p_year int, p_confirm boolean default false, p_post_date date default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_start date := make_date(p_year, 1, 1);
  v_end   date := make_date(p_year, 12, 31);
  v_block jsonb; v_saldo_re numeric; v_re uuid; v_rna uuid; v_lines jsonb;
  v_post date; v_period uuid; v_pstatus public.accounting_period_status_t;
  v_run_id uuid; v_entry jsonb;
begin
  if not (public.has_permission('contabilidad.admin') or public.current_role() = 'admin') then
    raise exception 'FORBIDDEN: requiere permiso contabilidad.admin' using errcode='42501';
  end if;
  if not p_confirm then
    raise exception 'CONFIRM_REQUIRED: usá acc_simulate_annual_closing primero; la refundición real exige p_confirm=true' using errcode='check_violation';
  end if;

  v_block := public.acc_annual_blockers(p_year);
  if not (v_block->>'ready')::boolean then
    raise exception 'ANNUAL_NOT_READY: %', (v_block->'blockers')::text using errcode='check_violation';
  end if;

  -- Doble refundición prohibida.
  if exists (select 1 from public.accounting_closing_runs r
             join public.accounting_periods p on p.id = r.period_id
             where r.closing_type in ('annual_closing','retained_earnings_transfer') and r.status='posted'
               and p.start_date >= v_start and p.end_date <= v_end) then
    raise exception 'ALREADY_CLOSED_ANNUAL: el ejercicio % ya fue refundido', p_year using errcode='check_violation';
  end if;

  v_re := public.acc_account_id('3.2.02');
  v_rna := public.acc_account_id('3.2.01');
  select coalesce(sum(l.credit - l.debit), 0) into v_saldo_re
  from public.journal_entries je
  join public.journal_entry_lines l on l.journal_entry_id = je.id
  where je.status = 'posted' and je.entry_date between v_start and v_end and l.account_id = v_re;

  if abs(v_saldo_re) < 0.01 then
    raise exception 'NO_RESULT_TO_TRANSFER: 3.2.02 está en 0 (¿faltan los cierres mensuales?)' using errcode='check_violation';
  end if;

  -- Período destino del asiento (default 31/12 del año). Debe estar abierto.
  v_post := coalesce(p_post_date, v_end);
  v_period := public.acc_ensure_period(v_post);
  select status into v_pstatus from public.accounting_periods where id = v_period;
  if v_pstatus in ('closed','locked') then
    raise exception 'POST_PERIOD_CLOSED: el período de % está % — reabrilo o elegí otra fecha de imputación', v_post, v_pstatus using errcode='check_violation';
  end if;

  if v_saldo_re > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_re,  'debit', round(v_saldo_re,2), 'credit', 0, 'description','Cierre Resultado del Ejercicio '||p_year,'line_no',1),
      jsonb_build_object('account_id', v_rna, 'debit', 0, 'credit', round(v_saldo_re,2), 'description','A Resultados No Asignados '||p_year,'line_no',2));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_re,  'debit', 0, 'credit', round(-v_saldo_re,2), 'description','Cierre Resultado del Ejercicio '||p_year,'line_no',1),
      jsonb_build_object('account_id', v_rna, 'debit', round(-v_saldo_re,2), 'credit', 0, 'description','A Resultados No Asignados '||p_year,'line_no',2));
  end if;

  insert into public.accounting_closing_runs (period_id, closing_type, status, started_at, created_by, notes)
  values (v_period, 'retained_earnings_transfer', 'draft', now(), auth.uid(), 'Refundición anual '||p_year)
  returning id into v_run_id;

  v_entry := public.acc_create_posted_entry('adjustment', v_run_id, v_post,
    'Refundición anual '||p_year||' — Resultado a Resultados No Asignados (run '||v_run_id||')',
    v_lines, false);

  update public.accounting_closing_runs
    set status = 'posted', completed_at = now(), journal_entry_id = nullif(v_entry->>'entry_id','')::uuid
  where id = v_run_id;

  return jsonb_build_object('ok', true, 'year', p_year, 'closing_run_id', v_run_id,
    'journal_entry_id', v_entry->>'entry_id', 'transferido', round(v_saldo_re,2));
end; $$;
revoke all on function public.acc_execute_annual_closing(int, boolean, date) from public;
grant execute on function public.acc_execute_annual_closing(int, boolean, date) to authenticated;

-- -------------------------------------------------------------------------
-- 4. Vista de resultado anual.
-- -------------------------------------------------------------------------
create or replace view public.v_resultado_anual
with (security_invoker = true) as
select
  extract(year from je.entry_date)::int as ejercicio,
  coalesce(sum(l.credit - l.debit) filter (where coa.type = 'ingreso'), 0) as ingresos,
  coalesce(-sum(l.credit - l.debit) filter (where coa.type = 'gasto'), 0)  as gastos,
  coalesce(sum(l.credit - l.debit) filter (where coa.type in ('ingreso','gasto')), 0) as resultado_ejercicio
from public.journal_entries je
join public.journal_entry_lines l on l.journal_entry_id = je.id
join public.chart_of_accounts coa on coa.id = l.account_id
where je.status = 'posted' and coa.type in ('ingreso','gasto')
group by extract(year from je.entry_date);

comment on view public.v_resultado_anual is
  'Resultado del ejercicio por año (ingresos − gastos), base de la refundición anual.';

grant select on public.v_resultado_anual to authenticated;

notify pgrst, 'reload schema';
