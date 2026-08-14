-- 0235_link_notification_personal_read.sql — NEXUS-LINK-NOTIFICATIONS-MEDIA-001 · FASE A.
-- ─────────────────────────────────────────────────────────────────────────
-- ADITIVA y BACKWARD-COMPATIBLE. No borra ni reescribe notificaciones
-- históricas, no relaja RLS, no otorga permisos generales, no hace backfill.
--
-- QUÉ CIERRA
-- Los avisos por ROL (`role_target`) son UNA fila con UN solo `read_at`
-- compartido por todo el rol. Medido en producción (2026-08-14): 17 de las 28
-- no leídas son de ese tipo. Con ese modelo, marcar leído es imposible sin
-- elegir entre dos daños: silenciar el aviso para todos los demás, o dejarlo
-- encendido para siempre. Cualquiera de los dos contradice el criterio de que
-- el indicador rojo se apague cuando su categoría llega a cero.
--
-- NO existe en el esquema ninguna estructura previa de lectura individual
-- reutilizable (se buscó por catálogo: no hay tabla de reads/receipts para
-- notificaciones; `connect_participants.last_read_seq` es el cursor de
-- CONVERSACIONES y no aplica). Se crea la mínima necesaria.
--
-- MODELO
--   · Aviso DIRECTO (`user_id` no nulo, con o sin delegación): el estado de
--     lectura sigue siendo `notifications.read_at`. Sin cambios, sin migración.
--   · BROADCAST por rol (`user_id` nulo + `role_target`): el estado de lectura
--     es personal y vive en `notification_reads`.
-- La precedencia es por `user_id is not null`, y coincide con la forma real de
-- los datos (los 28 pendientes actuales son o bien de usuario o bien de rol,
-- nunca ambos).
--
-- Un broadcast que YA figure leído globalmente (`read_at` no nulo) sigue
-- leído para todos: no se resucita nada. La lectura individual sólo gobierna
-- de acá en adelante.
--
-- SEMÁNTICA ÚNICA
-- `v_link_my_notifications` es la única definición de "mis notificaciones" y
-- de "leída". La consumen el contador rojo, la lista de la campanita y el
-- Centro de Notificaciones, de modo que no puedan divergir.
--
-- DEPENDE de 0147/0162/0234. Rollback: ROLLBACK_0235_link_notification_personal_read.sql
-- ─────────────────────────────────────────────────────────────────────────

-- ═══ (1) Lectura personal de broadcasts ═══
create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  profile_id      uuid not null references auth.users(id)          on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, profile_id)
);
create index if not exists notification_reads_profile_idx
  on public.notification_reads (profile_id);

alter table public.notification_reads enable row level security;

-- Cada quien ve y escribe EXCLUSIVAMENTE su propia marca. Sin rama de
-- auditoría para admin: acá no hay nada que auditar que no esté en la tabla
-- madre, y una rama así reintroduciría el defecto que este expediente cierra.
drop policy if exists notification_reads_own_select on public.notification_reads;
create policy notification_reads_own_select on public.notification_reads
  for select using (profile_id = auth.uid());

-- Sin INSERT/UPDATE/DELETE directos: la única vía de escritura es la RPC.
revoke all on public.notification_reads from public, anon, authenticated;
grant select on public.notification_reads to authenticated;

-- Realtime (patrón 0147/0164/0168). C4 3/3 · MEDIUM-1: marcar leído un
-- broadcast ya NO escribe en `notifications`, escribe acá. Sin publicar esta
-- tabla, la campanita del shell —que vive en un layout persistente y no se
-- re-monta cuando el Centro hace `router.refresh()`— se quedaba con la cifra
-- vieja hasta una recarga dura. Y los broadcasts son el caso dominante: 17 de
-- las 28 pendientes medidas en producción. Es el mismo defecto que se corrigió
-- para `connect_participants`, en la otra mitad del problema.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'notification_reads'
  ) then
    execute 'alter publication supabase_realtime add table public.notification_reads';
  end if;
exception
  when undefined_object then null;
end $$;

-- ═══ (1-bis) Cierre de la vía de escritura directa sobre `notifications` ═══
-- C4 3/3 · MEDIUM-2. 0162 dejó `grant update (read_at, remind_at) ... to
-- authenticated` y una policy de UPDATE con rama `current_role() = 'admin'`.
-- Con eso, por PostgREST directo:
--   · un admin puede marcar leída la notificación DIRECTA de cualquier usuario;
--   · cualquier miembro de un rol puede escribir el `read_at` COMPARTIDO de un
--     broadcast y silenciarlo para todo el rol.
-- Es exactamente el daño que este expediente cierra, y la garantía quedaba
-- sostenida sólo por el código, no por el sistema. El grant ya no tiene
-- consumidores: snooze migró a RPC SECDEF en 0162 y el marcado migra acá, así
-- que revocarlo no rompe ningún camino productivo. Es una restricción de
-- permisos, nunca una relajación.
revoke update on public.notifications from authenticated;

drop policy if exists "notifications mark read own" on public.notifications;
create policy "notifications mark read own"
  on public.notifications for update
  using (user_id = auth.uid() or delegated_to = auth.uid())
  with check (user_id = auth.uid() or delegated_to = auth.uid());

-- ═══ (2) Mis notificaciones, con su estado de lectura efectivo ═══
create or replace view public.v_link_my_notifications
with (security_invoker = true) as
select
  n.id,
  n.kind,
  n.title,
  n.message,
  n.entity,
  n.entity_id,
  n.created_at,
  n.priority,
  n.remind_at,
  n.delegated_to,
  n.user_id,
  n.role_target,
  (n.user_id is null and n.role_target is not null) as is_broadcast,
  case
    when n.user_id is not null then n.read_at is not null
    else n.read_at is not null
      or exists (
        select 1 from public.notification_reads r
         where r.notification_id = n.id and r.profile_id = auth.uid()
      )
  end as is_read,
  -- Snooze: oculta hasta su hora, igual que el Centro desde 0147.
  (n.remind_at is null or n.remind_at <= now()) as is_due
from public.notifications n
where
  -- Aislamiento explícito por destinatario. NO se delega en la RLS: su rama
  -- `current_role() = 'admin'` existe para AUDITAR toda la organización, y
  -- convertiría una superficie personal en una bandeja ajena.
      n.user_id      = auth.uid()
   or n.delegated_to = auth.uid()
   or (n.user_id is null and n.role_target is not null
       and n.role_target = public.current_role());

grant select on public.v_link_my_notifications to authenticated;

-- ═══ (3) Única vía de escritura del estado de lectura ═══
-- SECURITY DEFINER con verificación explícita del llamador: `auth.uid()` es la
-- identidad real del usuario incluso dentro de una función DEFINER (a
-- diferencia de `current_user`, que sería el dueño y haría el control
-- tautológico).
create or replace function public.connect_notif_mark_read(p_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_role public.user_role_t; v_deleg uuid; v_target public.user_role_t;
        v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'sesión no autenticada' using errcode = 'insufficient_privilege';
  end if;

  select user_id, delegated_to, role_target into v_user, v_deleg, v_target
    from public.notifications where id = p_id;
  if not found then
    raise exception 'notificación inexistente' using errcode = 'no_data_found';
  end if;

  v_role := public.current_role();

  if v_user is not null then
    -- Directa: sólo el dueño o el delegado. Un admin NO puede marcar por otro.
    if v_me is distinct from v_user and v_me is distinct from v_deleg then
      raise exception 'solo el dueño o el delegado pueden marcarla leída'
        using errcode = 'insufficient_privilege';
    end if;
    update public.notifications set read_at = coalesce(read_at, now()) where id = p_id;
  elsif v_target is not null and v_target = v_role then
    -- Broadcast: marca PERSONAL. No toca la fila compartida ni a terceros.
    insert into public.notification_reads (notification_id, profile_id)
    values (p_id, v_me)
    on conflict (notification_id, profile_id) do nothing;
  else
    raise exception 'la notificación no está dirigida a este usuario'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function public.connect_notif_mark_read(uuid) from public, anon, authenticated;
grant execute on function public.connect_notif_mark_read(uuid) to authenticated;

-- Marca leídas TODAS mis pendientes, con la misma semántica y sin tocar a nadie.
create or replace function public.connect_notif_mark_all_read()
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid(); v_n integer := 0; r record;
begin
  if v_me is null then
    raise exception 'sesión no autenticada' using errcode = 'insufficient_privilege';
  end if;

  for r in
    select id, is_broadcast from public.v_link_my_notifications
     where not is_read and is_due
  loop
    if r.is_broadcast then
      insert into public.notification_reads (notification_id, profile_id)
      values (r.id, v_me) on conflict do nothing;
    else
      update public.notifications set read_at = coalesce(read_at, now()) where id = r.id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.connect_notif_mark_all_read() from public, anon, authenticated;
grant execute on function public.connect_notif_mark_all_read() to authenticated;

-- ═══ (4) El contador rojo pasa a la semántica única ═══
-- Mismo contrato de columnas que 0234: tres bigint, mismos nombres y orden.
create or replace view public.v_link_notification_badges
with (security_invoker = true) as
select
  (
    select count(*) from public.v_link_my_notifications m
     where not m.is_read and m.is_due
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

notify pgrst, 'reload schema';
