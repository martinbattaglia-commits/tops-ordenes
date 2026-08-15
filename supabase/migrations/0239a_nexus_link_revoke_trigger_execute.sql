-- 0239a_nexus_link_revoke_trigger_execute.sql
-- NEXUS LINK · correctivo ACL post-0238.
--
-- 0238 creó `_connect_attachment_requires_finalized_upload()` como función
-- SECURITY DEFINER de retorno `trigger`, pero no revocó el EXECUTE que
-- PostgreSQL/Supabase concede por defecto. El trigger necesita conservar
-- SECURITY DEFINER: lee `connect_pending_uploads`, una tabla con RLS activa y
-- sin policies permisivas; ejecutarlo como invoker volvería invisible la fila
-- pendiente y haría que la guarda aceptara el adjunto por la rama `not found`.
--
-- Ningún rol cliente necesita invocar la función directamente. El enlace
-- `connect_attachments_upload_binding` fue creado por el dueño del esquema y
-- dispara internamente ante INSERT; revocar EXECUTE a PUBLIC, anon,
-- authenticated y service_role no desactiva ese enlace ni cambia su lógica.
--
-- DEPENDE de: 0238_nexus_link_upload_lifecycle.sql.
-- Rollback: ROLLBACK_0239a_nexus_link_revoke_trigger_execute.sql (documental,
-- fail-closed: no vuelve a conceder la superficie insegura).

do $acl_precondition$
declare
  v_fn oid := to_regprocedure('public._connect_attachment_requires_finalized_upload()');
  v_valid boolean;
  v_expected_prosrc text := $expected_body$
declare
  v_row public.connect_pending_uploads%rowtype;
begin
  select * into v_row
    from public.connect_pending_uploads u
   where u.storage_bucket = new.storage_bucket
     and u.storage_path = new.storage_path;

  -- Sin registro pendiente el trigger es INERTE: audio y todo lo anterior a
  -- esta migración siguen funcionando exactamente igual.
  if not found then
    return new;
  end if;

  if v_row.status <> 'finalized' then
    raise exception 'La subida no está finalizada.' using errcode = '42501';
  end if;
  if v_row.conversation_id <> new.conversation_id then
    raise exception 'La subida pertenece a otra conversación.' using errcode = '42501';
  end if;
  if new.uploaded_by is not null and v_row.initiated_by <> new.uploaded_by then
    raise exception 'La subida pertenece a otro usuario.' using errcode = '42501';
  end if;
  return new;
end;
$expected_body$;
begin
  if v_fn is null then
    raise exception '0239a: falta _connect_attachment_requires_finalized_upload()'
      using errcode = '55000';
  end if;

  select p.prosecdef
         and p.prorettype = 'pg_catalog.trigger'::regtype
         and p.prolang = (select l.oid from pg_language l where l.lanname = 'plpgsql')
         and p.proconfig = array['search_path=public, pg_temp']
         and p.proowner = 'postgres'::regrole
         and p.prokind = 'f'
         and p.provolatile = 'v'
         and not p.proisstrict
         and not p.proleakproof
         and p.proparallel = 'u'
         and p.prosrc = v_expected_prosrc
    into v_valid
    from pg_proc p
   where p.oid = v_fn;
  if not coalesce(v_valid, false) then
    raise exception '0239a: identidad o modo SECURITY DEFINER del trigger divergente'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.connect_attachments'::regclass
       and t.tgname = 'connect_attachments_upload_binding'
       and t.tgfoid = v_fn
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and t.tgtype = 7 -- ROW (1) + BEFORE (2) + INSERT (4)
       and t.tgqual is null
       and t.tgnargs = 0
       and t.tgattr::text = ''
       and t.tgconstraint = 0
       and not t.tgdeferrable
       and not t.tginitdeferred
       and t.tgparentid = 0
  ) then
    raise exception '0239a: binding BEFORE INSERT ROW connect_attachments_upload_binding no verificable'
      using errcode = '55000';
  end if;
end;
$acl_precondition$;

revoke all on function public._connect_attachment_requires_finalized_upload()
  from public, anon, authenticated, service_role;

do $acl_postcondition$
declare
  v_fn oid := to_regprocedure('public._connect_attachment_requires_finalized_upload()');
  v_owner oid;
begin
  select p.proowner into v_owner from pg_proc p where p.oid = v_fn;

  if exists (
    select 1
      from aclexplode(coalesce(
        (select p.proacl from pg_proc p where p.oid = v_fn),
        acldefault('f', v_owner)
      )) a
     where a.grantee = 0
       and a.privilege_type = 'EXECUTE'
  ) then
    raise exception '0239a: PUBLIC conserva EXECUTE' using errcode = '55000';
  end if;

  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception '0239a: un rol cliente conserva EXECUTE' using errcode = '55000';
  end if;
end;
$acl_postcondition$;

notify pgrst, 'reload schema';
