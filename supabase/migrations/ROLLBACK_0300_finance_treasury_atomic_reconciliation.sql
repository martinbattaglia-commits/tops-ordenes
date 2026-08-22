-- =========================================================================
-- ROLLBACK_0300_finance_treasury_atomic_reconciliation.sql
--
-- INVERSA EJECUTABLE DE 0300 (NEXUS-FIN-TES-001).
-- Restaura las firmas y contratos previos de Tesorería (0055 y 0194)
-- y elimina los objetos y columnas introducidos en 0300.
-- =========================================================================

-- 1. DROPEAR FUNCIONES DE 0300
drop function if exists public.tesoreria_register_receipt(uuid, date, public.treasury_receipt_method_t, uuid, numeric, numeric, text, text, jsonb, uuid, numeric, uuid);
drop function if exists public.tesoreria_register_receipt(uuid, date, public.treasury_receipt_method_t, uuid, numeric, numeric, text, text, jsonb, uuid, numeric, text);
drop function if exists public.tesoreria_register_payment(uuid, date, public.treasury_payment_method_t, uuid, numeric, text, text, text, jsonb, uuid, numeric, uuid);
drop function if exists public.tesoreria_register_payment(uuid, date, public.treasury_payment_method_t, uuid, numeric, text, text, text, jsonb, uuid, numeric, text);
drop function if exists public.tesoreria_register_operational_movement(date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text, uuid, text, public.treasury_beneficiary_kind_t, text, text, uuid, numeric, uuid);
drop function if exists public.tesoreria_register_operational_movement(date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text, uuid, text, public.treasury_beneficiary_kind_t, text, text, uuid, numeric, text);
drop function if exists public._internal_reconcile_forecast(uuid, uuid, numeric, uuid, text);
drop function if exists public.finance_void_forecast(uuid, text);

-- Restaurar el privilegio de tabla previo a 0300.
revoke update on table public.finance_forecast_adjustments from authenticated;
grant update on table public.finance_forecast_adjustments to authenticated;

-- 2. RESTAURAR FIRMA Y LÓGICA PREVIA: tesoreria_register_receipt (0055)
create or replace function public.tesoreria_register_receipt(
  p_client_id        uuid,
  p_payment_date     date,
  p_payment_method   public.treasury_receipt_method_t,
  p_bank_account_id  uuid,
  p_gross_amount     numeric,
  p_retention_amount numeric default 0,
  p_observations     text default null,
  p_attachment       text default null,
  p_allocations      jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_net numeric(15,2);
  v_sum numeric(15,2);
  v_ids uuid[];
  v_currency text; v_active boolean; v_is_system boolean;
  v_receipt_id uuid; v_receipt_pub text; v_movement_id uuid;
  r record;
  v_total numeric; v_estado text; v_anulada boolean; v_inv_client uuid; v_paid numeric;
begin
  perform set_config('treasury.via_rpc', 'on', true);

  if not coalesce(public.has_permission('tesoreria.create'), false) then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.create' using errcode='42501';
  end if;

  if p_gross_amount is null or p_gross_amount <= 0 then
    raise exception 'INVALID_AMOUNT: gross_amount debe ser > 0' using errcode='check_violation';
  end if;
  if p_retention_amount is null or p_retention_amount < 0 or p_retention_amount > p_gross_amount then
    raise exception 'INVALID_RETENTION: retention entre 0 y gross' using errcode='check_violation';
  end if;
  v_net := p_gross_amount - p_retention_amount;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) = 0 then
    raise exception 'NO_ALLOCATIONS: se requiere al menos una imputación' using errcode='check_violation';
  end if;
  select coalesce(sum((a->>'amount')::numeric), 0),
         array_agg((a->>'invoice_id')::uuid)
    into v_sum, v_ids
  from jsonb_array_elements(p_allocations) a;
  if v_sum <> p_gross_amount then
    raise exception 'ALLOCATION_SUM_MISMATCH: suma allocations (%) <> gross (%)', v_sum, p_gross_amount using errcode='check_violation';
  end if;

  select currency, active, is_system into v_currency, v_active, v_is_system
  from public.bank_accounts where id = p_bank_account_id;
  if not found then raise exception 'BANK_INVALID: cuenta inexistente' using errcode='check_violation'; end if;
  if not v_active then raise exception 'BANK_INACTIVE' using errcode='check_violation'; end if;
  if v_currency <> 'ARS' then raise exception 'CURRENCY_UNSUPPORTED: solo ARS en A' using errcode='check_violation'; end if;
  if p_payment_method = 'efectivo' and not v_is_system then
    raise exception 'CASH_REQUIRES_CAJA: efectivo debe imputar a la cuenta CAJA' using errcode='check_violation';
  end if;

  perform 1 from public.customer_invoices where id = any(v_ids) order by id for update;

  for r in select (a->>'invoice_id')::uuid as inv, (a->>'amount')::numeric as amt
           from jsonb_array_elements(p_allocations) a loop
    if r.amt is null or r.amt <= 0 then
      raise exception 'INVALID_ALLOCATION_AMOUNT' using errcode='check_violation';
    end if;
    select ci.total, ci.estado_arca::text, ci.anulada, ci.client_id
      into v_total, v_estado, v_anulada, v_inv_client
    from public.customer_invoices ci where ci.id = r.inv;
    if not found then raise exception 'INVOICE_NOT_FOUND: %', r.inv using errcode='check_violation'; end if;
    if v_inv_client <> p_client_id then raise exception 'INVOICE_WRONG_CLIENT: %', r.inv using errcode='check_violation'; end if;
    if v_anulada or v_estado <> 'AUTORIZADO_ARCA' then
      raise exception 'INVOICE_NOT_PAYABLE: % (estado %)', r.inv, v_estado using errcode='check_violation';
    end if;
    select coalesce(sum(ra.amount), 0) into v_paid
    from public.receipt_allocations ra
    join public.customer_receipts cr on cr.id = ra.receipt_id
    where ra.customer_invoice_id = r.inv and cr.status = 'confirmado';
    if r.amt > (v_total - v_paid) then
      raise exception 'OVERALLOCATION: factura % saldo % < imputado %', r.inv, (v_total - v_paid), r.amt using errcode='check_violation';
    end if;
  end loop;

  insert into public.customer_receipts(client_id, payment_date, payment_method, bank_account_id,
       gross_amount, retention_amount, observations, attachment, status, created_by)
  values (p_client_id, coalesce(p_payment_date, current_date), p_payment_method, p_bank_account_id,
       p_gross_amount, p_retention_amount, p_observations, p_attachment, 'confirmado', v_uid)
  returning id, public_id into v_receipt_id, v_receipt_pub;

  insert into public.receipt_allocations(receipt_id, customer_invoice_id, amount)
  select v_receipt_id, (a->>'invoice_id')::uuid, (a->>'amount')::numeric
  from jsonb_array_elements(p_allocations) a;

  insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
       reference_type, reference_id, status, created_by)
  values (coalesce(p_payment_date, current_date), 'cobranza', 'ingreso', p_bank_account_id, v_net,
       'Cobranza '||v_receipt_pub, 'customer_receipt', v_receipt_id, 'confirmado', v_uid)
  returning id into v_movement_id;

  return jsonb_build_object('receipt_id', v_receipt_id, 'public_id', v_receipt_pub,
                            'movement_id', v_movement_id, 'allocations', jsonb_array_length(p_allocations));
end; $$;

grant execute on function public.tesoreria_register_receipt(uuid, date, public.treasury_receipt_method_t, uuid, numeric, numeric, text, text, jsonb) to authenticated;

-- 3. RESTAURAR FIRMA Y LÓGICA PREVIA: tesoreria_register_payment (0055)
create or replace function public.tesoreria_register_payment(
  p_vendor_id        uuid,
  p_payment_date     date,
  p_payment_method   public.treasury_payment_method_t,
  p_bank_account_id  uuid,
  p_amount           numeric,
  p_operation_number text default null,
  p_observations     text default null,
  p_attachment       text default null,
  p_allocations      jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_sum numeric(14,2); v_ids uuid[];
  v_currency text; v_active boolean;
  v_payment_id uuid; v_payment_pub text; v_movement_id uuid;
  r record; v_total numeric; v_status text; v_inv_vendor uuid; v_paid numeric;
begin
  perform set_config('treasury.via_rpc', 'on', true);

  if not coalesce(public.has_permission('tesoreria.create'), false) then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.create' using errcode='42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT: amount debe ser > 0' using errcode='check_violation';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) = 0 then
    raise exception 'NO_ALLOCATIONS' using errcode='check_violation';
  end if;
  select coalesce(sum((a->>'amount')::numeric), 0),
         array_agg((a->>'supplier_invoice_id')::uuid)
    into v_sum, v_ids
  from jsonb_array_elements(p_allocations) a;
  if v_sum <> p_amount then
    raise exception 'ALLOCATION_SUM_MISMATCH: suma allocations (%) <> amount (%)', v_sum, p_amount using errcode='check_violation';
  end if;

  select currency, active into v_currency, v_active from public.bank_accounts where id = p_bank_account_id;
  if not found then raise exception 'BANK_INVALID' using errcode='check_violation'; end if;
  if not v_active then raise exception 'BANK_INACTIVE' using errcode='check_violation'; end if;
  if v_currency <> 'ARS' then raise exception 'CURRENCY_UNSUPPORTED' using errcode='check_violation'; end if;

  perform 1 from public.supplier_invoices where id = any(v_ids) order by id for update;

  for r in select (a->>'supplier_invoice_id')::uuid as inv, (a->>'amount')::numeric as amt
           from jsonb_array_elements(p_allocations) a loop
    if r.amt is null or r.amt <= 0 then raise exception 'INVALID_ALLOCATION_AMOUNT' using errcode='check_violation'; end if;
    select si.total, si.status::text, si.vendor_id into v_total, v_status, v_inv_vendor
    from public.supplier_invoices si where si.id = r.inv;
    if not found then raise exception 'INVOICE_NOT_FOUND: %', r.inv using errcode='check_violation'; end if;
    if v_inv_vendor <> p_vendor_id then raise exception 'INVOICE_WRONG_VENDOR: %', r.inv using errcode='check_violation'; end if;
    if v_status = 'anulada' then raise exception 'INVOICE_VOID: %', r.inv using errcode='check_violation'; end if;
    select coalesce(sum(pa.amount), 0) into v_paid
    from public.payment_allocations pa
    join public.supplier_payments sp on sp.id = pa.payment_id
    where pa.supplier_invoice_id = r.inv and sp.status = 'confirmado';
    if r.amt > (v_total - v_paid) then
      raise exception 'OVERALLOCATION: factura % saldo % < imputado %', r.inv, (v_total - v_paid), r.amt using errcode='check_violation';
    end if;
  end loop;

  insert into public.supplier_payments(vendor_id, payment_date, payment_method, bank_account_id, amount,
       operation_number, observations, attachment, status, created_by)
  values (p_vendor_id, coalesce(p_payment_date, current_date), p_payment_method, p_bank_account_id, p_amount,
       p_operation_number, p_observations, p_attachment, 'confirmado', v_uid)
  returning id, public_id into v_payment_id, v_payment_pub;

  insert into public.payment_allocations(payment_id, supplier_invoice_id, amount)
  select v_payment_id, (a->>'supplier_invoice_id')::uuid, (a->>'amount')::numeric
  from jsonb_array_elements(p_allocations) a;

  insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
       reference_type, reference_id, status, created_by)
  values (coalesce(p_payment_date, current_date), 'pago_proveedor', 'egreso', p_bank_account_id, p_amount,
       'Pago '||v_payment_pub, 'supplier_payment', v_payment_id, 'confirmado', v_uid)
  returning id into v_movement_id;

  return jsonb_build_object('payment_id', v_payment_id, 'public_id', v_payment_pub,
                            'movement_id', v_movement_id, 'allocations', jsonb_array_length(p_allocations));
end; $$;

grant execute on function public.tesoreria_register_payment(uuid, date, public.treasury_payment_method_t, uuid, numeric, text, text, text, jsonb) to authenticated;

-- 4. RESTAURAR FIRMA Y LÓGICA PREVIA: tesoreria_register_operational_movement (0194)
create or replace function public.tesoreria_register_operational_movement(
  p_date                 date,
  p_category             public.treasury_operational_category_t,
  p_direction            public.treasury_direction_t,
  p_bank_account_id      uuid,
  p_amount               numeric,
  p_concept              text,
  p_beneficiary_id       uuid default null,
  p_beneficiary_name     text default null,
  p_beneficiary_kind     public.treasury_beneficiary_kind_t default 'tercero',
  p_beneficiary_document text default null,
  p_observations         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_desc text;
  v_cur text; v_active boolean;
  v_mov uuid; v_pub text;
  v_ben uuid := p_beneficiary_id;
  v_ben_name text := nullif(btrim(coalesce(p_beneficiary_name, '')), '');
  v_ben_label text;
  v_requires boolean;
begin
  perform set_config('treasury.via_rpc', 'on', true);

  if not coalesce(public.has_permission('tesoreria.create'), false) then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.create' using errcode='42501';
  end if;
  if p_concept is null or btrim(p_concept) = '' then
    raise exception 'OPMOV_CONCEPT_REQUIRED: el concepto es obligatorio' using errcode='check_violation';
  end if;
  if p_direction is null then
    raise exception 'OPMOV_DIRECTION_INVALID: dirección requerida (ingreso|egreso)' using errcode='check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT: el importe debe ser > 0' using errcode='check_violation';
  end if;

  select currency, active into v_cur, v_active from public.bank_accounts where id = p_bank_account_id;
  if not found then raise exception 'BANK_INVALID' using errcode='check_violation'; end if;
  if not v_active then raise exception 'BANK_INACTIVE' using errcode='check_violation'; end if;
  if v_cur <> 'ARS' then raise exception 'CURRENCY_UNSUPPORTED: solo ARS' using errcode='check_violation'; end if;

  v_requires := p_category in ('honorarios','adelanto_sueldo','adelanto_director','adelanto_efectivo','reintegro');

  if v_ben is not null then
    select active into v_active from public.treasury_beneficiaries where id = v_ben;
    if not found then
      raise exception 'BENEFICIARY_INVALID: el beneficiario no existe' using errcode='check_violation';
    end if;
    if not v_active then
      raise exception 'BENEFICIARY_INACTIVE: el beneficiario está dado de baja' using errcode='check_violation';
    end if;

  elsif v_ben_name is not null then
    select id into v_ben from public.treasury_beneficiaries
     where lower(btrim(full_name)) = lower(v_ben_name);
    if v_ben is null then
      insert into public.treasury_beneficiaries(full_name, kind, document_id, created_by)
      values (v_ben_name, coalesce(p_beneficiary_kind, 'tercero'),
              nullif(btrim(coalesce(p_beneficiary_document, '')), ''), v_uid)
      returning id into v_ben;
    end if;

  elsif v_requires then
    raise exception 'BENEFICIARY_REQUIRED: la categoría % exige identificar al beneficiario', p_category
      using errcode='check_violation';
  end if;

  v_desc := btrim(p_concept);

  insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
       reference_type, operational_category, beneficiary_id, status, created_by)
  values (coalesce(p_date, current_date), 'movimiento_operativo', p_direction, p_bank_account_id, p_amount, v_desc,
       'manual', p_category, v_ben, 'confirmado', v_uid)
  returning id, public_id into v_mov, v_pub;

  select full_name into v_ben_label from public.treasury_beneficiaries where id = v_ben;

  return jsonb_build_object('movement_id', v_mov, 'public_id', v_pub, 'amount', p_amount,
                            'direction', p_direction, 'beneficiary', v_ben_label);
end; $$;

grant execute on function public.tesoreria_register_operational_movement(date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text, uuid, text, public.treasury_beneficiary_kind_t, text, text) to authenticated;

-- 5. ELIMINAR TABLAS NUEVAS
drop table if exists public.finance_forecast_reconciliations cascade;
drop table if exists public.treasury_idempotency_keys cascade;

-- 6. ELIMINAR COLUMNA NUEVA
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'finance_forecast_adjustments'
      and column_name = 'reconciled_amount'
  ) then
    alter table public.finance_forecast_adjustments drop column reconciled_amount;
  end if;
end $$;
