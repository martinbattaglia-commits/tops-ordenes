-- =========================================================================
-- 0044_crm_contracts_onboarding.sql — CRM Comercial F2.1-2 · contratos + onboarding
--
-- ADDITIVE ONLY. ⚠️ Requiere 0041-0043 (enums, oportunidades, propuestas),
-- clients (0001), documents (0010), helpers RLS (0005), tg_touch_updated_at (0004).
-- Al ganar → contrato; al firmar → onboarding automático (checklist RNE/croquis/
-- plancheta/accesos/documentación). Ver ONBOARDING_AUTOMATION_DESIGN.
-- NO aplicar a Supabase PROD. Rama de feature, sin deploy.
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Enums --------------------------------------------------------------
do $$ begin
  create type public.crm_contract_status_t as enum
    ('borrador', 'enviado', 'firmado', 'vigente', 'vencido', 'rescindido');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_onboarding_status_t as enum
    ('pendiente', 'en_curso', 'bloqueado', 'completado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_onboarding_task_t as enum
    ('rne', 'croquis', 'plancheta', 'accesos', 'documentacion');
exception when duplicate_object then null; end $$;

-- ---- Secuencias ---------------------------------------------------------
create sequence if not exists public.crm_contracts_short_id_seq start 1;
create sequence if not exists public.crm_onboarding_short_id_seq start 1;

-- ---- Tabla: crm_contracts ----------------------------------------------
create table if not exists public.crm_contracts (
  id                    uuid primary key default gen_random_uuid(),
  short_id              int  not null default nextval('public.crm_contracts_short_id_seq'),
  public_id             text unique,                 -- CON-YYYY-0001
  opportunity_id        uuid not null references public.crm_opportunities(id) on delete cascade,
  client_id             uuid references public.clients(id),
  proposal_id           uuid references public.crm_proposals(id) on delete set null,
  version               int not null default 1,
  status                public.crm_contract_status_t not null default 'borrador',
  pdf_document_id       uuid references public.documents(id),
  signed_at             timestamptz,
  signed_by             text,
  signature_evidence_id uuid,                         -- patrón evidencia custodia (0038)
  valid_from            date,
  valid_until           date,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz,
  deleted_at            timestamptz
);
create index if not exists crm_contracts_opp_idx    on public.crm_contracts (opportunity_id);
create index if not exists crm_contracts_client_idx on public.crm_contracts (client_id);
create index if not exists crm_contracts_status_idx on public.crm_contracts (status);

-- ---- Tabla: crm_onboarding ---------------------------------------------
create table if not exists public.crm_onboarding (
  id              uuid primary key default gen_random_uuid(),
  short_id        int  not null default nextval('public.crm_onboarding_short_id_seq'),
  public_id       text unique,                       -- ONB-YYYY-0001
  opportunity_id  uuid not null references public.crm_opportunities(id) on delete cascade,
  client_id       uuid references public.clients(id),
  contract_id     uuid references public.crm_contracts(id) on delete set null,
  status          public.crm_onboarding_status_t not null default 'pendiente',
  progress_pct    int not null default 0 check (progress_pct between 0 and 100),
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
create index if not exists crm_onboarding_opp_idx    on public.crm_onboarding (opportunity_id);
create index if not exists crm_onboarding_status_idx on public.crm_onboarding (status);

-- ---- Tabla: crm_onboarding_tasks ---------------------------------------
create table if not exists public.crm_onboarding_tasks (
  id            uuid primary key default gen_random_uuid(),
  onboarding_id uuid not null references public.crm_onboarding(id) on delete cascade,
  tipo          public.crm_onboarding_task_t not null,
  titulo        text not null,
  status        text not null default 'pendiente',   -- pendiente|en_curso|completado|na
  document_id   uuid references public.documents(id),
  assignee_id   uuid references auth.users(id) on delete set null,
  due_date      date,
  completed_at  timestamptz,
  orden         int not null default 0
);
create index if not exists crm_onb_tasks_onb_idx on public.crm_onboarding_tasks (onboarding_id);

-- =========================================================================
-- public_id triggers
-- =========================================================================
create or replace function public.set_crm_contract_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.created_at, now()), 'YYYY');
    new.public_id := 'CON-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_crm_contract_public_id on public.crm_contracts;
create trigger trg_set_crm_contract_public_id
  before insert on public.crm_contracts
  for each row execute function public.set_crm_contract_public_id();

create or replace function public.set_crm_onboarding_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.created_at, now()), 'YYYY');
    new.public_id := 'ONB-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_crm_onboarding_public_id on public.crm_onboarding;
create trigger trg_set_crm_onboarding_public_id
  before insert on public.crm_onboarding
  for each row execute function public.set_crm_onboarding_public_id();

-- ---- updated_at ---------------------------------------------------------
drop trigger if exists trg_crm_contracts_touch on public.crm_contracts;
create trigger trg_crm_contracts_touch before update on public.crm_contracts
  for each row execute function public.tg_touch_updated_at();
drop trigger if exists trg_crm_onboarding_touch on public.crm_onboarding;
create trigger trg_crm_onboarding_touch before update on public.crm_onboarding
  for each row execute function public.tg_touch_updated_at();

-- =========================================================================
-- RLS
-- =========================================================================
alter table public.crm_contracts        enable row level security;
alter table public.crm_onboarding        enable row level security;
alter table public.crm_onboarding_tasks  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['crm_contracts','crm_onboarding','crm_onboarding_tasks'] loop
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
