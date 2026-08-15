-- 0237_nexus_link_channel_rls.sql — NEXUS LINK · la frontera de canal, ESTRUCTURAL.
-- ─────────────────────────────────────────────────────────────────────────
-- 0236 puso la frontera en `v_connect_inbox`, que gobierna la bandeja y los
-- contadores. Eso deja fuera todo lo que NO pasa por esa vista:
--
--   · Realtime — `postgres_changes` aplica la policy SELECT de la tabla. Con la
--     policy vieja, un encargado que fuera participante de un hilo de WhatsApp
--     seguía recibiendo los INSERT de esos mensajes en su canal, aunque la UI
--     los ignorara. Filtrado visual, no estructural.
--   · Búsqueda — `connect_search` es SECURITY DEFINER: bypassea RLS. Sus ramas
--     de conversación ya excluían WhatsApp, pero las de MENSAJE y ADJUNTO sólo
--     filtraban por participación.
--   · Descarga — `connect_emit_attachment_signed_url` (0144) valida
--     `connect.view` + membresía, sin noción de canal.
--   · Storage — la policy `connect-files read members` (0148) es
--     `bucket_id + has_permission('connect.view')`, SIN membresía: cualquiera
--     con ese permiso que conociera la ruta leía cualquier objeto del bucket.
--     El propio 0148 lo dejó anotado como diferido.
--
-- Acá se cierran los cuatro. La regla es la misma en todos: si la conversación
-- es `whatsapp`, hace falta `nexus_link.whatsapp.read`.
--
-- SIN RECURSIÓN — DEMOSTRADO, NO SUPUESTO. `SECURITY DEFINER` por sí solo NO
-- garantiza nada: el dueño de la función tiene que coincidir con el dueño de las
-- tablas que lee y esas tablas no pueden tener `FORCE ROW LEVEL SECURITY`, o el
-- definer vuelve a entrar por la policy y la recursión aparece. Medido en el
-- catálogo productivo (2026-08-14, sólo lectura):
--
--   · `connect_conversations`, `connect_messages`, `connect_attachments`,
--     `connect_participants`, `permissions`, `role_permissions`, `user_roles` y
--     `profiles` → owner = `postgres`, `relforcerowsecurity = false`;
--   · `_connect_is_member`, `_connect_channel_allowed`, `nexus_link_can`,
--     `current_role` e `is_admin` → owner = `postgres`, `prosecdef = true`,
--     `search_path = public, pg_temp` fijo;
--   · `row_security = on` a nivel de sesión.
--
-- Con FORCE apagado el dueño no queda sujeto a la RLS de sus propias tablas, así
-- que el predicado se evalúa sin reingresar a las policies. La prueba
-- T-LINK-B1-02 fija esa condición: si alguien activara FORCE sobre estas tablas,
-- la premisa se rompe y el caso lo detecta.
--
-- `storage.objects` pertenece a `supabase_storage_admin`, NO a `postgres`. Por
-- eso `_connect_storage_object_allowed()` deliberadamente NO lee esa tabla: sólo
-- recibe `bucket_id` y `name` como argumentos y resuelve contra
-- `connect_attachments`, que sí es del mismo dueño.
--
-- Todas las referencias dentro de estos helpers están calificadas por esquema
-- (`public.…`, `storage.…`), de modo que `pg_temp` en el search_path no pueda
-- capturar ninguna resolución.
--
-- SIN BYPASS LEGACY: el predicado llama a `nexus_link_can()` (0236), que no
-- consulta `connect.view/create/edit` y exige doble evidencia para el atajo
-- administrativo. `is_admin()` —que es sólo `profiles.role='admin'`— queda
-- neutralizado para este canal porque el predicado se aplica como AND EXTERNO,
-- por fuera de cualquier rama OR preexistente.
--
-- Rollback: ROLLBACK_0237_nexus_link_channel_rls.sql
-- ─────────────────────────────────────────────────────────────────────────

-- ═══ (1) El predicado de canal ═══
create or replace function public._connect_channel_allowed(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when (select c.kind from public.connect_conversations c where c.id = p_conversation_id)
         = 'whatsapp'
      then public.nexus_link_can('nexus_link.whatsapp.read')
    else true
  end;
$$;
revoke all on function public._connect_channel_allowed(uuid) from public, anon, authenticated;
grant execute on function public._connect_channel_allowed(uuid) to authenticated;

-- ═══ (2) RLS: mensajes — cierra lectura Y realtime ═══
drop policy if exists "connect_messages select" on public.connect_messages;
create policy "connect_messages select"
  on public.connect_messages for select
  using (
    has_permission('connect.view')
    and public._connect_is_member(conversation_id)
    and public._connect_channel_allowed(conversation_id)
  );

-- ═══ (3) RLS: adjuntos ═══
drop policy if exists "connect_attachments select" on public.connect_attachments;
create policy "connect_attachments select"
  on public.connect_attachments for select
  using (
    has_permission('connect.view')
    and public._connect_is_member(conversation_id)
    and public._connect_channel_allowed(conversation_id)
  );

-- ═══ (4) RLS: conversaciones ═══
-- El predicado va como AND EXTERNO: así ni la rama `is_admin()` ni la de canal
-- público pueden esquivarlo.
drop policy if exists "connect_conversations select" on public.connect_conversations;
create policy "connect_conversations select"
  on public.connect_conversations for select
  using (
    has_permission('connect.view')
    and (
      public._connect_is_member(id)
      or (kind = 'channel' and visibility = 'public')
      or is_admin()
    )
    and (kind <> 'whatsapp' or public.nexus_link_can('nexus_link.whatsapp.read'))
  );

-- ═══ (5) Descarga: el portón de la signed URL ═══
create or replace function public.connect_emit_attachment_signed_url(p_attachment_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_conv   uuid;
  v_bucket text;
  v_path   text;
  v_scan   text;
begin
  select conversation_id, storage_bucket, storage_path, scan_status
    into v_conv, v_bucket, v_path, v_scan
    from public.connect_attachments where id = p_attachment_id;
  if not found then raise exception 'adjunto inexistente' using errcode = 'no_data_found'; end if;

  if not (public.has_permission('connect.view') and public._connect_is_member(v_conv)) then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  -- Frontera de canal: la membresía no alcanza para descargar un adjunto de
  -- WhatsApp. Mismo error que el caso no autorizado, para no revelar por la vía
  -- del mensaje que el adjunto existe y es de ese canal.
  if not public._connect_channel_allowed(v_conv) then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_attachment', p_attachment_id, 'connect.attachment.access',
          jsonb_build_object('bucket', v_bucket, 'scan_status', v_scan));

  return jsonb_build_object('bucket', v_bucket, 'path', v_path, 'scan_status', v_scan);
end;
$fn$;
revoke all on function public.connect_emit_attachment_signed_url(uuid) from public, anon;
grant execute on function public.connect_emit_attachment_signed_url(uuid) to authenticated;

-- ═══ (6) Storage: membresía real + canal, por RUTA ═══
--
-- Universo verificado antes de endurecer (2026-08-14, sólo lectura): los 7
-- objetos de `connect-files` tienen la forma `<conversation_id>/…` y su
-- conversación existe. Cerrar por ruta no deja ningún objeto vigente inaccesible.
-- La autoridad NO es el primer segmento de la ruta: es el REGISTRO DE ADJUNTO.
-- Interpretar la ruta sola permitiría que un objeto con un prefijo engañoso
-- —`<uuid-de-una-conversación-mía>/…` apuntando a material ajeno— se leyera. Se
-- exige la cadena completa:
--
--   objeto → connect_attachments(bucket,path) → conversación → membresía vigente
--          → capacidad del canal
--
-- y ADEMÁS que el primer segmento de la ruta coincida con la conversación del
-- registro, de modo que ruta y registro no puedan discrepar.
--
-- Sin registro de adjunto ⇒ DENEGADO. Verificado antes de endurecer
-- (2026-08-14): los 7 objetos vigentes de `connect-files` tienen su registro,
-- cero huérfanos y ninguna discrepancia ruta↔conversación, así que la regla no
-- deja inaccesible ningún objeto existente.
create or replace function public._connect_storage_object_allowed(
  p_bucket text, p_name text
)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.connect_attachments a
     where a.storage_bucket = p_bucket
       and a.storage_path   = p_name
       and a.conversation_id::text = (storage.foldername(p_name))[1]
       and public._connect_is_member(a.conversation_id)
       and public._connect_channel_allowed(a.conversation_id)
  );
$$;
revoke all on function public._connect_storage_object_allowed(text, text) from public, anon, authenticated;
grant execute on function public._connect_storage_object_allowed(text, text) to authenticated;

drop policy if exists "connect-files read members" on storage.objects;
create policy "connect-files read members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'connect-files'
    and has_permission('connect.view')
    and public._connect_storage_object_allowed(bucket_id, name)
  );

-- ═══ (7) Búsqueda ═══
-- Idéntica a la vigente salvo por el predicado de canal en las ramas de MENSAJE
-- y ADJUNTO, que eran las únicas que podían devolver material de WhatsApp (las
-- de conversación ya se limitaban a dm/group/channel/erp).
create or replace function public.connect_search(p_query text, p_limit integer default 30)
returns table(result_type text, conversation_id uuid, context_id text, kind text, title text,
              snippet text, entity_type text, entity_ref text,
              occurred_at timestamp with time zone, sort_rank integer)
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_q   tsquery;
  v_like text;
  v_lim int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if not public.has_permission('connect.view') then
    raise exception 'Sin permiso connect.view' using errcode = 'insufficient_privilege';
  end if;
  if p_query is null or length(btrim(p_query)) = 0 then
    return;
  end if;
  v_like := '%' || btrim(p_query) || '%';
  v_q := websearch_to_tsquery('spanish', p_query);

  return query
  with my_convs as (
    select p.conversation_id from public.connect_participants p where p.profile_id = v_uid
  )
  select 'conversation'::text, c.id, c.context_id, c.kind::text,
         coalesce(c.title, c.slug, 'Conversación')::text,
         c.topic, null::text, null::text, c.last_message_at, 1
    from public.connect_conversations c
   where c.kind in ('dm','group','channel')
     and c.archived_at is null
     and (c.id in (select mc.conversation_id from my_convs mc)
          or (c.kind = 'channel' and c.visibility = 'public'))
     and (c.title ilike v_like or c.topic ilike v_like or c.slug ilike v_like or c.context_id ilike v_like)
  union all
  select 'erp_context'::text, c.id, c.context_id, c.kind::text,
         coalesce(c.title, 'Contexto ERP')::text,
         c.topic, l.entity_type, coalesce(l.entity_id::text, l.entity_id_text), c.last_message_at, 2
    from public.connect_conversations c
    join public.connect_conversation_links l on l.conversation_id = c.id
   where c.kind = 'erp'
     and c.id in (select mc.conversation_id from my_convs mc)
     and (c.title ilike v_like or c.context_id ilike v_like or l.entity_type ilike v_like
          or l.entity_id_text ilike v_like)
  union all
  select 'message'::text, m.conversation_id, c.context_id, c.kind::text,
         coalesce(c.title, c.slug, 'Mensaje')::text,
         left(m.body, 180), null::text, null::text, m.created_at, 3
    from public.connect_messages m
    join public.connect_conversations c on c.id = m.conversation_id
   where m.deleted_at is null
     and m.conversation_id in (select mc.conversation_id from my_convs mc)
     and public._connect_channel_allowed(m.conversation_id)   -- ← frontera de canal
     and to_tsvector('spanish', coalesce(m.body, '')) @@ v_q
  union all
  select 'attachment'::text, a.conversation_id, c.context_id, c.kind::text,
         coalesce(a.file_name, 'Adjunto')::text,
         a.mime_type, null::text, null::text, a.created_at, 4
    from public.connect_attachments a
    join public.connect_conversations c on c.id = a.conversation_id
   where a.conversation_id in (select mc.conversation_id from my_convs mc)
     and public._connect_channel_allowed(a.conversation_id)   -- ← frontera de canal
     and a.file_name ilike v_like
  order by 10 asc, 9 desc nulls last
  limit v_lim;
end;
$fn$;
revoke all on function public.connect_search(text, integer) from public, anon;
grant execute on function public.connect_search(text, integer) to authenticated;

notify pgrst, 'reload schema';
