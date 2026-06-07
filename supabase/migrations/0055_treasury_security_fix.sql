-- =========================================================================
-- 0055_treasury_security_fix.sql — ERP-A5.1 (HOTFIX de seguridad)
--
-- Corrige INCIDENTE-1 (ERP_A5_E2E_VALIDATION_REPORT.md): el guard de permisos
-- de las RPC de tesorería FALLABA-ABIERTO ante rol nulo.
--
-- Causa: public.has_permission(slug) = exists(...) OR current_role()='admin'.
--   Con auth.uid() nulo, current_role() devuelve NULL ⇒ `false OR (NULL='admin')`
--   = NULL (no false). En la RPC, `if not has_permission(...)` con `not NULL` =
--   NULL ⇒ el IF no se cumple ⇒ el FORBIDDEN NO se lanza ⇒ fail-open.
--
-- Fix: envolver el guard en coalesce(..., false) ⇒ NULL ↓ FALSE ⇒ FAIL-CLOSED.
--
-- ALCANCE: redefine ÚNICAMENTE las 4 RPC (create or replace), byte-idénticas a
-- 0054 salvo la línea del guard. NO toca has_permission/RBAC/RLS/vistas/0052/
-- 0053/0054 ni introduce cambio funcional, financiero o de negocio.
-- =========================================================================

-- =========================================================================
-- 1. RPC · tesoreria_register_receipt
-- =========================================================================
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
  -- R2: habilitar guard (scope transacción)
  perform set_config('treasury.via_rpc', 'on', true);

  -- HOTFIX 0055: fail-closed (NULL ↓ FALSE)
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

  -- banco
  select currency, active, is_system into v_currency, v_active, v_is_system
  from public.bank_accounts where id = p_bank_account_id;
  if not found then raise exception 'BANK_INVALID: cuenta inexistente' using errcode='check_violation'; end if;
  if not v_active then raise exception 'BANK_INACTIVE' using errcode='check_violation'; end if;
  if v_currency <> 'ARS' then raise exception 'CURRENCY_UNSUPPORTED: solo ARS en A' using errcode='check_violation'; end if;
  if p_payment_method = 'efectivo' and not v_is_system then
    raise exception 'CASH_REQUIRES_CAJA: efectivo debe imputar a la cuenta CAJA' using errcode='check_violation';
  end if;

  -- F1: lock determinístico de las facturas destino (NUNCA sobre allocations)
  perform 1 from public.customer_invoices where id = any(v_ids) order by id for update;

  -- validación por imputación (bajo lock)
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

  -- alta del recibo (public_id lo genera el trigger)
  insert into public.customer_receipts(client_id, payment_date, payment_method, bank_account_id,
       gross_amount, retention_amount, observations, attachment, status, created_by)
  values (p_client_id, coalesce(p_payment_date, current_date), p_payment_method, p_bank_account_id,
       p_gross_amount, p_retention_amount, p_observations, p_attachment, 'confirmado', v_uid)
  returning id, public_id into v_receipt_id, v_receipt_pub;

  -- allocations (guard via_rpc OK)
  insert into public.receipt_allocations(receipt_id, customer_invoice_id, amount)
  select v_receipt_id, (a->>'invoice_id')::uuid, (a->>'amount')::numeric
  from jsonb_array_elements(p_allocations) a;

  -- movimiento bancario solo si neto > 0 (retención 100% ⇒ sin movimiento)
  if v_net > 0 then
    insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
         reference_type, reference_id, status, created_by)
    values (coalesce(p_payment_date, current_date), 'cobranza', 'ingreso', p_bank_account_id, v_net,
         'Cobranza '||v_receipt_pub, 'customer_receipt', v_receipt_id, 'confirmado', v_uid)
    returning id into v_movement_id;
  end if;

  return jsonb_build_object('receipt_id', v_receipt_id, 'public_id', v_receipt_pub,
                            'movement_id', v_movement_id, 'net_amount', v_net,
                            'allocations', jsonb_array_length(p_allocations));
end; $$;

-- =========================================================================
-- 2. RPC · tesoreria_register_payment
-- =========================================================================
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

  -- HOTFIX 0055: fail-closed (NULL ↓ FALSE)
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

  -- F1: lock determinístico
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

-- =========================================================================
-- 3. RPC · tesoreria_register_transfer
-- =========================================================================
create or replace function public.tesoreria_register_transfer(
  p_date                 date,
  p_from_bank_account_id uuid,
  p_to_bank_account_id   uuid,
  p_amount               numeric,
  p_description          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_group uuid := gen_random_uuid();
  v_from_cur text; v_to_cur text; v_from_active boolean; v_to_active boolean;
  v_out uuid; v_in uuid;
begin
  perform set_config('treasury.via_rpc', 'on', true);

  -- HOTFIX 0055: fail-closed (NULL ↓ FALSE)
  if not coalesce(public.has_permission('tesoreria.create'), false) then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.create' using errcode='42501';
  end if;
  if p_from_bank_account_id = p_to_bank_account_id then
    raise exception 'SAME_ACCOUNT: origen y destino deben diferir' using errcode='check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode='check_violation';
  end if;
  select currency, active into v_from_cur, v_from_active from public.bank_accounts where id = p_from_bank_account_id;
  if not found then raise exception 'BANK_INVALID: origen' using errcode='check_violation'; end if;
  select currency, active into v_to_cur, v_to_active from public.bank_accounts where id = p_to_bank_account_id;
  if not found then raise exception 'BANK_INVALID: destino' using errcode='check_violation'; end if;
  if not v_from_active or not v_to_active then raise exception 'BANK_INACTIVE' using errcode='check_violation'; end if;
  if v_from_cur <> 'ARS' or v_to_cur <> 'ARS' then raise exception 'CURRENCY_UNSUPPORTED' using errcode='check_violation'; end if;

  insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
       reference_type, reference_id, transfer_group_id, status, created_by)
  values (coalesce(p_date, current_date), 'transferencia', 'egreso', p_from_bank_account_id, p_amount,
       coalesce(p_description, 'Transferencia'), 'transfer', null, v_group, 'confirmado', v_uid)
  returning id into v_out;

  insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
       reference_type, reference_id, transfer_group_id, status, created_by)
  values (coalesce(p_date, current_date), 'transferencia', 'ingreso', p_to_bank_account_id, p_amount,
       coalesce(p_description, 'Transferencia'), 'transfer', null, v_group, 'confirmado', v_uid)
  returning id into v_in;

  return jsonb_build_object('transfer_group_id', v_group, 'movement_out_id', v_out, 'movement_in_id', v_in);
end; $$;

-- =========================================================================
-- 4. RPC · tesoreria_void_movement
-- =========================================================================
create or replace function public.tesoreria_void_movement(
  p_target_type text,   -- 'receipt' | 'payment' | 'transfer' | 'movement'
  p_target_id   uuid,
  p_reason      text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_cnt int;
begin
  -- HOTFIX 0055: fail-closed (NULL ↓ FALSE)
  if not coalesce(public.has_permission('tesoreria.edit'), false) then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.edit' using errcode='42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'VOID_REQUIRES_REASON' using errcode='check_violation';
  end if;

  if p_target_type = 'receipt' then
    update public.customer_receipts set status='anulado', voided_at=v_now, voided_by=v_uid, void_reason=p_reason
      where id = p_target_id and status='confirmado';
    get diagnostics v_cnt = row_count;
    if v_cnt = 0 then raise exception 'NOT_FOUND_OR_ALREADY_VOID: receipt %', p_target_id using errcode='check_violation'; end if;
    -- anula el movimiento asociado si existe (net=0 ⇒ no hay movimiento; 0 filas OK)
    update public.treasury_movements set status='anulado', voided_at=v_now, voided_by=v_uid, void_reason=p_reason
      where reference_type='customer_receipt' and reference_id=p_target_id and status='confirmado';

  elsif p_target_type = 'payment' then
    update public.supplier_payments set status='anulado', voided_at=v_now, voided_by=v_uid, void_reason=p_reason
      where id = p_target_id and status='confirmado';
    get diagnostics v_cnt = row_count;
    if v_cnt = 0 then raise exception 'NOT_FOUND_OR_ALREADY_VOID: payment %', p_target_id using errcode='check_violation'; end if;
    update public.treasury_movements set status='anulado', voided_at=v_now, voided_by=v_uid, void_reason=p_reason
      where reference_type='supplier_payment' and reference_id=p_target_id and status='confirmado';

  elsif p_target_type = 'transfer' then
    update public.treasury_movements set status='anulado', voided_at=v_now, voided_by=v_uid, void_reason=p_reason
      where transfer_group_id = p_target_id and status='confirmado';
    get diagnostics v_cnt = row_count;
    if v_cnt = 0 then raise exception 'NOT_FOUND_OR_ALREADY_VOID: transfer %', p_target_id using errcode='check_violation'; end if;

  elsif p_target_type = 'movement' then
    update public.treasury_movements set status='anulado', voided_at=v_now, voided_by=v_uid, void_reason=p_reason
      where id = p_target_id and status='confirmado' and type='ajuste';
    get diagnostics v_cnt = row_count;
    if v_cnt = 0 then raise exception 'NOT_FOUND_OR_ALREADY_VOID: movement % (solo ajuste por id)', p_target_id using errcode='check_violation'; end if;

  else
    raise exception 'INVALID_TARGET_TYPE: % (receipt|payment|transfer|movement)', p_target_type using errcode='check_violation';
  end if;

  return jsonb_build_object('ok', true, 'target_type', p_target_type, 'target_id', p_target_id);
end; $$;

notify pgrst, 'reload schema';
