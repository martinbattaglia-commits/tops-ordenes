-- =========================================================================
-- 0085_accounting_posting.sql — Capa Contable · Motor de asientos automáticos
--
-- RPCs SECURITY DEFINER que generan el asiento (reflejo contable) de cada
-- documento operativo, balanceado por partida doble, idempotente y trazable
-- (source_type + source_id). Reglas de imputación tomadas de accounting_rules
-- (0084) → 100% configurable. Notas de crédito invierten debe/haber. Anulación
-- = asiento de REVERSA (nunca delete). Soporta DRY-RUN para backfill seguro.
--
-- Estados que habilitan posteo:
--   · customer_invoice : estado_arca='AUTORIZADO_ARCA' ∧ ¬anulada
--   · supplier_invoice : approval_status='aprobada'
--   · customer_receipt : status='confirmado'
--   · supplier_payment : status='confirmado'
--
-- NATURALEZA: ADITIVA. Lee tablas fiscales/tesorería sin modificarlas.
-- Requiere 0083 (tablas) y 0084 (plan + reglas).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Helpers internos
-- -------------------------------------------------------------------------

-- Resuelve (source_type, rule_key) → account_id vía accounting_rules + COA.
create or replace function public.acc_rule_account(p_source text, p_key text)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coa.id
  from public.accounting_rules r
  join public.chart_of_accounts coa on coa.code = r.account_code
  where r.source_type = p_source and r.rule_key = p_key;
$$;
revoke all on function public.acc_rule_account(text, text) from public;

-- Construye un fragmento de línea (array jsonb de 0 ó 1 elemento). Aplica el
-- signo de NC: si p_is_nc, invierte debe/haber. Devuelve '[]' si monto <= 0.
create or replace function public.acc_mk_line(
  p_account_id uuid, p_side text, p_amount numeric, p_is_nc boolean,
  p_descr text, p_cc uuid, p_line_no int
) returns jsonb
language sql immutable
as $$
  select case
    when p_amount is null or p_amount <= 0 then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object(
      'account_id', p_account_id,
      'debit',  case when (p_side = 'D') <> p_is_nc then p_amount else 0 end,
      'credit', case when (p_side = 'D') <> p_is_nc then 0 else p_amount end,
      'description', p_descr,
      'cost_center_id', p_cc,
      'line_no', p_line_no
    ))
  end;
$$;

-- Núcleo: crea y postea un asiento balanceado a partir de líneas jsonb.
-- Idempotente por (source_type, source_id) salvo reversas. DRY-RUN no escribe.
create or replace function public.acc_create_posted_entry(
  p_source_type public.journal_source_t,
  p_source_id   uuid,
  p_entry_date  date,
  p_description text,
  p_lines       jsonb,
  p_dry_run     boolean default false,
  p_reversed_entry_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_debit numeric; v_credit numeric; v_n int;
  v_period uuid; v_pstatus public.accounting_period_status_t;
  v_eid uuid; v_num bigint; v_existing uuid;
begin
  select coalesce(sum((l->>'debit')::numeric),0),
         coalesce(sum((l->>'credit')::numeric),0),
         count(*)
    into v_debit, v_credit, v_n
  from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) l;

  if v_n = 0 then
    return jsonb_build_object('ok', false, 'message', 'sin_lineas',
      'source_type', p_source_type, 'source_id', p_source_id);
  end if;
  if round(v_debit,2) <> round(v_credit,2) then
    raise exception 'ACC_UNBALANCED: debe=% / haber=% para % %', v_debit, v_credit, p_source_type, p_source_id
      using errcode = 'check_violation';
  end if;

  -- Idempotencia (no aplica a reversas): si ya existe asiento activo, skip.
  if p_reversed_entry_id is null and p_source_id is not null then
    select id into v_existing from public.journal_entries
    where source_type = p_source_type and source_id = p_source_id
      and status in ('draft','posted') and reversed_entry_id is null
    limit 1;
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'skipped', true, 'entry_id', v_existing,
        'source_type', p_source_type, 'source_id', p_source_id,
        'message', 'ya_contabilizado');
    end if;
  end if;

  if p_dry_run then
    return jsonb_build_object('ok', true, 'dry_run', true, 'skipped', false,
      'source_type', p_source_type, 'source_id', p_source_id,
      'debit', round(v_debit,2), 'credit', round(v_credit,2), 'balanced', true,
      'lines', p_lines);
  end if;

  v_period := public.acc_ensure_period(p_entry_date);
  select status into v_pstatus from public.accounting_periods where id = v_period;
  if v_pstatus in ('closed','locked') then
    raise exception 'ACC_PERIOD_CLOSED: el período de % está % — no admite asientos', p_entry_date, v_pstatus
      using errcode = 'check_violation';
  end if;

  insert into public.journal_entries
    (entry_date, period_id, source_type, source_id, description, status,
     reversed_entry_id, created_by)
  values
    (p_entry_date, v_period, p_source_type, p_source_id, p_description, 'draft',
     p_reversed_entry_id, auth.uid())
  returning id into v_eid;

  insert into public.journal_entry_lines
    (journal_entry_id, account_id, description, debit, credit, cost_center_id, line_no)
  select
    v_eid,
    (l->>'account_id')::uuid,
    nullif(l->>'description',''),
    coalesce((l->>'debit')::numeric,0),
    coalesce((l->>'credit')::numeric,0),
    nullif(l->>'cost_center_id','')::uuid,
    coalesce((l->>'line_no')::int, 0)
  from jsonb_array_elements(p_lines) l;

  v_num := nextval('public.journal_entry_number_seq');
  update public.journal_entries
    set entry_number = v_num, status = 'posted', posted_at = now()
  where id = v_eid;

  return jsonb_build_object('ok', true, 'skipped', false, 'dry_run', false,
    'entry_id', v_eid, 'entry_number', v_num,
    'source_type', p_source_type, 'source_id', p_source_id,
    'debit', round(v_debit,2), 'credit', round(v_credit,2), 'balanced', true);
end; $$;
revoke all on function public.acc_create_posted_entry(public.journal_source_t, uuid, date, text, jsonb, boolean, uuid) from public;

-- Gate de permiso común a las RPC públicas de posteo.
create or replace function public.acc_require_post_permission()
returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('contabilidad.create') then
    raise exception 'ACC_DENIED: requiere permiso contabilidad.create' using errcode = 'insufficient_privilege';
  end if;
end; $$;
revoke all on function public.acc_require_post_permission() from public;

-- -------------------------------------------------------------------------
-- 2. Posteo: factura de venta (débito fiscal)
-- -------------------------------------------------------------------------
create or replace function public.acc_post_sales_invoice(p_invoice_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  ci public.customer_invoices;
  v_nc boolean; v_lines jsonb := '[]'::jsonb;
  v_total numeric;
begin
  perform public.acc_require_post_permission();
  select * into ci from public.customer_invoices where id = p_invoice_id;
  if ci.id is null then
    raise exception 'ACC_DOC_NOT_FOUND: factura de venta % inexistente', p_invoice_id using errcode='no_data_found';
  end if;
  if ci.estado_arca <> 'AUTORIZADO_ARCA' or ci.anulada then
    return jsonb_build_object('ok', false, 'skipped', true, 'source_type','customer_invoice',
      'source_id', p_invoice_id, 'message', 'no_contabilizable (estado='||ci.estado_arca||', anulada='||ci.anulada||')');
  end if;
  v_nc := ci.tipo_comprobante::text like 'NOTA_CREDITO%';
  v_total := coalesce(ci.subtotal,0) + coalesce(ci.importe_no_gravado,0) + coalesce(ci.importe_exento,0)
           + coalesce(ci.iva,0) + coalesce(ci.percepciones,0) + coalesce(ci.tributos,0);

  v_lines := v_lines
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','receivable'), 'D', v_total, v_nc, 'Deudores por ventas', null, 1)
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','revenue'), 'H', coalesce(ci.subtotal,0), v_nc, 'Ventas (neto gravado)', null, 2)
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','revenue_exento'), 'H', coalesce(ci.importe_no_gravado,0)+coalesce(ci.importe_exento,0), v_nc, 'Ventas no gravadas/exentas', null, 3)
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','iva_debito'), 'H', coalesce(ci.iva,0), v_nc, 'IVA débito fiscal', null, 4)
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','percepciones_a_depositar'), 'H', coalesce(ci.percepciones,0), v_nc, 'Percepciones a depositar', null, 5)
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','otros_tributos_a_depositar'), 'H', coalesce(ci.tributos,0), v_nc, 'Otros tributos', null, 6);

  return public.acc_create_posted_entry('customer_invoice', p_invoice_id, ci.created_at::date,
    'Venta '||ci.tipo_comprobante||' '||coalesce(ci.punto_venta::text,'')||'-'||coalesce(ci.numero_comprobante::text,'')||' '||coalesce(ci.razon_social,''),
    v_lines, p_dry_run);
end; $$;
revoke all on function public.acc_post_sales_invoice(uuid, boolean) from public;
grant execute on function public.acc_post_sales_invoice(uuid, boolean) to authenticated;

-- -------------------------------------------------------------------------
-- 3. Posteo: factura de compra (crédito fiscal)
-- -------------------------------------------------------------------------
create or replace function public.acc_post_purchase_invoice(p_invoice_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  si public.supplier_invoices;
  v_nc boolean; v_lines jsonb := '[]'::jsonb;
  v_expense numeric; v_total numeric;
begin
  perform public.acc_require_post_permission();
  select * into si from public.supplier_invoices where id = p_invoice_id;
  if si.id is null then
    raise exception 'ACC_DOC_NOT_FOUND: factura de compra % inexistente', p_invoice_id using errcode='no_data_found';
  end if;
  if si.approval_status <> 'aprobada' then
    return jsonb_build_object('ok', false, 'skipped', true, 'source_type','supplier_invoice',
      'source_id', p_invoice_id, 'message', 'no_contabilizable (approval_status='||si.approval_status||')');
  end if;
  v_nc := si.tipo_comprobante::text like 'NOTA_CREDITO%';
  v_expense := coalesce(si.neto,0) + coalesce(si.importe_no_gravado,0) + coalesce(si.importe_exento,0) + coalesce(si.tributos,0);
  v_total := v_expense + coalesce(si.iva,0) + coalesce(si.percepciones,0);

  v_lines := v_lines
    || public.acc_mk_line(public.acc_rule_account('supplier_invoice','expense'), 'D', v_expense, v_nc, 'Gasto/Costo (neto+no grav+exento+tributos)', si.cost_center_id, 1)
    || public.acc_mk_line(public.acc_rule_account('supplier_invoice','iva_credito'), 'D', coalesce(si.iva,0), v_nc, 'IVA crédito fiscal', null, 2)
    || public.acc_mk_line(public.acc_rule_account('supplier_invoice','percepciones_sufridas'), 'D', coalesce(si.percepciones,0), v_nc, 'Percepciones sufridas', null, 3)
    || public.acc_mk_line(public.acc_rule_account('supplier_invoice','payable'), 'H', v_total, v_nc, 'Proveedores', null, 4);

  return public.acc_create_posted_entry('supplier_invoice', p_invoice_id, si.fecha_emision,
    'Compra '||si.tipo_comprobante||' '||coalesce(si.punto_venta::text,'')||'-'||coalesce(si.numero,'')||' ('||si.public_id||')',
    v_lines, p_dry_run);
end; $$;
revoke all on function public.acc_post_purchase_invoice(uuid, boolean) from public;
grant execute on function public.acc_post_purchase_invoice(uuid, boolean) to authenticated;

-- -------------------------------------------------------------------------
-- 4. Posteo: cobranza de cliente
-- -------------------------------------------------------------------------
create or replace function public.acc_post_customer_receipt(p_receipt_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  cr public.customer_receipts;
  v_is_caja boolean; v_bank_acc uuid; v_lines jsonb := '[]'::jsonb;
begin
  perform public.acc_require_post_permission();
  select * into cr from public.customer_receipts where id = p_receipt_id;
  if cr.id is null then
    raise exception 'ACC_DOC_NOT_FOUND: cobranza % inexistente', p_receipt_id using errcode='no_data_found';
  end if;
  if cr.status <> 'confirmado' then
    return jsonb_build_object('ok', false, 'skipped', true, 'source_type','customer_receipt',
      'source_id', p_receipt_id, 'message', 'no_contabilizable (status='||cr.status||')');
  end if;
  select is_system into v_is_caja from public.bank_accounts where id = cr.bank_account_id;
  v_bank_acc := public.acc_rule_account('customer_receipt', case when coalesce(v_is_caja,false) then 'caja' else 'bank' end);

  v_lines := v_lines
    || public.acc_mk_line(v_bank_acc, 'D', coalesce(cr.net_amount,0), false, 'Ingreso de fondos', null, 1)
    || public.acc_mk_line(public.acc_rule_account('customer_receipt','retencion_sufrida'), 'D', coalesce(cr.retention_amount,0), false, 'Retenciones sufridas', null, 2)
    || public.acc_mk_line(public.acc_rule_account('customer_receipt','receivable'), 'H', coalesce(cr.gross_amount,0), false, 'Cancela deudores por ventas', null, 3);

  return public.acc_create_posted_entry('customer_receipt', p_receipt_id, cr.payment_date,
    'Cobranza '||cr.public_id, v_lines, p_dry_run);
end; $$;
revoke all on function public.acc_post_customer_receipt(uuid, boolean) from public;
grant execute on function public.acc_post_customer_receipt(uuid, boolean) to authenticated;

-- -------------------------------------------------------------------------
-- 5. Posteo: pago a proveedor
-- -------------------------------------------------------------------------
create or replace function public.acc_post_supplier_payment(p_payment_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  sp public.supplier_payments;
  v_is_caja boolean; v_bank_acc uuid; v_lines jsonb := '[]'::jsonb;
begin
  perform public.acc_require_post_permission();
  select * into sp from public.supplier_payments where id = p_payment_id;
  if sp.id is null then
    raise exception 'ACC_DOC_NOT_FOUND: pago % inexistente', p_payment_id using errcode='no_data_found';
  end if;
  if sp.status <> 'confirmado' then
    return jsonb_build_object('ok', false, 'skipped', true, 'source_type','supplier_payment',
      'source_id', p_payment_id, 'message', 'no_contabilizable (status='||sp.status||')');
  end if;
  select is_system into v_is_caja from public.bank_accounts where id = sp.bank_account_id;
  v_bank_acc := public.acc_rule_account('supplier_payment', case when coalesce(v_is_caja,false) then 'caja' else 'bank' end);

  v_lines := v_lines
    || public.acc_mk_line(public.acc_rule_account('supplier_payment','payable'), 'D', coalesce(sp.amount,0), false, 'Cancela proveedores', null, 1)
    || public.acc_mk_line(v_bank_acc, 'H', coalesce(sp.amount,0), false, 'Egreso de fondos', null, 2);

  return public.acc_create_posted_entry('supplier_payment', p_payment_id, sp.payment_date,
    'Pago '||sp.public_id, v_lines, p_dry_run);
end; $$;
revoke all on function public.acc_post_supplier_payment(uuid, boolean) from public;
grant execute on function public.acc_post_supplier_payment(uuid, boolean) to authenticated;

-- -------------------------------------------------------------------------
-- 6. Dispatcher genérico
-- -------------------------------------------------------------------------
create or replace function public.acc_post_document(p_source_type text, p_source_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  return case p_source_type
    when 'customer_invoice' then public.acc_post_sales_invoice(p_source_id, p_dry_run)
    when 'supplier_invoice' then public.acc_post_purchase_invoice(p_source_id, p_dry_run)
    when 'customer_receipt' then public.acc_post_customer_receipt(p_source_id, p_dry_run)
    when 'supplier_payment' then public.acc_post_supplier_payment(p_source_id, p_dry_run)
    else jsonb_build_object('ok', false, 'message', 'source_type_desconocido: '||p_source_type)
  end;
end; $$;
revoke all on function public.acc_post_document(text, uuid, boolean) from public;
grant execute on function public.acc_post_document(text, uuid, boolean) to authenticated;

-- -------------------------------------------------------------------------
-- 7. Reversa de asiento (anulación / NC manual). Crea asiento inverso, marca
--    el original como 'reversed'. Nunca borra. Idempotente (no re-reversa).
-- -------------------------------------------------------------------------
create or replace function public.acc_reverse_entry(p_entry_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  je public.journal_entries; v_lines jsonb := '[]'::jsonb; v_res jsonb; v_dup uuid;
begin
  perform public.acc_require_post_permission();
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'ACC_REVERSE_REASON_REQUIRED: motivo obligatorio' using errcode='check_violation';
  end if;
  select * into je from public.journal_entries where id = p_entry_id;
  if je.id is null then
    raise exception 'ACC_ENTRY_NOT_FOUND: asiento % inexistente', p_entry_id using errcode='no_data_found';
  end if;
  if je.status <> 'posted' then
    raise exception 'ACC_NOT_POSTED: solo se revierte un asiento posteado (estado actual %)', je.status using errcode='check_violation';
  end if;
  select id into v_dup from public.journal_entries where reversed_entry_id = p_entry_id and status = 'posted' limit 1;
  if v_dup is not null then
    return jsonb_build_object('ok', true, 'skipped', true, 'entry_id', v_dup, 'message','ya_revertido');
  end if;

  -- Líneas invertidas (debe↔haber).
  select coalesce(jsonb_agg(jsonb_build_object(
           'account_id', l.account_id,
           'debit',  l.credit,
           'credit', l.debit,
           'description', 'Reversa: '||coalesce(l.description,''),
           'cost_center_id', l.cost_center_id,
           'line_no', l.line_no
         ) order by l.line_no), '[]'::jsonb)
    into v_lines
  from public.journal_entry_lines l where l.journal_entry_id = p_entry_id;

  v_res := public.acc_create_posted_entry(je.source_type, je.source_id, current_date,
    'Reversa asiento N° '||coalesce(je.entry_number::text,'(s/n)')||' — '||p_reason,
    v_lines, false, p_entry_id);

  update public.journal_entries
    set status = 'reversed', reversal_of_reason = p_reason
  where id = p_entry_id;

  return jsonb_build_object('ok', true, 'reversed_entry_id', p_entry_id, 'reversal', v_res);
end; $$;
revoke all on function public.acc_reverse_entry(uuid, text) from public;
grant execute on function public.acc_reverse_entry(uuid, text) to authenticated;

-- -------------------------------------------------------------------------
-- 8. Backfill histórico (DRY-RUN por defecto). Recorre documentos elegibles
--    sin asiento activo y los contabiliza (o simula). Devuelve resumen.
-- -------------------------------------------------------------------------
create or replace function public.acc_backfill(
  p_source_type text,
  p_dry_run boolean default true,
  p_from date default null,
  p_to date default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  rec record; r jsonb;
  v_candidates int := 0; v_posted int := 0; v_skipped int := 0; v_errors int := 0;
  v_total_debit numeric := 0; v_err_list jsonb := '[]'::jsonb;
begin
  perform public.acc_require_post_permission();

  for rec in
    select id, d from (
      select ci.id, ci.created_at::date as d
      from public.customer_invoices ci
      where p_source_type = 'customer_invoice'
        and ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
      union all
      select si.id, si.fecha_emision as d
      from public.supplier_invoices si
      where p_source_type = 'supplier_invoice' and si.approval_status = 'aprobada'
      union all
      select cr.id, cr.payment_date as d
      from public.customer_receipts cr
      where p_source_type = 'customer_receipt' and cr.status = 'confirmado'
      union all
      select sp.id, sp.payment_date as d
      from public.supplier_payments sp
      where p_source_type = 'supplier_payment' and sp.status = 'confirmado'
    ) src
    where (p_from is null or src.d >= p_from)
      and (p_to   is null or src.d <= p_to)
  loop
    v_candidates := v_candidates + 1;
    begin
      r := public.acc_post_document(p_source_type, rec.id, p_dry_run);
      if coalesce((r->>'skipped')::boolean, false) then
        v_skipped := v_skipped + 1;
      elsif coalesce((r->>'ok')::boolean, false) then
        v_posted := v_posted + 1;
        v_total_debit := v_total_debit + coalesce((r->>'debit')::numeric, 0);
      else
        v_errors := v_errors + 1;
        v_err_list := v_err_list || jsonb_build_array(jsonb_build_object('id', rec.id, 'msg', r->>'message'));
      end if;
    exception when others then
      v_errors := v_errors + 1;
      v_err_list := v_err_list || jsonb_build_array(jsonb_build_object('id', rec.id, 'msg', sqlerrm));
    end;
  end loop;

  return jsonb_build_object(
    'ok', v_errors = 0,
    'source_type', p_source_type,
    'dry_run', p_dry_run,
    'candidates', v_candidates,
    'posted_or_preview', v_posted,
    'skipped_existing', v_skipped,
    'errors', v_errors,
    'total_debit', round(v_total_debit,2),
    'error_detail', v_err_list
  );
end; $$;
revoke all on function public.acc_backfill(text, boolean, date, date) from public;
grant execute on function public.acc_backfill(text, boolean, date, date) to authenticated;

notify pgrst, 'reload schema';
