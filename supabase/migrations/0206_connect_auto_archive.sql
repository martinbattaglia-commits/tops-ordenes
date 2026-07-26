-- 0206_connect_auto_archive.sql
-- LINK-UX-002-H1 · Ciclo de vida del hilo de entidad (resolución de Dirección 2026-07-26:
-- D1 incidente CERRADO ⇒ archivar (resuelto sigue operativo) · D2 reapertura ⇒ desarchivar ·
-- D3 reversa manual visible).
-- ADITIVA PURA: dos funciones nuevas; no modifica funciones, tablas, RLS ni grants existentes.
-- Idempotencia: los UPDATE condicionan archived_at para no pisar fechas ni duplicar efectos.

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) connect_archive_entity_thread — archiva el hilo de una entidad TERMINADA.
--     La legitimidad es por la ENTIDAD, no por member_role del hilo: quien puede terminar
--     la tarea (asignado/creador/task_admin) puede ser simple `member` de la conversación
--     y connect_archive_conversation lo rechazaría (owner/moderator). Esta función valida
--     el vínculo + estado terminal + parte legítima, y sólo entonces archiva.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.connect_archive_entity_thread(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_t public.connect_tasks%rowtype;
  v_i public.connect_incidents%rowtype;
  v_legit boolean := false;
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode = 'insufficient_privilege';
  end if;

  -- Vínculo 1:0..1 garantizado por connect_tasks_conversation_uidx (0168).
  select * into v_t from public.connect_tasks where conversation_id = p_conversation_id;
  if found then
    if v_t.estado not in ('completada','cancelada') then
      raise exception 'la tarea no está en estado terminal' using errcode = 'check_violation';
    end if;
    v_legit := public.is_admin() or public._connect_task_is_admin()
            or (v_t.asignado_a is not null and v_t.asignado_a = auth.uid())
            or (v_t.creado_por is not null and v_t.creado_por = auth.uid());
  else
    select * into v_i from public.connect_incidents where conversation_id = p_conversation_id;
    if not found then
      raise exception 'la conversación no está vinculada a una tarea o incidente'
        using errcode = 'no_data_found';
    end if;
    -- D1: 'resuelto' NO archiva — puede haber validación/seguimiento pendiente.
    if v_i.estado <> 'cerrado' then
      raise exception 'el incidente no está cerrado' using errcode = 'check_violation';
    end if;
    v_legit := public.is_admin() or public._connect_incident_is_admin()
            or (v_i.reportado_por is not null and v_i.reportado_por = auth.uid())
            or (v_i.asignado_a  is not null and v_i.asignado_a  = auth.uid());
  end if;

  if not v_legit then
    raise exception 'sin permiso para archivar el hilo de esta entidad'
      using errcode = 'insufficient_privilege';
  end if;

  update public.connect_conversations
     set archived_at = now()
   where id = p_conversation_id and archived_at is null;
end;
$$;

-- anon hereda de PUBLIC: el revoke explícito a los tres es el único cierre real (P0-a).
revoke all on function public.connect_archive_entity_thread(uuid) from public, anon, authenticated;
grant execute on function public.connect_archive_entity_thread(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) connect_unarchive_conversation — la reversa (no existía en el sistema).
--     Vía manual: misma matriz que connect_archive_conversation (owner/moderator o admin).
--     Vía entidad (D2): la tarea/incidente volvió a estado ACTIVO y el llamador es parte
--     legítima de la entidad — cubre al asignado-member tras una reapertura.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.connect_unarchive_conversation(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_my_role public.connect_member_role_t;
  v_t public.connect_tasks%rowtype;
  v_i public.connect_incidents%rowtype;
  v_legit boolean := false;
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode = 'insufficient_privilege';
  end if;

  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if public.is_admin() or v_my_role in ('owner','moderator') then
    v_legit := true;
  end if;

  if not v_legit then
    select * into v_t from public.connect_tasks where conversation_id = p_conversation_id;
    if found then
      v_legit := v_t.estado in ('pendiente','en_progreso')
             and ( public._connect_task_is_admin()
                or (v_t.asignado_a is not null and v_t.asignado_a = auth.uid())
                or (v_t.creado_por is not null and v_t.creado_por = auth.uid()) );
    else
      select * into v_i from public.connect_incidents where conversation_id = p_conversation_id;
      if found then
        v_legit := v_i.estado in ('abierto','en_progreso','en_espera')
               and ( public._connect_incident_is_admin()
                  or (v_i.reportado_por is not null and v_i.reportado_por = auth.uid())
                  or (v_i.asignado_a  is not null and v_i.asignado_a  = auth.uid()) );
      end if;
    end if;
  end if;

  if not v_legit then
    raise exception 'sin permiso para desarchivar' using errcode = 'insufficient_privilege';
  end if;

  update public.connect_conversations
     set archived_at = null
   where id = p_conversation_id and archived_at is not null;
end;
$$;

revoke all on function public.connect_unarchive_conversation(uuid) from public, anon, authenticated;
grant execute on function public.connect_unarchive_conversation(uuid) to authenticated;
