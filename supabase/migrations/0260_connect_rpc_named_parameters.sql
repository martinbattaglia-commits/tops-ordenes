-- CONNECT-RPC-PARAMETROS-SIN-NOMBRE · las 17 puertas que PostgREST no podia abrir.
--
-- QUE PASO. La migracion 0246 renombro 17 funciones del modulo a `*_pre_0246` y
-- creo 17 envolturas que anteponen `nexus_depot_manager_reject_legacy_connect()`
-- antes de delegar. El proposito de la envoltura es correcto y NO se toca. Lo
-- que se perdio en el camino son los NOMBRES de los parametros: las envolturas
-- se declararon posicionales -`create function public.connect_mark_read(uuid,
-- bigint)`- y reenvian con `$1,$2`. Las `*_pre_0246` conservan los suyos.
--
-- POR QUE ESO ROMPE. PostgREST resuelve una RPC por NOMBRE de argumento, que es
-- la notacion nombrada de PostgreSQL. Una funcion sin nombres de parametro es
-- inalcanzable por esa via. Reproducido contra produccion con EXPLAIN, que
-- planifica sin ejecutar:
--   nombrada   -> 42883 · function public.connect_mark_read(p_conversation_id
--                 => uuid, p_seq => integer) does not exist
--   la _pre_0246 con los mismos nombres -> planifica y resuelve
-- El codigo llama a ONCE de las 17 con objeto nombrado, asi que once operaciones
-- quedaron muertas: marcar leido, archivar, favoritos, unirse a canal, alta y
-- baja de miembro, rol de miembro, titulo, tema, fijar y desfijar mensaje.
--
-- QUE HACE ESTA MIGRACION. DROP + CREATE de las 17 con parametros NOMBRADOS,
-- identicos a los de su `*_pre_0246`. No alcanza `create or replace`: cambiar
-- el nombre de un parametro exige recrear. Mismo cuerpo, mismo `security
-- definer`, mismo `search_path`, mismos revoke y grant. La autoridad no se
-- mueve un milimetro: el gate del principal depot-manager sigue primero y los
-- permisos internos de las `*_pre_0246` siguen mordiendo igual.
--
-- El `notify pgrst` del final NO es decorativo: sin recargar el esquema,
-- PostgREST sigue sirviendo el cache viejo y las 17 seguirian inalcanzables
-- aunque la base ya este bien.

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

create function public.connect_add_member(p_conversation_id uuid,p_profile_id uuid,p_role public.connect_member_role_t) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_add_member_pre_0246(p_conversation_id,p_profile_id,p_role); end $$;
create function public.connect_archive_conversation(p_conversation_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_archive_conversation_pre_0246(p_conversation_id); end $$;
create function public.connect_delete_message(p_message_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_delete_message_pre_0246(p_message_id); end $$;
create function public.connect_edit_message(p_message_id uuid,p_body text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_edit_message_pre_0246(p_message_id,p_body); end $$;
create function public.connect_flag_message(p_message_id uuid,p_flag text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_flag_message_pre_0246(p_message_id,p_flag); end $$;
create function public.connect_join_channel(p_conversation_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_join_channel_pre_0246(p_conversation_id); end $$;
create function public.connect_mark_read(p_conversation_id uuid,p_up_to_seq bigint) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_mark_read_pre_0246(p_conversation_id,p_up_to_seq); end $$;
create function public.connect_pin_message(p_message_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_pin_message_pre_0246(p_message_id); end $$;
create function public.connect_react(p_message_id uuid,p_emoji text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_react_pre_0246(p_message_id,p_emoji); end $$;
create function public.connect_remove_member(p_conversation_id uuid,p_profile_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_remove_member_pre_0246(p_conversation_id,p_profile_id); end $$;
create function public.connect_set_member_role(p_conversation_id uuid,p_profile_id uuid,p_role public.connect_member_role_t) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_set_member_role_pre_0246(p_conversation_id,p_profile_id,p_role); end $$;
create function public.connect_set_title(p_conversation_id uuid,p_title text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_set_title_pre_0246(p_conversation_id,p_title); end $$;
create function public.connect_set_topic(p_conversation_id uuid,p_topic text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_set_topic_pre_0246(p_conversation_id,p_topic); end $$;
create function public.connect_toggle_favorite(p_conversation_id uuid,p_on boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_toggle_favorite_pre_0246(p_conversation_id,p_on); end $$;
create function public.connect_unflag_message(p_message_id uuid,p_flag text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_unflag_message_pre_0246(p_message_id,p_flag); end $$;
create function public.connect_unpin_message(p_message_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_unpin_message_pre_0246(p_message_id); end $$;
create function public.connect_unreact(p_message_id uuid,p_emoji text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_unreact_pre_0246(p_message_id,p_emoji); end $$;

revoke all on function public.connect_add_member(uuid,uuid,public.connect_member_role_t),public.connect_archive_conversation(uuid),public.connect_delete_message(uuid),public.connect_edit_message(uuid,text),public.connect_flag_message(uuid,text),public.connect_join_channel(uuid),public.connect_mark_read(uuid,bigint),public.connect_pin_message(uuid),public.connect_react(uuid,text),public.connect_remove_member(uuid,uuid),public.connect_set_member_role(uuid,uuid,public.connect_member_role_t),public.connect_set_title(uuid,text),public.connect_set_topic(uuid,text),public.connect_toggle_favorite(uuid,boolean),public.connect_unflag_message(uuid,text),public.connect_unpin_message(uuid),public.connect_unreact(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.connect_add_member(uuid,uuid,public.connect_member_role_t),public.connect_archive_conversation(uuid),public.connect_delete_message(uuid),public.connect_edit_message(uuid,text),public.connect_flag_message(uuid,text),public.connect_join_channel(uuid),public.connect_mark_read(uuid,bigint),public.connect_pin_message(uuid),public.connect_react(uuid,text),public.connect_remove_member(uuid,uuid),public.connect_set_member_role(uuid,uuid,public.connect_member_role_t),public.connect_set_title(uuid,text),public.connect_set_topic(uuid,text),public.connect_toggle_favorite(uuid,boolean),public.connect_unflag_message(uuid,text),public.connect_unpin_message(uuid),public.connect_unreact(uuid,text) to authenticated;

-- POST-CONDICION QUE ABORTA. La migracion prueba su propio efecto: si alguna de
-- las 17 quedara sin nombres, seguiria siendo inalcanzable por PostgREST y esta
-- migracion no habria servido de nada. Se verifica ADEMAS que los nombres sean
-- EXACTAMENTE los de la `*_pre_0246` correspondiente: recrearlas con cualquier
-- nombre las volveria alcanzables, pero con otro contrato que el codigo no usa.
do $post$
declare v_faltan text; v_difieren text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_faltan
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proargnames is null and p.pronargs > 0
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
  if v_faltan is not null then
    raise exception 'RPC sin nombres de parametro tras 0260: %', v_faltan
      using errcode='check_violation';
  end if;

  select string_agg(a.proname, ', ' order by a.proname) into v_difieren
  from pg_proc a
  join pg_proc b on b.proname = a.proname || '_pre_0246'
                and b.pronamespace = a.pronamespace
  where a.pronamespace = 'public'::regnamespace
    and a.proname in (
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
    )
    and a.proargnames is distinct from b.proargnames;
  if v_difieren is not null then
    raise exception 'nombres distintos de su _pre_0246: %', v_difieren
      using errcode='check_violation';
  end if;
end $post$;

notify pgrst, 'reload schema';

commit;
