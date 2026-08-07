-- 0208_wa_identities.sql — LINK-WA-002 · Fase 1a (aditiva pura).
create table if not exists public.wa_identities (
  phone_e164   text primary key,
  display_name text not null,
  entity_type  text check (entity_type in ('cliente','proveedor','contacto','interno')),
  entity_id    uuid,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.wa_identities enable row level security;
revoke all on table public.wa_identities from public, anon, authenticated;
grant all on table public.wa_identities to service_role;
