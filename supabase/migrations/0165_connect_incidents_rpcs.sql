-- 0165_connect_incidents_rpcs.sql — Nexus Link F4.2B (Centro de Incidentes).
-- ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor de prod (arsksytgdnzukbmfgkju).
-- ─────────────────────────────────────────────────────────────────────────
-- RPCs de ciclo de vida del Addendum A2 con la máquina de estados congelada
-- en el Master Plan §5.2 (D4 ratificada):
--
--   abierto → en_progreso → en_espera ↔ en_progreso → resuelto → cerrado
--   reapertura: resuelto → en_progreso (AUDITADA como connect.incident.reopen)
--   cierre forzado (solo connect.incident_admin): cualquier estado no-cerrado → cerrado
--   cerrado = TERMINAL.  'resuelto' NO se alcanza por set_status (solo por resolve,
--   que exige resolucion_text — invariante del modelo).
--
-- Reglas transversales (contrato F4):
--   · SECDEF + search_path fijo + guards NULL-safe fail-closed (P-1).
--   · Escritura EXCLUSIVA por estas RPCs (0164 deja la tabla deny-all para sesión).
--   · Toda transición/asignación → fila append-only en audit_log.
--   · Notificaciones críticas SÍNCRONAS (D2 ratificada: NO dependen del worker/
--     scheduler — deuda OPS F4.1 intacta y NO tocada). kind='connect_incident'
--     (reservado en 0147), entity='connect_incident', entity_id = INCIDENT id
--     (hrefFor navega entity→/connect/incidentes/{entity_id}; NO se usa
--     entity='connect' porque ese vocabulario navega a /connect/c/{conversation}
--     y además activaría el dedupe anti-fatiga de conversaciones no-leídas,
--     que no aplica a incidentes). Payload sin PII ni contenido
--     de mensajes (el título del incidente es dato operativo, criterio 0161).
--   · Fan-out acotado: apertura → tenedores de connect.incident_admin;
--     asignación → asignado; estado/resolución → reportante + asignado.
--     Bounded por diseño (puñado de filas) — patrón 0161.
--   · FOR UPDATE en toda transición (serializa transiciones concurrentes).
--   · Comentarios/fotos del incidente = connect_post_message / connect_attachments
--     sobre la conversación vinculada (motor existente; acá NO se duplica).
-- IDEMPOTENTE (create or replace + revoke/grant re-ejecutables).
-- DEPENDE de: 0164 (tabla/enums/valor 'incident_admin' de permission_action_t —
-- por eso el SEED del permiso vive ACÁ, en tx separada), 0143/0144/0151/0161
-- (Connect core), 0147 (notifications ext), 0009 (RBAC), 0004 (notifications).
-- ─────────────────────────────────────────────────────────────────────────

-- ===== D3 · RBAC (parte 2/2): permiso connect.incident_admin =====
-- El valor de enum 'incident_admin' se agregó en 0164 (tx separada). Acá se
-- siembra el permiso + grants (SOLO catálogo; patrón 0146/0155). action =
-- 'incident_admin' porque ('connect','admin') está ocupado (UNIQUE module+action).
-- ⚠️ NO usar `on conflict do nothing` sin target acá: taparía en silencio un
-- conflicto de (module,action) y el permiso no existiría (precedente 0070).
insert into public.permissions (slug, module, action, label, description) values
  ('connect.incident_admin', 'connect', 'incident_admin', 'Administrar incidentes',
   'Administracion avanzada del Centro de Incidentes: reasignar, cerrar forzado, ajustar severidad')
on conflict (slug) do nothing;

insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p on p.slug = 'connect.incident_admin'
where ro.slug in ('admin','director_ops')
on conflict do nothing;

-- ===== Helper: ¿el usuario es admin de incidentes? (NULL-safe, P-1) =====
-- has_permission puede devolver NULL si el usuario no tiene fila en profiles
-- (current_role() NULL → `false or null` = NULL). Hallazgo I-2 adversarial:
-- `if not NULL` no levanta → fail-open. coalesce lo cierra.
create or replace function public._connect_incident_is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(public.has_permission('connect.incident_admin'), false);
$$;
revoke all on function public._connect_incident_is_admin() from public, anon, authenticated;
grant execute on function public._connect_incident_is_admin() to service_role;

-- ===== Helper: prioridad de notificación según severidad =====
create or replace function public._connect_incident_priority(p_sev public.connect_incident_severity_t)
returns text
language sql immutable set search_path = public, pg_temp
as $$
  select case p_sev when 'critica' then 'urgent' when 'alta' then 'high' else 'normal' end;
$$;
revoke all on function public._connect_incident_priority(public.connect_incident_severity_t) from public, anon, authenticated;
grant execute on function public._connect_incident_priority(public.connect_incident_severity_t) to service_role;

-- ===== Helper: notificación de incidente (síncrona, sin PII) =====
create or replace function public._connect_incident_notify(
  p_user      uuid,
  p_incident  uuid,
  p_title     text,
  p_message   text,
  p_priority  text
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_user is null or p_user = auth.uid() then
    return;  -- el actor no se auto-notifica
  end if;
  insert into public.notifications (user_id, kind, title, message, entity, entity_id, priority)
  values (p_user, 'connect_incident', p_title, p_message, 'connect_incident', p_incident, p_priority);
end;
$$;
revoke all on function public._connect_incident_notify(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public._connect_incident_notify(uuid, uuid, text, text, text) to service_role;

-- ===== (1) connect_incident_open =====
-- Reportar requiere connect.create (cualquier staff habilitado en Link).
-- Crea ATÓMICAMENTE: conversación kind='incident' + reportante owner + fila de
-- incidente + primer mensaje (descripción, opcional) + audit + notificación
-- síncrona a los tenedores de connect.incident_admin.
create or replace function public.connect_incident_open(
  p_titulo      text,
  p_severidad   text default 'media',
  p_sector      text default null,
  p_ubicacion   text default null,
  p_tipo_averia text default null,
  p_descripcion text default null
) returns table (id uuid, public_id text, conversation_id uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_titulo text;
  v_sev    public.connect_incident_severity_t;
  v_conv   uuid;
  v_part   uuid;
  v_inc    uuid;
  v_pub    text;
  v_admin  uuid;
begin
  -- P-1: fail-closed explícito (coalesce: has_permission puede devolver NULL, I-2).
  if auth.uid() is null or not coalesce(public.has_permission('connect.create'), false) then
    raise exception 'Sin permiso connect.create' using errcode = 'insufficient_privilege';
  end if;

  v_titulo := left(btrim(coalesce(p_titulo, '')), 160);
  if v_titulo = '' then
    raise exception 'el título del incidente es obligatorio' using errcode = 'check_violation';
  end if;
  if coalesce(p_severidad, 'media') not in ('baja','media','alta','critica') then
    raise exception 'severidad inválida (baja|media|alta|critica)' using errcode = 'check_violation';
  end if;
  v_sev := coalesce(p_severidad, 'media')::public.connect_incident_severity_t;

  -- Hilo del incidente (kind reservado en 0143; sin migrar enums).
  insert into public.connect_conversations (kind, title, created_by)
  values ('incident', v_titulo, auth.uid())
  returning connect_conversations.id into v_conv;

  insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
  values (v_conv, 'staff', auth.uid(), 'owner')
  on conflict (conversation_id, profile_id) do nothing;

  insert into public.connect_incidents
    (conversation_id, titulo, sector, ubicacion, tipo_averia, severidad, reportado_por)
  values
    (v_conv, v_titulo, nullif(btrim(coalesce(p_sector,'')),''),
     nullif(btrim(coalesce(p_ubicacion,'')),''),
     nullif(btrim(coalesce(p_tipo_averia,'')),''), v_sev, auth.uid())
  returning connect_incidents.id, connect_incidents.public_id into v_inc, v_pub;

  -- Título navegable del hilo: "INC-2026-0001 — <titulo>".
  update public.connect_conversations c
     set title = v_pub || ' — ' || left(v_titulo, 100)
   where c.id = v_conv;

  -- Primer mensaje = descripción (opcional; dispara el enqueue estándar de 0161 —
  -- rama DM no aplica a kind='incident', las menciones no intervienen acá).
  if nullif(btrim(coalesce(p_descripcion,'')), '') is not null then
    select cp.id into v_part
      from public.connect_participants cp
     where cp.conversation_id = v_conv and cp.profile_id = auth.uid();
    insert into public.connect_messages
      (conversation_id, author_participant_id, author_profile_id, kind, body)
    values (v_conv, v_part, auth.uid(), 'text', btrim(p_descripcion));
  end if;

  -- Audit append-only (sin descripción: el contenido vive en el hilo).
  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_incident', v_inc, 'connect.incident.open',
          jsonb_build_object('public_id', v_pub, 'severidad', v_sev,
                             'sector', nullif(btrim(coalesce(p_sector,'')),'')));

  -- D2: notificación SÍNCRONA acotada a los tenedores de connect.incident_admin
  -- (RBAC formal) UNION los admins legacy (profiles.role='admin') — fix I-3
  -- adversarial: con el RBAC dormido (1 asignación en user_roles en prod), solo
  -- el RBAC formal dejaría el fan-out VACÍO y nadie se enteraría de la apertura.
  -- Acotado por diseño (puñado de usuarios internos activos); el reportante se
  -- excluye en el helper.
  for v_admin in
    select distinct ur.user_id
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions pe on pe.id = rp.permission_id
      join public.profiles pr on pr.id = ur.user_id
     where pe.slug = 'connect.incident_admin'
       and coalesce(pr.active, true)
       and pr.client_id is null
    union
    select p.id
      from public.profiles p
     where p.role = 'admin'
       and coalesce(p.active, true)
       and p.client_id is null
  loop
    perform public._connect_incident_notify(
      v_admin, v_inc,
      'Nuevo incidente ' || v_pub,
      'Se reportó: ' || left(v_titulo, 120),
      public._connect_incident_priority(v_sev));
  end loop;

  id := v_inc; public_id := v_pub; conversation_id := v_conv;
  return next;
end;
$$;
revoke all on function public.connect_incident_open(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.connect_incident_open(text, text, text, text, text, text) to authenticated;

-- ===== (2) connect_incident_assign =====
-- incident_admin asigna/reasigna a cualquier interno; auto-asignación permitida
-- (p_to = actor, con connect.create). La asignación es ATRIBUTO, no estado (D4).
create or replace function public.connect_incident_assign(p_id uuid, p_to uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_inc  public.connect_incidents%rowtype;
  v_is_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode = 'insufficient_privilege';
  end if;
  if p_to is null then
    raise exception 'falta el asignado' using errcode = 'check_violation';
  end if;

  select * into v_inc from public.connect_incidents where connect_incidents.id = p_id for update;
  if not found then
    raise exception 'incidente inexistente' using errcode = 'no_data_found';
  end if;
  if v_inc.estado = 'cerrado' then
    raise exception 'el incidente está cerrado' using errcode = 'check_violation';
  end if;

  -- P-1: NULL-safe (helper con coalesce, fix I-2). Reglas (fix I-1 adversarial):
  --   · incident_admin: asigna/REASIGNA a cualquiera (incluido sí mismo).
  --   · staff con connect.create: SOLO auto-asignación tipo "claim" de un
  --     incidente VACANTE (asignado_a null). Sin esto, cualquier staff se
  --     apropiaba de incidentes ya asignados (robo de asignación + entrada al
  --     hilo + ciclo completo resolve/close sin ser admin).
  v_is_admin := public._connect_incident_is_admin();
  if not v_is_admin then
    if not (p_to = auth.uid()
            and v_inc.asignado_a is null
            and coalesce(public.has_permission('connect.create'), false)) then
      raise exception 'solo connect.incident_admin puede asignar o reasignar a terceros'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Destino: staff interno activo (mismo criterio que connect_notif_delegate / 0158).
  if not exists (
    select 1 from public.profiles p
     where p.id = p_to
       and coalesce(p.active, true)
       and p.client_id is null
       and p.role in ('admin','operaciones','supervisor')
  ) then
    raise exception 'el asignado no es un usuario interno válido' using errcode = 'check_violation';
  end if;

  update public.connect_incidents set asignado_a = p_to where connect_incidents.id = p_id;

  -- El asignado entra al hilo (miembro) para ver/comentar.
  insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
  values (v_inc.conversation_id, 'staff', p_to, 'member')
  on conflict (conversation_id, profile_id) do nothing;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_incident', p_id, 'connect.incident.assign',
          jsonb_build_object('public_id', v_inc.public_id,
                             'from', v_inc.asignado_a, 'to', p_to));

  perform public._connect_incident_notify(
    p_to, p_id,
    'Incidente ' || v_inc.public_id || ' asignado',
    'Te asignaron: ' || left(v_inc.titulo, 120),
    public._connect_incident_priority(v_inc.severidad));
  -- Reasignación: el asignado anterior también se entera.
  if v_inc.asignado_a is not null and v_inc.asignado_a is distinct from p_to then
    perform public._connect_incident_notify(
      v_inc.asignado_a, p_id,
      'Incidente ' || v_inc.public_id || ' reasignado',
      'El incidente pasó a otro responsable.',
      'normal');
  end if;
end;
$$;
revoke all on function public.connect_incident_assign(uuid, uuid) from public, anon;
grant execute on function public.connect_incident_assign(uuid, uuid) to authenticated;

-- ===== (3) connect_incident_set_status =====
-- Máquina de estados D4. 'resuelto' NO es alcanzable acá (usar resolve).
-- Reapertura (resuelto→en_progreso): reportante, asignado o incident_admin — AUDITADA.
-- Cierre (resuelto→cerrado): reportante, asignado o incident_admin.
-- Forzado ((abierto|en_progreso|en_espera)→cerrado): SOLO incident_admin — AUDITADO forced=true.
-- Resto (abierto→en_progreso, en_progreso↔en_espera): asignado o incident_admin.
create or replace function public.connect_incident_set_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_inc         public.connect_incidents%rowtype;
  v_new         public.connect_incident_status_t;
  v_is_admin    boolean;
  v_is_assignee boolean;
  v_is_reporter boolean;
  v_reopen      boolean := false;
  v_forced      boolean := false;
  v_action      text;
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_status,'') not in ('abierto','en_progreso','en_espera','resuelto','cerrado') then
    raise exception 'estado inválido' using errcode = 'check_violation';
  end if;
  if p_status = 'resuelto' then
    raise exception 'usar connect_incident_resolve (la resolución exige detalle)'
      using errcode = 'check_violation';
  end if;
  v_new := p_status::public.connect_incident_status_t;

  select * into v_inc from public.connect_incidents where connect_incidents.id = p_id for update;
  if not found then
    raise exception 'incidente inexistente' using errcode = 'no_data_found';
  end if;

  v_is_admin    := public._connect_incident_is_admin();  -- NULL-safe (I-2)
  -- P-1: comparaciones NULL-safe.
  v_is_assignee := v_inc.asignado_a is not distinct from auth.uid() and v_inc.asignado_a is not null;
  v_is_reporter := v_inc.reportado_por is not distinct from auth.uid() and v_inc.reportado_por is not null;

  if v_inc.estado = v_new then
    return;  -- no-op idempotente
  end if;

  -- Matriz de transiciones (Master Plan §5.2).
  if v_inc.estado = 'cerrado' then
    raise exception 'el incidente está cerrado (estado terminal)' using errcode = 'check_violation';
  elsif v_inc.estado = 'abierto' and v_new = 'en_progreso' then
    if not (v_is_assignee or v_is_admin) then
      raise exception 'solo el asignado o incident_admin' using errcode = 'insufficient_privilege';
    end if;
  elsif v_inc.estado = 'en_progreso' and v_new = 'en_espera' then
    if not (v_is_assignee or v_is_admin) then
      raise exception 'solo el asignado o incident_admin' using errcode = 'insufficient_privilege';
    end if;
  elsif v_inc.estado = 'en_espera' and v_new = 'en_progreso' then
    if not (v_is_assignee or v_is_admin) then
      raise exception 'solo el asignado o incident_admin' using errcode = 'insufficient_privilege';
    end if;
  elsif v_inc.estado = 'resuelto' and v_new = 'cerrado' then
    if not (v_is_reporter or v_is_assignee or v_is_admin) then
      raise exception 'solo reportante, asignado o incident_admin pueden cerrar'
        using errcode = 'insufficient_privilege';
    end if;
  elsif v_inc.estado = 'resuelto' and v_new = 'en_progreso' then
    -- REAPERTURA (D4: permitida y auditada).
    if not (v_is_reporter or v_is_assignee or v_is_admin) then
      raise exception 'solo reportante, asignado o incident_admin pueden reabrir'
        using errcode = 'insufficient_privilege';
    end if;
    v_reopen := true;
  elsif v_new = 'cerrado' then
    -- CIERRE FORZADO desde estado no-resuelto: solo incident_admin.
    if not v_is_admin then
      raise exception 'cierre forzado: solo connect.incident_admin'
        using errcode = 'insufficient_privilege';
    end if;
    v_forced := true;
  else
    raise exception 'transición inválida: % → %', v_inc.estado, v_new
      using errcode = 'check_violation';
  end if;

  update public.connect_incidents
     set estado = v_new,
         resuelto_at     = case when v_reopen then null else resuelto_at end,
         resolucion_text = case when v_reopen then null else resolucion_text end
   where connect_incidents.id = p_id;

  -- Reapertura: la resolución anterior se PRESERVA como mensaje system en el
  -- hilo (visible solo a miembros — misma frontera PII que el resto del hilo).
  -- Fix I-4 adversarial: NO va texto libre a audit_log (legible por supervisor);
  -- allí solo queda la longitud como evidencia de que existía.
  if v_reopen and v_inc.resolucion_text is not null then
    insert into public.connect_messages (conversation_id, kind, body)
    values (v_inc.conversation_id, 'system',
            'Reapertura de ' || v_inc.public_id || '. Resolución anterior: ' || v_inc.resolucion_text);
  end if;

  v_action := case
    when v_reopen then 'connect.incident.reopen'
    when v_forced then 'connect.incident.force_close'
    else 'connect.incident.set_status'
  end;
  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_incident', p_id, v_action,
          jsonb_build_object('public_id', v_inc.public_id,
                             'from', v_inc.estado, 'to', v_new, 'forced', v_forced,
                             'prev_resolucion_len',
                             case when v_reopen then coalesce(length(v_inc.resolucion_text), 0) end));

  -- D2: reportante + asignado se enteran síncrono (helper excluye al actor;
  -- fix M-3 adversarial: si reportante = asignado, UNA sola notificación).
  perform public._connect_incident_notify(
    v_inc.reportado_por, p_id,
    'Incidente ' || v_inc.public_id || ': ' || replace(v_new::text, '_', ' '),
    case when v_reopen then 'El incidente fue reabierto.'
         else 'Cambio de estado: ' || replace(v_inc.estado::text,'_',' ') || ' → ' || replace(v_new::text,'_',' ') end,
    public._connect_incident_priority(v_inc.severidad));
  if v_inc.asignado_a is distinct from v_inc.reportado_por then
    perform public._connect_incident_notify(
      v_inc.asignado_a, p_id,
      'Incidente ' || v_inc.public_id || ': ' || replace(v_new::text, '_', ' '),
      case when v_reopen then 'El incidente fue reabierto.'
           else 'Cambio de estado: ' || replace(v_inc.estado::text,'_',' ') || ' → ' || replace(v_new::text,'_',' ') end,
      public._connect_incident_priority(v_inc.severidad));
  end if;
end;
$$;
revoke all on function public.connect_incident_set_status(uuid, text) from public, anon;
grant execute on function public.connect_incident_set_status(uuid, text) to authenticated;

-- ===== (4) connect_incident_set_severity =====
-- Asignado o incident_admin. Escalada a 'critica' notifica (síncrono).
create or replace function public.connect_incident_set_severity(p_id uuid, p_severidad text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_inc public.connect_incidents%rowtype;
  v_new public.connect_incident_severity_t;
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_severidad,'') not in ('baja','media','alta','critica') then
    raise exception 'severidad inválida (baja|media|alta|critica)' using errcode = 'check_violation';
  end if;
  v_new := p_severidad::public.connect_incident_severity_t;

  select * into v_inc from public.connect_incidents where connect_incidents.id = p_id for update;
  if not found then
    raise exception 'incidente inexistente' using errcode = 'no_data_found';
  end if;
  if v_inc.estado = 'cerrado' then
    raise exception 'el incidente está cerrado' using errcode = 'check_violation';
  end if;
  if not ((v_inc.asignado_a is not null and v_inc.asignado_a is not distinct from auth.uid())
          or public._connect_incident_is_admin()) then
    raise exception 'solo el asignado o incident_admin' using errcode = 'insufficient_privilege';
  end if;
  if v_inc.severidad = v_new then
    return;  -- no-op idempotente
  end if;

  update public.connect_incidents set severidad = v_new where connect_incidents.id = p_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_incident', p_id, 'connect.incident.set_severity',
          jsonb_build_object('public_id', v_inc.public_id,
                             'from', v_inc.severidad, 'to', v_new));

  if v_new = 'critica' then
    perform public._connect_incident_notify(
      v_inc.reportado_por, p_id,
      'Incidente ' || v_inc.public_id || ' escalado a crítica',
      left(v_inc.titulo, 120), 'urgent');
    if v_inc.asignado_a is distinct from v_inc.reportado_por then
      perform public._connect_incident_notify(
        v_inc.asignado_a, p_id,
        'Incidente ' || v_inc.public_id || ' escalado a crítica',
        left(v_inc.titulo, 120), 'urgent');
    end if;
  end if;
end;
$$;
revoke all on function public.connect_incident_set_severity(uuid, text) from public, anon;
grant execute on function public.connect_incident_set_severity(uuid, text) to authenticated;

-- ===== (5) connect_incident_resolve =====
-- Asignado o incident_admin (Master Plan §5.2). resolucion_text OBLIGATORIO.
create or replace function public.connect_incident_resolve(p_id uuid, p_resolucion text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_inc public.connect_incidents%rowtype;
  v_res text;
begin
  if auth.uid() is null then
    raise exception 'sesión requerida' using errcode = 'insufficient_privilege';
  end if;
  v_res := btrim(coalesce(p_resolucion, ''));
  if v_res = '' then
    raise exception 'la resolución es obligatoria' using errcode = 'check_violation';
  end if;

  select * into v_inc from public.connect_incidents where connect_incidents.id = p_id for update;
  if not found then
    raise exception 'incidente inexistente' using errcode = 'no_data_found';
  end if;
  if v_inc.estado not in ('abierto','en_progreso','en_espera') then
    raise exception 'transición inválida: % → resuelto', v_inc.estado using errcode = 'check_violation';
  end if;
  if not ((v_inc.asignado_a is not null and v_inc.asignado_a is not distinct from auth.uid())
          or public._connect_incident_is_admin()) then
    raise exception 'solo el asignado o incident_admin pueden resolver'
      using errcode = 'insufficient_privilege';
  end if;

  update public.connect_incidents
     set estado = 'resuelto', resuelto_at = now(), resolucion_text = left(v_res, 2000)
   where connect_incidents.id = p_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_incident', p_id, 'connect.incident.resolve',
          jsonb_build_object('public_id', v_inc.public_id, 'from', v_inc.estado));

  perform public._connect_incident_notify(
    v_inc.reportado_por, p_id,
    'Incidente ' || v_inc.public_id || ' resuelto',
    'Podés verificar y cerrar (o reabrir).',
    public._connect_incident_priority(v_inc.severidad));
  if v_inc.asignado_a is distinct from v_inc.reportado_por then
    perform public._connect_incident_notify(
      v_inc.asignado_a, p_id,
      'Incidente ' || v_inc.public_id || ' resuelto',
      'El incidente quedó resuelto.',
      'normal');
  end if;
end;
$$;
revoke all on function public.connect_incident_resolve(uuid, text) from public, anon;
grant execute on function public.connect_incident_resolve(uuid, text) to authenticated;

notify pgrst, 'reload schema';
