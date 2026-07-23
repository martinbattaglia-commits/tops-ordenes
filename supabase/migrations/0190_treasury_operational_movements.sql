-- =========================================================================
-- 0190_treasury_operational_movements.sql — Movimientos Operativos de Tesorería · Gate 2
--
-- Expediente: "Completar operatoria diaria de Tesorería" (2026-07-17).
-- Autoridad: Dirección (diseño aprobado; modificación de tesoreria_void_movement
--   autorizada expresamente). ADITIVO salvo la RPC de anulación (autorizada).
--
-- Requiere 0189 COMMITEADA (usa 'movimiento_operativo' y treasury_operational_category_t).
--
-- ⚠️ NÚMERO PROVISIONAL (ver 0189). Se aplica A MANO por Dirección (G3 / DA-001).
--    El asistente NO aplica. Idempotente (create or replace / if not exists).
--
-- Contenido:
--   1) Columna operational_category (nullable) + CHECK de coherencia con el tipo.
--   2) RPC tesoreria_register_operational_movement (RPC-first, SECURITY DEFINER,
--      fail-closed). UNA SOLA CUENTA — las transferencias usan el flujo existente.
--   3) tesoreria_void_movement: rama 'movement' acotada a 'movimiento_operativo'
--      (blindaje de baseline por gobierno, NO por inmutabilidad técnica — D3).
-- =========================================================================

-- =========================================================================
-- 1. Columna categoría + CHECK (identidad propia del movimiento operativo)
-- =========================================================================
alter table public.treasury_movements
  add column if not exists operational_category public.treasury_operational_category_t;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'treasury_movements_operational_category_ck') then
    -- categoría obligatoria si-y-solo-si el movimiento es operativo.
    -- filas existentes (type <> 'movimiento_operativo', operational_category NULL) ⇒ (false)=(false) ⇒ OK.
    alter table public.treasury_movements
      add constraint treasury_movements_operational_category_ck
      check ((operational_category is not null) = (type = 'movimiento_operativo'));
  end if;
end $$;

-- =========================================================================
-- 2. RPC · tesoreria_register_operational_movement (UNA SOLA CUENTA)
--    Espejo del patrón de la casa. Ninguna regla financiera vive en TS: suma,
--    saldo (vista), lock, append-only, guarda de inserción y proyección a
--    knowledge_events son de la base. Las transferencias NO pasan por acá:
--    usan tesoreria_register_transfer (arquitectura existente, no se duplica).
-- =========================================================================
create or replace function public.tesoreria_register_operational_movement(
  p_date            date,
  p_category        public.treasury_operational_category_t,
  p_direction       public.treasury_direction_t,
  p_bank_account_id uuid,
  p_amount          numeric,
  p_concept         text,
  p_observations    text default null
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
begin
  -- guarda de inserción: habilita el alta de tipos <> 'ajuste' (scope transacción)
  perform set_config('treasury.via_rpc', 'on', true);

  -- fail-closed (patrón HOTFIX 0055: NULL ↓ FALSE)
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

  v_desc := btrim(p_concept);

  insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
       reference_type, operational_category, status, created_by)
  values (coalesce(p_date, current_date), 'movimiento_operativo', p_direction, p_bank_account_id, p_amount, v_desc,
       'operational_movement', p_category, 'confirmado', v_uid)
  returning id, public_id into v_mov, v_pub;

  return jsonb_build_object('movement_id', v_mov, 'public_id', v_pub);
end; $$;

grant execute on function public.tesoreria_register_operational_movement(
  date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text, text
) to authenticated;

-- =========================================================================
-- 3. RPC · tesoreria_void_movement — MODIFICACIÓN AUTORIZADA POR DIRECCIÓN
--    Byte-idéntica a 0055 salvo la rama 'movement'. E3 (anular operativos) + D3
--    (blindaje de baseline). NO introduce inmutabilidad técnica: la transición
--    confirmado→anulado sigue disponible para una intervención EXTRAORDINARIA
--    autorizada por Dirección (DA-001), fuera de esta RPC operativa.
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
    -- OPERATORIA DIARIA: solo movimientos operativos (type='movimiento_operativo'),
    -- que son de una sola cuenta (por id). La baseline (type='ajuste',
    -- MOV-2026-000009/000010) queda FUERA del alcance de la anulación diaria (D3).
    update public.treasury_movements
       set status='anulado', voided_at=v_now, voided_by=v_uid, void_reason=p_reason
     where id = p_target_id and status='confirmado' and type='movimiento_operativo';
    get diagnostics v_cnt = row_count;
    if v_cnt = 0 then raise exception 'NOT_FOUND_OR_ALREADY_VOID: movement % (solo movimiento_operativo)', p_target_id using errcode='check_violation'; end if;

  else
    raise exception 'INVALID_TARGET_TYPE: % (receipt|payment|transfer|movement)', p_target_type using errcode='check_violation';
  end if;

  return jsonb_build_object('ok', true, 'target_type', p_target_type, 'target_id', p_target_id);
end; $$;

notify pgrst, 'reload schema';
