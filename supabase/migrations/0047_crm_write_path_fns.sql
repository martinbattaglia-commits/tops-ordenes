-- =========================================================================
-- 0047_crm_write_path_fns.sql — CRM Comercial F2.1-8 · Write-Path (W-1)
--
-- ADDITIVE ONLY · SOLO FUNCIONES. No crea/modifica tablas, enums, columnas,
-- policies, RLS ni RBAC. Implementa la atomicidad opp + ledger aprobada en
-- docs/comercial/CRM_WRITE_PATH_ARCHITECTURE.md (D-1: RPC SECURITY INVOKER).
--
-- Requiere (ya en staging): 0041-0046 (enums + crm_opportunities + crm_stage_history
--   + crm_onboarding), helpers RLS has_permission()/auth.uid() (0005/0009).
--
-- Decisiones implementadas:
--   D-1 · transacción atómica vía función (UPDATE opp + INSERT ledger en una tx).
--   D-2 · BLOQUEO DURO: no se pasa a 'ganado' sin assigned_site.
--   D-3 · 'visita' opcional: calificado → propuesta directo permitido.
--
-- SECURITY INVOKER (default explícito): la RLS de ambas tablas se evalúa con el
-- permiso del invocador (comercial.view para SELECT/FOR UPDATE, comercial.edit
-- para UPDATE/INSERT). Mantiene el modelo verificado en staging (R-G2). NO usar
-- SECURITY DEFINER acá (abriría un bypass que habría que re-auditar).
--
-- NO aplicar a Supabase PROD (arsksytgdnzukbmfgkju). Solo staging
-- (vrxosunxlhohmqymxots). Rama de feature, sin deploy.
-- =========================================================================

-- =========================================================================
-- 1) crm_advance_stage — transición de etapa atómica (opp + ledger)
--    Valida la transición, deriva committed_state, escribe crm_stage_history.
--    Idempotente: from == to → no-op sin fila de ledger.
-- =========================================================================
create or replace function public.crm_advance_stage(
  p_opp  uuid,
  p_to   public.crm_stage_t,
  p_note text default null
)
returns public.crm_opportunities
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_opp           public.crm_opportunities;
  v_from          public.crm_stage_t;
  v_valid         boolean;
  v_committed     public.crm_committed_state_t;
begin
  -- Lock de fila (RLS SELECT = comercial.view). Excluye soft-deleted.
  select * into v_opp
  from public.crm_opportunities
  where id = p_opp and deleted_at is null
  for update;

  if not found then
    raise exception 'OPP_NOT_FOUND: oportunidad % inexistente o eliminada', p_opp
      using errcode = 'no_data_found';
  end if;

  v_from := v_opp.estado;

  -- Idempotencia: misma etapa → no-op, sin ruido en el ledger.
  if v_from = p_to then
    return v_opp;
  end if;

  -- Máquina de transiciones (pipeline lineal + salida 'perdido').
  -- D-3: 'calificado' permite 'propuesta' directo (visita opcional).
  v_valid := case v_from
    when 'nuevo_lead'  then p_to in ('contactado','perdido')
    when 'contactado'  then p_to in ('calificado','perdido')
    when 'calificado'  then p_to in ('visita','propuesta','perdido')
    when 'visita'      then p_to in ('propuesta','perdido')
    when 'propuesta'   then p_to in ('negociacion','perdido')
    when 'negociacion' then p_to in ('ganado','perdido')
    else false  -- 'ganado' y 'perdido' son terminales (sin reapertura desde UI)
  end;

  if not v_valid then
    raise exception 'INVALID_TRANSITION: % -> % no permitida', v_from, p_to
      using errcode = 'check_violation';
  end if;

  -- D-2 · BLOQUEO DURO: ganar exige capacidad reservada (assigned_site).
  if p_to = 'ganado' and v_opp.assigned_site is null then
    raise exception 'GANADO_REQUIRES_CAPACITY: no se puede ganar sin capacidad reservada (assigned_site)'
      using errcode = 'check_violation';
  end if;

  -- Derivación de committed_state (regla de negocio · arquitectura §3).
  --  perdido      → none  (libera)
  --  ganado       → comprometido
  --  resto activo → reservado SI tiene assigned_site (mantiene la reserva a
  --                 través de etapas intermedias; evita "des-reservar" en visita),
  --                 si no, none. Coherente con crm_reserve_capacity (reservado).
  --  'ocupado' nunca lo fija advance_stage (solo crm_complete_onboarding) →
  --  preserva la regla anti-doble-conteo (F2.1-4).
  v_committed := case
    when p_to = 'perdido'              then 'none'::public.crm_committed_state_t
    when p_to = 'ganado'               then 'comprometido'::public.crm_committed_state_t
    when v_opp.assigned_site is not null then 'reservado'::public.crm_committed_state_t
    else 'none'::public.crm_committed_state_t
  end;

  -- UPDATE opp (updated_at lo pone el trigger tg_touch_updated_at).
  update public.crm_opportunities
     set estado          = p_to,
         committed_state = v_committed,
         actual_close    = case
                             when p_to in ('ganado','perdido') then coalesce(actual_close, current_date)
                             else actual_close
                           end,
         lost_reason     = case
                             when p_to = 'perdido' then coalesce(p_note, lost_reason)
                             else lost_reason
                           end
   where id = p_opp
   returning * into v_opp;

  -- INSERT ledger (append-only; RLS INSERT = comercial.edit). Atómico con el UPDATE.
  insert into public.crm_stage_history (opportunity_id, from_stage, to_stage, changed_by, note)
  values (p_opp, v_from, p_to, auth.uid(), p_note);

  return v_opp;
end;
$$;

-- =========================================================================
-- 2) crm_reserve_capacity — reserva de sitio/unidades + committed_state=reservado
--    El baseline físico de capacidad vive en los modelos TS del Digital Twin,
--    NO en Postgres. Por eso la factibilidad física se calcula en el server
--    action (W-2) y se pasa como presupuesto opcional p_available_m2 para el
--    chequeo atómico final acá (evita TOCTOU). Si es NULL, la DB no puede
--    validar capacidad física y solo aplica invariantes de datos.
-- =========================================================================
create or replace function public.crm_reserve_capacity(
  p_opp         uuid,
  p_site        text,
  p_units       jsonb,
  p_available_m2 numeric default null
)
returns public.crm_opportunities
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_opp public.crm_opportunities;
begin
  select * into v_opp
  from public.crm_opportunities
  where id = p_opp and deleted_at is null
  for update;

  if not found then
    raise exception 'OPP_NOT_FOUND: oportunidad % inexistente o eliminada', p_opp
      using errcode = 'no_data_found';
  end if;

  if v_opp.estado = 'perdido' then
    raise exception 'CANNOT_RESERVE_LOST: no se reserva capacidad para una oportunidad perdida'
      using errcode = 'check_violation';
  end if;

  -- Sitio válido (alineado a assigned_site del código: crm-types.ts / mapas).
  if p_site not in ('PEDRO_LUJAN_3159','MAGALDI_1765') then
    raise exception 'INVALID_SITE: % no es un sitio conocido', p_site
      using errcode = 'check_violation';
  end if;

  -- Unidades: array jsonb no vacío.
  if p_units is null or jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) = 0 then
    raise exception 'INVALID_UNITS: assigned_units debe ser un array jsonb no vacío'
      using errcode = 'check_violation';
  end if;

  -- Chequeo atómico de capacidad SOLO si el server pasó el presupuesto físico.
  if p_available_m2 is not null and v_opp.m2 is not null and v_opp.m2 > p_available_m2 then
    raise exception 'INSUFFICIENT_CAPACITY: requeridos % m² > disponibles % m²', v_opp.m2, p_available_m2
      using errcode = 'check_violation';
  end if;

  update public.crm_opportunities
     set assigned_site     = p_site,
         assigned_units    = p_units,
         capacity_feasible = true,
         committed_state   = 'reservado'::public.crm_committed_state_t
   where id = p_opp
   returning * into v_opp;

  -- Evento de capacidad en el ledger (from == to == etapa actual; no es una
  -- transición de etapa, pero queda trazado como pide W-1).
  insert into public.crm_stage_history (opportunity_id, from_stage, to_stage, changed_by, note)
  values (p_opp, v_opp.estado, v_opp.estado, auth.uid(),
          coalesce('Capacidad reservada en ' || p_site, 'Capacidad reservada'));

  return v_opp;
end;
$$;

-- =========================================================================
-- 3) crm_complete_onboarding — onboarding completo + committed_state=ocupado
--    Anti-doble-conteo (F2.1-4): 'ocupado' sale del CommittedSnapshot; su m²
--    pasa a la ocupación física del Digital Twin. Idempotente si ya 'ocupado'.
-- =========================================================================
create or replace function public.crm_complete_onboarding(
  p_opp  uuid,
  p_note text default null
)
returns public.crm_opportunities
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_opp       public.crm_opportunities;
  v_onb_count int;
begin
  select * into v_opp
  from public.crm_opportunities
  where id = p_opp and deleted_at is null
  for update;

  if not found then
    raise exception 'OPP_NOT_FOUND: oportunidad % inexistente o eliminada', p_opp
      using errcode = 'no_data_found';
  end if;

  -- Idempotencia: ya ocupado → no-op, sin doble evento ni doble conteo.
  if v_opp.committed_state = 'ocupado' then
    return v_opp;
  end if;

  -- Solo se onboardea lo ganado.
  if v_opp.estado <> 'ganado' then
    raise exception 'ONBOARDING_REQUIRES_GANADO: la oportunidad debe estar en ganado (actual: %)', v_opp.estado
      using errcode = 'check_violation';
  end if;

  -- Debe existir un onboarding para la oportunidad (su creación es otro frente).
  select count(*) into v_onb_count
  from public.crm_onboarding
  where opportunity_id = p_opp;

  if v_onb_count = 0 then
    raise exception 'ONBOARDING_NOT_FOUND: no hay onboarding para la oportunidad %', p_opp
      using errcode = 'no_data_found';
  end if;

  update public.crm_onboarding
     set status       = 'completado'::public.crm_onboarding_status_t,
         progress_pct = 100,
         completed_at = coalesce(completed_at, now())
   where opportunity_id = p_opp;

  update public.crm_opportunities
     set committed_state = 'ocupado'::public.crm_committed_state_t
   where id = p_opp
   returning * into v_opp;

  insert into public.crm_stage_history (opportunity_id, from_stage, to_stage, changed_by, note)
  values (p_opp, v_opp.estado, v_opp.estado, auth.uid(),
          coalesce(p_note, 'Onboarding completado · capacidad ocupada'));

  return v_opp;
end;
$$;

-- =========================================================================
-- Grants — ejecutar como usuario autenticado (la RLS hace cumplir el permiso).
-- service_role para uso administrativo/server. anon NO (no escribe).
-- =========================================================================
revoke all on function public.crm_advance_stage(uuid, public.crm_stage_t, text)        from public;
revoke all on function public.crm_reserve_capacity(uuid, text, jsonb, numeric)         from public;
revoke all on function public.crm_complete_onboarding(uuid, text)                      from public;

grant execute on function public.crm_advance_stage(uuid, public.crm_stage_t, text)     to authenticated, service_role;
grant execute on function public.crm_reserve_capacity(uuid, text, jsonb, numeric)      to authenticated, service_role;
grant execute on function public.crm_complete_onboarding(uuid, text)                   to authenticated, service_role;

notify pgrst, 'reload schema';
