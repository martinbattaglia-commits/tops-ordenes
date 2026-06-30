-- 0147_connect_notifications_ext.sql — Nexus Link RC1.0.
-- ENTREGADA, NO APLICADA (G3).
-- ─────────────────────────────────────────────────────────────────────────
-- Extiende public.notifications para Connect SIN tabla nueva y SIN romper el
-- trigger de orders. La columna kind es text → los kinds connect_* NO requieren
-- ALTER TYPE (se documentan). Publica las tablas connect en supabase_realtime
-- con el bloque idempotente de 0016 (NO el de 0004). Incorpora las columnas del
-- Centro de notificaciones (Addendum A4) de forma ADITIVA (se cablean en RC1.4).
-- DEPENDE de 0004 (notifications), 0143 (tablas connect).
-- ─────────────────────────────────────────────────────────────────────────

-- (1) Kinds connect_* — documentación; kind es text, no enum (0004_extended_schema:54).
--     'connect_message' | 'connect_mention' | 'connect_channel_invite' | 'connect_incident'.
--     El fan-out (worker service_role que drena connect_outbox) inserta filas con
--     entity='connect' y entity_id=<conversation_id>. NO se toca el trigger de orders.

-- (2) Centro de notificaciones (Addendum A4) — columnas ADITIVAS, no rompen orders.
alter table public.notifications add column if not exists priority text
  check (priority in ('low','normal','high','urgent')) default 'normal';
alter table public.notifications add column if not exists remind_at timestamptz;        -- snooze / recordar
alter table public.notifications add column if not exists delegated_to uuid
  references auth.users(id) on delete set null;                                          -- delegar

-- (3) Realtime: publicar tablas connect en supabase_realtime (patrón idempotente 0016).
do $$
declare t text;
begin
  foreach t in array array[
    'connect_conversations','connect_participants','connect_messages',
    'connect_message_reactions','connect_message_mentions','connect_attachments',
    'connect_conversation_links','connect_pinned'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception
  when undefined_object then null;  -- publicación inexistente (entorno no-Supabase)
end $$;

notify pgrst, 'reload schema';
