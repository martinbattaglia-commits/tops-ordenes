-- ROLLBACK de 0260. Inversa logica e idempotente.
--
-- Restituye las 17 envolturas EXACTAMENTE como las dejo 0246: parametros
-- POSICIONALES declarados por tipo y cuerpo que reenvia con `$1,$2,$3`. Cuerpo,
-- `security definer`, `search_path`, revoke y grant identicos a los de 0246,
-- reemitidos byte a byte desde esa migracion.
--
-- ADVERTENCIA DECLARADA, y es el sentido de este archivo: ejecutarlo DEVUELVE EL
-- DEFECTO. Las 17 vuelven a ser inalcanzables por PostgREST y las once
-- operaciones vivas -marcar leido, archivar, favoritos, unirse a canal, alta y
-- baja de miembro, rol de miembro, titulo, tema, fijar y desfijar mensaje-
-- vuelven a fallar, una de ellas -marcar leido- EN SILENCIO. No es un rollback
-- que restituya un estado sano: restituye el estado del 2026-08-17. Existe
-- porque el linaje lo exige y porque revertir 0260 sin volver a 0246 dejaria un
-- contrato que ninguna migracion describe.
--
-- El `notify pgrst` es igual de necesario acá: sin recargar, PostgREST seguiria
-- sirviendo el cache con nombres que la base ya no tiene.

begin;

drop function if exists public.connect_add_member(uuid,uuid,public.connect_member_role_t);
drop function if exists public.connect_archive_conversation(uuid);
drop function if exists public.connect_delete_message(uuid);
drop function if exists public.connect_edit_message(uuid,text);
drop function if exists public.connect_flag_message(uuid,text);
drop function if exists public.connect_join_channel(uuid);
drop function if exists public.connect_mark_read(uuid,bigint);
drop function if exists public.connect_pin_message(uuid);
drop function if exists public.connect_react(uuid,text);
drop function if exists public.connect_remove_member(uuid,uuid);
drop function if exists public.connect_set_member_role(uuid,uuid,public.connect_member_role_t);
drop function if exists public.connect_set_title(uuid,text);
drop function if exists public.connect_set_topic(uuid,text);
drop function if exists public.connect_toggle_favorite(uuid,boolean);
drop function if exists public.connect_unflag_message(uuid,text);
drop function if exists public.connect_unpin_message(uuid);
drop function if exists public.connect_unreact(uuid,text);

create function public.connect_add_member(uuid,uuid,public.connect_member_role_t) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_add_member_pre_0246($1,$2,$3); end $$;
create function public.connect_archive_conversation(uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_archive_conversation_pre_0246($1); end $$;
create function public.connect_delete_message(uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_delete_message_pre_0246($1); end $$;
create function public.connect_edit_message(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_edit_message_pre_0246($1,$2); end $$;
create function public.connect_flag_message(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_flag_message_pre_0246($1,$2); end $$;
create function public.connect_join_channel(uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_join_channel_pre_0246($1); end $$;
create function public.connect_mark_read(uuid,bigint) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_mark_read_pre_0246($1,$2); end $$;
create function public.connect_pin_message(uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_pin_message_pre_0246($1); end $$;
create function public.connect_react(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_react_pre_0246($1,$2); end $$;
create function public.connect_remove_member(uuid,uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_remove_member_pre_0246($1,$2); end $$;
create function public.connect_set_member_role(uuid,uuid,public.connect_member_role_t) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_set_member_role_pre_0246($1,$2,$3); end $$;
create function public.connect_set_title(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_set_title_pre_0246($1,$2); end $$;
create function public.connect_set_topic(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_set_topic_pre_0246($1,$2); end $$;
create function public.connect_toggle_favorite(uuid,boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_toggle_favorite_pre_0246($1,$2); end $$;
create function public.connect_unflag_message(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_unflag_message_pre_0246($1,$2); end $$;
create function public.connect_unpin_message(uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_unpin_message_pre_0246($1); end $$;
create function public.connect_unreact(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_unreact_pre_0246($1,$2); end $$;

revoke all on function public.connect_add_member(uuid,uuid,public.connect_member_role_t),public.connect_archive_conversation(uuid),public.connect_delete_message(uuid),public.connect_edit_message(uuid,text),public.connect_flag_message(uuid,text),public.connect_join_channel(uuid),public.connect_mark_read(uuid,bigint),public.connect_pin_message(uuid),public.connect_react(uuid,text),public.connect_remove_member(uuid,uuid),public.connect_set_member_role(uuid,uuid,public.connect_member_role_t),public.connect_set_title(uuid,text),public.connect_set_topic(uuid,text),public.connect_toggle_favorite(uuid,boolean),public.connect_unflag_message(uuid,text),public.connect_unpin_message(uuid),public.connect_unreact(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.connect_add_member(uuid,uuid,public.connect_member_role_t),public.connect_archive_conversation(uuid),public.connect_delete_message(uuid),public.connect_edit_message(uuid,text),public.connect_flag_message(uuid,text),public.connect_join_channel(uuid),public.connect_mark_read(uuid,bigint),public.connect_pin_message(uuid),public.connect_react(uuid,text),public.connect_remove_member(uuid,uuid),public.connect_set_member_role(uuid,uuid,public.connect_member_role_t),public.connect_set_title(uuid,text),public.connect_set_topic(uuid,text),public.connect_toggle_favorite(uuid,boolean),public.connect_unflag_message(uuid,text),public.connect_unpin_message(uuid),public.connect_unreact(uuid,text) to authenticated;

-- Post-condicion inversa: las 17 tienen que quedar SIN nombres, que es el estado
-- de 0246. Si alguna conservara nombres, el rollback habria quedado a medias.
do $post$
declare v_con_nombres text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_con_nombres
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proargnames is not null and p.pronargs > 0
    and p.proname in (
      'connect_add_member',
      'connect_archive_conversation',
      'connect_delete_message',
      'connect_edit_message',
      'connect_flag_message',
      'connect_join_channel',
      'connect_mark_read',
      'connect_pin_message',
      'connect_react',
      'connect_remove_member',
      'connect_set_member_role',
      'connect_set_title',
      'connect_set_topic',
      'connect_toggle_favorite',
      'connect_unflag_message',
      'connect_unpin_message',
      'connect_unreact'
    );
  if v_con_nombres is not null then
    raise exception 'rollback incompleto, conservan nombres: %', v_con_nombres
      using errcode='check_violation';
  end if;
end $post$;

notify pgrst, 'reload schema';

commit;
