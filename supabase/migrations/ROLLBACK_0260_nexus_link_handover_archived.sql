-- ROLLBACK_0260_nexus_link_handover_archived.sql

drop trigger if exists trg_connect_messages_handover on public.connect_messages;
drop function if exists public._connect_trg_handover_human_message();
drop function if exists public.connect_set_handover_state(uuid, text);

alter table public.connect_conversations
  drop column if exists handover_state,
  drop column if exists handover_at;

drop index if exists connect_conversations_handover_idx;

notify pgrst, 'reload schema';
