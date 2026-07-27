-- 0207_notification_email_sends.sql — LINK-NOTIFY-001 · F1 EMAIL MVP.
-- Auditoría + idempotencia del consumidor de email del worker (resolución de Dirección 07-26).
-- ADITIVA PURA: una tabla nueva; no toca notifications, outbox, triggers ni RLS existentes.
--
-- Protocolo del consumidor (lección MAIL-OS: la auditoría vive en el MISMO circuito que envía):
--   claim  = INSERT ('claimed') con UNIQUE(notification_id) ⇒ imposible doble-envío aunque el
--            cron corra dos veces (quien inserta, envía).
--   luego  = UPDATE a 'sent' (con provider_id) o 'error' (con detalle).
--   F1 SIN auto-retry: una fila 'error' o un 'claimed' huérfano quedan visibles para
--   inspección manual — el aviso sigue vivo en la campana; se prefiere no duplicar.

create table if not exists public.notification_email_sends (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.notifications(id) on delete cascade,
  to_email        text not null,
  status          text not null default 'claimed' check (status in ('claimed','sent','error')),
  provider_id     text,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists notification_email_sends_created_idx
  on public.notification_email_sends (created_at);

-- Deny-all para clientes: sin policies + revoke explícito (anon hereda de PUBLIC — P0-a).
-- El worker opera con service_role (bypassa RLS).
alter table public.notification_email_sends enable row level security;
revoke all on table public.notification_email_sends from public, anon, authenticated;
grant all on table public.notification_email_sends to service_role;
