-- 0161_connect_mentions_fanout.sql — Nexus Link F4.1B (Fundación colaborativa).
-- ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor de prod (arsksytgdnzukbmfgkju)
-- **EJECUTANDO EL ARCHIVO COMPLETO COMO UN SOLO BATCH** (transaccional: el DROP+CREATE de
-- connect_post_message debe ser atómico — D-F41-4).
-- ─────────────────────────────────────────────────────────────────────────
-- Menciones end-to-end + fan-out síncrono acotado (modelo HÍBRIDO spec §A4/NOTIF-1, D-F41-1):
--
-- (1) connect_post_message: cambia la FIRMA (+p_mentions uuid[] default null).
--     ⚠️ D-F41-4 (hallazgo crítico del plan): CREATE OR REPLACE con firma distinta crearía una
--     SEGUNDA función sobrecargada → PostgREST error 300 (ambigüedad) → rompe la RPC más usada.
--     Por eso: DROP de la firma 5-args + CREATE 6-args + re-aplicar revoke/grant, en el MISMO batch.
--     El adapter actual llama con parámetros NOMBRADOS → resuelve a la única función nueva sin
--     deploy simultáneo (p_mentions default null). Cuerpo base = 0144 (vigente) + menciones +
--     guarda de archivado (consolidación de D-F41-5: la función se reescribe acá una sola vez;
--     0163 cubre las 14 restantes).
--     Menciones: p_mentions = PROFILE ids; se resuelven a participant ids DE ESTA conversación
--     (la FK de connect_message_mentions → connect_participants fuerza membresía por construcción,
--     D-F41-8); no-miembros se IGNORAN en silencio; autor excluido; tope 20 (check_violation).
--
-- (2) Trigger AFTER INSERT en connect_message_mentions → notificación kind='connect_mention'
--     (priority high, entity='connect', entity_id=conversation_id — convención 0147:15;
--     SIN contenido del mensaje: anti-PII).
--
-- (3) _connect_enqueue_message (misma aridad → CREATE OR REPLACE seguro): agrega rama DM 1:1
--     con COALESCING (D-F41-2): máx. 1 notificación kind='connect_message' NO leída por
--     conversación/usuario. Canales NO notifican por mensaje (D-F41-3): solo menciones.
--
-- Helper _connect_assert_not_archived: server-side guard de archivado (R-3). Se define ACÁ
-- (lo usa connect_post_message) y lo reutilizan las 14 RPCs de 0163.
-- IDEMPOTENTE (re-ejecución = mismo estado final). DEPENDE de 0143/0144/0147.
-- ─────────────────────────────────────────────────────────────────────────

-- ===== Helper R-3: guarda de archivado (fail-closed; conversación inexistente NO raise acá —
-- los guards de existencia/membresía de cada RPC ya cubren ese caso). =====
create or replace function public._connect_assert_not_archived(p_conversation_id uuid)
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_archived_at timestamptz;
begin
  select archived_at into v_archived_at
    from public.connect_conversations where id = p_conversation_id;
  if v_archived_at is not null then
    raise exception 'la conversación está archivada (solo lectura)' using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function public._connect_assert_not_archived(uuid) from public, anon, authenticated;
grant execute on function public._connect_assert_not_archived(uuid) to service_role;

-- ===== (1) connect_post_message: DROP firma 5-args + CREATE 6-args (D-F41-4) =====
-- Idempotencia del re-run: se dropean AMBAS firmas si existen y se crea la nueva.
drop function if exists public.connect_post_message(uuid, text, uuid, text, uuid[]);
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
begin
  if not public.has_permission('connect.create') then
    raise exception 'Sin permiso connect.create' using errcode = 'insufficient_privilege';
  end if;
  if not public._connect_is_member(p_conversation_id) then
    raise exception 'No es miembro de la conversación' using errcode = 'insufficient_privilege';
  end if;
  -- R-3 (D-F41-5): la UI read-only ya lo bloquea; esto cierra el bypass por RPC directa.
  perform public._connect_assert_not_archived(p_conversation_id);
  -- D-F41-8: tope de menciones por mensaje (anti-abuso).
  if p_mentions is not null and array_length(p_mentions, 1) > 20 then
    raise exception 'demasiadas menciones (máximo 20)' using errcode = 'check_violation';
  end if;

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

  insert into public.connect_messages
    (conversation_id, author_participant_id, author_profile_id, kind, body,
     reply_to_message_id, client_msg_id)
  values
    (p_conversation_id, v_part, auth.uid(), 'text', nullif(p_body,''),
     p_reply_to, p_client_msg_id)
  returning connect_messages.id, connect_messages.seq into v_msg_id, v_seq;

  if p_attachment_ids is not null then
    foreach v_att in array p_attachment_ids loop
      update public.connect_attachments
         set message_id = v_msg_id
       where connect_attachments.id = v_att
         and conversation_id = p_conversation_id and message_id is null;
    end loop;
  end if;

  -- Menciones (D-F41-8): profile ids → participant ids DE ESTA conversación.
  -- No-miembros y el autor se ignoran; dedupe por unique(message_id, mentioned_participant_id).
  -- El AFTER INSERT trigger (abajo) genera la notificación connect_mention.
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
revoke all on function public.connect_post_message(uuid, text, uuid, text, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.connect_post_message(uuid, text, uuid, text, uuid[], uuid[]) to authenticated;

-- ===== (2) Notificación de mención: AFTER INSERT en connect_message_mentions =====
create or replace function public._connect_notify_mention()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_conv    uuid;
  v_author  uuid;
  v_author_name text;
  v_conv_label  text;
begin
  -- Participante mencionado → profile (solo staff con profile; otros tipos no notifican en F4.1).
  select cp.profile_id, cp.conversation_id into v_profile, v_conv
    from public.connect_participants cp where cp.id = new.mentioned_participant_id;
  if v_profile is null then
    return new;
  end if;

  select m.author_profile_id into v_author
    from public.connect_messages m where m.id = new.message_id;
  if v_author is not null and v_author = v_profile then
    return new;  -- auto-mención: no notificar (defensivo; el RPC ya excluye al autor)
  end if;

  select nullif(btrim(coalesce(p.full_name,'') || ' ' || coalesce(p.apellido,'')), '')
    into v_author_name
    from public.profiles p where p.id = v_author;

  select coalesce(c.title, '#' || c.slug, 'una conversación')
    into v_conv_label
    from public.connect_conversations c where c.id = v_conv;

  -- Sin contenido del mensaje (anti-PII). entity='connect' (convención 0147:15 + spec:776).
  insert into public.notifications (user_id, kind, title, message, entity, entity_id, priority)
  values (
    v_profile,
    'connect_mention',
    'Te mencionaron en ' || coalesce(v_conv_label, 'una conversación'),
    coalesce(v_author_name, 'Un compañero') || ' te mencionó.',
    'connect',
    v_conv,
    'high'
  );
  return new;
end;
$$;
revoke all on function public._connect_notify_mention() from public, anon, authenticated;

drop trigger if exists trg_connect_mentions_notify on public.connect_message_mentions;
create trigger trg_connect_mentions_notify
  after insert on public.connect_message_mentions
  for each row execute function public._connect_notify_mention();

-- ===== (3) _connect_enqueue_message: + rama DM síncrona con coalescing (D-F41-2) =====
-- Misma aridad (trigger fn sin args) → CREATE OR REPLACE es seguro (no crea overload).
create or replace function public._connect_enqueue_message()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_kind        public.connect_conversation_kind_t;
  v_counterpart uuid;
  v_author_name text;
begin
  update public.connect_conversations
     set last_message_seq = new.seq,
         last_message_at  = new.created_at
   where id = new.conversation_id
   returning kind into v_kind;

  insert into public.connect_outbox (topic, payload)
  values (
    'connect.message.posted',
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'message_id',      new.id,
      'seq',             new.seq,
      'author_profile_id', new.author_profile_id,
      'kind',            new.kind
    )
  );

  -- Fan-out síncrono DM 1:1 (D-F41-1/2, spec:777). Solo mensajes de texto de un autor real.
  -- Canales/grupos NO notifican por mensaje (D-F41-3): las menciones tienen su propio trigger.
  if v_kind = 'dm' and new.kind = 'text' and new.author_profile_id is not null then
    for v_counterpart in
      select cp.profile_id from public.connect_participants cp
       where cp.conversation_id = new.conversation_id
         and cp.profile_id is not null
         and cp.profile_id <> new.author_profile_id
    loop
      -- COALESCING (D-F41-2): máx. 1 notificación connect_message NO leída por conversación/usuario.
      if not exists (
        select 1 from public.notifications n
         where n.user_id = v_counterpart
           and n.kind = 'connect_message'
           and n.entity = 'connect'
           and n.entity_id = new.conversation_id
           and n.read_at is null
      ) then
        select nullif(btrim(coalesce(p.full_name,'') || ' ' || coalesce(p.apellido,'')), '')
          into v_author_name
          from public.profiles p where p.id = new.author_profile_id;

        insert into public.notifications (user_id, kind, title, message, entity, entity_id, priority)
        values (
          v_counterpart,
          'connect_message',
          coalesce(v_author_name, 'Mensaje directo'),
          'Te escribió por mensaje directo.',
          'connect',
          new.conversation_id,
          'normal'
        );
      end if;
    end loop;
  end if;

  return new;
end;
$$;
revoke all on function public._connect_enqueue_message() from public, anon, authenticated;

notify pgrst, 'reload schema';
