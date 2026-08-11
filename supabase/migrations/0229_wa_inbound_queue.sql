-- 0229_wa_inbound_queue.sql — LINK-WA WA-8R9 · M-4 · cola durable de eventos inbound.
-- ENTREGADA, NO APLICADA. Sin ejecución contra Supabase remoto.
-- Numeración: 0221–0226 WMS · 0227 estado atómico · 0228 backfill · 0229 libre
-- verificado sobre los worktrees del repositorio.
-- ─────────────────────────────────────────────────────────────────────────────
-- EL DEFECTO
--
-- `wa_inbound_events.processed` existía desde 0171 con el comentario
-- «reservado para F5», y el webhook ya dejaba eventos en `false` cuando la
-- proyección no se completaba. Pero NADIE los volvía a mirar.
--
-- El resultado era el peor de los dos mundos: el webhook respondía HTTP 200
-- —correcto, porque Meta no debe reintentar indefinidamente— y el evento
-- quedaba en una cola que ningún consumidor leía. Un status de Meta perdido no
-- daba error en ningún lado; simplemente no ocurría.
--
-- Esta migración convierte esa columna en una COLA REAL: claim atómico,
-- reintentos acotados con backoff, error sanitizado y estado terminal
-- explícito. El evento deja de perderse porque el webhook contestó 200.
--
-- ── POR QUÉ EL CLAIM VIVE EN SQL ────────────────────────────────────────────
--
-- Con dos workers, "leer los pendientes y después marcarlos" es una carrera:
-- ambos leen el mismo lote y ambos lo procesan. `for update skip locked` es la
-- primitiva que lo resuelve sin bloquear a nadie: cada worker se lleva filas
-- distintas, y el que llega segundo no espera, sigue con las que quedan.
--
-- 100% ADITIVA. Idempotente. No borra eventos ni payloads.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- (1) COLUMNAS DE COLA
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.wa_inbound_events
  add column if not exists attempts        integer     not null default 0,
  add column if not exists last_error      text,
  add column if not exists claim_token     uuid,
  add column if not exists claimed_at      timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now(),
  -- Terminal: se agotaron los reintentos o el error es permanente. El evento NO
  -- se procesó y NO se volverá a intentar solo; queda visible para replay manual.
  add column if not exists terminal        boolean     not null default false;

comment on column public.wa_inbound_events.attempts is
  'M-4 · intentos de proceso consumidos. Acotado por el consumidor.';
comment on column public.wa_inbound_events.last_error is
  'M-4 · último error SANITIZADO. Nunca payload, teléfono, texto ni token.';
comment on column public.wa_inbound_events.terminal is
  'M-4 · agotado o permanente. Requiere replay manual; jamás se pierde en silencio.';

-- Índice de la cola: sólo lo pendiente y ya vencido.
create index if not exists wa_inbound_events_queue_idx
  on public.wa_inbound_events (next_attempt_at, seq)
  where processed = false and terminal = false;

-- ═════════════════════════════════════════════════════════════════════════════
-- (2) CLAIM ATÓMICO — dos workers, un ganador por fila
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `skip locked` es la clave: el worker B no espera al A, se lleva las filas que
-- A no tomó. Sin él, o bien ambos procesan el mismo evento (sin lock) o bien B
-- queda bloqueado detrás de A (con lock pero sin skip).
--
-- Pero `skip locked` NO alcanza por sí solo, y ésta es la parte que es fácil dar
-- por hecha: el lock dura lo que dura la TRANSACCIÓN. Apenas el claim confirma,
-- la fila queda desbloqueada y —sin más precondiciones— cualquier worker vuelve
-- a reclamarla, aunque el primero todavía la esté procesando. El resultado sería
-- justo lo que esta cola debe impedir: dos proyecciones del mismo evento.
--
-- Por eso el claim otorga un LEASE: mientras `claim_token` esté puesto y el
-- `claimed_at` sea reciente, la fila no vuelve a salir. Si el worker muere sin
-- liberar, el lease vence y la fila regresa sola — ningún evento queda
-- secuestrado para siempre por un proceso caído.

create or replace function public.wa_claim_inbound_events(
  p_token        uuid,
  p_limit        integer default 10,
  p_max_attempts integer default 5,
  -- Vigencia del lease. Un worker que muere sin liberar devuelve la fila al
  -- vencerlo; no hace falta intervención manual.
  p_lease        interval default interval '5 minutes'
) returns table (seq bigint, payload jsonb, attempts integer)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_token is null then
    raise exception 'wa_claim_inbound_events: token de claim obligatorio'
      using errcode = 'check_violation';
  end if;
  if p_limit is null or p_limit <= 0 then
    raise exception 'wa_claim_inbound_events: límite inválido'
      using errcode = 'check_violation';
  end if;

  return query
  with candidatas as (
    select e.seq
      from public.wa_inbound_events e
     where e.processed = false
       and e.terminal  = false
       and e.attempts  < p_max_attempts
       and e.next_attempt_at <= now()
       -- Libre, o con el lease del claim anterior ya vencido.
       and (e.claim_token is null or e.claimed_at <= now() - p_lease)
     order by e.seq
     limit p_limit
     for update skip locked
  )
  update public.wa_inbound_events t
     set claim_token = p_token,
         claimed_at  = now(),
         attempts    = t.attempts + 1
    from candidatas c
   where t.seq = c.seq
  returning t.seq, t.payload, t.attempts;
end;
$$;

comment on function public.wa_claim_inbound_events(uuid, integer, integer, interval) is
  'LINK-WA WA-8R9 · M-4 · reclama eventos pendientes con for update skip locked. Un ganador por fila.';

revoke all on function public.wa_claim_inbound_events(uuid, integer, integer, interval)
  from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- (3) LIBERACIÓN — el desenlace de cada evento reclamado
-- ═════════════════════════════════════════════════════════════════════════════
--
--   done       la proyección se completó ⇒ processed = true
--   retryable  falló de forma recuperable ⇒ vuelve a la cola con backoff
--   permanent  no tiene sentido reintentar ⇒ terminal, visible para replay
--
-- El token del claim es precondición: un worker cuyo claim expiró y fue
-- retomado por otro NO puede escribir el desenlace de un trabajo ajeno.

create or replace function public.wa_release_inbound_event(
  p_seq     bigint,
  p_token   uuid,
  p_outcome text,
  p_error   text default null
) returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
  v_max      constant integer := 5;
  v_backoff  interval;
begin
  if p_outcome not in ('done','retryable','permanent') then
    raise exception 'wa_release_inbound_event: desenlace inválido (%)', p_outcome
      using errcode = 'check_violation';
  end if;

  select e.attempts into v_attempts
    from public.wa_inbound_events e
   where e.seq = p_seq and e.claim_token = p_token
   for update;

  if v_attempts is null then
    -- O no existe, o el claim ya no es de este worker. No se escribe nada.
    return 'not_claimed';
  end if;

  if p_outcome = 'done' then
    update public.wa_inbound_events
       set processed = true, claim_token = null, claimed_at = null, last_error = null
     where seq = p_seq;
    return 'done';
  end if;

  if p_outcome = 'permanent' or v_attempts >= v_max then
    update public.wa_inbound_events
       set terminal = true, claim_token = null, claimed_at = null,
           -- El error se guarda ACOTADO. El saneamiento de contenido es
           -- responsabilidad del consumidor; acá se limita el tamaño para que
           -- ningún payload entre por accidente.
           last_error = left(coalesce(p_error, 'sin detalle'), 200)
     where seq = p_seq;
    return 'terminal';
  end if;

  -- Backoff exponencial acotado: 2^intentos segundos, tope 5 minutos.
  v_backoff := least(power(2, v_attempts) * interval '1 second', interval '5 minutes');
  update public.wa_inbound_events
     set claim_token = null, claimed_at = null,
         next_attempt_at = now() + v_backoff,
         last_error = left(coalesce(p_error, 'sin detalle'), 200)
   where seq = p_seq;
  return 'requeued';
end;
$$;

comment on function public.wa_release_inbound_event(bigint, uuid, text, text) is
  'LINK-WA WA-8R9 · M-4 · desenlace de un evento reclamado: done | requeued (backoff) | terminal.';

revoke all on function public.wa_release_inbound_event(bigint, uuid, text, text)
  from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- (4) REPLAY MANUAL — devolver a la cola lo terminal
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Un evento terminal NO desaparece: queda a la vista y un operador puede
-- devolverlo a la cola. El replay reinicia los intentos y limpia el error, pero
-- NUNCA toca el payload ni marca nada como procesado por su cuenta.

create or replace function public.wa_replay_inbound_event(p_seq bigint)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ok boolean;
begin
  update public.wa_inbound_events
     set terminal = false, attempts = 0, claim_token = null, claimed_at = null,
         next_attempt_at = now(), last_error = null
   where seq = p_seq
     -- Un evento YA procesado no se reabre: sería un reproceso inventado.
     and processed = false
  returning true into v_ok;

  return case when coalesce(v_ok, false) then 'requeued' else 'noop' end;
end;
$$;

revoke all on function public.wa_replay_inbound_event(bigint)
  from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- (5) OBSERVABILIDAD — la cola es visible sin exponer PII
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Cuenta y antigüedad, nunca payloads. Es lo que permite detectar que hay
-- eventos perdidos aunque el webhook haya contestado 200 a todos.

create or replace function public.wa_inbound_queue_health()
returns table (pendientes bigint, terminales bigint, mas_viejo_seg numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where processed = false and terminal = false)::bigint,
    count(*) filter (where terminal = true)::bigint,
    -- `filter` sólo aplica a AGREGADOS: se filtra el `min` y recién después se
    -- calcula la antigüedad sobre su resultado.
    coalesce(
      extract(epoch from (
        now() - min(received_at) filter (where processed = false and terminal = false)
      )),
      0)::numeric
  from public.wa_inbound_events;
$$;

revoke all on function public.wa_inbound_queue_health()
  from public, anon, authenticated;
