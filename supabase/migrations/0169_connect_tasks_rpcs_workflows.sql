-- 0169_connect_tasks_rpcs_workflows.sql — Nexus Link F4.3C (Tareas + Workflows).
-- ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor de prod (arsksytgdnzukbmfgkju).
-- ─────────────────────────────────────────────────────────────────────────
-- RPCs de ciclo de vida (ADR-F4-3, D-F43-1..9):
--   pendiente → en_progreso → completada  |  cancelada (desde no-terminal)
--   reapertura: completada → en_progreso (AUDITADA) · cancelada = TERMINAL
--   claim SOLO de vacantes (lección I-1) · devolución del asignado ·
--   reasignación = creador o task_admin (D-F43-3) · hilo LAZY (ensure_thread) ·
--   workflow LINEAL: completar paso N crea SÍNCRONO el paso N+1 y avisa al rol.
-- Reglas transversales heredadas de F4.2 (todas las lecciones aplicadas):
--   SECDEF + search_path fijo · guards NULL-safe con coalesce(has_permission)
--   (lección I-2) · FOR UPDATE en transiciones e instancias · audit append-only
--   SIN texto libre (lección I-4: motivo/título NO van al payload; solo IDs,
--   estados y longitudes) · notificaciones SÍNCRONAS acotadas con dedupe de
--   destinatarios (lección M-3) y actor excluido · #variable_conflict
--   use_column donde hay OUT params (lección 42702) · kind/entity =
--   'connect_task', entity_id = TASK id (hrefFor → /connect/tareas/{id}).
-- IDEMPOTENTE. DEPENDE de: 0167 (enums), 0168 (tablas/permiso), 0143/0161
-- (conversaciones/notifs), 0009/0004. Rollback: ROLLBACK_0167_0170.md.
-- ─────────────────────────────────────────────────────────────────────────

-- ===== Policy de notifications: los broadcasts a rol se pueden marcar leídos =====
-- Fix I-2 adversarial F4.3: F4.3 es el PRIMER emisor de role_target ≠ 'admin'
-- (operaciones/supervisor en los avisos de workflow). La policy de UPDATE de
-- 0162 solo contemplaba user_id/delegated_to/current_role()='admin' → esos
-- broadcasts quedaban NO-LEÍDOS PARA SIEMPRE para el rol destino (el UPDATE de
-- read_at matcheaba 0 filas en silencio). Extensión MÍNIMA: el miembro del rol
-- destino puede accionar (limitado por el grant POR COLUMNA de 0162 a
-- read_at/remind_at; marcarla leída la marca para todo el rol — semántica
-- inherente del broadcast de 0004, aceptada). Se re-crea la policy COMPLETA
-- de 0162 + la rama nueva (cuerpo base = 0162:33-36 VIGENTE).
drop policy if exists "notifications mark read own" on public.notifications;
create policy "notifications mark read own"
  on public.notifications for update
  using (
    user_id = auth.uid()
    or delegated_to = auth.uid()
    or (role_target is not null and role_target = public.current_role())
    or public.current_role() = 'admin'
  )
  with check (
    user_id = auth.uid()
    or delegated_to = auth.uid()
    or (role_target is not null and role_target = public.current_role())
    or public.current_role() = 'admin'
  );

-- ===== Helpers =====
create or replace function public._connect_task_is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(public.has_permission('connect.task_admin'), false);
$$;
revoke all on function public._connect_task_is_admin() from public, anon, authenticated;
grant execute on function public._connect_task_is_admin() to service_role;

create or replace function public._connect_task_prio(p public.connect_task_priority_t)
returns text
language sql immutable set search_path = public, pg_temp
as $$
  select case p when 'urgente' then 'urgent' when 'alta' then 'high' else 'normal' end;
$$;
revoke all on function public._connect_task_prio(public.connect_task_priority_t) from public, anon, authenticated;
grant execute on function public._connect_task_prio(public.connect_task_priority_t) to service_role;

-- Notificación individual (síncrona, actor excluido, sin PII).
create or replace function public._connect_task_notify(
  p_user uuid, p_task uuid, p_title text, p_message text, p_priority text
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  insert into public.notifications (user_id, kind, title, message, entity, entity_id, priority)
  values (p_user, 'connect_task', p_title, p_message, 'connect_task', p_task, p_priority);
end;
$$;
revoke all on function public._connect_task_notify(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public._connect_task_notify(uuid, uuid, text, text, text) to service_role;

-- Notificación a TODOS los involucrados (creador + asignado + seguidores),
-- con DISTINCT (dedupe, lección M-3) y actor excluido por el helper de arriba.
create or replace function public._connect_task_notify_involved(
  p_task uuid, p_title text, p_message text, p_priority text
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid;
begin
  for v_user in
    select distinct u from (
      select t.creado_por as u from public.connect_tasks t where t.id = p_task
      union
      select t.asignado_a from public.connect_tasks t where t.id = p_task
      union
      select f.profile_id from public.connect_task_followers f where f.task_id = p_task
    ) s where u is not null
  loop
    perform public._connect_task_notify(v_user, p_task, p_title, p_message, p_priority);
  end loop;
end;
$$;
revoke all on function public._connect_task_notify_involved(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public._connect_task_notify_involved(uuid, text, text, text) to service_role;

-- Destino de asignación/seguimiento válido: interno activo (criterio 0162/0158).
create or replace function public._connect_task_assert_internal(p_user uuid)
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = p_user
       and coalesce(p.active, true)
       and p.client_id is null
       and p.role in ('admin','operaciones','supervisor')
  ) then
    raise exception 'el usuario no es un interno válido' using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function public._connect_task_assert_internal(uuid) from public, anon, authenticated;
grant execute on function public._connect_task_assert_internal(uuid) to service_role;

-- ===== (1) connect_task_create =====
create or replace function public.connect_task_create(
  p_titulo      text,
  p_descripcion text default null,
  p_prioridad   text default 'media',
  p_due_at      timestamptz default null,
  p_asignado    uuid default null,
  p_incident_id uuid default null
) returns table (id uuid, public_id text)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_titulo text;
  v_prio   public.connect_task_priority_t;
  v_task   uuid;
  v_pub    text;
begin
  if auth.uid() is null or not coalesce(public.has_permission('connect.create'), false) then
    raise exception 'Sin permiso connect.create' using errcode = 'insufficient_privilege';
  end if;
  v_titulo := left(btrim(coalesce(p_titulo, '')), 160);
  if v_titulo = '' then
    raise exception 'el título de la tarea es obligatorio' using errcode = 'check_violation';
  end if;
  if coalesce(p_prioridad,'media') not in ('baja','media','alta','urgente') then
    raise exception 'prioridad inválida (baja|media|alta|urgente)' using errcode = 'check_violation';
  end if;
  v_prio := coalesce(p_prioridad,'media')::public.connect_task_priority_t;

  -- Vínculo con incidente: debe existir Y el creador debe poder verlo
  -- (miembro del hilo, incident_admin o admin) — sin oráculo de contenido.
  if p_incident_id is not null then
    if not exists (
      select 1 from public.connect_incidents i
       where i.id = p_incident_id
         and (public._connect_is_member(i.conversation_id)
              or public.is_admin()
              or coalesce(public.has_permission('connect.incident_admin'), false))
    ) then
      raise exception 'incidente inexistente o sin acceso' using errcode = 'check_violation';
    end if;
  end if;

  if p_asignado is not null then
    perform public._connect_task_assert_internal(p_asignado);
  end if;

  insert into public.connect_tasks
    (titulo, descripcion, prioridad, due_at, creado_por, asignado_a, incident_id)
  values
    (v_titulo, nullif(btrim(coalesce(p_descripcion,'')),''), v_prio, p_due_at,
     auth.uid(), p_asignado, p_incident_id)
  returning connect_tasks.id, connect_tasks.public_id into v_task, v_pub;

  -- Audit sin texto libre (lección I-4): título/descr viven bajo RLS.
  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_task', v_task, 'connect.task.create',
          jsonb_build_object('public_id', v_pub, 'prioridad', v_prio,
                             'asignada', p_asignado is not null,
                             'incident_id', p_incident_id,
                             'due', p_due_at is not null));

  if p_asignado is not null then
    perform public._connect_task_notify(
      p_asignado, v_task,
      'Tarea ' || v_pub || ' asignada',
      'Te asignaron: ' || left(v_titulo, 120),
      public._connect_task_prio(v_prio));
  end if;

  id := v_task; public_id := v_pub;
  return next;
end;
$$;
revoke all on function public.connect_task_create(text, text, text, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.connect_task_create(text, text, text, timestamptz, uuid, uuid) to authenticated;

-- ===== (2) connect_task_assign — asignar / reclamar / devolver =====
-- p_to NULL = DEVOLUCIÓN (solo asignado actual, creador o task_admin).
-- p_to = actor con tarea VACANTE = claim (connect.create) — lección I-1.
-- Reasignación (vacante o no) a terceros/sí mismo ocupada: creador o task_admin (D-F43-3).
create or replace function public.connect_task_assign(p_id uuid, p_to uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_t public.connect_tasks%rowtype;
  v_admin boolean; v_creator boolean; v_assignee boolean;
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode = 'insufficient_privilege';
  end if;
  select * into v_t from public.connect_tasks where connect_tasks.id = p_id for update;
  if not found then
    raise exception 'tarea inexistente' using errcode = 'no_data_found';
  end if;
  if v_t.estado in ('completada','cancelada') then
    raise exception 'la tarea está en estado terminal' using errcode = 'check_violation';
  end if;

  v_admin    := public._connect_task_is_admin();
  v_creator  := v_t.creado_por is not distinct from auth.uid() and v_t.creado_por is not null;
  v_assignee := v_t.asignado_a is not distinct from auth.uid() and v_t.asignado_a is not null;

  if p_to is null then
    -- Devolución / des-asignación.
    if not (v_assignee or v_creator or v_admin) then
      raise exception 'solo el asignado, el creador o task_admin pueden des-asignar'
        using errcode = 'insufficient_privilege';
    end if;
    if v_t.asignado_a is null then return; end if;  -- no-op idempotente
    update public.connect_tasks set asignado_a = null where connect_tasks.id = p_id;
    insert into public.audit_log (user_id, entity, entity_id, action, payload)
    values (auth.uid(), 'connect_task', p_id, 'connect.task.return',
            jsonb_build_object('public_id', v_t.public_id, 'from', v_t.asignado_a));
    perform public._connect_task_notify(v_t.creado_por, p_id,
      'Tarea ' || v_t.public_id || ' quedó vacante',
      'El responsable devolvió la tarea.', public._connect_task_prio(v_t.prioridad));
    -- Dedupe (fix M-3 adversarial): si creador = asignado, UNA sola notificación.
    if v_t.asignado_a is distinct from v_t.creado_por then
      perform public._connect_task_notify(v_t.asignado_a, p_id,
        'Tarea ' || v_t.public_id || ' des-asignada',
        'Ya no sos el responsable.', 'normal');
    end if;
    return;
  end if;

  -- Asignación / claim / reasignación (lección I-1: claim SOLO vacante).
  if not v_admin and not v_creator then
    if not (p_to = auth.uid()
            and v_t.asignado_a is null
            and coalesce(public.has_permission('connect.create'), false)) then
      raise exception 'solo el creador o task_admin pueden asignar/reasignar a terceros'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  perform public._connect_task_assert_internal(p_to);
  if v_t.asignado_a is not distinct from p_to then return; end if;  -- no-op

  update public.connect_tasks set asignado_a = p_to where connect_tasks.id = p_id;

  -- El asignado entra al hilo si existe (lazy: puede no existir aún).
  if v_t.conversation_id is not null then
    insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
    values (v_t.conversation_id, 'staff', p_to, 'member')
    on conflict (conversation_id, profile_id) do nothing;
  end if;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_task', p_id, 'connect.task.assign',
          jsonb_build_object('public_id', v_t.public_id, 'from', v_t.asignado_a, 'to', p_to));

  perform public._connect_task_notify(p_to, p_id,
    'Tarea ' || v_t.public_id || ' asignada',
    'Te asignaron: ' || left(v_t.titulo, 120), public._connect_task_prio(v_t.prioridad));
  if v_t.asignado_a is not null and v_t.asignado_a is distinct from p_to then
    perform public._connect_task_notify(v_t.asignado_a, p_id,
      'Tarea ' || v_t.public_id || ' reasignada',
      'La tarea pasó a otro responsable.', 'normal');
  end if;
  if v_t.creado_por is distinct from p_to and v_t.creado_por is distinct from v_t.asignado_a then
    perform public._connect_task_notify(v_t.creado_por, p_id,
      'Tarea ' || v_t.public_id || ' tiene responsable',
      'La tarea fue tomada/asignada.', 'normal');
  end if;
end;
$$;
revoke all on function public.connect_task_assign(uuid, uuid) from public, anon;
grant execute on function public.connect_task_assign(uuid, uuid) to authenticated;

-- ===== (3) connect_task_set_status — start / complete / cancel / reopen + avance de workflow =====
create or replace function public.connect_task_set_status(
  p_id uuid, p_status text, p_motivo text default null
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_t     public.connect_tasks%rowtype;
  v_new   public.connect_task_status_t;
  v_admin boolean; v_creator boolean; v_assignee boolean;
  v_reopen boolean := false;
  v_action text;
  v_inst  public.connect_workflow_instances%rowtype;
  v_step  public.connect_workflow_steps%rowtype;
  v_next_id uuid; v_next_pub text;
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_status,'') not in ('pendiente','en_progreso','completada','cancelada') then
    raise exception 'estado inválido' using errcode = 'check_violation';
  end if;
  v_new := p_status::public.connect_task_status_t;

  select * into v_t from public.connect_tasks where connect_tasks.id = p_id for update;
  if not found then
    raise exception 'tarea inexistente' using errcode = 'no_data_found';
  end if;

  v_admin    := public._connect_task_is_admin();
  v_creator  := v_t.creado_por is not distinct from auth.uid() and v_t.creado_por is not null;
  v_assignee := v_t.asignado_a is not distinct from auth.uid() and v_t.asignado_a is not null;

  if v_t.estado = v_new then return; end if;  -- no-op idempotente

  -- Matriz (ADR §4).
  if v_t.estado = 'cancelada' then
    raise exception 'la tarea está cancelada (estado terminal)' using errcode = 'check_violation';
  elsif v_t.estado = 'pendiente' and v_new = 'en_progreso' then
    if not (v_assignee or v_admin) then
      raise exception 'solo el asignado o task_admin pueden iniciar' using errcode = 'insufficient_privilege';
    end if;
  elsif v_t.estado in ('pendiente','en_progreso') and v_new = 'completada' then
    if not (v_assignee or v_creator or v_admin) then
      raise exception 'solo asignado, creador o task_admin pueden completar' using errcode = 'insufficient_privilege';
    end if;
  elsif v_t.estado in ('pendiente','en_progreso') and v_new = 'cancelada' then
    if not (v_creator or v_admin) then
      raise exception 'solo el creador o task_admin pueden cancelar' using errcode = 'insufficient_privilege';
    end if;
    if nullif(btrim(coalesce(p_motivo,'')),'') is null then
      raise exception 'la cancelación requiere un motivo breve' using errcode = 'check_violation';
    end if;
  elsif v_t.estado = 'completada' and v_new = 'en_progreso' then
    -- REAPERTURA (auditada).
    if not (v_creator or v_assignee or v_admin) then
      raise exception 'solo creador, asignado o task_admin pueden reabrir' using errcode = 'insufficient_privilege';
    end if;
    v_reopen := true;
  else
    raise exception 'transición inválida: % → %', v_t.estado, v_new using errcode = 'check_violation';
  end if;

  update public.connect_tasks
     set estado = v_new,
         completed_at  = case when v_new = 'completada' then now()
                              when v_reopen then null else completed_at end,
         cancel_reason = case when v_new = 'cancelada' then left(btrim(p_motivo), 300)
                              else cancel_reason end
   where connect_tasks.id = p_id;

  v_action := case
    when v_reopen then 'connect.task.reopen'
    when v_new = 'cancelada' then 'connect.task.cancel'
    else 'connect.task.set_status'
  end;
  -- Audit SIN texto libre (motivo queda en la tabla bajo RLS; acá solo length).
  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_task', p_id, v_action,
          jsonb_build_object('public_id', v_t.public_id, 'from', v_t.estado, 'to', v_new,
                             'motivo_len', case when v_new = 'cancelada'
                                                then length(btrim(p_motivo)) end));

  -- Notificación síncrona a involucrados (dedupe + actor excluido).
  perform public._connect_task_notify_involved(
    p_id,
    'Tarea ' || v_t.public_id || ': ' || replace(v_new::text, '_', ' '),
    case when v_reopen then 'La tarea fue reabierta.'
         when v_new = 'cancelada' then 'La tarea fue cancelada.'
         when v_new = 'completada' then 'La tarea fue completada.'
         else 'La tarea está en progreso.' end,
    public._connect_task_prio(v_t.prioridad));

  -- ===== Cancelación de paso de workflow → la INSTANCIA también se cancela =====
  -- Fix I-1 adversarial: sin esto, cancelar el paso activo dejaba la instancia
  -- 'en_curso' PARA SIEMPRE (el avance solo dispara al completar; el unique
  -- (instance, step) impide recrear el paso; 'cancelado' era código muerto).
  if v_new = 'cancelada' and v_t.workflow_instance_id is not null then
    select * into v_inst from public.connect_workflow_instances
     where connect_workflow_instances.id = v_t.workflow_instance_id for update;
    if found and v_inst.estado = 'en_curso' and v_inst.current_step = v_t.step_no then
      update public.connect_workflow_instances
         set estado = 'cancelado', completed_at = now()
       where connect_workflow_instances.id = v_inst.id;
      perform public._connect_task_notify(v_inst.iniciado_por, p_id,
        'Workflow cancelado',
        'Se canceló el paso ' || v_t.step_no || ' (' || v_t.public_id || ') y la cadena se detuvo.',
        'normal');
      insert into public.audit_log (user_id, entity, entity_id, action, payload)
      values (auth.uid(), 'connect_task', p_id, 'connect.task.workflow_advance',
              jsonb_build_object('instance_id', v_inst.id, 'from_step', v_t.step_no,
                                 'cancelled', true));
    end if;
  end if;

  -- ===== Avance de WORKFLOW LINEAL (síncrono, sin scheduler) =====
  if v_new = 'completada' and v_t.workflow_instance_id is not null then
    select * into v_inst from public.connect_workflow_instances
     where connect_workflow_instances.id = v_t.workflow_instance_id for update;
    if found and v_inst.estado = 'en_curso' and v_inst.current_step = v_t.step_no then
      select * into v_step from public.connect_workflow_steps s
       where s.template_id = v_inst.template_id and s.step_no = v_t.step_no + 1;
      if found then
        -- Paso siguiente: tarea VACANTE (D-F43-5) creada a nombre del iniciador.
        insert into public.connect_tasks
          (titulo, descripcion, prioridad, due_at, creado_por,
           workflow_instance_id, step_no, area)
        values
          (v_step.titulo, v_step.descripcion, v_step.prioridad,
           case when v_step.due_offset_days is not null
                then now() + make_interval(days => v_step.due_offset_days) end,
           v_inst.iniciado_por, v_inst.id, v_step.step_no, v_step.rol_sugerido::text)
        returning connect_tasks.id, connect_tasks.public_id into v_next_id, v_next_pub;

        update public.connect_workflow_instances
           set current_step = v_step.step_no
         where connect_workflow_instances.id = v_inst.id;

        -- Aviso al ROL del paso (role_target, broadcast al área; D-F43-5).
        if v_step.rol_sugerido is not null then
          insert into public.notifications (role_target, kind, title, message, entity, entity_id, priority)
          values (v_step.rol_sugerido, 'connect_task',
                  'Nueva tarea de workflow ' || v_next_pub,
                  left(v_step.titulo, 120) || ' — disponible para reclamar.',
                  'connect_task', v_next_id, public._connect_task_prio(v_step.prioridad));
        end if;
        perform public._connect_task_notify(v_inst.iniciado_por, v_next_id,
          'Workflow avanzó: ' || v_next_pub,
          'Se creó el paso ' || v_step.step_no || '.', 'normal');

        insert into public.audit_log (user_id, entity, entity_id, action, payload)
        values (auth.uid(), 'connect_task', v_next_id, 'connect.task.workflow_advance',
                jsonb_build_object('instance_id', v_inst.id, 'from_step', v_t.step_no,
                                   'to_step', v_step.step_no, 'public_id', v_next_pub));
      else
        -- Último paso: instancia completada.
        update public.connect_workflow_instances
           set estado = 'completado', completed_at = now()
         where connect_workflow_instances.id = v_inst.id;
        perform public._connect_task_notify(v_inst.iniciado_por, p_id,
          'Workflow completado',
          'Se completó el último paso (' || v_t.public_id || ').', 'normal');
        insert into public.audit_log (user_id, entity, entity_id, action, payload)
        values (auth.uid(), 'connect_task', p_id, 'connect.task.workflow_advance',
                jsonb_build_object('instance_id', v_inst.id, 'from_step', v_t.step_no,
                                   'completed', true));
      end if;
    end if;
  end if;
end;
$$;
revoke all on function public.connect_task_set_status(uuid, text, text) from public, anon;
grant execute on function public.connect_task_set_status(uuid, text, text) to authenticated;

-- ===== (4) connect_task_set_priority =====
create or replace function public.connect_task_set_priority(p_id uuid, p_prioridad text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_t public.connect_tasks%rowtype;
  v_new public.connect_task_priority_t;
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_prioridad,'') not in ('baja','media','alta','urgente') then
    raise exception 'prioridad inválida (baja|media|alta|urgente)' using errcode = 'check_violation';
  end if;
  v_new := p_prioridad::public.connect_task_priority_t;

  select * into v_t from public.connect_tasks where connect_tasks.id = p_id for update;
  if not found then
    raise exception 'tarea inexistente' using errcode = 'no_data_found';
  end if;
  if v_t.estado in ('completada','cancelada') then
    raise exception 'la tarea está en estado terminal' using errcode = 'check_violation';
  end if;
  if not ((v_t.creado_por is not null and v_t.creado_por is not distinct from auth.uid())
          or (v_t.asignado_a is not null and v_t.asignado_a is not distinct from auth.uid())
          or public._connect_task_is_admin()) then
    raise exception 'solo creador, asignado o task_admin' using errcode = 'insufficient_privilege';
  end if;
  if v_t.prioridad = v_new then return; end if;

  update public.connect_tasks set prioridad = v_new where connect_tasks.id = p_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_task', p_id, 'connect.task.set_priority',
          jsonb_build_object('public_id', v_t.public_id, 'from', v_t.prioridad, 'to', v_new));

  if v_new = 'urgente' then
    perform public._connect_task_notify_involved(p_id,
      'Tarea ' || v_t.public_id || ' escalada a urgente',
      left(v_t.titulo, 120), 'urgent');
  end if;
end;
$$;
revoke all on function public.connect_task_set_priority(uuid, text) from public, anon;
grant execute on function public.connect_task_set_priority(uuid, text) to authenticated;

-- ===== (5) connect_task_set_due (INFORMATIVO — ADR §9) =====
create or replace function public.connect_task_set_due(p_id uuid, p_due timestamptz)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_t public.connect_tasks%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode = 'insufficient_privilege';
  end if;
  select * into v_t from public.connect_tasks where connect_tasks.id = p_id for update;
  if not found then
    raise exception 'tarea inexistente' using errcode = 'no_data_found';
  end if;
  if v_t.estado in ('completada','cancelada') then
    raise exception 'la tarea está en estado terminal' using errcode = 'check_violation';
  end if;
  if not ((v_t.creado_por is not null and v_t.creado_por is not distinct from auth.uid())
          or (v_t.asignado_a is not null and v_t.asignado_a is not distinct from auth.uid())
          or public._connect_task_is_admin()) then
    raise exception 'solo creador, asignado o task_admin' using errcode = 'insufficient_privilege';
  end if;
  if v_t.due_at is not distinct from p_due then return; end if;

  update public.connect_tasks set due_at = p_due where connect_tasks.id = p_id;
  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_task', p_id, 'connect.task.set_due',
          jsonb_build_object('public_id', v_t.public_id, 'from', v_t.due_at, 'to', p_due));
end;
$$;
revoke all on function public.connect_task_set_due(uuid, timestamptz) from public, anon;
grant execute on function public.connect_task_set_due(uuid, timestamptz) to authenticated;

-- ===== (6) connect_task_follow — seguir / dejar de seguir / agregar seguidores =====
create or replace function public.connect_task_follow(p_id uuid, p_user uuid, p_follow boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_t public.connect_tasks%rowtype;
  v_admin boolean; v_creator boolean; v_self boolean;
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode = 'insufficient_privilege';
  end if;
  if p_user is null then
    raise exception 'falta el usuario' using errcode = 'check_violation';
  end if;
  select * into v_t from public.connect_tasks where connect_tasks.id = p_id for update;
  if not found then
    raise exception 'tarea inexistente' using errcode = 'no_data_found';
  end if;

  v_admin   := public._connect_task_is_admin();
  v_creator := v_t.creado_por is not distinct from auth.uid() and v_t.creado_por is not null;
  v_self    := p_user = auth.uid();

  if v_self then
    -- Auto-seguir: solo quien ya puede VER la tarea (involucrado/admin/task_admin).
    if not (public._connect_task_is_involved(p_id) or v_admin or public.is_admin()) then
      raise exception 'sin acceso a la tarea' using errcode = 'insufficient_privilege';
    end if;
  else
    -- Gestionar seguidores de terceros: creador o task_admin.
    if not (v_creator or v_admin) then
      raise exception 'solo el creador o task_admin gestionan seguidores' using errcode = 'insufficient_privilege';
    end if;
    perform public._connect_task_assert_internal(p_user);
  end if;

  if p_follow then
    insert into public.connect_task_followers (task_id, profile_id, added_by)
    values (p_id, p_user, auth.uid())
    on conflict (task_id, profile_id) do nothing;
    -- El seguidor entra al hilo si existe (coherencia de acceso al contenido).
    if v_t.conversation_id is not null then
      insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
      values (v_t.conversation_id, 'staff', p_user, 'member')
      on conflict (conversation_id, profile_id) do nothing;
    end if;
    if not v_self then
      insert into public.audit_log (user_id, entity, entity_id, action, payload)
      values (auth.uid(), 'connect_task', p_id, 'connect.task.follow_added',
              jsonb_build_object('public_id', v_t.public_id, 'user', p_user));
      perform public._connect_task_notify(p_user, p_id,
        'Seguís la tarea ' || v_t.public_id,
        'Te agregaron como seguidor de: ' || left(v_t.titulo, 120), 'normal');
    end if;
  else
    delete from public.connect_task_followers
     where task_id = p_id and profile_id = p_user;
  end if;
end;
$$;
revoke all on function public.connect_task_follow(uuid, uuid, boolean) from public, anon;
grant execute on function public.connect_task_follow(uuid, uuid, boolean) to authenticated;

-- ===== (7) connect_task_ensure_thread — hilo LAZY (ADR §10) =====
create or replace function public.connect_task_ensure_thread(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_t public.connect_tasks%rowtype;
  v_conv uuid;
  v_member uuid;
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode = 'insufficient_privilege';
  end if;
  select * into v_t from public.connect_tasks where connect_tasks.id = p_id for update;
  if not found then
    raise exception 'tarea inexistente' using errcode = 'no_data_found';
  end if;
  if not (public._connect_task_is_involved(p_id) or public._connect_task_is_admin() or public.is_admin()) then
    raise exception 'sin acceso a la tarea' using errcode = 'insufficient_privilege';
  end if;
  -- Fix I-3 adversarial: no crear hilos nuevos en estados terminales (nacerían
  -- read-only e inútiles). Si el hilo YA existe, se devuelve normalmente.
  if v_t.conversation_id is null and v_t.estado in ('completada','cancelada') then
    raise exception 'la tarea está en estado terminal (sin hilo)' using errcode = 'check_violation';
  end if;

  if v_t.conversation_id is not null then
    -- Ya existe: garantizar que el caller (involucrado) sea miembro.
    insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
    values (v_t.conversation_id, 'staff', auth.uid(), 'member')
    on conflict (conversation_id, profile_id) do nothing;
    return v_t.conversation_id;
  end if;

  insert into public.connect_conversations (kind, title, created_by)
  values ('task', v_t.public_id || ' — ' || left(v_t.titulo, 100), auth.uid())
  returning connect_conversations.id into v_conv;

  -- Miembros iniciales: creador, asignado, seguidores y el caller (distinct).
  for v_member in
    select distinct u from (
      select v_t.creado_por as u
      union select v_t.asignado_a
      union select auth.uid()
      union select f.profile_id from public.connect_task_followers f where f.task_id = p_id
    ) s where u is not null
  loop
    -- ⚠️ Fix C-1 adversarial (BLOQUEANTE): un CASE cuyas ramas son todas
    -- literales unknown se resuelve como TEXT, y text→enum NO tiene coerción
    -- de asignación → 42804 en la primera ejecución. Cast explícito al enum.
    insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
    values (v_conv, 'staff', v_member,
            (case when v_member = v_t.creado_por then 'owner' else 'member' end)::public.connect_member_role_t)
    on conflict (conversation_id, profile_id) do nothing;
  end loop;

  update public.connect_tasks set conversation_id = v_conv where connect_tasks.id = p_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_task', p_id, 'connect.task.thread_created',
          jsonb_build_object('public_id', v_t.public_id, 'conversation_id', v_conv));

  return v_conv;
end;
$$;
revoke all on function public.connect_task_ensure_thread(uuid) from public, anon;
grant execute on function public.connect_task_ensure_thread(uuid) to authenticated;

-- ===== (8) connect_workflow_instantiate =====
create or replace function public.connect_workflow_instantiate(p_template_id uuid)
returns table (instance_id uuid, task_id uuid, task_public_id text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tpl  public.connect_workflow_templates%rowtype;
  v_step public.connect_workflow_steps%rowtype;
  v_inst uuid; v_task uuid; v_pub text;
begin
  if auth.uid() is null or not coalesce(public.has_permission('connect.create'), false) then
    raise exception 'Sin permiso connect.create' using errcode = 'insufficient_privilege';
  end if;
  select * into v_tpl from public.connect_workflow_templates
   where connect_workflow_templates.id = p_template_id;
  if not found or not v_tpl.activo then
    raise exception 'workflow inexistente o inactivo' using errcode = 'check_violation';
  end if;
  select * into v_step from public.connect_workflow_steps s
   where s.template_id = p_template_id and s.step_no = 1;
  if not found then
    raise exception 'el workflow no tiene paso 1' using errcode = 'check_violation';
  end if;

  insert into public.connect_workflow_instances (template_id, iniciado_por)
  values (p_template_id, auth.uid())
  returning connect_workflow_instances.id into v_inst;

  -- Paso 1: tarea VACANTE (D-F43-5) a nombre del iniciador.
  insert into public.connect_tasks
    (titulo, descripcion, prioridad, due_at, creado_por, workflow_instance_id, step_no, area)
  values
    (v_step.titulo, v_step.descripcion, v_step.prioridad,
     case when v_step.due_offset_days is not null
          then now() + make_interval(days => v_step.due_offset_days) end,
     auth.uid(), v_inst, 1, v_step.rol_sugerido::text)
  returning connect_tasks.id, connect_tasks.public_id into v_task, v_pub;

  if v_step.rol_sugerido is not null then
    insert into public.notifications (role_target, kind, title, message, entity, entity_id, priority)
    values (v_step.rol_sugerido, 'connect_task',
            'Nueva tarea de workflow ' || v_pub,
            left(v_step.titulo, 120) || ' — disponible para reclamar.',
            'connect_task', v_task, public._connect_task_prio(v_step.prioridad));
  end if;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_task', v_task, 'connect.task.workflow_advance',
          jsonb_build_object('instance_id', v_inst, 'from_step', 0, 'to_step', 1,
                             'template', v_tpl.nombre, 'public_id', v_pub));

  instance_id := v_inst; task_id := v_task; task_public_id := v_pub;
  return next;
end;
$$;
revoke all on function public.connect_workflow_instantiate(uuid) from public, anon;
grant execute on function public.connect_workflow_instantiate(uuid) to authenticated;

-- ===== Seeds de workflows (D-F43-6: pocos, concretos, por seed; idempotentes) =====
insert into public.connect_workflow_templates (nombre, descripcion) values
  ('Seguimiento post-incidente',
   'Cadena interna tras resolver un incidente: acciones correctivas, verificación y cierre informativo.'),
  ('Preparación de documentación entre áreas',
   'Reunir, revisar y distribuir documentación operativa entre depósito, supervisión y administración.')
on conflict (nombre) do nothing;

insert into public.connect_workflow_steps (template_id, step_no, titulo, descripcion, rol_sugerido, due_offset_days, prioridad)
select t.id, s.step_no, s.titulo, s.descripcion, s.rol::user_role_t, s.offset_days, s.prio::public.connect_task_priority_t
from public.connect_workflow_templates t
join (values
  ('Seguimiento post-incidente', 1, 'Registrar acciones correctivas', 'Documentar qué se hizo para resolver y qué falta para prevenir.', 'operaciones', 1, 'media'),
  ('Seguimiento post-incidente', 2, 'Verificar normalización del sector', 'Confirmar en el lugar que la operación volvió a la normalidad.', 'supervisor', 2, 'media'),
  ('Seguimiento post-incidente', 3, 'Informar cierre a Dirección', 'Resumen breve del incidente, acciones y prevención.', 'admin', 3, 'baja'),
  ('Preparación de documentación entre áreas', 1, 'Reunir documentación del caso', 'Juntar remitos, fotos y registros del caso.', 'operaciones', 2, 'media'),
  ('Preparación de documentación entre áreas', 2, 'Revisión y visto bueno', 'Controlar completitud y validez de la documentación.', 'supervisor', 3, 'media'),
  ('Preparación de documentación entre áreas', 3, 'Archivo y distribución interna', 'Archivar y avisar a los interesados internos.', 'admin', 5, 'baja')
) as s(nombre, step_no, titulo, descripcion, rol, offset_days, prio)
  on s.nombre = t.nombre
on conflict (template_id, step_no) do nothing;

notify pgrst, 'reload schema';
