-- =========================================================================
-- 0090_treasury_withholdings_native.sql — Fase 11.B/C · Tesorería con
--   retenciones nativas (bruto / retención / neto)
--
-- PROBLEMA (documentado en Fase 10): tesoreria_register_payment (0054) imputa
-- allocations = importe pagado (neto) y mueve banco = neto; al practicar
-- retenciones, supplier_open_items quedaba con un residual = retención porque
-- las allocations no cubrían el bruto.
--
-- SOLUCIÓN (aditiva, sin tocar 0053/0054): una RPC NUEVA que, en una sola
-- transacción, imputa el BRUTO contra la factura (payment_allocations.amount =
-- bruto → supplier_open_items cancela por bruto), egresa el NETO por banco
-- (treasury_movements.amount = neto) y registra las retenciones
-- (supplier_payment_withholdings, 0088). No modifica la RPC vieja (sigue válida
-- para pagos sin retención) ni las vistas de 0054/0086/0089.
--
-- INVARIANTE CONTABLE (ya implementada en 0089, sin cambios):
--   acc_post_supplier_payment → DEBE Proveedores (amount + Σ retenciones = bruto)
--   / HABER Banco (amount = neto) + Retenciones a depositar (Σ). Como acá
--   amount = neto y Σ retenciones = retención, el asiento da bruto/neto/retención
--   y supplier_open_items (allocations = bruto) coincide. SIN residual.
--
-- COMPATIBILIDAD: ADITIVA e idempotente. No aplica migraciones (las aplica Martín).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Columnas explícitas de bruto/retenido en el pago (aditivas, nullables).
--    amount sigue siendo el NETO egresado (semántica existente, no se toca).
--    Legacy: gross_amount/withheld_amount NULL → los reportes hacen coalesce.
-- -------------------------------------------------------------------------
alter table public.supplier_payments
  add column if not exists gross_amount   numeric(14,2),
  add column if not exists withheld_amount numeric(14,2);

comment on column public.supplier_payments.amount is
  'Importe NETO efectivamente egresado por banco/caja (= bruto − retenciones). Semántica original 0053.';
comment on column public.supplier_payments.gross_amount is
  'Importe BRUTO cancelado contra el proveedor (= Σ payment_allocations.amount). Lo setea la RPC nativa de retenciones (0090); NULL en pagos legacy.';
comment on column public.supplier_payments.withheld_amount is
  'Σ retenciones practicadas en este pago (= Σ supplier_payment_withholdings.amount). NULL/0 en pagos legacy.';

-- -------------------------------------------------------------------------
-- 2. RPC nativa: pago a proveedor con retenciones (bruto/retención/neto).
--    Espejo de tesoreria_register_payment (0054) + retenciones. F1 lock,
--    R2 via_rpc, append-only intacto.
-- -------------------------------------------------------------------------
create or replace function public.tesoreria_register_supplier_payment_neto(
  p_vendor_id        uuid,
  p_payment_date     date,
  p_payment_method   public.treasury_payment_method_t,
  p_bank_account_id  uuid,
  p_allocations      jsonb,                       -- [{supplier_invoice_id, gross_amount}]
  p_withholdings     jsonb default '[]'::jsonb,   -- [{supplier_invoice_id?, withholding_type, withholding_name?, jurisdiction?, tax_base?, rate?, amount, certificate_number?, withheld_at?}]
  p_operation_number text default null,
  p_observations     text default null,
  p_attachment       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_gross numeric(14,2); v_withheld numeric(14,2); v_net numeric(14,2);
  v_ids uuid[];
  v_currency text; v_active boolean;
  v_payment_id uuid; v_payment_pub text; v_movement_id uuid;
  r record; v_total numeric; v_status text; v_inv_vendor uuid; v_paid numeric;
  v_bad int;
begin
  -- R2: habilitar guards (scope transacción) para allocations y withholdings.
  perform set_config('treasury.via_rpc', 'on', true);
  perform set_config('ap.via_rpc', 'on', true);

  if not public.has_permission('tesoreria.create') then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.create' using errcode='42501';
  end if;

  -- Allocations (bruto)
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) = 0 then
    raise exception 'NO_ALLOCATIONS: se requiere al menos una imputación bruta' using errcode='check_violation';
  end if;
  select coalesce(sum((a->>'gross_amount')::numeric), 0),
         array_agg((a->>'supplier_invoice_id')::uuid)
    into v_gross, v_ids
  from jsonb_array_elements(p_allocations) a;
  if v_gross <= 0 then
    raise exception 'INVALID_GROSS: el bruto total debe ser > 0' using errcode='check_violation';
  end if;

  -- Retenciones
  if p_withholdings is null or jsonb_typeof(p_withholdings) <> 'array' then
    raise exception 'INVALID_WITHHOLDINGS: debe ser un array' using errcode='check_violation';
  end if;
  select coalesce(sum((w->>'amount')::numeric), 0),
         count(*) filter (where coalesce((w->>'amount')::numeric, 0) <= 0)
    into v_withheld, v_bad
  from jsonb_array_elements(p_withholdings) w;
  if v_bad > 0 then
    raise exception 'INVALID_WITHHOLDING_AMOUNT: cada retención debe ser > 0' using errcode='check_violation';
  end if;
  if v_withheld < 0 then
    raise exception 'INVALID_WITHHOLDING_TOTAL' using errcode='check_violation';
  end if;

  v_net := v_gross - v_withheld;
  if v_net <= 0 then
    raise exception 'INVALID_NET: el neto (bruto % − retenciones %) debe ser > 0', v_gross, v_withheld using errcode='check_violation';
  end if;

  -- Banco
  select currency, active into v_currency, v_active from public.bank_accounts where id = p_bank_account_id;
  if not found then raise exception 'BANK_INVALID' using errcode='check_violation'; end if;
  if not v_active then raise exception 'BANK_INACTIVE' using errcode='check_violation'; end if;
  if v_currency <> 'ARS' then raise exception 'CURRENCY_UNSUPPORTED' using errcode='check_violation'; end if;

  -- F1: lock determinístico de las facturas destino (NUNCA sobre allocations)
  perform 1 from public.supplier_invoices where id = any(v_ids) order by id for update;

  -- Validación por imputación (bajo lock): bruto <= saldo de la factura.
  for r in select (a->>'supplier_invoice_id')::uuid as inv, (a->>'gross_amount')::numeric as amt
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
      raise exception 'OVERALLOCATION: factura % saldo % < imputado bruto %', r.inv, (v_total - v_paid), r.amt using errcode='check_violation';
    end if;
  end loop;

  -- Alta del pago: amount = NETO; gross/withheld explícitos.
  insert into public.supplier_payments(vendor_id, payment_date, payment_method, bank_account_id, amount,
       gross_amount, withheld_amount, operation_number, observations, attachment, status, created_by)
  values (p_vendor_id, coalesce(p_payment_date, current_date), p_payment_method, p_bank_account_id, v_net,
       v_gross, v_withheld, p_operation_number, p_observations, p_attachment, 'confirmado', v_uid)
  returning id, public_id into v_payment_id, v_payment_pub;

  -- Allocations = BRUTO (cancela la factura por el bruto). Guard via_rpc OK.
  insert into public.payment_allocations(payment_id, supplier_invoice_id, amount)
  select v_payment_id, (a->>'supplier_invoice_id')::uuid, (a->>'gross_amount')::numeric
  from jsonb_array_elements(p_allocations) a;

  -- Retenciones practicadas (guard ap.via_rpc OK).
  if jsonb_array_length(p_withholdings) > 0 then
    insert into public.supplier_payment_withholdings
      (supplier_payment_id, supplier_invoice_id, withholding_type, withholding_name,
       jurisdiction, tax_base, rate, amount, account_id, certificate_number, withheld_at)
    select v_payment_id,
           nullif(w->>'supplier_invoice_id','')::uuid,
           (w->>'withholding_type')::public.supplier_withholding_t,
           nullif(w->>'withholding_name',''),
           coalesce(w->>'jurisdiction',''),
           coalesce((w->>'tax_base')::numeric, 0),
           nullif(w->>'rate','')::numeric,
           coalesce((w->>'amount')::numeric, 0),
           nullif(w->>'account_id','')::uuid,
           nullif(w->>'certificate_number',''),
           coalesce(nullif(w->>'withheld_at','')::date, coalesce(p_payment_date, current_date))
    from jsonb_array_elements(p_withholdings) w;
  end if;

  -- Egreso bancario = NETO (neto siempre > 0 acá).
  insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
       reference_type, reference_id, status, created_by)
  values (coalesce(p_payment_date, current_date), 'pago_proveedor', 'egreso', p_bank_account_id, v_net,
       'Pago '||v_payment_pub||' (neto, c/retención)', 'supplier_payment', v_payment_id, 'confirmado', v_uid)
  returning id into v_movement_id;

  return jsonb_build_object(
    'payment_id', v_payment_id, 'public_id', v_payment_pub, 'movement_id', v_movement_id,
    'gross_amount', v_gross, 'withheld_amount', v_withheld, 'net_amount', v_net,
    'allocations', jsonb_array_length(p_allocations),
    'withholdings', jsonb_array_length(p_withholdings),
    'accounting_hint', 'Contabilizá el pago en /contabilidad/comprobantes (genera DEBE Proveedores '||v_gross||' / HABER Banco '||v_net||' + Retenciones '||v_withheld||').'
  );
end; $$;

revoke all on function public.tesoreria_register_supplier_payment_neto(uuid,date,public.treasury_payment_method_t,uuid,jsonb,jsonb,text,text,text) from public;
grant execute on function public.tesoreria_register_supplier_payment_neto(uuid,date,public.treasury_payment_method_t,uuid,jsonb,jsonb,text,text,text) to authenticated;

notify pgrst, 'reload schema';
