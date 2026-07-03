-- 0174_ai_core.sql — F5.2-lite · Nexus AI Copilot read-only.
-- ENTREGADA, NO APLICADA (G3) — verificar número libre en prod antes de aplicar.
-- ─────────────────────────────────────────────────────────────────────────
-- Contenido:
--   1. Tablas de gate + auditoría IA: ai_pilot_users, ai_sessions, ai_messages,
--      ai_sources, ai_feedback. Append-only (sin policies de UPDATE/DELETE;
--      escritura SOLO vía RPC SECURITY DEFINER — G10).
--   2. RLS: dueño ve lo suyo; is_admin() ve todo (NO usa has_permission():
--      con RBAC dormido no es una frontera confiable).
--   3. Catálogo CERRADO de RPCs de lectura SECURITY INVOKER (la RLS del
--      usuario aplica; la IA nunca ve más que el usuario — Master Plan §8).
--   4. RPCs de escritura de auditoría: ai_log_interaction / ai_set_feedback
--      (SECURITY DEFINER, validan auth.uid() y pertenencia).
-- DEPENDE de: 0126 (searchable_items/knowledge_events + RLS visibility_key),
--   0130 (v_knowledge_timeline/v_knowledge_entity_360), 0143 (connect core),
--   0164 (incidentes), 0168 (tareas/workflows), 0004 (notifications),
--   compliance_cases/compliance_documents (aplicadas en prod vía rama compliance),
--   is_admin() (0009).
-- Rollback: ROLLBACK_0173_0175.md.
-- IDEMPOTENTE. Sin datos. Sin cambios sobre tablas existentes.
-- ─────────────────────────────────────────────────────────────────────────

-- ═════════════════════════ 1. TABLAS ═════════════════════════

-- Gate explícito de piloto (D-F5-5 / decisión Dirección 2026-07-03):
-- estar acá habilita el Copilot; NO otorga permisos de datos (eso es RLS).
create table if not exists public.ai_pilot_users (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  note     text
);

create table if not exists public.ai_sessions (
  id             uuid primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  channel        text not null default 'page' check (channel in ('page','panel')),
  entity_context text,
  started_at     timestamptz not null default now()
);
create index if not exists ai_sessions_user_idx on public.ai_sessions (user_id, started_at desc);

create table if not exists public.ai_messages (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.ai_sessions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade, -- desnormalizado: budget + RLS baratos
  seq            int  not null check (seq >= 1),
  role           text not null check (role in ('user','assistant')),
  content        text,                       -- texto pleno (retención 180d — depuración manual documentada)
  content_hash   text not null,              -- sha256; se conserva siempre
  tools_used     jsonb not null default '[]'::jsonb,
  provider       text,
  model          text,
  prompt_version text,
  tokens_in      int,
  tokens_out     int,
  cost_estimate  numeric(12,6),
  latency_ms     int,
  outcome        text check (outcome in ('answered','no_evidence','error','budget','killed','denied')),
  error_detail   text,
  created_at     timestamptz not null default now(),
  unique (session_id, seq)
);
create index if not exists ai_messages_user_day_idx on public.ai_messages (user_id, created_at desc);

create table if not exists public.ai_sources (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.ai_messages(id) on delete cascade,
  entity_type  text not null,
  entity_id    text not null,
  public_id    text,
  excerpt_hash text,
  rank         int,
  created_at   timestamptz not null default now()
);
create index if not exists ai_sources_message_idx on public.ai_sources (message_id);

create table if not exists public.ai_feedback (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.ai_messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  verdict    text not null check (verdict in ('up','down')),
  reason     text,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

-- ═════════════════════════ 2. RLS ═════════════════════════
-- Solo SELECT por policy. INSERT/UPDATE/DELETE: sin policy → denegado para
-- authenticated; la escritura entra únicamente por las RPC SECURITY DEFINER.

alter table public.ai_pilot_users enable row level security;
alter table public.ai_sessions    enable row level security;
alter table public.ai_messages    enable row level security;
alter table public.ai_sources     enable row level security;
alter table public.ai_feedback    enable row level security;

drop policy if exists ai_pilot_users_select on public.ai_pilot_users;
create policy ai_pilot_users_select on public.ai_pilot_users
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists ai_sessions_select on public.ai_sessions;
create policy ai_sessions_select on public.ai_sessions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists ai_messages_select on public.ai_messages;
create policy ai_messages_select on public.ai_messages
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists ai_sources_select on public.ai_sources;
create policy ai_sources_select on public.ai_sources
  for select to authenticated
  using (exists (
    select 1 from public.ai_messages m
    where m.id = ai_sources.message_id
      and (m.user_id = auth.uid() or public.is_admin())
  ));

drop policy if exists ai_feedback_select on public.ai_feedback;
create policy ai_feedback_select on public.ai_feedback
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on public.ai_pilot_users, public.ai_sessions, public.ai_messages,
           public.ai_sources, public.ai_feedback from anon;
grant select on public.ai_pilot_users, public.ai_sessions, public.ai_messages,
             public.ai_sources, public.ai_feedback to authenticated;

-- ═════════════════ 3. CATÁLOGO DE LECTURA (SECURITY INVOKER) ═════════════════
-- Todas STABLE, search_path fijo, límites acotados server-side. La RLS del
-- llamador decide qué filas existen. Ningún argumento se interpola como SQL.

-- 3.1 Búsqueda FTS sobre la proyección del spine (0126).
-- NOTA OPERATIVA: searchable_items está VACÍA en prod (verificado 2026-07-03:
-- knowledge_events=295, searchable_items=0 → la proyección/backfill nunca corrió).
-- La función es correcta; el backfill es tarea OPS de la ventana de aplicación.
create or replace function public.ai_search_knowledge(
  p_query text,
  p_types text[] default null,
  p_limit int default 20
) returns table (
  entity_type text, entity_id text, public_id text, title text,
  excerpt text, status text, entity_date timestamptz, rank real
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select s.entity_type, s.entity_id, s.public_id, s.title,
         left(coalesce(s.body, ''), 400) as excerpt,
         s.status, s.entity_date,
         ts_rank(s.tsv, websearch_to_tsquery('spanish', p_query)) as rank
  from public.searchable_items s
  where length(trim(coalesce(p_query, ''))) >= 2
    and s.tsv @@ websearch_to_tsquery('spanish', p_query)
    and (p_types is null or s.entity_type = any (p_types))
  order by rank desc, s.entity_date desc nulls last
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- 3.2 Incidentes (0164). Solo nombre visible del asignado (sin PII de profiles).
create or replace function public.ai_incidents_overview(
  p_estados text[] default null,
  p_severidades text[] default null,
  p_limit int default 30
) returns table (
  public_id text, titulo text, sector text, severidad text, estado text,
  asignado text, sla_due_at timestamptz, created_at timestamptz, resuelto_at timestamptz
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select i.public_id, i.titulo, i.sector, i.severidad::text, i.estado::text,
         p.full_name as asignado, i.sla_due_at, i.created_at, i.resuelto_at
  from public.connect_incidents i
  left join public.profiles p on p.id = i.asignado_a
  where (p_estados is null or i.estado::text = any (p_estados))
    and (p_severidades is null or i.severidad::text = any (p_severidades))
  order by array_position(array['critica','alta','media','baja'], i.severidad::text),
           i.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
$$;

-- 3.3 Tareas (0168). Scopes cerrados; 'de_usuario' exige p_user.
create or replace function public.ai_tasks_overview(
  p_scope text default 'abiertas',
  p_user uuid default null,
  p_limit int default 30
) returns table (
  public_id text, titulo text, estado text, prioridad text, due_at timestamptz,
  asignado text, incident_public_id text, workflow text, created_at timestamptz
)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if p_scope not in ('abiertas', 'vencidas', 'mias', 'de_usuario') then
    raise exception 'ai_tasks_overview: scope inválido %', p_scope;
  end if;
  if p_scope = 'de_usuario' and p_user is null then
    raise exception 'ai_tasks_overview: de_usuario requiere p_user';
  end if;
  return query
  select t.public_id, t.titulo, t.estado::text, t.prioridad::text, t.due_at,
         pr.full_name as asignado, i.public_id as incident_public_id,
         wt.nombre as workflow, t.created_at
  from public.connect_tasks t
  left join public.profiles pr on pr.id = t.asignado_a
  left join public.connect_incidents i on i.id = t.incident_id
  left join public.connect_workflow_instances wi on wi.id = t.workflow_instance_id
  left join public.connect_workflow_templates wt on wt.id = wi.template_id
  where t.estado in ('pendiente', 'en_progreso')
    and (p_scope <> 'vencidas' or (t.due_at is not null and t.due_at < now()))
    and (p_scope <> 'mias' or t.asignado_a = auth.uid())
    and (p_scope <> 'de_usuario' or t.asignado_a = p_user)
  order by array_position(array['urgente','alta','media','baja'], t.prioridad::text),
           t.due_at asc nulls last, t.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
end $$;

-- 3.4 Workflows trabados: instancia en_curso cuyo paso actual no registra
-- actividad hace >= p_days_idle días (definición determinista, diseño §4).
create or replace function public.ai_workflows_stuck(
  p_days_idle int default 3,
  p_limit int default 20
) returns table (
  workflow text, current_step int, step_titulo text,
  task_public_id text, task_estado text, idle_days int, iniciado timestamptz
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select wt.nombre as workflow, wi.current_step, ws.titulo as step_titulo,
         tk.public_id as task_public_id, tk.estado::text as task_estado,
         extract(day from now() - coalesce(tk.updated_at, wi.created_at))::int as idle_days,
         wi.created_at as iniciado
  from public.connect_workflow_instances wi
  join public.connect_workflow_templates wt on wt.id = wi.template_id
  left join public.connect_workflow_steps ws
         on ws.template_id = wi.template_id and ws.step_no = wi.current_step
  left join public.connect_tasks tk
         on tk.workflow_instance_id = wi.id and tk.step_no = wi.current_step
  where wi.estado = 'en_curso'
    and coalesce(tk.updated_at, wi.created_at)
        < now() - make_interval(days => least(greatest(coalesce(p_days_idle, 3), 1), 60))
  order by idle_days desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- 3.5 Cronología de una entidad (vista security_invoker 0130 → RLS visibility_key).
-- Sin payload: solo summary (postura PII conservadora, diseño §10).
create or replace function public.ai_entity_timeline(
  p_entity_type text,
  p_entity_id text,
  p_limit int default 40
) returns table (
  event_type text, occurred_at timestamptz, actor_label text, summary text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select v.event_type, v.occurred_at, v.actor_label, v.summary
  from public.v_knowledge_timeline v
  where v.entity_type = p_entity_type and v.entity_id = p_entity_id
  order by v.occurred_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 50)
$$;

-- 3.6 Vista 360 de una entidad (conceptos anotados incluidos; sin payload).
create or replace function public.ai_entity_360(
  p_entity_type text,
  p_entity_id text,
  p_limit int default 40
) returns table (
  event_type text, occurred_at timestamptz, actor_label text, summary text,
  concept_label text, concept_kind text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select v.event_type, v.occurred_at, v.actor_label, v.summary,
         v.concept_label, v.concept_kind
  from public.v_knowledge_entity_360 v
  where v.entity_type = p_entity_type and v.entity_id = p_entity_id
  order by v.occurred_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 50)
$$;

-- 3.7 Compliance pendiente: casos activos + documentos vencidos / por vencer (90d).
create or replace function public.ai_compliance_pending(
  p_limit int default 30
) returns table (
  kind text, ref text, titulo text, estado text, riesgo text,
  fecha_clave date, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  (
    select 'caso'::text as kind, c.item_id as ref,
           coalesce(c.tipo_certificado, 'Caso') || ' · ' || coalesce(c.sede, 's/sede') as titulo,
           c.estado_administrativo as estado, c.nivel_riesgo as riesgo,
           c.proxima_accion_fecha as fecha_clave, c.proxima_accion as detalle
    from public.compliance_cases c
    where c.activo = true
  )
  union all
  (
    select 'documento'::text, d.item_id, d.titulo, d.estado, d.riesgo,
           d.fecha_vencimiento, d.categoria
    from public.compliance_documents d
    where d.fecha_vencimiento is not null
      and d.fecha_vencimiento <= (current_date + interval '90 days')
  )
  order by fecha_clave asc nulls last
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
$$;

-- 3.8 Salud de clientes vía vínculos conversación↔cliente (0143: entity_type
-- 'clients'). Expone SOLO razón social (nunca cuit/teléfono/email — F-01-R).
create or replace function public.ai_clients_health(
  p_limit int default 15
) returns table (
  cliente text, incidentes_abiertos int, tareas_abiertas int, total_abiertos int
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with linked as (
    select l.conversation_id, c.razon
    from public.connect_conversation_links l
    join public.clients c on c.id = l.entity_id
    where l.entity_type = 'clients'
  )
  select lk.razon as cliente,
         count(distinct i.id) filter (
           where i.estado in ('abierto','en_progreso','en_espera'))::int as incidentes_abiertos,
         count(distinct t.id) filter (
           where t.estado in ('pendiente','en_progreso'))::int as tareas_abiertas,
         ( count(distinct i.id) filter (where i.estado in ('abierto','en_progreso','en_espera'))
         + count(distinct t.id) filter (where t.estado in ('pendiente','en_progreso')) )::int as total_abiertos
  from linked lk
  left join public.connect_incidents i on i.conversation_id = lk.conversation_id
  left join public.connect_tasks t on t.conversation_id = lk.conversation_id
  group by lk.razon
  having ( count(distinct i.id) filter (where i.estado in ('abierto','en_progreso','en_espera'))
         + count(distinct t.id) filter (where t.estado in ('pendiente','en_progreso')) ) > 0
  order by total_abiertos desc
  limit least(greatest(coalesce(p_limit, 15), 1), 50)
$$;

-- 3.9 Digest operativo: eventos del spine en la ventana (RLS visibility_key).
create or replace function public.ai_ops_digest(
  p_hours int default 24,
  p_limit int default 40
) returns table (
  event_type text, entity_type text, entity_id text,
  summary text, actor_label text, occurred_at timestamptz
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select e.event_type, e.entity_type, e.entity_id, e.summary, e.actor_label, e.occurred_at
  from public.knowledge_events e
  where e.occurred_at >= now() - make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 168))
    and e.status = 'processed'
  order by e.occurred_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 50)
$$;

-- 3.10 Agenda propia: notificaciones sin leer + tareas e incidentes asignados.
-- SOLO del llamador (auth.uid()); jamás agenda de terceros.
create or replace function public.ai_my_agenda(
  p_limit int default 30
) returns table (
  kind text, public_id text, titulo text, detalle text,
  prioridad text, fecha timestamptz, created_at timestamptz
)
language sql stable security invoker set search_path = public, pg_temp as $$
  -- El union va envuelto: Postgres no acepta EXPRESIONES en el ORDER BY de un
  -- set-op (solo columnas de salida) → ordenar en el select externo.
  select u.kind, u.public_id, u.titulo, u.detalle, u.prioridad, u.fecha, u.created_at
  from (
    select 'incidente'::text as kind, i.public_id, i.titulo,
           coalesce(i.sector, '') as detalle, i.severidad::text as prioridad,
           i.sla_due_at as fecha, i.created_at
    from public.connect_incidents i
    where i.asignado_a = auth.uid()
      and i.estado in ('abierto','en_progreso','en_espera')
    union all
    select 'tarea', t.public_id, t.titulo, null, t.prioridad::text, t.due_at, t.created_at
    from public.connect_tasks t
    where t.asignado_a = auth.uid()
      and t.estado in ('pendiente','en_progreso')
    union all
    select 'notificacion', null, n.title, n.message, n.priority, n.remind_at, n.created_at
    from public.notifications n
    where n.user_id = auth.uid() and n.read_at is null
  ) u
  order by array_position(array['critica','urgente','alta','media','baja'], u.prioridad),
           u.fecha asc nulls last, u.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
$$;

-- ═════════════ 4. ESCRITURA DE AUDITORÍA (SECURITY DEFINER) ═════════════

-- 4.1 Registra una interacción completa: upsert de sesión + mensajes + fuentes
-- del último mensaje assistant. Valida identidad y gate de piloto.
create or replace function public.ai_log_interaction(
  p_session_id uuid,
  p_channel text default 'page',
  p_entity_context text default null,
  p_messages jsonb default '[]'::jsonb,
  p_sources jsonb default '[]'::jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_seq int;
  v_msg jsonb;
  v_src jsonb;
  v_last_assistant uuid;
  v_inserted int := 0;
begin
  if v_uid is null then
    raise exception 'ai_log_interaction: sesión anónima';
  end if;
  if not exists (select 1 from public.ai_pilot_users pu where pu.user_id = v_uid) then
    raise exception 'ai_log_interaction: usuario fuera del piloto';
  end if;
  if p_session_id is null then
    raise exception 'ai_log_interaction: p_session_id requerido';
  end if;
  if jsonb_typeof(p_messages) is distinct from 'array'
     or jsonb_typeof(p_sources) is distinct from 'array' then
    raise exception 'ai_log_interaction: p_messages/p_sources deben ser arrays';
  end if;

  insert into public.ai_sessions (id, user_id, channel, entity_context)
  values (p_session_id, v_uid,
          case when p_channel in ('page','panel') then p_channel else 'page' end,
          p_entity_context)
  on conflict (id) do nothing;

  select s.user_id into v_owner from public.ai_sessions s where s.id = p_session_id;
  if v_owner is distinct from v_uid then
    raise exception 'ai_log_interaction: sesión ajena';
  end if;

  select coalesce(max(m.seq), 0) into v_seq
  from public.ai_messages m where m.session_id = p_session_id;

  for v_msg in select * from jsonb_array_elements(p_messages) loop
    v_seq := v_seq + 1;
    insert into public.ai_messages (
      session_id, user_id, seq, role, content, content_hash, tools_used,
      provider, model, prompt_version, tokens_in, tokens_out, cost_estimate,
      latency_ms, outcome, error_detail
    ) values (
      p_session_id, v_uid, v_seq,
      case when v_msg->>'role' in ('user','assistant') then v_msg->>'role'
           else 'assistant' end,
      v_msg->>'content',
      coalesce(v_msg->>'content_hash', md5(coalesce(v_msg->>'content',''))),
      coalesce(v_msg->'tools_used', '[]'::jsonb),
      v_msg->>'provider', v_msg->>'model', v_msg->>'prompt_version',
      nullif(v_msg->>'tokens_in','')::int, nullif(v_msg->>'tokens_out','')::int,
      nullif(v_msg->>'cost_estimate','')::numeric,
      nullif(v_msg->>'latency_ms','')::int,
      case when v_msg->>'outcome' in
             ('answered','no_evidence','error','budget','killed','denied')
           then v_msg->>'outcome' end,
      v_msg->>'error_detail'
    ) returning id into v_last_assistant;
    v_inserted := v_inserted + 1;
  end loop;

  if v_last_assistant is not null then
    for v_src in select * from jsonb_array_elements(p_sources) loop
      insert into public.ai_sources (message_id, entity_type, entity_id, public_id, excerpt_hash, rank)
      values (v_last_assistant,
              coalesce(v_src->>'entity_type','desconocido'),
              coalesce(v_src->>'entity_id',''),
              v_src->>'public_id', v_src->>'excerpt_hash',
              nullif(v_src->>'rank','')::int);
    end loop;
  end if;

  return jsonb_build_object(
    'session_id', p_session_id,
    'messages_inserted', v_inserted,
    'last_message_id', v_last_assistant
  );
end $$;

-- 4.2 Feedback 👍/👎 del dueño del mensaje (upsert por (message_id, user_id)).
create or replace function public.ai_set_feedback(
  p_message_id uuid,
  p_verdict text,
  p_reason text default null
) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'ai_set_feedback: sesión anónima';
  end if;
  if p_verdict not in ('up','down') then
    raise exception 'ai_set_feedback: verdict inválido';
  end if;
  if not exists (
    select 1 from public.ai_messages m
    where m.id = p_message_id and m.user_id = v_uid
  ) then
    raise exception 'ai_set_feedback: mensaje ajeno o inexistente';
  end if;
  insert into public.ai_feedback (message_id, user_id, verdict, reason)
  values (p_message_id, v_uid, p_verdict, left(p_reason, 500))
  on conflict (message_id, user_id)
  do update set verdict = excluded.verdict, reason = excluded.reason;
end $$;

-- ═════════════════════════ 5. GRANTS ═════════════════════════
revoke all on function public.ai_search_knowledge(text, text[], int)          from public, anon;
revoke all on function public.ai_incidents_overview(text[], text[], int)      from public, anon;
revoke all on function public.ai_tasks_overview(text, uuid, int)              from public, anon;
revoke all on function public.ai_workflows_stuck(int, int)                    from public, anon;
revoke all on function public.ai_entity_timeline(text, text, int)             from public, anon;
revoke all on function public.ai_entity_360(text, text, int)                  from public, anon;
revoke all on function public.ai_compliance_pending(int)                      from public, anon;
revoke all on function public.ai_clients_health(int)                          from public, anon;
revoke all on function public.ai_ops_digest(int, int)                         from public, anon;
revoke all on function public.ai_my_agenda(int)                               from public, anon;
revoke all on function public.ai_log_interaction(uuid, text, text, jsonb, jsonb) from public, anon;
revoke all on function public.ai_set_feedback(uuid, text, text)               from public, anon;

grant execute on function public.ai_search_knowledge(text, text[], int)       to authenticated;
grant execute on function public.ai_incidents_overview(text[], text[], int)   to authenticated;
grant execute on function public.ai_tasks_overview(text, uuid, int)           to authenticated;
grant execute on function public.ai_workflows_stuck(int, int)                 to authenticated;
grant execute on function public.ai_entity_timeline(text, text, int)          to authenticated;
grant execute on function public.ai_entity_360(text, text, int)               to authenticated;
grant execute on function public.ai_compliance_pending(int)                   to authenticated;
grant execute on function public.ai_clients_health(int)                       to authenticated;
grant execute on function public.ai_ops_digest(int, int)                      to authenticated;
grant execute on function public.ai_my_agenda(int)                            to authenticated;
grant execute on function public.ai_log_interaction(uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.ai_set_feedback(uuid, text, text)            to authenticated;

notify pgrst, 'reload schema';
