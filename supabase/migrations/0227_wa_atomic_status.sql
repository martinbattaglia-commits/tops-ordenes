-- 0227_wa_atomic_status.sql — LINK-WA WA-8R9 · estado del outbound, atómico y server-side.
-- ENTREGADA, NO APLICADA. Sin ejecución contra Supabase remoto.
-- Numeración: 0221–0226 están reservadas por WMS (custody integrity); 0227 es el
-- siguiente libre verificado sobre los 65 worktrees del repositorio.
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EXISTE
--
-- Hasta acá el estado de `meta.wa` se escribía con un read-modify-write DESDE EL
-- CLIENTE: leer la fila, fusionar el objeto en JS, y escribirlo entero con un CAS
-- por columnas JSON. Eso deja tres defectos que ningún CAS por columnas cierra:
--
--  B-1. El webhook fusiona sobre el snapshot que leyó. Si entre la lectura y la
--       escritura otro escritor agrega `audit_sent`, el objeto reconstruido NO lo
--       tiene y la escritura lo BORRA. La clave desaparecida es un hecho durable
--       de auditoría, no un detalle de presentación.
--  H-1. Con CAS optimista, perder la carrera N veces se vuelve indistinguible de
--       "no había nada que hacer": ambos terminan en `noop`, el evento se marca
--       `processed` y el status de Meta se pierde en silencio.
--  H-2. Una fila recién creada por `connect_post_message` no tiene `meta.wa`, así
--       que no hay procedencia que preservar y los fallos previos al transporte
--       (`sandbox_denied`, `audit_unavailable`) no se podían persistir.
--
-- La corrección es mover la decisión ADENTRO de la transacción: se toma el lock de
-- la fila, se lee bajo el lock, se decide y se escribe. La lectura ya no puede
-- quedar vieja, porque nadie más puede tocar la fila entre leer y escribir.
--
-- 100% ADITIVA. Idempotente. No borra datos. No toca tablas de otros dominios.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- (1) La máquina canónica, en SQL
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Espejo EXACTO de `canTransition` en src/lib/whatsapp/outbound-state.ts. Se
-- duplica a propósito y no se "simplifica": la RPC no puede llamar al TypeScript,
-- y una divergencia entre ambas es justamente el defecto que hay que poder
-- detectar. La prueba de equivalencia recorre las 7×7 combinaciones y compara
-- contra el canon, de modo que si alguna de las dos cambia sin la otra, falla.

create or replace function public._wa_can_transition(
  p_current  text,
  p_incoming text
) returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  with p as (
    select
      -- Orden de progreso. `queued`/`sending` son previos al envío.
      case p_current  when 'queued' then 0 when 'sending' then 1 when 'sent' then 2
                      when 'delivered' then 3 when 'read' then 4 end as cur_rank,
      case p_incoming when 'queued' then 0 when 'sending' then 1 when 'sent' then 2
                      when 'delivered' then 3 when 'read' then 4 end as inc_rank
  )
  select case
    -- Sin estado previo, cualquier estado conocido entra.
    when p_current is null then true
    -- Un estado no vuelve a aplicarse sobre sí mismo.
    when p_current = p_incoming then false

    -- `failed` nunca pisa delivered/read, ni reabre una reconciliación: ahí no
    -- se sabe si el mensaje llegó, y marcarlo fallido mentiría.
    when p_incoming = 'failed' then
      p_current not in ('delivered', 'read', 'reconciliation_required')

    -- Sólo se entra en reconciliación desde un intento EN CURSO.
    when p_incoming = 'reconciliation_required' then
      p_current in ('queued', 'sending')

    -- Un intento cerrado como fallido sólo revive con evidencia real de Meta.
    when p_current = 'failed' then
      p_incoming in ('sent', 'delivered', 'read')

    -- La reconciliación se resuelve con un status real del proveedor.
    when p_current = 'reconciliation_required' then
      p_incoming in ('sent', 'delivered', 'read')

    -- Entre estados de progreso, sólo se avanza.
    else (select cur_rank is not null and inc_rank is not null and inc_rank > cur_rank from p)
  end;
$$;

comment on function public._wa_can_transition(text, text) is
  'LINK-WA · espejo SQL de canTransition (outbound-state.ts). Autoridad única de transición del outbound de WhatsApp.';

-- ═════════════════════════════════════════════════════════════════════════════
-- (2) Estados canónicos reconocidos
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public._wa_is_known_state(p_state text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_state in
    ('queued','sending','sent','delivered','read','failed','reconciliation_required');
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- (3) Instante canónico del servidor
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Mismo formato que `isCanonicalIsoUtc` exige en TypeScript: UTC, con
-- milisegundos y sufijo `Z`. El reloj es SIEMPRE el del servidor de base: el
-- llamador no puede declarar cuándo ocurrió un hecho del servidor.

create or replace function public._wa_server_now_iso()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- (3b) INSTANTE CANÓNICO — validación server-side  (CLOSEOUT · G)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- El instante de Meta llega en el evento y se conservaba TAL CUAL. Un valor no
-- canónico —otro formato, otra zona, texto arbitrario— entraba a `status_at` sin
-- que nada lo detuviera, y recién la UI lo descartaba al proyectar: el hecho
-- quedaba escrito con un instante que nadie podía leer.
--
-- La validación baja al servidor y es FAIL-CLOSED: un instante inválido rechaza
-- la escritura en vez de persistir basura. Mismo contrato que
-- `isCanonicalIsoUtc` en TypeScript: UTC, milisegundos, sufijo `Z`.

create or replace function public._wa_is_canonical_iso(p_at text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_ts timestamptz;
begin
  -- Forma exacta primero: UTC, milisegundos, sufijo `Z`.
  if p_at is null or p_at !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then
    return false;
  end if;
  -- Y además una fecha REAL: `2026-13-01T…` y `2026-02-30T…` respetan el patrón
  -- pero no existen. El cast es la única autoridad sobre eso, y su fallo se
  -- captura acá en vez de propagarse: la función devuelve un booleano, no lanza.
  begin
    v_ts := p_at::timestamptz;
  exception when others then
    return false;
  end;
  return v_ts is not null;
end;
$$;

comment on function public._wa_is_canonical_iso(text) is
  'LINK-WA · espejo SQL de isCanonicalIsoUtc. UTC, milisegundos, sufijo Z.';

-- ═════════════════════════════════════════════════════════════════════════════
-- (4) RPC ATÓMICA DE ESTADO
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Un único punto de escritura de `meta.wa.status*` para webhook y servidor.
--
-- RESULTADO DISCRIMINADO — nunca un booleano, nunca `noop` como cajón de sastre:
--
--   applied                  el hecho quedó escrito en esta llamada
--   duplicate                el hecho YA estaba escrito, idéntico (replay idempotente)
--   retryable                la fila cambió bajo el llamador; el hecho NO se aplicó
--   reconciliation_required  no se pudo aplicar y quedó marca durable de reconciliación
--   rejected                 la fila no admite este hecho (dirección, canon, procedencia)
--   unmatched                no hay fila para ese wamid (status llegó antes del sello)
--
-- Sólo `applied` y `duplicate` acreditan el hecho y habilitan marcar el evento
-- como procesado. `retryable`, `reconciliation_required` y `unmatched` dejan el
-- evento en la COLA DURABLE. `rejected` es terminal por decisión del dominio.
-- Cardinalidad anómala, error o agotamiento JAMÁS se degradan a "nada que hacer".
--
-- Un error (parámetro inválido, estado desconocido) LANZA. No se degrada a
-- ningún resultado: un fallo silencioso acá es exactamente lo que produjo H-1.

create or replace function public.connect_wa_apply_status(
  p_message_id       uuid    default null,
  p_wamid            text    default null,
  p_status           text    default null,
  p_source           text    default null,
  p_at               text    default null,
  p_error_code       text    default null,
  p_error            text    default null,
  -- CAS opcional sobre el snapshot que observó el llamador.
  p_expect_status    text    default null,
  p_expect_source    text    default null,
  p_expect_at        text    default null,
  p_expect_wamid     text    default null,
  p_use_expectations boolean default false
) returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id        uuid;
  v_meta      jsonb;
  v_wa        jsonb;
  v_wamid     text;
  v_cur       text;
  v_cur_src   text;
  v_cur_at    text;
  v_at        text;
  v_patch     jsonb;
begin
  -- ── Validación de entrada. Lanza: no hay resultado "seguro" ante basura. ──
  if p_source is null or p_source not in ('meta','server') then
    raise exception 'connect_wa_apply_status: procedencia inválida (%)', p_source
      using errcode = 'check_violation';
  end if;
  if p_status is null or not public._wa_is_known_state(p_status) then
    raise exception 'connect_wa_apply_status: estado desconocido (%)', p_status
      using errcode = 'check_violation';
  end if;
  if (p_message_id is null) = (p_wamid is null) then
    raise exception 'connect_wa_apply_status: se resuelve por id O por wamid, no ambos'
      using errcode = 'check_violation';
  end if;
  -- CLOSEOUT · G · un instante de Meta no canónico NO se persiste: se rechaza.
  -- Sólo se valida cuando viene; ausente significa "usá el reloj del servidor".
  if p_at is not null and not public._wa_is_canonical_iso(p_at) then
    raise exception 'connect_wa_apply_status: instante no canónico (%)', p_at
      using errcode = 'check_violation';
  end if;

  -- ── EL LOCK. Acá muere el read-modify-write. ─────────────────────────────
  -- La fila queda tomada hasta el fin de la transacción, así que la lectura de
  -- abajo NO puede quedar vieja: ningún otro escritor puede intercalarse entre
  -- este SELECT y el UPDATE. Por eso `audit_sent` agregado por un concurrente
  -- está presente en `v_wa` y sobrevive (B-1).
  if p_message_id is not null then
    select m.id, coalesce(m.meta,'{}'::jsonb), m.external_msg_id
      into v_id, v_meta, v_wamid
      from public.connect_messages m
     where m.id = p_message_id
     for update;
  else
    select m.id, coalesce(m.meta,'{}'::jsonb), m.external_msg_id
      into v_id, v_meta, v_wamid
      from public.connect_messages m
     where m.external_msg_id = p_wamid
     for update;
  end if;

  if v_id is null then
    return 'unmatched';
  end if;

  v_wa      := coalesce(v_meta->'wa', '{}'::jsonb);
  v_cur     := v_wa->>'status';
  v_cur_src := v_wa->>'status_source';
  v_cur_at  := v_wa->>'status_at';

  -- ── Sólo una fila SALIENTE admite estado de egress ───────────────────────
  -- Meta reutiliza el mismo espacio de identificadores para lo que entra y lo
  -- que sale: un status puede caer sobre un mensaje RECIBIDO. Escribir ahí
  -- corrompe la fila de forma durable.
  if v_wa->>'direction' is distinct from 'outbound' then
    return 'rejected';
  end if;

  -- ── CAS sobre el snapshot observado por el llamador ───────────────────────
  if p_use_expectations then
    if v_cur     is distinct from p_expect_status
    or v_cur_src is distinct from p_expect_source
    or v_cur_at  is distinct from p_expect_at
    or v_wamid   is distinct from p_expect_wamid then
      return 'retryable';
    end if;
  end if;

  -- ── Replay idempotente: el hecho ya está, con la MISMA procedencia ────────
  if v_cur = p_status and v_cur_src = p_source then
    return 'duplicate';
  end if;

  -- ── Precedencia de procedencia ───────────────────────────────────────────
  -- Un hecho del SERVIDOR jamás reemplaza un hecho OBSERVADO POR META. Los
  -- relojes son de dominios distintos y la observación del proveedor es la
  -- autoridad sobre lo que pasó con el mensaje.
  if v_cur_src = 'meta' and p_source = 'server' then
    if p_status = 'reconciliation_required' then
      return public._wa_mark_reconciliation(v_id, v_meta, v_wa, p_error);
    end if;
    return 'rejected';
  end if;

  -- ── El canon es la única autoridad de transición ──────────────────────────
  if not public._wa_can_transition(v_cur, p_status) then
    -- Si lo que se quería registrar era una reconciliación y el canon no admite
    -- la transición (por ejemplo desde `sent`), NO se fuerza el estado: se deja
    -- marca durable aparte. El estado confirmado y `audit_sent` quedan intactos.
    if p_source = 'server' and p_status = 'reconciliation_required' then
      return public._wa_mark_reconciliation(v_id, v_meta, v_wa, p_error);
    end if;
    return 'rejected';
  end if;

  -- ── Escritura ────────────────────────────────────────────────────────────
  -- El instante de un hecho del SERVIDOR lo pone el servidor. El de Meta viene
  -- en el evento y se conserva tal cual, porque describe otro reloj.
  v_at := case when p_source = 'server' then public._wa_server_now_iso()
               else coalesce(p_at, public._wa_server_now_iso()) end;

  v_patch := jsonb_build_object(
    'direction',     'outbound',
    'status',        p_status,
    'status_at',     v_at,
    'status_source', p_source
  );
  if p_error_code is not null then
    v_patch := v_patch || jsonb_build_object('error_code', p_error_code);
  end if;
  if p_error is not null then
    v_patch := v_patch || jsonb_build_object('error', p_error);
  end if;

  -- `v_wa || v_patch` conserva TODA clave concurrente —`audit_sent` incluido—
  -- porque `v_wa` se leyó bajo el lock. Es la diferencia exacta con el
  -- read-modify-write del cliente.
  --
  -- CLOSEOUT · §4.C · la marca `provenance_backfill` CADUCA acá. Registra que la
  -- procedencia fue DERIVADA por el backfill (0228); en cuanto un writer real
  -- escribe procedencia, esa derivación deja de describir la fila. Si la marca
  -- sobreviviera, una reversión posterior del backfill borraría un hecho que el
  -- backfill nunca escribió.
  update public.connect_messages
     set meta = jsonb_set(v_meta, '{wa}', (v_wa - 'provenance_backfill') || v_patch, true)
   where id = v_id;

  return 'applied';
end;
$$;

comment on function public.connect_wa_apply_status is
  'LINK-WA WA-8R9 · única escritura de meta.wa.status*. Lock + decisión + escritura en una transacción. Resultado discriminado; nunca noop.';

revoke all on function public.connect_wa_apply_status(
  uuid, text, text, text, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- (5) MARCA DURABLE DE RECONCILIACIÓN  (M-1 · SCR-LINK-WA-002)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- SCR-LINK-WA-002 prometía `sent → reconciliation_required`, transición que la
-- máquina canónica PROHÍBE (sólo se entra en reconciliación desde `queued` o
-- `sending`). La promesa era inejecutable.
--
-- La reconciliación deja de representarse como estado y pasa a ser un HECHO
-- ADJUNTO: `meta.wa.reconciliation`. Así el estado confirmado por Meta y el
-- marcador `audit_sent` sobreviven intactos, y no se agrega ninguna transición
-- al canon.

create or replace function public._wa_mark_reconciliation(
  p_id     uuid,
  p_meta   jsonb,
  p_wa     jsonb,
  p_reason text
) returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_mark jsonb;
begin
  -- Idempotente: una reconciliación ya anotada no se re-sella con hora nueva.
  if p_wa ? 'reconciliation' then
    return 'reconciliation_required';
  end if;

  v_mark := jsonb_build_object(
    'at',     public._wa_server_now_iso(),
    'reason', coalesce(p_reason, 'audit_reconciliation')
  );

  -- Sólo se agrega la clave. `status`, `status_source`, `status_at` y
  -- `audit_sent` quedan EXACTAMENTE como estaban.
  update public.connect_messages
     set meta = jsonb_set(p_meta, '{wa,reconciliation}', v_mark, true)
   where id = p_id;

  return 'reconciliation_required';
end;
$$;

revoke all on function public._wa_mark_reconciliation(uuid, jsonb, jsonb, text)
  from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- (5b) MARCADOR DE AUDITORÍA, ATÓMICO  (B-1 · la otra mitad de la carrera)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `markAudited` sufría el defecto ESPEJO del webhook: reconstruía `meta.wa`
-- entero desde un snapshot leído antes. Si en el medio llegaba un status de
-- Meta, la escritura del marcador lo REGRESABA. Entre los dos escritores podían
-- borrarse mutuamente, que es exactamente lo que B-1 describe.
--
-- Acá se escribe SÓLO la clave `audit_sent`, bajo el lock de la fila. Todo lo
-- demás —status, procedencia, instante, reconciliación— queda intacto por
-- construcción, no por cuidado del llamador.

create or replace function public.connect_wa_mark_audited(
  p_message_id uuid,
  p_wamid      text,
  p_at         text
) returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_meta  jsonb;
  v_wa    jsonb;
  v_wamid text;
  v_cur   text;
begin
  if p_message_id is null or p_wamid is null then
    raise exception 'connect_wa_mark_audited: id y wamid son obligatorios'
      using errcode = 'check_violation';
  end if;

  select m.id, coalesce(m.meta,'{}'::jsonb), m.external_msg_id
    into v_id, v_meta, v_wamid
    from public.connect_messages m
   where m.id = p_message_id
   for update;

  if v_id is null then
    return 'unmatched';
  end if;

  v_wa  := coalesce(v_meta->'wa', '{}'::jsonb);
  v_cur := v_wa->>'status';

  -- El marcador se ata al WAMID, no al mensaje: un marcador viejo no puede
  -- acreditar un sello nuevo.
  if v_wamid is distinct from p_wamid then
    return 'rejected';
  end if;
  if v_wa->>'direction' is distinct from 'outbound' then
    return 'rejected';
  end if;
  -- Sólo un estado auditable admite acreditación (espejo de AUDITABLE_STATUSES).
  if v_cur is null or v_cur not in ('sent','delivered','read') then
    return 'rejected';
  end if;

  -- Idempotente: ya acreditado con el MISMO wamid.
  if (v_wa->'audit_sent'->>'wamid') = p_wamid then
    return 'duplicate';
  end if;

  update public.connect_messages
     set meta = jsonb_set(v_meta, '{wa,audit_sent}',
                          jsonb_build_object('wamid', p_wamid, 'at',
                                             coalesce(p_at, public._wa_server_now_iso())),
                          true)
   where id = v_id;

  return 'applied';
end;
$$;

comment on function public.connect_wa_mark_audited(uuid, text, text) is
  'LINK-WA WA-8R9 · acredita audit_sent bajo lock, sin reconstruir meta.wa. Espejo de B-1.';

revoke all on function public.connect_wa_mark_audited(uuid, text, text)
  from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- (6) NACIMIENTO CANÓNICO DEL INTENTO  (H-2)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `connect_post_message` insertaba sin `meta`, así que una fila saliente nacía
-- SIN dirección ni procedencia. Consecuencia: los fallos anteriores al
-- transporte no se podían persistir —no había hecho previo del servidor que
-- respetar— y se perdían al recargar.
--
-- Ahora, cuando la conversación es de WhatsApp, la fila nace con metadata
-- canónica puesta POR EL SERVIDOR. El llamador no puede declarar dirección,
-- procedencia ni instante: se derivan de `connect_conversations.kind` y del
-- reloj de la base. La firma y el resto del comportamiento no cambian, así que
-- ningún otro `kind` de Connect se ve afectado.

drop function if exists public.connect_post_message(uuid, text, uuid, text, uuid[], uuid[]);

create function public.connect_post_message(
  p_conversation_id uuid,
  p_body            text,
  p_reply_to        uuid,
  p_client_msg_id   text,
  p_attachment_ids  uuid[],
  p_mentions        uuid[] default null
) returns table (id uuid, seq bigint)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_msg_id uuid;
  v_seq    bigint;
  v_part   uuid;
  v_att    uuid;
  v_kind   text;
  v_meta   jsonb;
begin
  if not public.has_permission('connect.create') then
    raise exception 'Sin permiso connect.create' using errcode = 'insufficient_privilege';
  end if;
  if not public._connect_is_member(p_conversation_id) then
    raise exception 'No es miembro de la conversación' using errcode = 'insufficient_privilege';
  end if;
  perform public._connect_assert_not_archived(p_conversation_id);
  if p_mentions is not null and array_length(p_mentions, 1) > 20 then
    raise exception 'demasiadas menciones (máximo 20)' using errcode = 'check_violation';
  end if;

  -- Idempotencia por (conversación, autor, client_msg_id): mismo intento ⇒ misma
  -- fila. El autor es `auth.uid()`, nunca un parámetro.
  if p_client_msg_id is not null then
    select m.id, m.seq into v_msg_id, v_seq
      from public.connect_messages m
     where m.conversation_id = p_conversation_id
       and m.author_profile_id = auth.uid()
       and m.client_msg_id = p_client_msg_id;
    if v_msg_id is not null then
      id := v_msg_id; seq := v_seq; return next;
      return;
    end if;
  end if;

  v_part := public._connect_my_participant(p_conversation_id);

  -- WA-8R9 · metadata canónica del intento saliente, derivada del SERVIDOR.
  select c.kind into v_kind
    from public.connect_conversations c
   where c.id = p_conversation_id;

  if v_kind = 'whatsapp' then
    v_meta := jsonb_build_object('wa', jsonb_build_object(
      'direction',     'outbound',
      'status',        'queued',
      'status_source', 'server',
      'status_at',     public._wa_server_now_iso()
    ));
  else
    v_meta := '{}'::jsonb;
  end if;

  insert into public.connect_messages
    (conversation_id, author_participant_id, author_profile_id, kind, body,
     reply_to_message_id, client_msg_id, meta)
  values
    (p_conversation_id, v_part, auth.uid(), 'text', nullif(p_body,''),
     p_reply_to, p_client_msg_id, v_meta)
  returning connect_messages.id, connect_messages.seq into v_msg_id, v_seq;

  if p_attachment_ids is not null then
    foreach v_att in array p_attachment_ids loop
      update public.connect_attachments
         set message_id = v_msg_id
       where connect_attachments.id = v_att
         and conversation_id = p_conversation_id and message_id is null;
    end loop;
  end if;

  if p_mentions is not null and array_length(p_mentions, 1) > 0 then
    insert into public.connect_message_mentions (message_id, mentioned_participant_id)
    select v_msg_id, cp.id
      from public.connect_participants cp
     where cp.conversation_id = p_conversation_id
       and cp.profile_id = any(p_mentions)
       and cp.profile_id is distinct from auth.uid()
    on conflict (message_id, mentioned_participant_id) do nothing;
  end if;

  id := v_msg_id; seq := v_seq; return next;
end;
$$;

revoke all on function public.connect_post_message(uuid, text, uuid, text, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.connect_post_message(uuid, text, uuid, text, uuid[], uuid[])
  to authenticated;
