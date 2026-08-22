-- =========================================================================
-- 0300_finance_treasury_atomic_reconciliation.sql
--
-- NEXUS-FIN-TES-001 — Atomicidad de Reconciliación Finanzas ↔ Tesorería
--
-- PROBLEMA:  la reconciliación de una previsión (finance_forecast_adjustments)
--            con un movimiento de Tesorería (treasury_movements) ocurría como
--            un UPDATE PostgREST separado en la capa de aplicación, fuera de
--            la transacción SQL de la RPC. Esto rompe atomicidad, permite
--            estados inconsistentes y no protege contra concurrencia ni retry.
--
-- SOLUCIÓN:
--   1) Mover la reconciliación DENTRO de las RPCs existentes de Tesorería
--      (register_receipt, register_payment, register_operational_movement)
--      como parámetros opcionales. Toda la operación ocurre en UNA sola transacción.
--   2) Historial auditable append-only: finance_forecast_reconciliations
--      NO tiene grants de escritura ni policy write para authenticated; sólo
--      accesible vía SELECT auditado y mutaciones exclusivas por SECURITY DEFINER.
--   3) Idempotencia transaccional end-to-end con clave UUID obligatoria (p_idempotency_key):
--      - Valida autenticación y permiso tesoreria.create ANTES de consultar cache.
--      - Trust boundary tipado estricto (UUID nativo en PostgreSQL).
--      - Serializa concurrentes con pg_advisory_xact_lock (gap lock).
--      - Vincula cada clave al actor (created_by); actor distinto falla fail-closed.
--      - Mismo actor + mismo key + mismo payload devuelve el resultado original.
--      - Mismo key + payload distinto aborta con check_violation.
--
-- MULTITENANCY: NO APLICA AL MODELO ACTUAL (single-tenant confirmado).
--               RBAC existente (has_permission / current_role) se conserva.
--
-- NATURALEZA: aditiva + reescritura de 3 funciones.
-- MIGRACIÓN: LOCAL, NO APLICADA.
-- =========================================================================

-- =========================================================================
-- 1. TABLA DE IDEMPOTENCIA TRANSACCIONAL END-TO-END
-- =========================================================================
create table if not exists public.treasury_idempotency_keys (
  key uuid primary key,
  action text not null,
  payload_hash text not null,
  response jsonb not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists treasury_idempotency_keys_created_at_idx
  on public.treasury_idempotency_keys(created_at);

alter table public.treasury_idempotency_keys enable row level security;

-- Solo lectura autenticada del propio actor / mutaciones exclusivas por SECURITY DEFINER
create policy "idempotency_keys_read_own"
  on public.treasury_idempotency_keys for select
  to authenticated
  using (created_by = auth.uid());

grant select on public.treasury_idempotency_keys to authenticated;
revoke insert, update, delete on public.treasury_idempotency_keys from authenticated, anon, public;

-- =========================================================================
-- 2. TABLA DE RELACIÓN AUDITABLE: finance_forecast_reconciliations
--    Preserva múltiples ejecuciones parciales (N:M). Append-only estricto.
-- =========================================================================
create table if not exists public.finance_forecast_reconciliations (
  id uuid primary key default gen_random_uuid(),
  forecast_adjustment_id uuid not null
    references public.finance_forecast_adjustments(id) on delete restrict,
  treasury_movement_id uuid not null
    references public.treasury_movements(id) on delete restrict,
  applied_amount numeric(15,2) not null check (applied_amount > 0),
  reconciled_by uuid references auth.users(id) on delete set null,
  reconciled_at timestamptz not null default now(),
  constraint ffr_unique_forecast_movement
    unique (forecast_adjustment_id, treasury_movement_id)
);

create index if not exists ffr_forecast_idx
  on public.finance_forecast_reconciliations (forecast_adjustment_id);
create index if not exists ffr_movement_idx
  on public.finance_forecast_reconciliations (treasury_movement_id);

-- RLS: SOLO SELECT para authenticated. Cero escritura directa por PostgREST.
alter table public.finance_forecast_reconciliations enable row level security;

create policy "ffr_read"
  on public.finance_forecast_reconciliations for select
  to authenticated
  using (coalesce(public.has_permission('finanzas.view'), false));

grant select on public.finance_forecast_reconciliations to authenticated;
revoke insert, update, delete on public.finance_forecast_reconciliations from authenticated, anon, public;

-- =========================================================================
-- 3. NUEVA COLUMNA en finance_forecast_adjustments: acumulado reconciliado
-- =========================================================================
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'finance_forecast_adjustments'
      and column_name = 'reconciled_amount'
  ) then
    alter table public.finance_forecast_adjustments
      add column reconciled_amount numeric(15,2) not null default 0 check (reconciled_amount >= 0);
  end if;
end $$;

-- Los campos derivados de conciliación sólo pueden mutarse desde funciones
-- SECURITY DEFINER controladas. Se conserva UPDATE para el resto de las
-- columnas editables sin depender de la forma histórica exacta de la tabla.
revoke update on table public.finance_forecast_adjustments from authenticated;
do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'finance_forecast_adjustments'
    and column_name not in ('id', 'status', 'matched_movement_id', 'reconciled_amount');

  if v_columns is null then
    raise exception 'FORECAST_UPDATE_COLUMNS_NOT_FOUND';
  end if;
  execute format(
    'grant update (%s) on table public.finance_forecast_adjustments to authenticated',
    v_columns
  );
end $$;

create or replace function public.finance_void_forecast(
  p_forecast_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.finance_forecast_status_t;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: sesion requerida' using errcode = '28000';
  end if;
  if not (
    coalesce(public.has_permission('finanzas.plan'), false)
    or coalesce(public.has_permission('finanzas.admin'), false)
  ) then
    raise exception 'FORBIDDEN: requiere finanzas.plan o finanzas.admin' using errcode = '42501';
  end if;

  select status into v_status
  from public.finance_forecast_adjustments
  where id = p_forecast_id
  for update;
  if not found then
    raise exception 'FORECAST_NOT_FOUND: la previsión % no existe', p_forecast_id
      using errcode = 'check_violation';
  end if;

  update public.finance_forecast_adjustments
  set status = 'anulado',
      notes = case
        when nullif(btrim(p_reason), '') is null then 'Anulado por el usuario'
        else 'Anulado: ' || btrim(p_reason)
      end,
      updated_at = now()
  where id = p_forecast_id;

  return jsonb_build_object('forecast_id', p_forecast_id, 'status', 'anulado');
end; $$;

revoke all on function public.finance_void_forecast(uuid, text) from public, anon;
grant execute on function public.finance_void_forecast(uuid, text) to authenticated;

-- =========================================================================
-- 4. FUNCIÓN INTERNA DE RECONCILIACIÓN ATÓMICA (SECURITY DEFINER, no pública)
-- =========================================================================
create or replace function public._internal_reconcile_forecast(
  p_forecast_id    uuid,
  p_movement_id    uuid,
  p_applied_amount numeric,
  p_user_id        uuid,
  p_expected_dir   text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fc record;
  v_already_reconciled numeric(15,2);
  v_new_reconciled numeric(15,2);
  v_remaining numeric(15,2);
  v_new_status public.finance_forecast_status_t;
  v_existing_id uuid;
begin
  if p_forecast_id is null then
    return null;
  end if;

  select * into v_fc
  from public.finance_forecast_adjustments
  where id = p_forecast_id
  for update;

  if not found then
    raise exception 'FORECAST_NOT_FOUND: la previsión % no existe', p_forecast_id
      using errcode = 'check_violation';
  end if;

  if v_fc.status = 'anulado' then
    raise exception 'FORECAST_ALREADY_VOID: la previsión % está anulada', p_forecast_id
      using errcode = 'check_violation';
  end if;

  if v_fc.direction::text <> p_expected_dir then
    raise exception 'FORECAST_DIRECTION_MISMATCH: la previsión es de % y la operación es de %',
      v_fc.direction, p_expected_dir
      using errcode = 'check_violation';
  end if;

  if v_fc.currency <> 'ARS' then
    raise exception 'FORECAST_CURRENCY_UNSUPPORTED: solo se concilian previsiones en ARS'
      using errcode = 'check_violation';
  end if;

  if p_applied_amount is null or p_applied_amount <= 0 then
    raise exception 'FORECAST_INVALID_APPLIED_AMOUNT: el monto a conciliar debe ser > 0'
      using errcode = 'check_violation';
  end if;

  select id into v_existing_id
  from public.finance_forecast_reconciliations
  where forecast_adjustment_id = p_forecast_id
    and treasury_movement_id = p_movement_id;

  if v_existing_id is not null then
    return jsonb_build_object(
      'reconciliation_id', v_existing_id,
      'idempotent', true,
      'forecast_id', p_forecast_id,
      'movement_id', p_movement_id,
      'applied_amount', p_applied_amount,
      'new_reconciled_total', v_fc.reconciled_amount,
      'remaining', (v_fc.amount - v_fc.reconciled_amount),
      'new_status', v_fc.status::text
    );
  end if;

  v_already_reconciled := coalesce(v_fc.reconciled_amount, 0);
  v_new_reconciled := v_already_reconciled + p_applied_amount;

  if v_new_reconciled > v_fc.amount then
    raise exception 'FORECAST_OVER_APPLICATION: total aplicado (%) superaría el importe previsto (%) de la previsión %',
      v_new_reconciled, v_fc.amount, p_forecast_id
      using errcode = 'check_violation';
  end if;

  insert into public.finance_forecast_reconciliations (
    forecast_adjustment_id,
    treasury_movement_id,
    applied_amount,
    reconciled_by
  ) values (
    p_forecast_id,
    p_movement_id,
    p_applied_amount,
    p_user_id
  );

  v_remaining := v_fc.amount - v_new_reconciled;
  if v_remaining = 0 then
    v_new_status := 'reconciliado';
  elsif v_remaining > 0 then
    v_new_status := 'comprometido';
  else
    raise exception 'FORECAST_NEGATIVE_REMAINING: error de cálculo, remaining=%', v_remaining
      using errcode = 'check_violation';
  end if;

  update public.finance_forecast_adjustments set
    reconciled_amount = v_new_reconciled,
    status = v_new_status,
    matched_movement_id = p_movement_id,
    updated_at = now()
  where id = p_forecast_id;

  return jsonb_build_object(
    'reconciliation_id', (
      select id from public.finance_forecast_reconciliations
      where forecast_adjustment_id = p_forecast_id
        and treasury_movement_id = p_movement_id
    ),
    'idempotent', false,
    'forecast_id', p_forecast_id,
    'movement_id', p_movement_id,
    'applied_amount', p_applied_amount,
    'new_reconciled_total', v_new_reconciled,
    'remaining', v_remaining,
    'new_status', v_new_status::text
  );
end; $$;

revoke all on function public._internal_reconcile_forecast(uuid, uuid, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public._internal_reconcile_forecast(uuid, uuid, numeric, uuid, text) to service_role;

-- =========================================================================
-- 5. REESCRITURA: tesoreria_register_receipt
--    Idempotencia con p_idempotency_key uuid y reconciliación atómica en una sola TX.
-- =========================================================================
drop function if exists public.tesoreria_register_receipt(uuid, date, public.treasury_receipt_method_t, uuid, numeric, numeric, text, text, jsonb, uuid, numeric);
drop function if exists public.tesoreria_register_receipt(uuid, date, public.treasury_receipt_method_t, uuid, numeric, numeric, text, text, jsonb, uuid, numeric, text);
drop function if exists public.tesoreria_register_receipt(uuid, date, public.treasury_receipt_method_t, uuid, numeric, numeric, text, text, jsonb, uuid, numeric, uuid);
drop function if exists public.tesoreria_register_receipt(uuid, date, public.treasury_receipt_method_t, uuid, numeric, numeric, text, text, jsonb);

create or replace function public.tesoreria_register_receipt(
  p_client_id               uuid,
  p_payment_date            date,
  p_payment_method          public.treasury_receipt_method_t,
  p_bank_account_id         uuid,
  p_gross_amount            numeric,
  p_retention_amount        numeric,
  p_observations            text,
  p_attachment              text,
  p_allocations             jsonb,
  p_forecast_adjustment_id  uuid,
  p_forecast_applied_amount numeric,
  p_idempotency_key         uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_net numeric(14,2); v_sum numeric(14,2); v_ids uuid[];
  v_currency text; v_active boolean; v_is_system boolean;
  v_receipt_id uuid; v_receipt_pub text; v_movement_id uuid;
  r record;
  v_total numeric; v_estado text; v_anulada boolean; v_inv_client uuid; v_paid numeric;
  v_reconcile_result jsonb := null;
  v_final_response jsonb;
  v_payload_hash text;
  v_cached_hash text;
  v_cached_response jsonb;
  v_cached_actor uuid;
begin
  -- 1. Habilitar guard de inserción interna
  perform set_config('treasury.via_rpc', 'on', true);

  -- 2. VALIDACIÓN DE SESIÓN Y PERMISO ANTES DE TOCAR CACHE
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: sesion requerida'
      using errcode = '28000';
  end if;

  if not coalesce(public.has_permission('tesoreria.create'), false) then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.create'
      using errcode = '42501';
  end if;
  if p_forecast_adjustment_id is not null and not (
    coalesce(public.has_permission('finanzas.plan'), false)
    or coalesce(public.has_permission('finanzas.admin'), false)
  ) then
    raise exception 'FORBIDDEN: reconciliar requiere finanzas.plan o finanzas.admin'
      using errcode = '42501';
  end if;

  -- 3. VALIDACIÓN DE IDEMPOTENCIA OBLIGATORIA
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED: se requiere idempotency_key obligatorio'
      using errcode = 'null_value_not_allowed';
  end if;

  -- 4. SERIALIZACIÓN TRANSACCIONAL POR CLAVE (gap lock)
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  -- 5. HASH DEL PAYLOAD
  v_payload_hash := md5(jsonb_build_object(
    'action', 'tesoreria_register_receipt',
    'client_id', p_client_id,
    'payment_date', p_payment_date,
    'payment_method', p_payment_method,
    'bank_account_id', p_bank_account_id,
    'gross_amount', p_gross_amount,
    'retention_amount', p_retention_amount,
    'observations', p_observations,
    'attachment', p_attachment,
    'allocations', p_allocations,
    'forecast_adjustment_id', p_forecast_adjustment_id,
    'forecast_applied_amount', p_forecast_applied_amount
  )::text);

  -- 6. CONSULTA DE CACHE CON VERIFICACIÓN DE ACTOR
  select payload_hash, response, created_by
    into v_cached_hash, v_cached_response, v_cached_actor
  from public.treasury_idempotency_keys
  where key = p_idempotency_key;

  if found then
    if v_cached_actor is distinct from v_uid then
      raise exception 'IDEMPOTENCY_KEY_ACTOR_MISMATCH: la clave % pertenece a otro actor', p_idempotency_key
        using errcode = '42501';
    end if;

    if v_cached_hash = v_payload_hash then
      return v_cached_response;
    else
      raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD: la clave % ya fue usada con otro payload', p_idempotency_key
        using errcode = 'check_violation';
    end if;
  end if;

  -- 7. VALIDACIONES DE NEGOCIO
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

  -- 8. MUTACIONES DE TESORERÍA
  insert into public.customer_receipts(client_id, payment_date, payment_method, bank_account_id,
       gross_amount, retention_amount, observations, attachment, status, created_by)
  values (p_client_id, coalesce(p_payment_date, current_date), p_payment_method, p_bank_account_id,
       p_gross_amount, coalesce(p_retention_amount, 0), p_observations, p_attachment, 'confirmado', v_uid)
  returning id, public_id into v_receipt_id, v_receipt_pub;

  insert into public.receipt_allocations(receipt_id, customer_invoice_id, amount)
  select v_receipt_id, (a->>'invoice_id')::uuid, (a->>'amount')::numeric
  from jsonb_array_elements(p_allocations) a;

  insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
       reference_type, reference_id, status, created_by)
  values (coalesce(p_payment_date, current_date), 'cobranza', 'ingreso', p_bank_account_id, v_net,
       'Cobranza '||v_receipt_pub, 'customer_receipt', v_receipt_id, 'confirmado', v_uid)
  returning id into v_movement_id;

  -- 9. RECONCILIACIÓN FINANCIERA ATÓMICA
  if p_forecast_adjustment_id is not null then
    v_reconcile_result := public._internal_reconcile_forecast(
      p_forecast_id    => p_forecast_adjustment_id,
      p_movement_id    => v_movement_id,
      p_applied_amount => coalesce(p_forecast_applied_amount, v_net),
      p_user_id        => v_uid,
      p_expected_dir   => 'ingreso'
    );
  end if;

  v_final_response := jsonb_build_object(
    'receipt_id', v_receipt_id,
    'public_id', v_receipt_pub,
    'movement_id', v_movement_id,
    'net_amount', v_net,
    'allocations', jsonb_array_length(p_allocations),
    'reconciliation', v_reconcile_result
  );

  -- 10. GUARDAR EN IDEMPOTENCIA
  insert into public.treasury_idempotency_keys(key, action, payload_hash, response, created_by)
  values (p_idempotency_key, 'tesoreria_register_receipt', v_payload_hash, v_final_response, v_uid)
  on conflict (key) do nothing;

  return v_final_response;
end; $$;

grant execute on function public.tesoreria_register_receipt(uuid, date, public.treasury_receipt_method_t, uuid, numeric, numeric, text, text, jsonb, uuid, numeric, uuid) to authenticated;

-- =========================================================================
-- 6. REESCRITURA: tesoreria_register_payment
--    Idempotencia con p_idempotency_key uuid y reconciliación atómica en una sola TX.
-- =========================================================================
drop function if exists public.tesoreria_register_payment(uuid, date, public.treasury_payment_method_t, uuid, numeric, text, text, text, jsonb, uuid, numeric);
drop function if exists public.tesoreria_register_payment(uuid, date, public.treasury_payment_method_t, uuid, numeric, text, text, text, jsonb, uuid, numeric, text);
drop function if exists public.tesoreria_register_payment(uuid, date, public.treasury_payment_method_t, uuid, numeric, text, text, text, jsonb, uuid, numeric, uuid);
drop function if exists public.tesoreria_register_payment(uuid, date, public.treasury_payment_method_t, uuid, numeric, text, text, text, jsonb);

create or replace function public.tesoreria_register_payment(
  p_vendor_id               uuid,
  p_payment_date            date,
  p_payment_method          public.treasury_payment_method_t,
  p_bank_account_id         uuid,
  p_amount                  numeric,
  p_operation_number        text,
  p_observations            text,
  p_attachment              text,
  p_allocations             jsonb,
  p_forecast_adjustment_id  uuid,
  p_forecast_applied_amount numeric,
  p_idempotency_key         uuid
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
  v_reconcile_result jsonb := null;
  v_final_response jsonb;
  v_payload_hash text;
  v_cached_hash text;
  v_cached_response jsonb;
  v_cached_actor uuid;
begin
  perform set_config('treasury.via_rpc', 'on', true);

  if v_uid is null then
    raise exception 'UNAUTHENTICATED: sesion requerida'
      using errcode = '28000';
  end if;

  if not coalesce(public.has_permission('tesoreria.create'), false) then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.create'
      using errcode = '42501';
  end if;
  if p_forecast_adjustment_id is not null and not (
    coalesce(public.has_permission('finanzas.plan'), false)
    or coalesce(public.has_permission('finanzas.admin'), false)
  ) then
    raise exception 'FORBIDDEN: reconciliar requiere finanzas.plan o finanzas.admin'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED: se requiere idempotency_key obligatorio'
      using errcode = 'null_value_not_allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  v_payload_hash := md5(jsonb_build_object(
    'action', 'tesoreria_register_payment',
    'vendor_id', p_vendor_id,
    'payment_date', p_payment_date,
    'payment_method', p_payment_method,
    'bank_account_id', p_bank_account_id,
    'amount', p_amount,
    'operation_number', p_operation_number,
    'observations', p_observations,
    'attachment', p_attachment,
    'allocations', p_allocations,
    'forecast_adjustment_id', p_forecast_adjustment_id,
    'forecast_applied_amount', p_forecast_applied_amount
  )::text);

  select payload_hash, response, created_by
    into v_cached_hash, v_cached_response, v_cached_actor
  from public.treasury_idempotency_keys
  where key = p_idempotency_key;

  if found then
    if v_cached_actor is distinct from v_uid then
      raise exception 'IDEMPOTENCY_KEY_ACTOR_MISMATCH: la clave % pertenece a otro actor', p_idempotency_key
        using errcode = '42501';
    end if;

    if v_cached_hash = v_payload_hash then
      return v_cached_response;
    else
      raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD: la clave % ya fue usada con otro payload', p_idempotency_key
        using errcode = 'check_violation';
    end if;
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

  if p_forecast_adjustment_id is not null then
    v_reconcile_result := public._internal_reconcile_forecast(
      p_forecast_id    => p_forecast_adjustment_id,
      p_movement_id    => v_movement_id,
      p_applied_amount => coalesce(p_forecast_applied_amount, p_amount),
      p_user_id        => v_uid,
      p_expected_dir   => 'egreso'
    );
  end if;

  v_final_response := jsonb_build_object(
    'payment_id', v_payment_id,
    'public_id', v_payment_pub,
    'movement_id', v_movement_id,
    'amount', p_amount,
    'allocations', jsonb_array_length(p_allocations),
    'reconciliation', v_reconcile_result
  );

  insert into public.treasury_idempotency_keys(key, action, payload_hash, response, created_by)
  values (p_idempotency_key, 'tesoreria_register_payment', v_payload_hash, v_final_response, v_uid)
  on conflict (key) do nothing;

  return v_final_response;
end; $$;

grant execute on function public.tesoreria_register_payment(uuid, date, public.treasury_payment_method_t, uuid, numeric, text, text, text, jsonb, uuid, numeric, uuid) to authenticated;

-- =========================================================================
-- 7. REESCRITURA: tesoreria_register_operational_movement
--    Idempotencia con p_idempotency_key uuid y reconciliación atómica en una sola TX.
-- =========================================================================
drop function if exists public.tesoreria_register_operational_movement(date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text, uuid, text, public.treasury_beneficiary_kind_t, text, text, uuid, numeric);
drop function if exists public.tesoreria_register_operational_movement(date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text, uuid, text, public.treasury_beneficiary_kind_t, text, text, uuid, numeric, text);
drop function if exists public.tesoreria_register_operational_movement(date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text, uuid, text, public.treasury_beneficiary_kind_t, text, text, uuid, numeric, uuid);
drop function if exists public.tesoreria_register_operational_movement(date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text, uuid, text, public.treasury_beneficiary_kind_t, text, text);

create or replace function public.tesoreria_register_operational_movement(
  p_date                    date,
  p_category                public.treasury_operational_category_t,
  p_direction               public.treasury_direction_t,
  p_bank_account_id         uuid,
  p_amount                  numeric,
  p_concept                 text,
  p_beneficiary_id          uuid,
  p_beneficiary_name        text,
  p_beneficiary_kind        public.treasury_beneficiary_kind_t,
  p_beneficiary_document    text,
  p_observations            text,
  p_forecast_adjustment_id  uuid,
  p_forecast_applied_amount numeric,
  p_idempotency_key         uuid
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
  v_reconcile_result jsonb := null;
  v_final_response jsonb;
  v_payload_hash text;
  v_cached_hash text;
  v_cached_response jsonb;
  v_cached_actor uuid;
begin
  perform set_config('treasury.via_rpc', 'on', true);

  if v_uid is null then
    raise exception 'UNAUTHENTICATED: sesion requerida'
      using errcode = '28000';
  end if;

  if not coalesce(public.has_permission('tesoreria.create'), false) then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.create'
      using errcode = '42501';
  end if;
  if p_forecast_adjustment_id is not null and not (
    coalesce(public.has_permission('finanzas.plan'), false)
    or coalesce(public.has_permission('finanzas.admin'), false)
  ) then
    raise exception 'FORBIDDEN: reconciliar requiere finanzas.plan o finanzas.admin'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED: se requiere idempotency_key obligatorio'
      using errcode = 'null_value_not_allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  v_payload_hash := md5(jsonb_build_object(
    'action', 'tesoreria_register_operational_movement',
    'date', p_date,
    'category', p_category,
    'direction', p_direction,
    'bank_account_id', p_bank_account_id,
    'amount', p_amount,
    'concept', p_concept,
    'beneficiary_id', p_beneficiary_id,
    'beneficiary_name', p_beneficiary_name,
    'beneficiary_kind', p_beneficiary_kind,
    'beneficiary_document', p_beneficiary_document,
    'observations', p_observations,
    'forecast_adjustment_id', p_forecast_adjustment_id,
    'forecast_applied_amount', p_forecast_applied_amount
  )::text);

  select payload_hash, response, created_by
    into v_cached_hash, v_cached_response, v_cached_actor
  from public.treasury_idempotency_keys
  where key = p_idempotency_key;

  if found then
    if v_cached_actor is distinct from v_uid then
      raise exception 'IDEMPOTENCY_KEY_ACTOR_MISMATCH: la clave % pertenece a otro actor', p_idempotency_key
        using errcode = '42501';
    end if;

    if v_cached_hash = v_payload_hash then
      return v_cached_response;
    else
      raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD: la clave % ya fue usada con otro payload', p_idempotency_key
        using errcode = 'check_violation';
    end if;
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

  if p_forecast_adjustment_id is not null then
    v_reconcile_result := public._internal_reconcile_forecast(
      p_forecast_id    => p_forecast_adjustment_id,
      p_movement_id    => v_mov,
      p_applied_amount => coalesce(p_forecast_applied_amount, p_amount),
      p_user_id        => v_uid,
      p_expected_dir   => p_direction::text
    );
  end if;

  v_final_response := jsonb_build_object(
    'movement_id', v_mov,
    'public_id', v_pub,
    'amount', p_amount,
    'direction', p_direction,
    'beneficiary', v_ben_label,
    'reconciliation', v_reconcile_result
  );

  insert into public.treasury_idempotency_keys(key, action, payload_hash, response, created_by)
  values (p_idempotency_key, 'tesoreria_register_operational_movement', v_payload_hash, v_final_response, v_uid)
  on conflict (key) do nothing;

  return v_final_response;
end; $$;

grant execute on function public.tesoreria_register_operational_movement(date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text, uuid, text, public.treasury_beneficiary_kind_t, text, text, uuid, numeric, uuid) to authenticated;
