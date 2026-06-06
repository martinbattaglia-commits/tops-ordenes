-- =========================================================================
-- 0043_crm_quotes_proposals.sql — CRM Comercial F2.1-2 · cotizaciones + propuestas
--
-- ADDITIVE ONLY. ⚠️ Requiere 0041-0042 (enums + crm_opportunities), documents
-- (0010), helpers RLS (0005), tg_touch_updated_at (0004).
-- Persiste la salida del cotizador y de los generadores de propuesta (hoy
-- efímeros) como objetos versionados ligados a la oportunidad.
-- NO aplicar a Supabase PROD. Rama de feature, sin deploy.
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Enums --------------------------------------------------------------
do $$ begin
  create type public.crm_quote_status_t as enum
    ('borrador', 'enviada', 'aceptada', 'rechazada', 'vencida');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_proposal_t as enum ('anmat', 'general');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_proposal_status_t as enum
    ('borrador', 'enviada', 'aceptada', 'rechazada');
exception when duplicate_object then null; end $$;

-- ---- Secuencias ---------------------------------------------------------
create sequence if not exists public.crm_quotes_short_id_seq start 1;
create sequence if not exists public.crm_proposals_short_id_seq start 1;

-- ---- Tabla: crm_quotes (cotización persistida) --------------------------
create table if not exists public.crm_quotes (
  id              uuid primary key default gen_random_uuid(),
  short_id        int  not null default nextval('public.crm_quotes_short_id_seq'),
  public_id       text unique,                       -- COT-YYYY-0001
  opportunity_id  uuid not null references public.crm_opportunities(id) on delete cascade,
  service_type    public.crm_service_t not null,
  tarifario_ref   text,                              -- 'MAYO/2026'
  subtotal        numeric(14,2) not null default 0,  -- neto sin IVA
  descuento_total numeric(14,2) not null default 0,
  iva             numeric(14,2) not null default 0,  -- 21%
  total           numeric(14,2) not null default 0,
  currency        text not null default 'ARS',
  status          public.crm_quote_status_t not null default 'borrador',
  pdf_document_id uuid references public.documents(id),
  payload         jsonb,                             -- snapshot del cálculo del cotizador
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  deleted_at      timestamptz
);
create index if not exists crm_quotes_opp_idx    on public.crm_quotes (opportunity_id);
create index if not exists crm_quotes_status_idx on public.crm_quotes (status);

-- ---- Tabla: crm_quote_items --------------------------------------------
create table if not exists public.crm_quote_items (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.crm_quotes(id) on delete cascade,
  concepto    text not null,
  categoria   text,                                  -- storage|ops_in|ops_out|transporte
  cantidad    numeric(12,2) not null default 0,
  unidad      text not null,                         -- m2|pallet|m3|hora|unidad
  precio_unit numeric(14,2) not null default 0,
  importe     numeric(14,2) not null default 0,
  orden       int not null default 0
);
create index if not exists crm_quote_items_quote_idx on public.crm_quote_items (quote_id);

-- ---- Tabla: crm_proposals (propuesta versionada) ------------------------
create table if not exists public.crm_proposals (
  id              uuid primary key default gen_random_uuid(),
  short_id        int  not null default nextval('public.crm_proposals_short_id_seq'),
  public_id       text unique,                       -- PROP-YYYY-0001
  opportunity_id  uuid not null references public.crm_opportunities(id) on delete cascade,
  quote_id        uuid references public.crm_quotes(id) on delete set null,
  tipo            public.crm_proposal_t not null,
  version         int not null default 1,
  status          public.crm_proposal_status_t not null default 'borrador',
  pdf_document_id uuid references public.documents(id),
  sent_at         timestamptz,
  viewed_at       timestamptz,
  payload         jsonb,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  deleted_at      timestamptz,
  unique (opportunity_id, tipo, version)
);
create index if not exists crm_proposals_opp_idx on public.crm_proposals (opportunity_id);

-- =========================================================================
-- public_id triggers
-- =========================================================================
create or replace function public.set_crm_quote_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.created_at, now()), 'YYYY');
    new.public_id := 'COT-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_crm_quote_public_id on public.crm_quotes;
create trigger trg_set_crm_quote_public_id
  before insert on public.crm_quotes
  for each row execute function public.set_crm_quote_public_id();

create or replace function public.set_crm_proposal_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.created_at, now()), 'YYYY');
    new.public_id := 'PROP-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_crm_proposal_public_id on public.crm_proposals;
create trigger trg_set_crm_proposal_public_id
  before insert on public.crm_proposals
  for each row execute function public.set_crm_proposal_public_id();

-- ---- updated_at ---------------------------------------------------------
drop trigger if exists trg_crm_quotes_touch on public.crm_quotes;
create trigger trg_crm_quotes_touch before update on public.crm_quotes
  for each row execute function public.tg_touch_updated_at();
drop trigger if exists trg_crm_proposals_touch on public.crm_proposals;
create trigger trg_crm_proposals_touch before update on public.crm_proposals
  for each row execute function public.tg_touch_updated_at();

-- =========================================================================
-- RLS
-- =========================================================================
alter table public.crm_quotes      enable row level security;
alter table public.crm_quote_items enable row level security;
alter table public.crm_proposals   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['crm_quotes','crm_quote_items','crm_proposals'] loop
    execute format('drop policy if exists "%s read" on public.%I', t, t);
    execute format('create policy "%s read" on public.%I for select using (public.has_permission(''comercial.view''))', t, t);
    execute format('drop policy if exists "%s write" on public.%I', t, t);
    execute format('create policy "%s write" on public.%I for insert with check (public.has_permission(''comercial.edit''))', t, t);
    execute format('drop policy if exists "%s update" on public.%I', t, t);
    execute format('create policy "%s update" on public.%I for update using (public.has_permission(''comercial.edit'')) with check (public.has_permission(''comercial.edit''))', t, t);
    execute format('drop policy if exists "%s delete" on public.%I', t, t);
    execute format('create policy "%s delete" on public.%I for delete using (public.is_admin())', t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
