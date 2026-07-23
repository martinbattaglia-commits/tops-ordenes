-- =========================================================================
-- 0191_treasury_operational_movement_fix_reference_type.sql — M3 (corrección)
--
-- Expediente: "Completar operatoria diaria de Tesorería" (2026-07-17).
-- Autoridad: Dirección (dictamen semántico de reference_type ratificado).
--
-- CORRIGE un defecto de la RPC creada en 0190: insertaba
--   reference_type = 'operational_movement'
-- valor NO admitido por el constraint preexistente treasury_movements_reference_type_ck
-- ( NULL | customer_receipt | supplier_payment | transfer | manual ), lo que hacía
-- fallar TODO alta operativa (detectado por el plan de pruebas antes del deploy).
--
-- INTERPRETACIÓN OFICIAL DEL MODELO (Dirección):
--   • `type`           identifica la NATURALEZA del movimiento (movimiento_operativo).
--   • `reference_type` identifica su PROCEDENCIA / mecanismo de origen.
--   Un movimiento operativo NO referencia ninguna entidad externa: su procedencia
--   es el alta a mano ⇒ valor histórico del modelo = 'manual' (diseño original 0053).
--
-- ALCANCE ESTRICTO (Dirección): modifica EXCLUSIVAMENTE la RPC vía CREATE OR REPLACE.
--   NO altera tabla, constraint, permisos (los grants de 0190 se preservan), ni el
--   resto del modelo. Único cambio respecto de 0190: 'operational_movement' → 'manual'.
--
-- ⚠️ NÚMERO PROVISIONAL (reservar el libre real al aplicar). Se aplica por MCP bajo
--    GO expreso de Dirección (DA-001). El asistente NO aplica. Idempotente.
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

  v_desc := btrim(p_concept);

  insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
       reference_type, operational_category, status, created_by)
  values (coalesce(p_date, current_date), 'movimiento_operativo', p_direction, p_bank_account_id, p_amount, v_desc,
       'manual', p_category, 'confirmado', v_uid)   -- ← M3: procedencia = alta a mano ('manual'), valor histórico del modelo
  returning id, public_id into v_mov, v_pub;

  return jsonb_build_object('movement_id', v_mov, 'public_id', v_pub);
end; $$;

notify pgrst, 'reload schema';
