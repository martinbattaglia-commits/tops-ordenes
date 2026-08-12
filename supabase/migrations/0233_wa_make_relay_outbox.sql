-- 0233_wa_make_relay_outbox.sql — WhatsApp Relay Nexus → Make.
-- ENTREGADA, NO APLICADA. Aplicación remota exige Gate DB separado.
--
-- Custodia atómica: el evento inbound y su entrega a Make se escriben en una
-- sola transacción. La outbox tiene identidad SHA-256 estable, lease, backoff y
-- dead-letter; por eso una caída/timeout de Make no depende del retry de Meta.
-- PII: raw_body contiene texto/teléfonos de terceros → RLS deny-all y acceso
-- exclusivo service_role. Migración aditiva; no altera filas preexistentes.
-- Rollback pre-activación ejecutable: ROLLBACK_0233_wa_make_relay_outbox.sql.

create table if not exists public.wa_make_relay_outbox (
  id               bigserial primary key,
  inbound_seq      bigint not null references public.wa_inbound_events(seq) on delete restrict,
  relay_key        text not null unique check (relay_key ~ '^[a-f0-9]{64}$'),
  raw_body         text not null check (octet_length(raw_body) between 1 and 1048576),
  signature_header text check (
    signature_header is null or signature_header ~* '^sha256=[a-f0-9]{64}$'
  ),
  status           text not null default 'pending'
                     check (status in ('pending','processing','failed','delivered','dead')),
  attempts         integer not null default 0 check (attempts >= 0),
  next_attempt_at  timestamptz not null default now(),
  claim_token      uuid,
  claimed_at       timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  delivered_at     timestamptz
);

create index if not exists wa_make_relay_due_idx
  on public.wa_make_relay_outbox (next_attempt_at, id)
  where status in ('pending','failed','processing');

alter table public.wa_make_relay_outbox enable row level security;
revoke all on table public.wa_make_relay_outbox from public, anon, authenticated;
revoke all on sequence public.wa_make_relay_outbox_id_seq from public, anon, authenticated;

-- Evento + outbox en UNA transacción. Si el relay_key ya existe por retry de
-- Meta, la outbox existente manda y no se duplica el egress interno.
create or replace function public.wa_persist_inbound_with_relay(
  p_payload          jsonb,
  p_raw_body         text,
  p_signature_header text,
  p_relay_key        text
) returns table (event_seq bigint, relay_durable boolean)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_seq bigint;
begin
  if p_payload is null or p_raw_body is null or p_relay_key is null then
    raise exception 'wa_persist_inbound_with_relay: argumentos obligatorios'
      using errcode = 'check_violation';
  end if;

  insert into public.wa_inbound_events(payload, signature_valid)
  values (p_payload, true)
  returning seq into v_seq;

  insert into public.wa_make_relay_outbox(
    inbound_seq, relay_key, raw_body, signature_header
  ) values (
    v_seq, p_relay_key, p_raw_body, p_signature_header
  ) on conflict (relay_key) do update
    -- Un retry auténtico de Meta revive un dead-letter con la MISMA identidad;
    -- delivered permanece entregado e idempotente; pending/failed conserva
    -- intentos y scheduling actuales.
    set status = case
          when wa_make_relay_outbox.status = 'dead' then 'pending'
          else wa_make_relay_outbox.status
        end,
        attempts = case
          when wa_make_relay_outbox.status = 'dead' then 0
          else wa_make_relay_outbox.attempts
        end,
        next_attempt_at = case
          when wa_make_relay_outbox.status = 'dead' then now()
          else wa_make_relay_outbox.next_attempt_at
        end,
        claim_token = case
          when wa_make_relay_outbox.status = 'dead' then null
          else wa_make_relay_outbox.claim_token
        end,
        claimed_at = case
          when wa_make_relay_outbox.status = 'dead' then null
          else wa_make_relay_outbox.claimed_at
        end,
        last_error = case
          when wa_make_relay_outbox.status = 'dead' then null
          else wa_make_relay_outbox.last_error
        end;

  return query select v_seq, true;
end;
$$;

-- Claim con lease. `p_relay_key` permite el intento inmediato del webhook; null
-- permite al cron drenar el lote pendiente.
create or replace function public.wa_claim_make_relay(
  p_token     uuid,
  p_limit     integer default 1,
  p_relay_key text default null,
  p_lease     interval default interval '2 minutes'
) returns table (
  id bigint,
  relay_key text,
  raw_body text,
  signature_header text,
  attempts integer
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_token is null or p_limit is null or p_limit <= 0 then
    raise exception 'wa_claim_make_relay: claim inválido'
      using errcode = 'check_violation';
  end if;

  -- Si el octavo intento murió antes de liberar, el lease no puede dejar la
  -- fila en processing para siempre. Se cierra como dead al vencer.
  update public.wa_make_relay_outbox q
     set status = 'dead', claim_token = null, claimed_at = null,
         last_error = coalesce(q.last_error, 'lease_exhausted')
   where q.status = 'processing'
     and q.attempts >= 8
     and q.claimed_at <= now() - p_lease;

  return query
  with candidates as (
    select q.id
      from public.wa_make_relay_outbox q
     where (
       q.status in ('pending','failed')
       or (q.status = 'processing' and q.claimed_at <= now() - p_lease)
     )
       and q.attempts < 8
       and q.next_attempt_at <= now()
       and (p_relay_key is null or q.relay_key = p_relay_key)
     order by q.next_attempt_at, q.id
     -- Invariante serverless: una fila reclamada = un egress que esta corrida
     -- puede iniciar. `p_limit` se conserva por compatibilidad de firma, pero
     -- no habilita lotes que consuman attempts antes de ser entregados.
     limit 1
     for update skip locked
  )
  update public.wa_make_relay_outbox q
     set status = 'processing',
         claim_token = p_token,
         claimed_at = now(),
         attempts = q.attempts + 1
    from candidates c
   where q.id = c.id
  returning q.id, q.relay_key, q.raw_body, q.signature_header, q.attempts;
end;
$$;

create or replace function public.wa_release_make_relay(
  p_id      bigint,
  p_token   uuid,
  p_outcome text,
  p_error   text default null
) returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_attempts integer;
begin
  if p_outcome not in ('delivered','retryable') then
    raise exception 'wa_release_make_relay: outcome inválido'
      using errcode = 'check_violation';
  end if;

  select q.attempts into v_attempts
    from public.wa_make_relay_outbox q
   where q.id = p_id and q.claim_token = p_token and q.status = 'processing'
   for update;
  if v_attempts is null then return 'not_claimed'; end if;

  if p_outcome = 'delivered' then
    update public.wa_make_relay_outbox
       set status = 'delivered', delivered_at = now(), claim_token = null,
           claimed_at = null, last_error = null
     where id = p_id;
    return 'delivered';
  end if;

  if v_attempts >= 8 then
    update public.wa_make_relay_outbox
       set status = 'dead', claim_token = null, claimed_at = null,
           last_error = left(coalesce(p_error, 'unknown'), 80)
     where id = p_id;
    return 'dead';
  end if;

  update public.wa_make_relay_outbox
     set status = 'failed', claim_token = null, claimed_at = null,
         next_attempt_at = now() + least(power(2, v_attempts) * interval '5 seconds', interval '5 minutes'),
         last_error = left(coalesce(p_error, 'unknown'), 80)
   where id = p_id;
  return 'requeued';
end;
$$;

-- Observabilidad sin PII: sólo cantidades y antigüedad.
create or replace function public.wa_make_relay_health()
returns table (pending bigint, dead bigint, oldest_seconds numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where status in ('pending','failed','processing'))::bigint,
    count(*) filter (where status = 'dead')::bigint,
    coalesce(extract(epoch from (
      now() - min(created_at) filter (where status in ('pending','failed','processing'))
    )), 0)::numeric
  from public.wa_make_relay_outbox;
$$;

-- Replay manual/ops de un dead-letter. El relay_key evita operar por payload o
-- PII y mantiene una identidad reproducible en la evidencia.
create or replace function public.wa_replay_make_relay(p_relay_key text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_found boolean;
begin
  update public.wa_make_relay_outbox
     set status = 'pending', attempts = 0, next_attempt_at = now(),
         claim_token = null, claimed_at = null, last_error = null
   where relay_key = p_relay_key and status = 'dead'
  returning true into v_found;
  return case when coalesce(v_found, false) then 'requeued' else 'noop' end;
end;
$$;

revoke all on function public.wa_persist_inbound_with_relay(jsonb,text,text,text)
  from public, anon, authenticated;
revoke all on function public.wa_claim_make_relay(uuid,integer,text,interval)
  from public, anon, authenticated;
revoke all on function public.wa_release_make_relay(bigint,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.wa_make_relay_health()
  from public, anon, authenticated;
revoke all on function public.wa_replay_make_relay(text)
  from public, anon, authenticated;

grant execute on function public.wa_persist_inbound_with_relay(jsonb,text,text,text) to service_role;
grant execute on function public.wa_claim_make_relay(uuid,integer,text,interval) to service_role;
grant execute on function public.wa_release_make_relay(bigint,uuid,text,text) to service_role;
grant execute on function public.wa_make_relay_health() to service_role;
grant execute on function public.wa_replay_make_relay(text) to service_role;

select pg_notify('pgrst', 'reload schema');
