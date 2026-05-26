-- =========================================================================
-- TOPS Órdenes — extensión productiva del schema
-- Agrega: notifications, attachments, columnas extra, índices, helpers RLS
-- Aplicar DESPUÉS de 0001/0002/0003.
-- =========================================================================

-- ---- profiles: separar apellido + teléfono ------------------------------
alter table public.profiles
  add column if not exists apellido text,
  add column if not exists telefono text,
  add column if not exists last_seen_at timestamptz;

-- ---- clients: depósito asignado por defecto -----------------------------
alter table public.clients
  add column if not exists deposito_asignado depot_t,
  add column if not exists activo boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

-- Trigger updated_at en clients
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_touch_updated_at on public.clients;
create trigger clients_touch_updated_at
  before update on public.clients
  for each row execute function public.tg_touch_updated_at();

-- ---- orders: updated_at + asignado --------------------------------------
alter table public.orders
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists asignado_a uuid references auth.users(id) on delete set null;

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.tg_touch_updated_at();

create index if not exists orders_updated_idx on public.orders(updated_at desc);
create index if not exists orders_asignado_idx on public.orders(asignado_a);

-- =========================================================================
-- Notifications (push interno + realtime)
-- =========================================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  -- null = broadcast a todos los roles internos
  role_target user_role_t,
  kind text not null,                  -- 'signed' | 'new' | 'observed' | 'info'
  title text not null,
  message text not null,
  entity text,                          -- 'orders' | 'clients' | ...
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_role_idx on public.notifications(role_target, created_at desc);
create index if not exists notifications_unread_idx on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;

create policy "notifications read own or role"
  on public.notifications for select
  using (
    user_id = auth.uid()
    or (role_target is not null and role_target = public.current_role())
    or public.current_role() = 'admin'
  );

create policy "notifications mark read own"
  on public.notifications for update
  using (user_id = auth.uid() or public.current_role() = 'admin')
  with check (user_id = auth.uid() or public.current_role() = 'admin');

create policy "notifications insert internal"
  on public.notifications for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- =========================================================================
-- Attachments (fotos/PDFs/remitos asociados a la orden)
-- =========================================================================
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  bucket text not null default 'attachments',
  path text not null,                   -- ruta dentro del bucket
  file_url text,                        -- public URL si bucket público
  file_name text,
  file_type text,
  file_size_bytes int,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index if not exists attachments_order_idx on public.attachments(order_id);
alter table public.attachments enable row level security;

create policy "attachments read same scope as orders"
  on public.attachments for select
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
    and (
      public.current_role() in ('admin','operaciones','supervisor')
      or o.client_id = (select client_id from public.profiles where id = auth.uid())
    )
  ));

create policy "attachments write internal"
  on public.attachments for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- =========================================================================
-- Helper: bump notification al crear/cambiar orden
-- =========================================================================
create or replace function public.tg_orders_notify()
returns trigger language plpgsql security definer as $$
declare
  client_razon text;
begin
  select razon into client_razon from public.clients where id = new.client_id;

  if (tg_op = 'INSERT') then
    insert into public.notifications (role_target, kind, title, message, entity, entity_id)
    values (
      'admin',
      'new',
      'Nueva orden creada',
      coalesce(new.public_id, '') || ' · ' || coalesce(client_razon, '—') || ' · ' || coalesce(new.depot::text, '—'),
      'orders',
      new.id
    );
  elsif (tg_op = 'UPDATE' and old.status is distinct from new.status) then
    insert into public.notifications (role_target, kind, title, message, entity, entity_id)
    values (
      'admin',
      case new.status
        when 'FIRMADA' then 'signed'
        when 'OBSERVADA' then 'observed'
        else 'info'
      end,
      'Orden ' || new.public_id || ' → ' || new.status::text,
      coalesce(client_razon, '—'),
      'orders',
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists tg_orders_notify_ins on public.orders;
create trigger tg_orders_notify_ins
  after insert on public.orders
  for each row execute function public.tg_orders_notify();

drop trigger if exists tg_orders_notify_upd on public.orders;
create trigger tg_orders_notify_upd
  after update on public.orders
  for each row execute function public.tg_orders_notify();

-- =========================================================================
-- Realtime publication
-- =========================================================================
-- Habilita realtime sobre las tablas que el frontend escucha.
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_services;
alter publication supabase_realtime add table public.notifications;

-- =========================================================================
-- Vista para KPIs del dashboard (rápida, indexada)
-- =========================================================================
create or replace view public.v_orders_dashboard as
select
  o.id, o.public_id, o.short_id, o.date, o.depot, o.status, o.total, o.hours,
  o.signed_by, o.signed_at, o.created_at,
  c.razon as client_razon, c.cuit as client_cuit, c.tags as client_tags,
  op.full_name as operator_name, op.avatar as operator_avatar
from public.orders o
left join public.clients c on c.id = o.client_id
left join public.operators op on op.id = o.operator_id;

grant select on public.v_orders_dashboard to authenticated;
