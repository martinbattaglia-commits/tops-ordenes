-- =========================================================================
-- 0089_prospeccion_core — Prospección Inteligente F0 · Núcleo de persistencia
-- =========================================================================
-- Implementa el subconjunto F0 del context `prospeccion` (LinkedIn → Nexus → Clientify;
-- NADA va directo a Clientify): catálogo de orígenes, fila materializada del Aggregate
-- Root Prospect, Outbox append-only de Domain Events e ingesta idempotente con dedup.
-- Cubre los pasos 1 (ProspectCreated) y 2 (ProspectImported) del event storming.
--
-- 100% ADITIVA · IDEMPOTENTE. Convenciones (0009/0082/0085):
--   id uuid default gen_random_uuid(); created_at/updated_at default now();
--   trigger public.tg_touch_updated_at() en updated_at; RLS con public.has_permission()
--   y public.is_admin() (RBAC fino, RBAC dormido → la RLS es la frontera real);
--   RPC security definer + search_path fijo; revoke from public/anon/authenticated +
--   grant a service_role; seed RBAC por slug con on conflict do nothing.
--
-- DEPENDE de: permission_module_t con valor 'prospeccion' (0088), permissions/roles/
--   role_permissions (0009), helpers has_permission/is_admin (0009), tg_touch_updated_at (0005).
-- =========================================================================

-- ---- Enum de estado del Prospect (los 9+ estados de la máquina) ----------
-- Espejo de la máquina de estados del event storming (15-event-storming.md:272-284).
-- 'raw' = recién capturado pre-normalización; 'imported' = normalizado; etapas
-- siguientes reservadas para F1+ (el Outbox ya las soporta como eventos).
do $$ begin
  create type public.prospeccion_status_t as enum (
    'raw',
    'imported',
    'enriquecido',
    'scoreado',
    'con_ia',
    'aprobado',
    'sincronizado',
    'cliente_creado',
    'rechazado',
    'duplicado'
  );
exception when duplicate_object then null; end $$;

-- ---- (A) Catálogo de orígenes (SourceSlug) ------------------------------
create table if not exists public.prospeccion_sources (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,                 -- VO SourceSlug (enum cerrado a nivel dominio)
  label       text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.prospeccion_sources (slug, label) values
  ('linkedin_sales_navigator', 'LinkedIn Sales Navigator'),
  ('csv',                      'Importación CSV'),
  ('manual',                  'Carga manual'),
  ('paste',                   'Pegado (paste)'),
  ('api',                     'API / integración'),
  ('webhook',                 'Webhook entrante')
on conflict (slug) do nothing;

-- ---- Secuencia + trigger para short_id legible PROS-YYYY-NNNN -------------
-- Patrón de id público legible (espejo de los public_id del CRM). La secuencia es
-- global (no por año); el año se toma del momento de inserción. NNNN con padding a 4.
create sequence if not exists public.prospeccion_prospect_seq;

-- ---- (B) Prospect (fila materializada del Aggregate Root) ----------------
create table if not exists public.prospeccion_prospects (
  id                   uuid primary key default gen_random_uuid(),
  short_id             text unique,                 -- PROS-YYYY-NNNN (lo pone el trigger)
  status               public.prospeccion_status_t not null default 'raw',
  source_id            uuid references public.prospeccion_sources(id) on delete set null,
  -- Identidad de empresa / contacto (DTO canónico, ver Sección 3)
  company_name         text,
  cuit                 text,                         -- guardado tal cual; clave de CUENTA, no de dedup de persona
  website              text,
  full_name            text,
  cargo                text,
  email                text,                         -- normalizado (lower/trim) en la RPC
  phone                text,                         -- normalizado (solo dígitos) en la RPC
  linkedin_url         text,
  -- Trazabilidad de duplicado (regla "crear y marcar", nunca mergear).
  dedupe_of            uuid references public.prospeccion_prospects(id) on delete set null,
  raw                  jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Índices de dedup (case-insensitive donde aplica) y de consulta.
create index if not exists prospeccion_prospects_email_idx        on public.prospeccion_prospects (lower(email));
create index if not exists prospeccion_prospects_cuit_idx         on public.prospeccion_prospects (cuit);
create index if not exists prospeccion_prospects_linkedin_idx     on public.prospeccion_prospects (linkedin_url);
create index if not exists prospeccion_prospects_status_idx       on public.prospeccion_prospects (status, created_at desc);  -- bandeja: filtra por estado, ordena por fecha (CONS-C1: definición única, sin duplicado)
create index if not exists prospeccion_prospects_source_idx       on public.prospeccion_prospects (source_id);
-- ---- short_id: secuencia + trigger BEFORE INSERT -------------------------
create or replace function public.prospeccion_set_short_id()
returns trigger
language plpgsql
as $$
begin
  if new.short_id is null then
    new.short_id := 'PROS-' || to_char(now(), 'YYYY') || '-' ||
                    lpad(nextval('public.prospeccion_prospect_seq')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_prospeccion_prospects_short_id on public.prospeccion_prospects;
create trigger trg_prospeccion_prospects_short_id
  before insert on public.prospeccion_prospects
  for each row execute function public.prospeccion_set_short_id();

-- ---- updated_at (usa public.tg_touch_updated_at() de 0005) ---------------
drop trigger if exists trg_prospeccion_prospects_touch on public.prospeccion_prospects;
create trigger trg_prospeccion_prospects_touch
  before update on public.prospeccion_prospects
  for each row execute function public.tg_touch_updated_at();

-- ---- (C) Outbox append-only de Domain Events -----------------------------
-- Materialización física de los 9 eventos (Transactional Outbox). Append-only:
-- sin policy de update/delete para anon/authenticated; lo escribe la RPC (DEFINER)
-- y lo consume el worker (service_role). type es texto versionado, no enum cerrado.
create table if not exists public.prospeccion_events (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint generated always as identity, -- orden causal TOTAL de emisión (CONS-C1/DM-004): id uuid no es monotónico y created_at colisiona en inserciones del mismo lote
  aggregate_type text not null default 'prospect',
  aggregate_id   uuid not null,                      -- = prospeccion_prospects.id (relación lógica)
  type           text not null,                      -- 'prospect.created' | 'prospect.imported' | ...
  version        int not null default 1,
  payload        jsonb not null default '{}'::jsonb,
  correlation_id text,
  causation_id   text,
  actor          text,                               -- 'system:ingest' | uuid del usuario | etc.
  status         text not null default 'pending'
                   check (status in ('pending','processing','processed','failed','dead')),
  retry_count    int not null default 0,
  available_at   timestamptz not null default now(),
  processed_at   timestamptz,
  error          text,
  created_at     timestamptz not null default now()
);
-- Cola del worker: índice parcial sobre eventos ACCIONABLES, ordenado por disponibilidad y
-- secuencia de emisión. Sustituye el viejo (status, available_at) y absorbe el rol del
-- bloque "ARB C-2" duplicado que referenciaba next_attempt_at/seq inexistentes (CONS-C1).
create index if not exists prospeccion_events_dispatch_idx
  on public.prospeccion_events (available_at, seq)
  where status in ('pending', 'failed');
-- Orden causal por agregado (replay determinista): usa seq, NO created_at (CONS-C1/DM-004).
create index if not exists prospeccion_events_aggregate_idx
  on public.prospeccion_events (aggregate_id, seq);

-- ---- (D) Bitácora de corridas de import (shape *_sync_log) ----------------
create table if not exists public.prospeccion_import_jobs (
  id          bigserial primary key,
  run_id      uuid not null unique default gen_random_uuid(),
  trigger     text not null check (trigger in ('cron','manual','api')),
  status      text not null check (status in ('running','completed','partial','error','skipped')),
  rows_in     int not null default 0,
  inserted    int not null default 0,
  duplicates  int not null default 0,
  errors      int not null default 0,
  message     text,
  report      jsonb,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists prospeccion_import_jobs_created_idx
  on public.prospeccion_import_jobs (created_at desc);

-- ---- (E) Tabla CRM refs provider-agnostic — adelantada F1→F0 (ARB C-3 2026-06-25) -----
-- Tabla CRM refs provider-agnostic — adelantada F1→F0 (ARB C-3 2026-06-25)
create table if not exists public.prospeccion_crm_refs (
  id              uuid        primary key default gen_random_uuid(),
  prospect_id     uuid        not null references public.prospeccion_prospects(id) on delete cascade,
  crm_provider    text        not null,   -- 'clientify' | 'hubspot' | 'salesforce' | …
  crm_contact_id  text,
  crm_deal_id     text,
  synced_at       timestamptz not null default now(),
  sync_version    integer     not null default 1,
  metadata        jsonb       not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),   -- DM-006: convención normativa (faltaba)
  unique(prospect_id, crm_provider)
);
alter table public.prospeccion_crm_refs enable row level security;

-- updated_at de crm_refs (convención 0082/0085; DM-006 — la tabla se adelantó a F0 por ARB C-3).
drop trigger if exists trg_prospeccion_crm_refs_touch on public.prospeccion_crm_refs;
create trigger trg_prospeccion_crm_refs_touch
  before update on public.prospeccion_crm_refs
  for each row execute function public.tg_touch_updated_at();

-- Índices de prospeccion_crm_refs. (Los índices de prospeccion_events y prospeccion_prospects
--  se definen junto a su tabla, arriba; el viejo bloque "ARB C-2" se eliminó porque duplicaba
--  nombres y referenciaba columnas inexistentes next_attempt_at/seq → CONS-C1.)
create index if not exists prospeccion_crm_refs_prospect_idx
  on public.prospeccion_crm_refs (prospect_id);

create index if not exists prospeccion_crm_refs_provider_idx
  on public.prospeccion_crm_refs (crm_provider, crm_contact_id)
  where crm_contact_id is not null;

-- =========================================================================
-- RLS — RBAC dormido → la RLS es la frontera real. Tablas con PII NUNCA using(true).
-- =========================================================================
alter table public.prospeccion_sources      enable row level security;
alter table public.prospeccion_prospects    enable row level security;
alter table public.prospeccion_events       enable row level security;
alter table public.prospeccion_import_jobs  enable row level security;

-- ---- sources: lectura por permiso view; escritura por edit; borrado admin --
drop policy if exists "prospeccion_sources select" on public.prospeccion_sources;
create policy "prospeccion_sources select" on public.prospeccion_sources
  for select to authenticated
  using (public.has_permission('prospeccion.view'));

drop policy if exists "prospeccion_sources insert" on public.prospeccion_sources;
create policy "prospeccion_sources insert" on public.prospeccion_sources
  for insert to authenticated
  with check (public.has_permission('prospeccion.create'));

drop policy if exists "prospeccion_sources update" on public.prospeccion_sources;
create policy "prospeccion_sources update" on public.prospeccion_sources
  for update to authenticated
  using (public.has_permission('prospeccion.edit'))
  with check (public.has_permission('prospeccion.edit'));

drop policy if exists "prospeccion_sources delete" on public.prospeccion_sources;
create policy "prospeccion_sources delete" on public.prospeccion_sources
  for delete to authenticated
  using (public.is_admin());

-- ---- prospects (PII): select=view, insert=create, update=edit, delete=is_admin() --
-- NUNCA using(true): contiene email/phone/cuit/linkedin (PII). El permiso es la frontera.
drop policy if exists "prospeccion_prospects select" on public.prospeccion_prospects;
create policy "prospeccion_prospects select" on public.prospeccion_prospects
  for select to authenticated
  using (public.has_permission('prospeccion.view'));

drop policy if exists "prospeccion_prospects insert" on public.prospeccion_prospects;
create policy "prospeccion_prospects insert" on public.prospeccion_prospects
  for insert to authenticated
  with check (public.has_permission('prospeccion.create'));

drop policy if exists "prospeccion_prospects update" on public.prospeccion_prospects;
create policy "prospeccion_prospects update" on public.prospeccion_prospects
  for update to authenticated
  using (public.has_permission('prospeccion.edit'))
  with check (public.has_permission('prospeccion.edit'));

drop policy if exists "prospeccion_prospects delete" on public.prospeccion_prospects;
create policy "prospeccion_prospects delete" on public.prospeccion_prospects
  for delete to authenticated
  using (public.is_admin());

-- ---- crm_refs: lectura por permiso view; escritura SOLO service_role/DEFINER (sync F5) -----
-- DM-006: la tabla tiene RLS habilitada (arriba). Sin esta policy, un SELECT autenticado
-- devolvía 0 filas y la UI no podía saber si un prospecto ya fue sincronizado. La escritura
-- la hace la RPC de sync (DEFINER, F5) / service_role; no se expone INSERT/UPDATE a sesión.
drop policy if exists "prospeccion_crm_refs select" on public.prospeccion_crm_refs;
create policy "prospeccion_crm_refs select" on public.prospeccion_crm_refs
  for select to authenticated
  using (public.has_permission('prospeccion.view'));

drop policy if exists "prospeccion_crm_refs delete" on public.prospeccion_crm_refs;
create policy "prospeccion_crm_refs delete" on public.prospeccion_crm_refs
  for delete to authenticated
  using (public.is_admin());

-- ---- events + import_jobs: SOLO service_role -----------------------------
-- El Outbox y la bitácora son superficie de máquina. RLS habilitada y SIN policy
-- para anon/authenticated → quedan cerrados a sesión de usuario. service_role los
-- escribe/consume (bypassa RLS). Las RPC DEFINER también escriben (corren como owner).
-- (Se deja explícito que NO hay policy: el enable + ausencia de policy = deny-all a roles
--  no privilegiados, frontera real con RBAC dormido.)

-- =========================================================================
-- RPC prospeccion_ingest — ingesta idempotente con dedup + Outbox
-- =========================================================================
-- SECURITY DEFINER (tráfico de máquina: cron/worker sin auth.uid()), search_path fijo;
-- es la ÚNICA puerta de escritura masiva. Dedup por cuit / lower(email) / linkedin_url
-- con regla "crear y marcar duplicado" (D-4 de crm_ingest_lead). Por cada fila inserta
-- en el Outbox los eventos 'prospect.created' y 'prospect.imported'. Retorna contadores.
create or replace function public.prospeccion_ingest(
  p_rows   jsonb,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_id   uuid;
  r             jsonb;
  v_company     text;
  v_cuit        text;
  v_website     text;
  v_full_name   text;
  v_cargo       text;
  v_email       text;
  v_phone       text;
  v_linkedin    text;
  v_raw         jsonb;
  v_match_id    uuid;
  v_is_dup      boolean;
  v_status      public.prospeccion_status_t;
  v_prospect    public.prospeccion_prospects;
  v_corr        uuid;   -- correlation_id por prospecto (EVT-4 OBLIGATORIO)
  v_created_eid uuid;   -- id del evento 'created' → causation_id del 'imported'
  v_inserted    int := 0;
  v_duplicates  int := 0;
begin
  -- Resolución del origen (catálogo). Origen desconocido → error permanente.
  select id into v_source_id from public.prospeccion_sources where slug = p_source;
  if v_source_id is null then
    raise exception 'UNKNOWN_SOURCE: origen % no existe en prospeccion_sources', p_source
      using errcode = 'check_violation';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_ROWS: p_rows debe ser un array jsonb'
      using errcode = 'check_violation';
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    -- ── Extracción + normalización (espejo de crm_ingest_lead) ────────────
    v_company   := nullif(trim(r->>'company_name'), '');
    v_cuit      := nullif(trim(r->>'cuit'), '');
    v_website   := nullif(lower(trim(r->>'website')), '');
    v_full_name := nullif(trim(r->>'full_name'), '');
    v_cargo     := nullif(trim(r->>'cargo'), '');
    v_email     := lower(nullif(trim(r->>'email'), ''));
    v_phone     := nullif(regexp_replace(coalesce(r->>'phone',''), '\D', '', 'g'), '');
    v_linkedin  := nullif(lower(trim(r->>'linkedin_url')), '');
    v_raw       := coalesce(r->'raw', r);

    -- ── Dedup: cuit → lower(email) → linkedin_url ─────────────────────────
    -- (CUIT es clave de CUENTA; acá se usa como una de las señales de dedup de fila
    --  de import, conforme a la cadena pedida para F0; persona fina se afina en fases
    --  siguientes con email/phone.)
    v_match_id := null;
    if v_cuit is not null then
      select id into v_match_id from public.prospeccion_prospects
       where cuit = v_cuit and dedupe_of is null limit 1;
    end if;
    if v_match_id is null and v_email is not null then
      select id into v_match_id from public.prospeccion_prospects
       where lower(email) = v_email and dedupe_of is null limit 1;
    end if;
    if v_match_id is null and v_linkedin is not null then
      select id into v_match_id from public.prospeccion_prospects
       where linkedin_url = v_linkedin and dedupe_of is null limit 1;
    end if;

    v_is_dup := v_match_id is not null;
    -- "Crear y marcar": el duplicado SE CREA (no se descarta), con status 'duplicado'
    -- y dedupe_of apuntando al original. NUNCA se mergea en F0.
    v_status := case when v_is_dup then 'duplicado'::public.prospeccion_status_t
                                   else 'imported'::public.prospeccion_status_t end;

    insert into public.prospeccion_prospects
      (status, source_id, company_name, cuit, website, full_name, cargo,
       email, phone, linkedin_url, dedupe_of, raw)
    values
      (v_status, v_source_id, v_company, v_cuit, v_website, v_full_name, v_cargo,
       v_email, v_phone, v_linkedin, v_match_id, v_raw)
    returning * into v_prospect;

    if v_is_dup then
      v_duplicates := v_duplicates + 1;
    else
      v_inserted := v_inserted + 1;
    end if;

    -- ── Outbox: evento 1 (created) + evento 2 (imported) por fila ─────────
    -- E-2: emisión atómica en la misma transacción que el agregado.
    -- EVT-4 (OBLIGATORIO): correlation_id agrupa la cadena causal del prospecto; el 'imported'
    -- lleva causation_id = id del 'created'. Se insertan en dos pasos para capturar ese id.
    v_corr := gen_random_uuid();
    insert into public.prospeccion_events
      (aggregate_id, type, version, payload, actor, correlation_id, causation_id)
    values
      (v_prospect.id, 'prospect.created', 1,
       jsonb_build_object('source', p_source, 'short_id', v_prospect.short_id),
       'system:ingest', v_corr::text, null)
    returning id into v_created_eid;

    insert into public.prospeccion_events
      (aggregate_id, type, version, payload, actor, correlation_id, causation_id)
    values
      (v_prospect.id, 'prospect.imported', 1,
       jsonb_build_object('source', p_source, 'is_duplicate', v_is_dup,
                          'dedupe_of', v_match_id, 'status', v_status),
       'system:ingest', v_corr::text, v_created_eid::text);
  end loop;

  return jsonb_build_object(
    'inserted',   v_inserted,
    'duplicates', v_duplicates
  );
end;
$$;

-- ---- Grants: SOLO service_role (superficie de máquina, bypassa RLS por DEFINER) --
revoke all on function public.prospeccion_ingest(jsonb, text) from public, anon, authenticated;
grant execute on function public.prospeccion_ingest(jsonb, text) to service_role;

-- =========================================================================
-- Seed RBAC — permisos prospeccion.* + grants por slug (idempotente)
-- =========================================================================
-- Acciones F0: SOLO view/create/edit/delete/admin (permission_action_t NO tiene 'sync').
insert into public.permissions (slug, module, action, label, description) values
  ('prospeccion.view',   'prospeccion', 'view',   'Ver prospectos',            'Acceso lectura al pipeline de Prospección Inteligente'),
  ('prospeccion.create', 'prospeccion', 'create', 'Crear / importar prospectos','Ingesta y alta de prospectos'),
  ('prospeccion.edit',   'prospeccion', 'edit',   'Editar prospectos',          'Modificar datos de un prospecto'),
  ('prospeccion.delete', 'prospeccion', 'delete', 'Eliminar prospectos',        'Baja de prospectos (admin)'),
  ('prospeccion.admin',  'prospeccion', 'admin',  'Administrar Prospección',     'Gestión total del módulo Prospección')
on conflict (slug) do nothing;

-- Grant por slug (roles.slug + permissions.slug), on conflict do nothing (molde 0087:13-19).
-- comercial + director_ops: operación completa (view/create/edit/delete).
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p
  on p.slug in ('prospeccion.view','prospeccion.create','prospeccion.edit','prospeccion.delete')
where ro.slug in ('comercial','director_ops')
on conflict do nothing;

-- operaciones: solo lectura.
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p on p.slug = 'prospeccion.view'
where ro.slug = 'operaciones'
on conflict do nothing;

-- admin: admin del módulo.
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p on p.slug = 'prospeccion.admin'
where ro.slug = 'admin'
on conflict do nothing;

-- ---- Cierre: refrescar el caché de esquema de PostgREST -------------------
notify pgrst, 'reload schema';
