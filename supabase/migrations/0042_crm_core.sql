-- =========================================================================
-- 0042_crm_core.sql — CRM Comercial F2.1 · núcleo (leads + oportunidades)
--
-- ADDITIVE ONLY. ⚠️ Requiere 0041 (enums) + tablas existentes clients (0001),
-- depot_t (0004), helpers RLS current_role()/is_staff()/is_admin() (0005),
-- tg_touch_updated_at() (0004).
--
-- crm_opportunities es el EJE del módulo: lleva los campos de integración con el
-- Motor Corporativo de Capacidad (capacity_feasible, assigned_site, assigned_units,
-- committed_state). Ver docs/comercial/COMMERCIAL_F2_1_ARCHITECTURE.md §3/§5.
--
-- NO aplicar a Supabase PROD sin autorización. Rama de feature, sin deploy.
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Secuencias de short_id (IDs humanos) -------------------------------
create sequence if not exists public.crm_leads_short_id_seq start 1;
create sequence if not exists public.crm_opportunities_short_id_seq start 1;

-- ---- Tabla: crm_leads (espejo de Clientify) -----------------------------
create table if not exists public.crm_leads (
  id              uuid primary key default gen_random_uuid(),
  short_id        int  not null default nextval('public.crm_leads_short_id_seq'),
  public_id       text unique,                       -- LEAD-YYYY-0001
  clientify_id    text unique,                       -- idempotencia inbound
  source          text,                              -- 'google_ads' | 'web' | ...
  full_name       text,
  email           text,
  phone           text,
  cuit            text,
  company_name    text,
  status          public.crm_lead_status_t not null default 'nuevo',
  owner_id        uuid references auth.users(id) on delete set null,
  tags            text[] not null default '{}',
  raw             jsonb,                             -- payload Clientify (trazabilidad)
  opportunity_id  uuid,                              -- FK añadida tras crear oportunidades (ciclo)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  deleted_at      timestamptz
);
create index if not exists crm_leads_status_idx on public.crm_leads (status);
create index if not exists crm_leads_owner_idx  on public.crm_leads (owner_id);
create index if not exists crm_leads_cuit_idx   on public.crm_leads (cuit);

-- ---- Tabla: crm_opportunities (EJE) -------------------------------------
create table if not exists public.crm_opportunities (
  id                 uuid primary key default gen_random_uuid(),
  short_id           int  not null default nextval('public.crm_opportunities_short_id_seq'),
  public_id          text unique,                    -- OPP-YYYY-0001
  client_id          uuid references public.clients(id),
  cuit               text,
  lead_id            uuid references public.crm_leads(id) on delete set null,
  contacto           text,
  email              text,
  telefono           text,
  service_type       public.crm_service_t not null,
  m2                 numeric(12,2),
  deposito           public.depot_t,                 -- reutiliza enum existente
  estado             public.crm_stage_t not null default 'nuevo_lead',
  probabilidad       int not null default 0 check (probabilidad between 0 and 100),
  monto              numeric(14,2),
  currency           text not null default 'ARS',
  owner_id           uuid references auth.users(id) on delete set null,
  expected_close     date,
  actual_close       date,
  clientify_deal_id  text unique,                    -- espejo idempotente
  clientify_pipeline text,
  lost_reason        text,
  -- ── Integración Motor Corporativo de Capacidad (F2.1) ──────────────────
  capacity_feasible  boolean,                        -- resultado de findAvailability()
  assigned_site      text,                           -- 'PEDRO_LUJAN_3159' | 'MAGALDI_1765'
  assigned_units     jsonb,                          -- sectores/cubículos/islas reservados
  committed_state    public.crm_committed_state_t not null default 'none',
  -- ── Auditoría ──────────────────────────────────────────────────────────
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  deleted_at         timestamptz
);
create index if not exists crm_opp_estado_idx     on public.crm_opportunities (estado);
create index if not exists crm_opp_service_idx    on public.crm_opportunities (service_type);
create index if not exists crm_opp_owner_idx      on public.crm_opportunities (owner_id);
create index if not exists crm_opp_client_idx     on public.crm_opportunities (client_id);
create index if not exists crm_opp_committed_idx  on public.crm_opportunities (committed_state);

-- ---- FK circular: crm_leads.opportunity_id → crm_opportunities ----------
do $$ begin
  alter table public.crm_leads
    add constraint crm_leads_opportunity_fk
    foreign key (opportunity_id) references public.crm_opportunities(id) on delete set null;
exception when duplicate_object then null; end $$;

-- =========================================================================
-- public_id triggers (BEFORE INSERT) — patrón 0030
-- =========================================================================
create or replace function public.set_crm_lead_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.created_at, now()), 'YYYY');
    new.public_id := 'LEAD-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_crm_lead_public_id on public.crm_leads;
create trigger trg_set_crm_lead_public_id
  before insert on public.crm_leads
  for each row execute function public.set_crm_lead_public_id();

create or replace function public.set_crm_opportunity_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.created_at, now()), 'YYYY');
    new.public_id := 'OPP-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_crm_opportunity_public_id on public.crm_opportunities;
create trigger trg_set_crm_opportunity_public_id
  before insert on public.crm_opportunities
  for each row execute function public.set_crm_opportunity_public_id();

-- ---- updated_at triggers (reutiliza tg_touch_updated_at de 0004) ---------
drop trigger if exists trg_crm_leads_touch on public.crm_leads;
create trigger trg_crm_leads_touch
  before update on public.crm_leads
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists trg_crm_opp_touch on public.crm_opportunities;
create trigger trg_crm_opp_touch
  before update on public.crm_opportunities
  for each row execute function public.tg_touch_updated_at();

-- =========================================================================
-- RLS — patrón del repo: lectura staff, escritura comercial/staff, delete admin.
-- Soft-delete preferido (deleted_at); delete físico solo admin.
-- =========================================================================
alter table public.crm_leads         enable row level security;
alter table public.crm_opportunities enable row level security;

-- crm_leads
drop policy if exists "crm_leads read" on public.crm_leads;
create policy "crm_leads read" on public.crm_leads for select
  using (public.is_staff() or public.current_role() = 'comercial');

drop policy if exists "crm_leads write" on public.crm_leads;
create policy "crm_leads write" on public.crm_leads for insert
  with check (public.current_role() in ('admin','operaciones','supervisor','comercial'));

drop policy if exists "crm_leads update" on public.crm_leads;
create policy "crm_leads update" on public.crm_leads for update
  using (public.current_role() in ('admin','operaciones','supervisor','comercial'))
  with check (public.current_role() in ('admin','operaciones','supervisor','comercial'));

drop policy if exists "crm_leads delete" on public.crm_leads;
create policy "crm_leads delete" on public.crm_leads for delete
  using (public.is_admin());

-- crm_opportunities
drop policy if exists "crm_opp read" on public.crm_opportunities;
create policy "crm_opp read" on public.crm_opportunities for select
  using (public.is_staff() or public.current_role() = 'comercial');

drop policy if exists "crm_opp write" on public.crm_opportunities;
create policy "crm_opp write" on public.crm_opportunities for insert
  with check (public.current_role() in ('admin','operaciones','supervisor','comercial'));

drop policy if exists "crm_opp update" on public.crm_opportunities;
create policy "crm_opp update" on public.crm_opportunities for update
  using (public.current_role() in ('admin','operaciones','supervisor','comercial'))
  with check (public.current_role() in ('admin','operaciones','supervisor','comercial'));

drop policy if exists "crm_opp delete" on public.crm_opportunities;
create policy "crm_opp delete" on public.crm_opportunities for delete
  using (public.is_admin());

notify pgrst, 'reload schema';
