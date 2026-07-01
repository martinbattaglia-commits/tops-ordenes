-- 0162_connect_notification_actions.sql — Nexus Link F4.1C (Fundación colaborativa).
-- ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor de prod (arsksytgdnzukbmfgkju).
-- ─────────────────────────────────────────────────────────────────────────
-- Acciones del Centro de Notificaciones (Addendum A4, D-F41-7): snooze / delegar / prioridad.
--   · RPC-first (G10): SECDEF + search_path fijo + guard de propiedad NULL-SAFE (P-1):
--     puede accionar el DUEÑO (user_id) o el DELEGADO ACTUAL (delegated_to). Nadie más.
--   · connect_notif_delegate registra FILA DE AUDITORÍA en audit_log (exigencia A4:2972).
--     Delegar de vuelta al dueño = des-delegar (delegated_to := null). El destino se valida
--     con el MISMO criterio que connect_search_profiles (0158): staff interno activo.
--   · Snooze por remind_at + filtro de lectura (desviación declarada de A4, D-F41-10 aprobada:
--     sin re-emisión por cron). Ventana 1 min..30 días (check_violation fuera de rango).
--
-- ⚠️ DESVÍO DECLARADO del plan §19 ("notifications sin cambios de policies"), aprobado en la
-- implementación: las policies de 0004 solo contemplan user_id/role_target/admin → el DELEGADO
-- no vería la notificación (la delegación sería inoperante). Extensión MÍNIMA y aditiva:
-- `delegated_to = auth.uid()` en SELECT (ver la delegada) y UPDATE (marcarla leída con el
-- flujo directo existente). Sin cambios de INSERT.
-- IDEMPOTENTE. DEPENDE de 0004 (notifications + policies), 0147 (priority/remind_at/delegated_to).
-- ─────────────────────────────────────────────────────────────────────────

-- ===== (1) Policies: el delegado ve y puede marcar leída su notificación delegada =====
drop policy if exists "notifications read own or role" on public.notifications;
create policy "notifications read own or role"
  on public.notifications for select
  using (
    user_id = auth.uid()
    or delegated_to = auth.uid()
    or (role_target is not null and role_target = public.current_role())
    or public.current_role() = 'admin'
  );

drop policy if exists "notifications mark read own" on public.notifications;
create policy "notifications mark read own"
  on public.notifications for update
  using (user_id = auth.uid() or delegated_to = auth.uid() or public.current_role() = 'admin')
  with check (user_id = auth.uid() or delegated_to = auth.uid() or public.current_role() = 'admin');

-- ===== Guard compartido: dueño o delegado actual (NULL-safe, P-1) =====
create or replace function public._notif_assert_owner_or_delegate(p_id uuid)
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_delegate uuid;
begin
  select user_id, delegated_to into v_user, v_delegate
    from public.notifications where id = p_id;
  if not found then
    raise exception 'notificación inexistente' using errcode = 'no_data_found';
  end if;
  -- P-1: NULL-safe explícito — auth.uid() null o sin match → deniega.
  if auth.uid() is null
     or (auth.uid() is distinct from v_user and auth.uid() is distinct from v_delegate) then
    raise exception 'solo el dueño o el delegado pueden accionar esta notificación'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function public._notif_assert_owner_or_delegate(uuid) from public, anon, authenticated;
grant execute on function public._notif_assert_owner_or_delegate(uuid) to service_role;

-- ===== (2) connect_notif_snooze =====
create or replace function public.connect_notif_snooze(p_id uuid, p_remind_at timestamptz)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public._notif_assert_owner_or_delegate(p_id);
  if p_remind_at is null
     or p_remind_at <= now() + interval '1 minute'
     or p_remind_at > now() + interval '30 days' then
    raise exception 'snooze inválido: debe ser entre 1 minuto y 30 días desde ahora'
      using errcode = 'check_violation';
  end if;
  update public.notifications set remind_at = p_remind_at where id = p_id;
end;
$$;
revoke all on function public.connect_notif_snooze(uuid, timestamptz) from public, anon;
grant execute on function public.connect_notif_snooze(uuid, timestamptz) to authenticated;

-- ===== (3) connect_notif_delegate (con fila de auditoría, A4:2972) =====
create or replace function public.connect_notif_delegate(p_id uuid, p_to_profile uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_prev  uuid;
  v_clear boolean := false;
begin
  perform public._notif_assert_owner_or_delegate(p_id);
  if p_to_profile is null then
    raise exception 'falta el destinatario de la delegación' using errcode = 'check_violation';
  end if;

  select user_id, delegated_to into v_owner, v_prev
    from public.notifications where id = p_id;

  if p_to_profile = v_owner then
    -- Devolver al dueño = des-delegar.
    update public.notifications set delegated_to = null where id = p_id;
    v_clear := true;
  else
    -- Destino: staff interno activo (mismo criterio que connect_search_profiles, 0158).
    if not exists (
      select 1 from public.profiles p
       where p.id = p_to_profile
         and coalesce(p.active, true)
         and p.client_id is null
         and p.role in ('admin','operaciones','supervisor')
    ) then
      raise exception 'el destinatario no es un usuario interno válido' using errcode = 'check_violation';
    end if;
    update public.notifications set delegated_to = p_to_profile where id = p_id;
  end if;

  -- Fila de auditoría (A4:2972). Sin PII: solo ids.
  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (
    auth.uid(), 'notification', p_id, 'connect.notification.delegate',
    jsonb_build_object(
      'owner', v_owner,
      'previous_delegate', v_prev,
      'new_delegate', case when v_clear then null else p_to_profile end,
      'cleared', v_clear
    )
  );
end;
$$;
revoke all on function public.connect_notif_delegate(uuid, uuid) from public, anon;
grant execute on function public.connect_notif_delegate(uuid, uuid) to authenticated;

-- ===== (4) connect_notif_set_priority =====
create or replace function public.connect_notif_set_priority(p_id uuid, p_priority text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public._notif_assert_owner_or_delegate(p_id);
  if p_priority is null or p_priority not in ('low','normal','high','urgent') then
    raise exception 'prioridad inválida (low|normal|high|urgent)' using errcode = 'check_violation';
  end if;
  update public.notifications set priority = p_priority where id = p_id;
end;
$$;
revoke all on function public.connect_notif_set_priority(uuid, text) from public, anon;
grant execute on function public.connect_notif_set_priority(uuid, text) to authenticated;

notify pgrst, 'reload schema';
