-- ROLLBACK_0235_link_notification_personal_read.sql
--
-- Revierte 0235 dejando el esquema exactamente como lo dejó 0234.
-- NO toca `public.notifications`: ninguna fila fue creada, borrada ni
-- reescrita por 0235, así que no hay nada que restaurar ahí.
--
-- ⚠️ Se pierden las marcas de lectura PERSONALES de broadcasts acumuladas
-- mientras 0235 estuvo aplicada (`notification_reads`). Es dato nacido de
-- 0235: al revertir, esos broadcasts vuelven a figurar sin leer para sus
-- destinatarios, que es el estado previo. No se pierde ninguna notificación.
-- Si se quisiera conservarlas, respaldar la tabla antes de ejecutar esto.

drop function if exists public.connect_notif_mark_all_read();
drop function if exists public.connect_notif_mark_read(uuid);

-- Restituye la vía de escritura directa tal como la dejó 0162, incluida su
-- rama de admin: al revertir 0235 el marcado vuelve a hacerse por UPDATE y sin
-- ese grant la aplicación anterior quedaría sin poder marcar nada leído.
drop policy if exists "notifications mark read own" on public.notifications;
create policy "notifications mark read own"
  on public.notifications for update
  using (user_id = auth.uid() or delegated_to = auth.uid() or public.current_role() = 'admin')
  with check (user_id = auth.uid() or delegated_to = auth.uid() or public.current_role() = 'admin');
grant update (read_at, remind_at) on public.notifications to authenticated;

-- Salida explícita de la publicación. Es REDUNDANTE por diseño: el `drop table`
-- de más abajo ya retira la tabla de `supabase_realtime` automáticamente, y por
-- eso suprimir este bloque NO hace fallar la prueba de residuos (medido: la
-- mutación sobrevive). Se conserva igual para que el rollback siga siendo
-- correcto si alguien reordena las sentencias, y se deja dicho acá para que
-- nadie lea la prueba como una cobertura que no da.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'notification_reads'
  ) then
    execute 'alter publication supabase_realtime drop table public.notification_reads';
  end if;
exception
  when undefined_object then null;
end $$;

-- El contador rojo vuelve a la definición de 0234 (filtro de destinatario
-- dentro de la vista, sin lectura individual de broadcasts).
create or replace view public.v_link_notification_badges
with (security_invoker = true) as
select
  (
    select count(*)
      from public.notifications n
     where n.read_at is null
       and (n.remind_at is null or n.remind_at <= now())
       and (
            n.user_id      = auth.uid()
         or n.delegated_to = auth.uid()
         or (n.user_id is null and n.role_target is not null
             and n.role_target = public.current_role())
       )
  )::bigint as red_system_count,
  coalesce((
    select sum(i.unread_count)
      from public.v_connect_inbox i
     where i.kind = 'whatsapp'
       and (i.muted_until is null or i.muted_until < now())
       and i.archived_at is null
  ), 0)::bigint as green_whatsapp_count,
  coalesce((
    select sum(i.unread_count)
      from public.v_connect_inbox i
     where i.kind <> 'whatsapp'
       and (i.muted_until is null or i.muted_until < now())
       and i.archived_at is null
  ), 0)::bigint as yellow_internal_count;

drop view if exists public.v_link_my_notifications;
drop table if exists public.notification_reads;

notify pgrst, 'reload schema';
