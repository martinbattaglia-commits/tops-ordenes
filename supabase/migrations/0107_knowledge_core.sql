-- ENTREGADA, NO APLICADA — F0.5 Knowledge Layer; verificar numeración contra prod arsksytgdnzukbmfgkju
-- 0107 — Núcleo del Knowledge Layer: 9 tablas knowledge_*, extensiones FTS,
--        índices GIN, RLS con visibility_key, triggers touch/append-only.
-- 100% ADITIVA. No altera DDL existente. Idempotente.

-- =========================================================================
-- 0. Extensiones (molde create extension postgis 0016:22)
-- =========================================================================
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

-- Wrapper IMMUTABLE de unaccent (terreno listo; NO usado en tsv de F0.5 — ver decisión).
-- unaccent() NO es IMMUTABLE → no se puede usar directo en GENERATED/STORED ni en índice.
create or replace function public.f_unaccent(text)
returns text
language sql
immutable
parallel safe
strict
set search_path = extensions, public, pg_temp
as $$ select extensions.unaccent('extensions.unaccent', $1) $$;

-- =========================================================================
-- 1. Touch updated_at: SE REUSA el trigger global existente public.tg_touch_updated_at()
--    (definido en 0004_extended_schema.sql:20 — "new.updated_at := now(); return new;").
--    NO se crea una función propia (evita duplicación; gobernanza "nada duplicado").
-- =========================================================================
-- (sin función nueva aquí)

-- =========================================================================
-- 2. Helper append-only (forbid delete) del módulo
-- =========================================================================
create or replace function public.tg_knowledge_forbid_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'knowledge: registros append-only (no se permite DELETE en %)', tg_table_name;
end;
$$;

-- =========================================================================
-- 3. Tablas
-- =========================================================================

-- ---- 3.1 knowledge_events (read-model timeline + outbox-ready) -----------
create table if not exists public.knowledge_events (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint generated always as identity,
  event_type     text not null,
  occurred_at    timestamptz not null,
  ingested_at    timestamptz not null default now(),
  actor_kind     text not null default 'system'
                   check (actor_kind in ('user','system','integration')),
  actor_id       uuid references auth.users(id) on delete set null,
  actor_label    text,
  entity_type    text not null,
  entity_id      text not null,
  summary        text,
  payload        jsonb not null default '{}'::jsonb,
  visibility_key text not null,
  source_table   text,
  source_pk      text,
  correlation_id text,
  status         text not null default 'processed'
                   check (status in ('pending','processing','processed','failed','dead')),
  retry_count    int  not null default 0,
  available_at   timestamptz not null default now(),
  processed_at   timestamptz,
  error          text,
  constraint knowledge_events_idem_uq unique (source_table, source_pk, event_type)
);

create index if not exists knowledge_events_entity_idx
  on public.knowledge_events (entity_type, entity_id, occurred_at desc);
create index if not exists knowledge_events_dispatch_idx
  on public.knowledge_events (available_at, seq)
  where status in ('pending','failed');
create index if not exists knowledge_events_summary_fts_gin
  on public.knowledge_events
  using gin (to_tsvector('spanish', coalesce(summary,'')));
create index if not exists knowledge_events_visibility_idx
  on public.knowledge_events (visibility_key);

drop trigger if exists tg_knowledge_events_no_delete on public.knowledge_events;
create trigger tg_knowledge_events_no_delete
  before delete on public.knowledge_events
  for each row execute function public.tg_knowledge_forbid_delete();

-- ---- 3.2 searchable_items (Búsqueda Universal MVP FTS) ------------------
create table if not exists public.searchable_items (
  id             uuid primary key default gen_random_uuid(),
  entity_type    text not null,
  entity_id      text not null,
  title          text,
  body           text,
  public_id      text,
  status         text,
  entity_date    timestamptz,
  visibility_key text not null,
  tsv            tsvector generated always as (
                   to_tsvector('spanish',
                     coalesce(title,'') || ' ' || coalesce(body,''))
                 ) stored,
  updated_at     timestamptz not null default now(),
  constraint searchable_items_entity_uq unique (entity_type, entity_id)
);

create index if not exists searchable_items_tsv_gin
  on public.searchable_items using gin (tsv);
create index if not exists searchable_items_title_trgm
  on public.searchable_items using gin (title extensions.gin_trgm_ops);
create index if not exists searchable_items_body_trgm
  on public.searchable_items using gin (body extensions.gin_trgm_ops);
create index if not exists searchable_items_visibility_idx
  on public.searchable_items (visibility_key);

drop trigger if exists tg_searchable_items_touch on public.searchable_items;
create trigger tg_searchable_items_touch
  before update on public.searchable_items
  for each row execute function public.tg_touch_updated_at();

-- ---- 3.3 knowledge_entities --------------------------------------------
create table if not exists public.knowledge_entities (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null
               check (kind in ('concept','topic','organization','product',
                               'service','project','place','keyword','person','date')),
  label      text not null,
  slug       text not null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint knowledge_entities_kind_slug_uq unique (kind, slug)
);

-- ---- 3.4 knowledge_annotations (append-only) ---------------------------
create table if not exists public.knowledge_annotations (
  id            uuid primary key default gen_random_uuid(),
  source_type   text not null,
  source_id     text not null,
  entity_id     uuid references public.knowledge_entities(id) on delete cascade,
  concept_label text,
  confidence    numeric,
  method        text not null default 'manual'
                  check (method in ('manual','rule','ai')),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists knowledge_annotations_source_idx
  on public.knowledge_annotations (source_type, source_id);
create index if not exists knowledge_annotations_entity_idx
  on public.knowledge_annotations (entity_id);

drop trigger if exists tg_knowledge_annotations_no_delete on public.knowledge_annotations;
create trigger tg_knowledge_annotations_no_delete
  before delete on public.knowledge_annotations
  for each row execute function public.tg_knowledge_forbid_delete();

-- ---- 3.5 knowledge_nodes -----------------------------------------------
create table if not exists public.knowledge_nodes (
  id          uuid primary key default gen_random_uuid(),
  node_type   text not null,
  entity_type text not null,
  entity_id   text not null,
  label       text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint knowledge_nodes_entity_uq unique (entity_type, entity_id)
);

-- ---- 3.6 knowledge_edges -----------------------------------------------
create table if not exists public.knowledge_edges (
  id          uuid primary key default gen_random_uuid(),
  src_node_id uuid not null references public.knowledge_nodes(id) on delete cascade,
  dst_node_id uuid not null references public.knowledge_nodes(id) on delete cascade,
  rel_type    text not null,
  weight      numeric,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint knowledge_edges_uq unique (src_node_id, dst_node_id, rel_type)
);
create index if not exists knowledge_edges_src_idx on public.knowledge_edges (src_node_id);
create index if not exists knowledge_edges_dst_idx on public.knowledge_edges (dst_node_id);

-- ---- 3.7 knowledge_documents (scaffold RAG) ----------------------------
create table if not exists public.knowledge_documents (
  id          uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id   text,
  title       text,
  uri         text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---- 3.8 knowledge_chunks (scaffold — SIN embedding en F0.5) ------------
create table if not exists public.knowledge_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  ord         int not null,
  content     text not null,
  token_count int,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint knowledge_chunks_doc_ord_uq unique (document_id, ord)
);
create index if not exists knowledge_chunks_document_idx
  on public.knowledge_chunks (document_id);

-- ---- 3.9 knowledge_sources (catálogo de fuentes) -----------------------
create table if not exists public.knowledge_sources (
  id               uuid primary key default gen_random_uuid(),
  source_table     text not null unique,
  enabled          boolean not null default true,
  visibility_mode  text,
  last_backfill_at timestamptz,
  notes            text,
  created_at       timestamptz not null default now()
);

-- =========================================================================
-- 4. RLS
-- =========================================================================
alter table public.knowledge_events      enable row level security;
alter table public.searchable_items      enable row level security;
alter table public.knowledge_entities    enable row level security;
alter table public.knowledge_annotations enable row level security;
alter table public.knowledge_nodes       enable row level security;
alter table public.knowledge_edges       enable row level security;
alter table public.knowledge_documents   enable row level security;
alter table public.knowledge_chunks      enable row level security;
alter table public.knowledge_sources     enable row level security;

-- ---- 4.1 Policy visibility_key (idéntica en events + searchable) --------
drop policy if exists knowledge_events_select on public.knowledge_events;
create policy knowledge_events_select on public.knowledge_events
  for select
  using (
    public.has_permission('knowledge.view') and (
         visibility_key = 'public_auth'
      or (visibility_key = 'staff' and public.is_staff())
      or (visibility_key like 'client:%'
            and split_part(visibility_key, ':', 2)
              = (select client_id::text from public.profiles where id = auth.uid()))
      or (visibility_key like 'perm:%'
            and public.has_permission(split_part(visibility_key, ':', 2)))
      or public.is_admin()
    )
  );

drop policy if exists searchable_items_select on public.searchable_items;
create policy searchable_items_select on public.searchable_items
  for select
  using (
    public.has_permission('knowledge.view') and (
         visibility_key = 'public_auth'
      or (visibility_key = 'staff' and public.is_staff())
      or (visibility_key like 'client:%'
            and split_part(visibility_key, ':', 2)
              = (select client_id::text from public.profiles where id = auth.uid()))
      or (visibility_key like 'perm:%'
            and public.has_permission(split_part(visibility_key, ':', 2)))
      or public.is_admin()
    )
  );

-- ---- 4.2 Tablas de vocabulario/grafo/scaffold: lectura para knowledge.view
do $$
declare t text;
begin
  foreach t in array array[
    'knowledge_entities','knowledge_annotations','knowledge_nodes',
    'knowledge_edges','knowledge_documents','knowledge_chunks'
  ] loop
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format(
      'create policy %I_select on public.%I for select using (public.has_permission(''knowledge.view''));',
      t, t);
  end loop;
end $$;

-- ---- 4.3 knowledge_sources: lectura staff (operativo) ------------------
drop policy if exists knowledge_sources_select on public.knowledge_sources;
create policy knowledge_sources_select on public.knowledge_sources
  for select using (public.is_staff());

-- NOTA: NINGUNA tabla recibe policy de INSERT/UPDATE/DELETE para authenticated/anon.
-- Toda escritura va por RPC SECURITY DEFINER (0108) o triggers de proyección (0109),
-- que corren con privilegios del owner y saltan RLS. Superficie de máquina cerrada.

select pg_notify('pgrst', 'reload schema');
