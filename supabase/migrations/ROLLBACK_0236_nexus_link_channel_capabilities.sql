-- ROLLBACK_0236_nexus_link_channel_capabilities.sql
--
-- Revierte 0236 dejando el esquema como lo dejó 0234/0235.
--
-- ⚠️ Al revertir DESAPARECE la frontera de canal: `v_connect_inbox` vuelve a
-- mostrar las conversaciones de WhatsApp a todo participante, sin exigir
-- capacidad. Es exactamente el estado previo —no una degradación nueva—, pero
-- conviene tenerlo presente: la prohibición para los encargados de depósito
-- vuelve a depender de que no sean participantes.
--
-- No toca `connect.view/create/edit` ni ningún permiso preexistente.

-- (4) La vista vuelve a la definición de 0234, sin filtro de canal.
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
  (
    select count(*)
      from public.connect_messages m
     where m.conversation_id = c.id
       and m.seq > coalesce(p.last_read_seq, 0)
       and m.deleted_at is null
       and m.kind <> 'system'
       and case
             when c.kind = 'whatsapp' then m.author_profile_id is null
             else coalesce(m.author_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  is distinct from p.profile_id
           end
  )::bigint          as unread_count,
  p.is_favorite,
  p.muted_until,
  c.archived_at
from public.connect_conversations c
join public.connect_participants  p
  on p.conversation_id = c.id and p.profile_id = auth.uid();

-- (3) Resolvedores.
drop function if exists public.nexus_link_is_admin();
drop function if exists public.nexus_link_can(text);

-- (2) Concesiones de las seis capacidades. Se borran SÓLO las filas de
-- role_permissions que apuntan a estas capacidades: ningún permiso legacy se
-- toca, y `delete` sobre role_permissions no afecta roles ni usuarios.
delete from public.role_permissions rp
 using public.permissions p
 where p.id = rp.permission_id
   and p.slug like 'nexus_link.%';

-- (1) Las capacidades.
delete from public.permissions where slug like 'nexus_link.%';

notify pgrst, 'reload schema';
