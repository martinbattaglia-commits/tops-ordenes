-- ROLLBACK_0233_wa_make_relay_outbox.sql
-- Reversión de esquema para 0233, exclusivamente antes de activar el relay.
--
-- PRECONDICIÓN: WHATSAPP_MAKE_RELAY_ENABLED=0 y outbox vacía. Si existe una
-- sola fila, el bloque aborta para preservar los mensajes bajo custodia. Una
-- reversión operativa posterior a la activación apaga el kill-switch y vuelve
-- al deploy previo; no elimina esta tabla ni sus datos.

begin;

do $$
begin
  if to_regclass('public.wa_make_relay_outbox') is not null then
    -- El lock se mantiene hasta COMMIT. Impide que un egress/inbound en vuelo
    -- inserte entre la comprobación de vacío y el DROP.
    lock table public.wa_make_relay_outbox in access exclusive mode;
    if exists (select 1 from public.wa_make_relay_outbox limit 1) then
      raise exception 'ROLLBACK_0233_ABORTED: wa_make_relay_outbox no está vacía'
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;
end;
$$;

drop function if exists public.wa_replay_make_relay(text);
drop function if exists public.wa_make_relay_health();
drop function if exists public.wa_release_make_relay(bigint,uuid,text,text);
drop function if exists public.wa_claim_make_relay(uuid,integer,text,interval);
drop function if exists public.wa_persist_inbound_with_relay(jsonb,text,text,text);
drop table if exists public.wa_make_relay_outbox;

select pg_notify('pgrst', 'reload schema');

commit;
