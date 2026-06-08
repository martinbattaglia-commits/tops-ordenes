-- CRM360 · P1 · E2 — Reserva ATÓMICA de unidades sobre crm_units.
-- Garantiza: disponible → reservada UNA sola vez. Segundo intento → UNIT_ALREADY_RESERVED.
-- Atómico: si una unidad del lote falla, rollbackea todo (sin reserva parcial).
-- Concurrencia: el UPDATE condicional (where state='disponible') bloquea la fila →
--   dos oportunidades en paralelo no pueden tomar la misma unidad.
-- Requiere 0066 (crm_units). NO aplicado a producción desde la sesión.

create or replace function public.crm_reserve_units(p_opp uuid, p_site text, p_unit_codes text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp   public.crm_opportunities;
  v_code  text;
  v_rows  int;
begin
  if p_unit_codes is null or array_length(p_unit_codes, 1) is null then
    raise exception 'INVALID_UNITS: indicá al menos una unidad' using errcode = 'check_violation';
  end if;
  if p_site not in ('MAGALDI_1765','PEDRO_LUJAN_3159') then
    raise exception 'INVALID_SITE: % no es un sitio conocido', p_site using errcode = 'check_violation';
  end if;

  select * into v_opp from public.crm_opportunities where id = p_opp and deleted_at is null for update;
  if not found then
    raise exception 'OPP_NOT_FOUND: oportunidad % inexistente', p_opp using errcode = 'no_data_found';
  end if;
  if v_opp.estado = 'perdido' then
    raise exception 'CANNOT_RESERVE_LOST: no se reserva para una oportunidad perdida' using errcode = 'check_violation';
  end if;

  -- Reserva unidad por unidad (atómico: cualquier fallo aborta toda la transacción).
  foreach v_code in array p_unit_codes loop
    update public.crm_units
       set state = 'reservada', opportunity_id = p_opp, updated_at = now()
     where site = p_site and unit_code = v_code and state = 'disponible';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      if exists (select 1 from public.crm_units where site = p_site and unit_code = v_code) then
        raise exception 'UNIT_ALREADY_RESERVED: la unidad % no está disponible', v_code using errcode = 'check_violation';
      else
        raise exception 'UNIT_NOT_FOUND: unidad % inexistente en %', v_code, p_site using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  -- Reflejar la reserva en la oportunidad (compat con la vista actual).
  update public.crm_opportunities
     set assigned_site    = p_site,
         assigned_units   = to_jsonb(p_unit_codes),
         committed_state  = 'reservado'::public.crm_committed_state_t,
         updated_at       = now()
   where id = p_opp;

  return jsonb_build_object('ok', true, 'opportunity_id', p_opp, 'site', p_site,
                            'reserved_units', to_jsonb(p_unit_codes));
end;
$$;

revoke all on function public.crm_reserve_units(uuid, text, text[]) from public;
grant execute on function public.crm_reserve_units(uuid, text, text[]) to authenticated, service_role;
