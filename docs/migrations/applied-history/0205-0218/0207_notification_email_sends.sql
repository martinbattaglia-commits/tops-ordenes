-- 0207_notification_email_sends.sql — LINK-NOTIFY-001 · F1 EMAIL MVP (aditiva pura).
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

alter table public.notification_email_sends enable row level security;
revoke all on table public.notification_email_sends from public, anon, authenticated;
grant all on table public.notification_email_sends to service_role;
