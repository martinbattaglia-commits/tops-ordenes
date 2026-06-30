-- 0145_connect_views.sql — Nexus Link RC1.0.
-- ENTREGADA, NO APLICADA (G3).
-- ─────────────────────────────────────────────────────────────────────────
-- Vistas de lectura (security_invoker=true): bandeja unificada, lista de
-- canales, contadores de no-leídos. NO escalan privilegios: respetan la RLS
-- del usuario que consulta. Reconciliación RC1 del spec §B 5.4 (+36) +
-- context_id en la bandeja (D-RC1-6). DEPENDE de 0143.
-- ─────────────────────────────────────────────────────────────────────────

-- Bandeja: mis conversaciones con su último mensaje y no-leídos.
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

-- Lista de canales visibles (públicos o donde soy miembro).
create or replace view public.v_connect_channels
with (security_invoker = true) as
select c.id, c.context_id, c.slug, c.title, c.topic, c.visibility, c.last_message_at,
       public._connect_is_member(c.id) as is_member
from public.connect_conversations c
where c.kind = 'channel';

-- Contador global de no-leídos (para el badge del sidebar/topbar).
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
