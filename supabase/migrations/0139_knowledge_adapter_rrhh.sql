-- ENTREGADA — F0.5.2 Knowledge Layer · 0139 — E2.2 adaptador RRHH (3 fuentes, PII).
-- D-E2.2-4: seed enabled=FALSE (dormido hasta autorización expresa de Dirección).
-- entity_type rrhh_empleado/rrhh_solicitud/rrhh_document (CASE -> 'perm:rrhh.view').
-- PAYLOAD SIN PII: solo metadata (campo/acción/action/fecha/nivel) — nunca valores, comentarios, ip/ua/detail.
-- Hardening completo en las 9 funciones.

-- ===== Fuente A: rrhh_empleado_historial =====
create or replace function public.knowledge_rrhh_empleado_historial_to_canonical(p public.rrhh_empleado_historial)
returns public.knowledge_event_canonical language sql stable set search_path = public, pg_temp as $$
  select row(
    'rrhh.empleado.updated', p.created_at,
    case when p.changed_by is null then 'system' else 'user' end, p.changed_by, null,
    'rrhh_empleado', p.empleado_id::text,
    'rrhh empleado actualizado',
    jsonb_build_object('campo', p.campo, 'vigente_desde', p.vigente_desde),  -- SIN valores (PII)
    public.knowledge_visibility_for('rrhh_empleado', p.empleado_id::text),
    'rrhh_empleado_historial', p.id::text, null
  )::public.knowledge_event_canonical
$$;
create or replace function public.project_rrhh_empleado_historial()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if coalesce((select enabled from public.knowledge_sources where source_table='rrhh_empleado_historial'), false) then
      perform public.knowledge_emit_event(public.knowledge_rrhh_empleado_historial_to_canonical(NEW));
    end if;
  exception when others then
    raise log 'KnowledgeProjectFailed %', json_build_object('component','project_rrhh_empleado_historial','source_pk',NEW.id::text,'error',sqlerrm);
  end; return null;
end; $$;
do $$ begin
  if to_regclass('public.rrhh_empleado_historial') is not null then
    drop trigger if exists tg_project_rrhh_empleado_historial on public.rrhh_empleado_historial;
    create trigger tg_project_rrhh_empleado_historial after insert on public.rrhh_empleado_historial
      for each row execute function public.project_rrhh_empleado_historial();
  end if;
end $$;
create or replace function public.knowledge_backfill_rrhh_empleado_historial(p_limit int default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.rrhh_empleado_historial; v_id uuid; v_count int := 0; v_fail int := 0;
begin
  if to_regclass('public.rrhh_empleado_historial') is null then return 0; end if;
  if not coalesce((select enabled from public.knowledge_sources where source_table='rrhh_empleado_historial'), false) then return 0; end if;
  perform set_config('knowledge.correlation_id', gen_random_uuid()::text, true);
  for a in select * from public.rrhh_empleado_historial order by created_at, id limit p_limit loop
    begin v_id := public.knowledge_emit_event(public.knowledge_rrhh_empleado_historial_to_canonical(a));
      if v_id is not null then v_count := v_count + 1; end if;
    exception when others then v_fail := v_fail + 1;
      raise log 'KnowledgeBackfillRowFailed %', json_build_object('component','knowledge_backfill_rrhh_empleado_historial','source_pk',a.id::text,'error',sqlerrm);
    end;
  end loop;
  update public.knowledge_sources set last_backfill_at = now() where source_table='rrhh_empleado_historial';
  return v_count;
end; $$;

-- ===== Fuente B: rrhh_solicitud_eventos =====
create or replace function public.knowledge_rrhh_solicitud_eventos_to_canonical(p public.rrhh_solicitud_eventos)
returns public.knowledge_event_canonical language sql stable set search_path = public, pg_temp as $$
  select row(
    'rrhh.solicitud.' || p.accion::text, p.ts,
    case when p.actor_id is null then 'system' else 'user' end, p.actor_id, null,
    'rrhh_solicitud', p.solicitud_id::text,
    'rrhh solicitud ' || p.accion::text,
    jsonb_build_object('accion', p.accion::text, 'nivel', p.nivel),  -- SIN comentario (PII)
    public.knowledge_visibility_for('rrhh_solicitud', p.solicitud_id::text),
    'rrhh_solicitud_eventos', p.id::text, null
  )::public.knowledge_event_canonical
$$;
create or replace function public.project_rrhh_solicitud_eventos()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if coalesce((select enabled from public.knowledge_sources where source_table='rrhh_solicitud_eventos'), false) then
      perform public.knowledge_emit_event(public.knowledge_rrhh_solicitud_eventos_to_canonical(NEW));
    end if;
  exception when others then
    raise log 'KnowledgeProjectFailed %', json_build_object('component','project_rrhh_solicitud_eventos','source_pk',NEW.id::text,'error',sqlerrm);
  end; return null;
end; $$;
do $$ begin
  if to_regclass('public.rrhh_solicitud_eventos') is not null then
    drop trigger if exists tg_project_rrhh_solicitud_eventos on public.rrhh_solicitud_eventos;
    create trigger tg_project_rrhh_solicitud_eventos after insert on public.rrhh_solicitud_eventos
      for each row execute function public.project_rrhh_solicitud_eventos();
  end if;
end $$;
create or replace function public.knowledge_backfill_rrhh_solicitud_eventos(p_limit int default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.rrhh_solicitud_eventos; v_id uuid; v_count int := 0; v_fail int := 0;
begin
  if to_regclass('public.rrhh_solicitud_eventos') is null then return 0; end if;
  if not coalesce((select enabled from public.knowledge_sources where source_table='rrhh_solicitud_eventos'), false) then return 0; end if;
  perform set_config('knowledge.correlation_id', gen_random_uuid()::text, true);
  for a in select * from public.rrhh_solicitud_eventos order by ts, id limit p_limit loop
    begin v_id := public.knowledge_emit_event(public.knowledge_rrhh_solicitud_eventos_to_canonical(a));
      if v_id is not null then v_count := v_count + 1; end if;
    exception when others then v_fail := v_fail + 1;
      raise log 'KnowledgeBackfillRowFailed %', json_build_object('component','knowledge_backfill_rrhh_solicitud_eventos','source_pk',a.id::text,'error',sqlerrm);
    end;
  end loop;
  update public.knowledge_sources set last_backfill_at = now() where source_table='rrhh_solicitud_eventos';
  return v_count;
end; $$;

-- ===== Fuente C: rrhh_document_audit =====
create or replace function public.knowledge_rrhh_document_audit_to_canonical(p public.rrhh_document_audit)
returns public.knowledge_event_canonical language sql stable set search_path = public, pg_temp as $$
  select row(
    'rrhh.document.' || p.action::text, p.ts,
    case when p.actor_id is null then 'system' else 'user' end, p.actor_id, null,
    'rrhh_document', p.document_id::text,
    'rrhh document ' || p.action::text,
    jsonb_build_object('action', p.action::text),  -- SIN ip/user_agent/detail (PII)
    public.knowledge_visibility_for('rrhh_document', p.document_id::text),
    'rrhh_document_audit', p.id::text, null
  )::public.knowledge_event_canonical
$$;
create or replace function public.project_rrhh_document_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if coalesce((select enabled from public.knowledge_sources where source_table='rrhh_document_audit'), false) then
      perform public.knowledge_emit_event(public.knowledge_rrhh_document_audit_to_canonical(NEW));
    end if;
  exception when others then
    raise log 'KnowledgeProjectFailed %', json_build_object('component','project_rrhh_document_audit','source_pk',NEW.id::text,'error',sqlerrm);
  end; return null;
end; $$;
do $$ begin
  if to_regclass('public.rrhh_document_audit') is not null then
    drop trigger if exists tg_project_rrhh_document_audit on public.rrhh_document_audit;
    create trigger tg_project_rrhh_document_audit after insert on public.rrhh_document_audit
      for each row execute function public.project_rrhh_document_audit();
  end if;
end $$;
create or replace function public.knowledge_backfill_rrhh_document_audit(p_limit int default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.rrhh_document_audit; v_id uuid; v_count int := 0; v_fail int := 0;
begin
  if to_regclass('public.rrhh_document_audit') is null then return 0; end if;
  if not coalesce((select enabled from public.knowledge_sources where source_table='rrhh_document_audit'), false) then return 0; end if;
  perform set_config('knowledge.correlation_id', gen_random_uuid()::text, true);
  for a in select * from public.rrhh_document_audit order by ts, id limit p_limit loop
    begin v_id := public.knowledge_emit_event(public.knowledge_rrhh_document_audit_to_canonical(a));
      if v_id is not null then v_count := v_count + 1; end if;
    exception when others then v_fail := v_fail + 1;
      raise log 'KnowledgeBackfillRowFailed %', json_build_object('component','knowledge_backfill_rrhh_document_audit','source_pk',a.id::text,'error',sqlerrm);
    end;
  end loop;
  update public.knowledge_sources set last_backfill_at = now() where source_table='rrhh_document_audit';
  return v_count;
end; $$;

-- ===== Seeds (enabled=FALSE — dormido hasta D-E2.2-4) =====
insert into public.knowledge_sources (source_table, enabled, notes) values
  ('rrhh_empleado_historial', false, 'Fuente E2.2 — rrhh (PII; DORMIDA hasta autorización Dirección, D-E2.2-4)'),
  ('rrhh_solicitud_eventos',  false, 'Fuente E2.2 — rrhh (PII; DORMIDA hasta autorización Dirección, D-E2.2-4)'),
  ('rrhh_document_audit',     false, 'Fuente E2.2 — rrhh (PII; DORMIDA hasta autorización Dirección, D-E2.2-4)')
on conflict (source_table) do nothing;

-- ===== Hardening completo (9 funciones) =====
revoke all on function public.knowledge_rrhh_empleado_historial_to_canonical(public.rrhh_empleado_historial) from public;
revoke execute on function public.knowledge_rrhh_empleado_historial_to_canonical(public.rrhh_empleado_historial) from anon, authenticated;
revoke all on function public.project_rrhh_empleado_historial() from public;
revoke execute on function public.project_rrhh_empleado_historial() from anon, authenticated;
revoke all on function public.knowledge_backfill_rrhh_empleado_historial(int) from public;
revoke execute on function public.knowledge_backfill_rrhh_empleado_historial(int) from anon, authenticated;
grant  execute on function public.knowledge_backfill_rrhh_empleado_historial(int) to service_role;

revoke all on function public.knowledge_rrhh_solicitud_eventos_to_canonical(public.rrhh_solicitud_eventos) from public;
revoke execute on function public.knowledge_rrhh_solicitud_eventos_to_canonical(public.rrhh_solicitud_eventos) from anon, authenticated;
revoke all on function public.project_rrhh_solicitud_eventos() from public;
revoke execute on function public.project_rrhh_solicitud_eventos() from anon, authenticated;
revoke all on function public.knowledge_backfill_rrhh_solicitud_eventos(int) from public;
revoke execute on function public.knowledge_backfill_rrhh_solicitud_eventos(int) from anon, authenticated;
grant  execute on function public.knowledge_backfill_rrhh_solicitud_eventos(int) to service_role;

revoke all on function public.knowledge_rrhh_document_audit_to_canonical(public.rrhh_document_audit) from public;
revoke execute on function public.knowledge_rrhh_document_audit_to_canonical(public.rrhh_document_audit) from anon, authenticated;
revoke all on function public.project_rrhh_document_audit() from public;
revoke execute on function public.project_rrhh_document_audit() from anon, authenticated;
revoke all on function public.knowledge_backfill_rrhh_document_audit(int) from public;
revoke execute on function public.knowledge_backfill_rrhh_document_audit(int) from anon, authenticated;
grant  execute on function public.knowledge_backfill_rrhh_document_audit(int) to service_role;

select pg_notify('pgrst', 'reload schema');
