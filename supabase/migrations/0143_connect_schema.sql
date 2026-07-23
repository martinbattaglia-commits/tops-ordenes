-- 0143_connect_schema.sql — Nexus Link RC1.0.
-- ENTREGADA, NO APLICADA (G3).
-- ─────────────────────────────────────────────────────────────────────────
-- Núcleo de datos de Nexus Link (Connect): enums connect_*, tablas, índices,
-- triggers (tg_touch_updated_at), helper _connect_is_member y RLS.
-- 100% ADITIVA · IDEMPOTENTE. NO incluye RPCs (van en 0144) ni el trigger de
-- fan-out (va en 0144, depende de la cola).
-- Reconciliación RC1 sobre el spec aprobado (§B 5.2), +36 de prefijo, más:
--   · D-RC1-6: context_id permanente (CTX-AAAA-NNNNNN, secuencia + trigger, inmutable).
--   · D-RC1-7: meta jsonb en conversaciones/mensajes (AI-ready, sin IA).
--   · Addendum A1: connect_participants.is_favorite + connect_pinned + connect_message_flags.
--   · Búsqueda (RC1.9): índice GIN FTS español sobre connect_messages.body.
-- DEPENDE de: tg_touch_updated_at (0004), is_admin/is_staff (0005),
--   has_permission/current_role (0009), auth.users.
-- ─────────────────────────────────────────────────────────────────────────

-- ===== Enums =====
do $$ begin
  create type public.connect_conversation_kind_t as enum
    ('dm','group','channel','erp','incident','whatsapp','ai');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.connect_member_role_t as enum
    ('owner','moderator','member','guest');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.connect_message_kind_t as enum
    ('text','system','ai','file','call_link','whatsapp');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.connect_participant_type_t as enum
    ('staff','client','provider','ai','system','whatsapp');
exception when duplicate_object then null; end $$;

-- ===== Context ID permanente (D-RC1-6) =====
-- Identificador estable y único por conversación: referencia transversal para
-- Knowledge / Timeline / Cockpit / Auditoría / Búsquedas / integraciones futuras.
create sequence if not exists public.connect_context_seq;

create or replace function public._connect_set_context_id()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.context_id is null then
    new.context_id := 'CTX-' || to_char(now(),'YYYY') || '-' ||
                      lpad(nextval('public.connect_context_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create or replace function public._connect_guard_context_id()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  -- Permanencia: context_id no se reasigna nunca (D-RC1-6).
  if new.context_id is distinct from old.context_id then
    raise exception 'context_id es inmutable (permanente)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ===== Tablas =====

-- (1) connect_conversations
create table if not exists public.connect_conversations (
  id                uuid primary key default gen_random_uuid(),
  context_id        text not null,                        -- D-RC1-6 (lo setea el trigger before insert; unique por índice nombrado abajo)
  kind              public.connect_conversation_kind_t not null,
  slug              text,
  title             text,
  visibility        text check (visibility in ('public','private')),
  topic             text,
  archived_at       timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  last_message_seq  bigint,
  last_message_at   timestamptz,
  meta              jsonb not null default '{}'::jsonb,    -- D-RC1-7 (AI-ready, extensible)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- belt-and-suspenders idempotente: meta lleva default → sale NOT NULL incluso en re-run.
-- context_id NO se agrega vía add-column (saldría nullable y divergiría del NOT NULL del create table);
-- en prod la tabla no existe (apply fresco) y el unique index nombrado de abajo es la ÚNICA fuente de
-- unicidad (se quitó el `unique` inline del create table para no duplicar el índice).
alter table public.connect_conversations add column if not exists meta jsonb not null default '{}'::jsonb;
create unique index if not exists connect_conversations_context_uidx
  on public.connect_conversations (context_id);
create unique index if not exists connect_conversations_slug_uidx
  on public.connect_conversations (lower(slug)) where slug is not null;
create index if not exists connect_conversations_inbox_idx
  on public.connect_conversations (kind, last_message_at desc);
create index if not exists connect_conversations_active_idx
  on public.connect_conversations (archived_at) where archived_at is null;

drop trigger if exists trg_connect_conversations_ctxid on public.connect_conversations;
create trigger trg_connect_conversations_ctxid
  before insert on public.connect_conversations
  for each row execute function public._connect_set_context_id();

drop trigger if exists trg_connect_conversations_ctxid_guard on public.connect_conversations;
create trigger trg_connect_conversations_ctxid_guard
  before update on public.connect_conversations
  for each row execute function public._connect_guard_context_id();

drop trigger if exists trg_connect_conversations_touch on public.connect_conversations;
create trigger trg_connect_conversations_touch
  before update on public.connect_conversations
  for each row execute function public.tg_touch_updated_at();

-- (2) connect_participants
create table if not exists public.connect_participants (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.connect_conversations(id) on delete cascade,
  participant_type  public.connect_participant_type_t not null default 'staff',
  profile_id        uuid references auth.users(id) on delete cascade,
  external_ref      jsonb,
  member_role       public.connect_member_role_t not null default 'member',
  joined_at         timestamptz not null default now(),
  last_read_seq     bigint not null default 0,
  muted_until       timestamptz,
  notif_pref        text,
  is_favorite       boolean not null default false,        -- Addendum A1 (favorito per-usuario)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (conversation_id, profile_id)
);
alter table public.connect_participants add column if not exists is_favorite boolean not null default false;
create index if not exists connect_participants_conv_idx
  on public.connect_participants (conversation_id);
create index if not exists connect_participants_profile_idx
  on public.connect_participants (profile_id) where profile_id is not null;

drop trigger if exists trg_connect_participants_touch on public.connect_participants;
create trigger trg_connect_participants_touch
  before update on public.connect_participants
  for each row execute function public.tg_touch_updated_at();

-- (3) connect_messages (append-only)
create table if not exists public.connect_messages (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null references public.connect_conversations(id) on delete cascade,
  seq                   bigint generated always as identity,
  author_participant_id uuid references public.connect_participants(id) on delete set null,
  author_profile_id     uuid,
  kind                  public.connect_message_kind_t not null default 'text',
  body                  text,
  body_format           text not null default 'markdown',
  reply_to_message_id   uuid references public.connect_messages(id) on delete set null,
  edited_at             timestamptz,
  deleted_at            timestamptz,
  redacted              boolean not null default false,
  client_msg_id         text,   -- idempotencia de USUARIO (UUID del front); scoped por conversación+autor
  external_msg_id       text,   -- idempotencia de MÁQUINA (wamid WhatsApp F4); UNIQUE global
  meta                  jsonb not null default '{}'::jsonb,   -- D-RC1-7 (AI-ready)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists connect_messages_conv_seq_uidx
  on public.connect_messages (conversation_id, seq);
create unique index if not exists connect_messages_client_msg_uidx
  on public.connect_messages (conversation_id, author_profile_id, client_msg_id)
  where client_msg_id is not null;
create unique index if not exists connect_messages_external_uidx
  on public.connect_messages (external_msg_id) where external_msg_id is not null;
create index if not exists connect_messages_reply_idx
  on public.connect_messages (reply_to_message_id) where reply_to_message_id is not null;
create index if not exists connect_messages_live_idx
  on public.connect_messages (conversation_id) where deleted_at is null;
-- Búsqueda RC1.9: FTS español sobre el cuerpo (índice ahora; la RPC de búsqueda en RC1.9).
create index if not exists connect_messages_fts_idx
  on public.connect_messages using gin (to_tsvector('spanish', coalesce(body,'')));

drop trigger if exists trg_connect_messages_touch on public.connect_messages;
create trigger trg_connect_messages_touch
  before update on public.connect_messages
  for each row execute function public.tg_touch_updated_at();

-- (4) connect_message_edits (append-only puro)
create table if not exists public.connect_message_edits (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.connect_messages(id) on delete cascade,
  prev_body   text,
  edited_by   uuid references auth.users(id) on delete set null,
  edited_at   timestamptz not null default now()
);
create index if not exists connect_message_edits_msg_idx
  on public.connect_message_edits (message_id, edited_at desc);

-- (5) connect_message_reactions
create table if not exists public.connect_message_reactions (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.connect_messages(id) on delete cascade,
  participant_id  uuid not null references public.connect_participants(id) on delete cascade,
  emoji           text not null,
  created_at      timestamptz not null default now(),
  unique (message_id, participant_id, emoji)
);
create index if not exists connect_message_reactions_msg_idx
  on public.connect_message_reactions (message_id);

-- (6) connect_message_mentions
create table if not exists public.connect_message_mentions (
  id                        uuid primary key default gen_random_uuid(),
  message_id                uuid not null references public.connect_messages(id) on delete cascade,
  mentioned_participant_id  uuid not null references public.connect_participants(id) on delete cascade,
  created_at                timestamptz not null default now(),
  unique (message_id, mentioned_participant_id)
);
create index if not exists connect_message_mentions_part_idx
  on public.connect_message_mentions (mentioned_participant_id);

-- (7) connect_attachments
create table if not exists public.connect_attachments (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
  message_id      uuid references public.connect_messages(id) on delete set null,
  storage_bucket  text not null,
  storage_path    text not null,
  sha256          text,
  mime_type       text,
  file_size       bigint,
  file_name       text,
  uploaded_by     uuid references auth.users(id) on delete set null,
  scan_status     text not null default 'pending'
                    check (scan_status in ('pending','clean','infected')),
  created_at      timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
create index if not exists connect_attachments_conv_idx
  on public.connect_attachments (conversation_id);
create index if not exists connect_attachments_msg_idx
  on public.connect_attachments (message_id) where message_id is not null;
create index if not exists connect_attachments_sha_idx
  on public.connect_attachments (sha256);

-- (8) connect_conversation_links (polimórfico ERP) — D-RC1-5 (contexto)
create table if not exists public.connect_conversation_links (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
  entity_type     text not null,
  entity_id       uuid,
  entity_id_text  text,
  linked_by       uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint connect_links_entity_type_chk check (entity_type in (
    'clients','orders','purchase_orders','customer_invoices','supplier_invoices',
    'fleet_vehicles','warehouses','crm_leads','crm_opportunities','crm_contracts',
    'contracts','prospeccion_prospects','vendors','compliance_items'
  )),
  constraint connect_links_pk_kind_chk check (
    (entity_type = 'compliance_items'
       and entity_id_text is not null and entity_id is null)
    or
    (entity_type <> 'compliance_items'
       and entity_id is not null and entity_id_text is null)
  )
);
create unique index if not exists connect_links_uuid_uidx
  on public.connect_conversation_links (conversation_id, entity_type, entity_id)
  where entity_id is not null;
create unique index if not exists connect_links_text_uidx
  on public.connect_conversation_links (conversation_id, entity_type, entity_id_text)
  where entity_id_text is not null;
create index if not exists connect_links_entity_uuid_idx
  on public.connect_conversation_links (entity_type, entity_id) where entity_id is not null;
create index if not exists connect_links_entity_text_idx
  on public.connect_conversation_links (entity_type, entity_id_text) where entity_id_text is not null;

-- (9) connect_outbox (superficie de máquina)
create table if not exists public.connect_outbox (
  seq           bigint generated always as identity primary key,
  topic         text not null,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending'
                  check (status in ('pending','processing','processed','failed','dead')),
  available_at  timestamptz not null default now(),
  retry_count   int not null default 0,
  processed_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);
create index if not exists connect_outbox_dispatch_idx
  on public.connect_outbox (available_at, seq)
  where status in ('pending','failed');

-- (10) connect_pinned (Addendum A1 — fijados a nivel conversación, por owner/moderator)
create table if not exists public.connect_pinned (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
  message_id      uuid not null references public.connect_messages(id) on delete cascade,
  pinned_by       uuid references auth.users(id) on delete set null,
  pinned_at       timestamptz not null default now(),
  unique (conversation_id, message_id)
);
create index if not exists connect_pinned_conv_idx
  on public.connect_pinned (conversation_id);

-- (11) connect_message_flags (Addendum A1 — marca personal "importante")
create table if not exists public.connect_message_flags (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.connect_messages(id) on delete cascade,
  profile_id  uuid not null references auth.users(id) on delete cascade,
  flag        text not null check (flag in ('important')),
  created_at  timestamptz not null default now(),
  unique (message_id, profile_id, flag)
);
create index if not exists connect_message_flags_profile_idx
  on public.connect_message_flags (profile_id);

-- ===== Helper interno _connect_is_member (evita recursión RLS) =====
create or replace function public._connect_is_member(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.connect_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.profile_id = auth.uid()
  );
$$;
revoke all on function public._connect_is_member(uuid) from public, anon;
grant execute on function public._connect_is_member(uuid) to authenticated, service_role;

-- ===== RLS =====
alter table public.connect_conversations       enable row level security;
alter table public.connect_participants        enable row level security;
alter table public.connect_messages            enable row level security;
alter table public.connect_message_edits       enable row level security;
alter table public.connect_message_reactions   enable row level security;
alter table public.connect_message_mentions    enable row level security;
alter table public.connect_attachments         enable row level security;
alter table public.connect_conversation_links  enable row level security;
alter table public.connect_outbox              enable row level security;  -- SIN policy: deny-all
alter table public.connect_pinned              enable row level security;
alter table public.connect_message_flags       enable row level security;

-- ---- connect_conversations ----
drop policy if exists "connect_conversations select" on public.connect_conversations;
create policy "connect_conversations select" on public.connect_conversations
  for select to authenticated
  using (
    public.has_permission('connect.view')
    and (
      public._connect_is_member(id)
      or (kind = 'channel' and visibility = 'public')
      or public.is_admin()
    )
  );

drop policy if exists "connect_conversations insert" on public.connect_conversations;
create policy "connect_conversations insert" on public.connect_conversations
  for insert to authenticated
  with check (public.has_permission('connect.create'));

drop policy if exists "connect_conversations update" on public.connect_conversations;
create policy "connect_conversations update" on public.connect_conversations
  for update to authenticated
  using (public.has_permission('connect.edit') and (public._connect_is_member(id) or public.is_admin()))
  with check (public.has_permission('connect.edit') and (public._connect_is_member(id) or public.is_admin()));

drop policy if exists "connect_conversations delete" on public.connect_conversations;
create policy "connect_conversations delete" on public.connect_conversations
  for delete to authenticated
  using (public.is_admin());

-- ---- connect_participants ----
drop policy if exists "connect_participants select" on public.connect_participants;
create policy "connect_participants select" on public.connect_participants
  for select to authenticated
  using (public.has_permission('connect.view') and (public._connect_is_member(conversation_id) or public.is_admin()));

drop policy if exists "connect_participants update self" on public.connect_participants;
create policy "connect_participants update self" on public.connect_participants
  for update to authenticated
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

drop policy if exists "connect_participants delete admin" on public.connect_participants;
create policy "connect_participants delete admin" on public.connect_participants
  for delete to authenticated
  using (public.is_admin());

-- Hardening SEC-PARTICIPANTS-1: la policy "update self" filtra FILAS, pero RLS NO acota COLUMNAS;
-- sin esto un miembro podría `update connect_participants set member_role='owner' where profile_id=auth.uid()`
-- directo (escalada de privilegios), evadiendo el guard de connect_set_member_role. Reemplazamos el grant
-- table-level de UPDATE (default privileges de Supabase) por grant POR COLUMNA: solo las columnas
-- auto-gestionables. member_role/participant_type/conversation_id/profile_id/joined_at solo mutan vía
-- RPC SECDEF (corre como owner, no afectada por este grant). RLS sola no alcanza para esto.
-- INSERT/DELETE de miembros y cambios de rol = SOLO vía RPC connect_add_member/remove_member/set_member_role.
revoke update on public.connect_participants from authenticated;
grant  update (last_read_seq, muted_until, notif_pref, is_favorite)
  on public.connect_participants to authenticated;

-- ---- connect_messages (append-only) ----
drop policy if exists "connect_messages select" on public.connect_messages;
create policy "connect_messages select" on public.connect_messages
  for select to authenticated
  using (public.has_permission('connect.view') and public._connect_is_member(conversation_id));

drop policy if exists "connect_messages insert" on public.connect_messages;
create policy "connect_messages insert" on public.connect_messages
  for insert to authenticated
  with check (
    public.has_permission('connect.create')
    and public._connect_is_member(conversation_id)
    and author_profile_id = auth.uid()
  );

drop policy if exists "connect_messages no direct update" on public.connect_messages;
create policy "connect_messages no direct update" on public.connect_messages
  for update to authenticated
  using (false);

drop policy if exists "connect_messages delete admin" on public.connect_messages;
create policy "connect_messages delete admin" on public.connect_messages
  for delete to authenticated
  using (public.is_admin());

-- ---- connect_message_edits ----
drop policy if exists "connect_message_edits select" on public.connect_message_edits;
create policy "connect_message_edits select" on public.connect_message_edits
  for select to authenticated
  using (
    public.has_permission('connect.view')
    and exists (
      select 1 from public.connect_messages m
      where m.id = connect_message_edits.message_id
        and public._connect_is_member(m.conversation_id)
    )
  );

-- ---- connect_message_reactions ----
drop policy if exists "connect_message_reactions select" on public.connect_message_reactions;
create policy "connect_message_reactions select" on public.connect_message_reactions
  for select to authenticated
  using (
    public.has_permission('connect.view')
    and exists (
      select 1 from public.connect_messages m
      where m.id = connect_message_reactions.message_id
        and public._connect_is_member(m.conversation_id)
    )
  );

drop policy if exists "connect_message_reactions insert self" on public.connect_message_reactions;
create policy "connect_message_reactions insert self" on public.connect_message_reactions
  for insert to authenticated
  with check (
    public.has_permission('connect.create')
    and participant_id in (
      select cp.id from public.connect_participants cp where cp.profile_id = auth.uid()
    )
  );

drop policy if exists "connect_message_reactions delete self" on public.connect_message_reactions;
create policy "connect_message_reactions delete self" on public.connect_message_reactions
  for delete to authenticated
  using (
    participant_id in (
      select cp.id from public.connect_participants cp where cp.profile_id = auth.uid()
    ) or public.is_admin()
  );

-- ---- connect_message_mentions ----
drop policy if exists "connect_message_mentions select" on public.connect_message_mentions;
create policy "connect_message_mentions select" on public.connect_message_mentions
  for select to authenticated
  using (
    public.has_permission('connect.view')
    and exists (
      select 1 from public.connect_messages m
      where m.id = connect_message_mentions.message_id
        and public._connect_is_member(m.conversation_id)
    )
  );

-- ---- connect_attachments ----
drop policy if exists "connect_attachments select" on public.connect_attachments;
create policy "connect_attachments select" on public.connect_attachments
  for select to authenticated
  using (public.has_permission('connect.view') and public._connect_is_member(conversation_id));

drop policy if exists "connect_attachments insert" on public.connect_attachments;
create policy "connect_attachments insert" on public.connect_attachments
  for insert to authenticated
  with check (
    public.has_permission('connect.create')
    and public._connect_is_member(conversation_id)
    and uploaded_by = auth.uid()
  );

drop policy if exists "connect_attachments no session update" on public.connect_attachments;
create policy "connect_attachments no session update" on public.connect_attachments
  for update to authenticated
  using (false);

drop policy if exists "connect_attachments delete admin" on public.connect_attachments;
create policy "connect_attachments delete admin" on public.connect_attachments
  for delete to authenticated
  using (public.is_admin());

-- ---- connect_conversation_links ----
drop policy if exists "connect_conversation_links select" on public.connect_conversation_links;
create policy "connect_conversation_links select" on public.connect_conversation_links
  for select to authenticated
  using (public.has_permission('connect.view') and public._connect_is_member(conversation_id));

-- ---- connect_pinned (A1) ----
drop policy if exists "connect_pinned select" on public.connect_pinned;
create policy "connect_pinned select" on public.connect_pinned
  for select to authenticated
  using (public.has_permission('connect.view') and public._connect_is_member(conversation_id));
-- INSERT/DELETE vía RPC connect_pin_message / connect_unpin_message (owner/moderator).

-- ---- connect_message_flags (A1) ----
drop policy if exists "connect_message_flags select self" on public.connect_message_flags;
create policy "connect_message_flags select self" on public.connect_message_flags
  for select to authenticated
  using (profile_id = auth.uid());
-- INSERT/DELETE vía RPC connect_flag_message / connect_unflag_message (propio).

-- ---- connect_outbox: RLS habilitada SIN policy (deny-all). Trigger DEFINER escribe;
--      worker service_role consume (bypassa RLS).

notify pgrst, 'reload schema';
