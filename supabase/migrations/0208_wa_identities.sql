-- 0208_wa_identities.sql — LINK-WA-002 · Fase 1a (WhatsApp Comercial Histórico).
-- Mapeo teléfono → entidad del ecosistema (cliente/proveedor/contacto/interno), con
-- confirmación humana. ADITIVA PURA: una tabla; no toca Connect, enums, RPCs ni RLS existentes.
-- La ingesta escribe vía service_role; los clientes NO tienen acceso directo (deny-all).

create table if not exists public.wa_identities (
  phone_e164   text primary key,                     -- +549…
  display_name text not null,                        -- cómo se muestra en hilos y bandeja
  entity_type  text check (entity_type in ('cliente','proveedor','contacto','interno')),
  entity_id    uuid,                                 -- FK lógica según entity_type (clients/vendors/profiles)
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Deny-all a clientes: RLS sin policies + revoke explícito (anon hereda de PUBLIC — P0-a).
alter table public.wa_identities enable row level security;
revoke all on table public.wa_identities from public, anon, authenticated;
grant all on table public.wa_identities to service_role;
