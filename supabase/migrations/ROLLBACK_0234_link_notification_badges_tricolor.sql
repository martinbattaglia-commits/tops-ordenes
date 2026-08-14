-- ROLLBACK_0234_link_notification_badges_tricolor.sql
-- Revierte 0234 restaurando textualmente las definiciones de 0145_connect_views.sql
-- y eliminando la vista nueva. No toca datos, tablas, RLS ni permisos.

drop view if exists public.v_link_notification_badges;

create or replace view public.v_connect_inbox
with (security_invoker = true) as
select
  c.id                as conversation_id,
  c.context_id,
  c.kind,
  c.title,
  c.slug,
  c.topic,
  c.last_message_at,
  c.last_message_seq,
  p.last_read_seq,
  greatest(coalesce(c.last_message_seq,0) - coalesce(p.last_read_seq,0), 0) as unread_count,
  p.is_favorite,
  p.muted_until,
  c.archived_at
from public.connect_conversations c
join public.connect_participants  p
  on p.conversation_id = c.id and p.profile_id = auth.uid();

create or replace view public.v_connect_unread_total
with (security_invoker = true) as
select coalesce(sum(
         greatest(coalesce(c.last_message_seq,0) - coalesce(p.last_read_seq,0), 0)
       ),0) as unread_total
from public.connect_conversations c
join public.connect_participants  p
  on p.conversation_id = c.id and p.profile_id = auth.uid()
where (p.muted_until is null or p.muted_until < now());

notify pgrst, 'reload schema';
