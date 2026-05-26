-- =========================================================================
-- TOPS Órdenes — Fix recursión RLS (PostgreSQL code 54001: stack depth limit)
--
-- Causa raíz:
--   `current_role()` hacía `select role from public.profiles where id = auth.uid()`
--   La policy de `public.profiles` definía:
--     "id = auth.uid() OR current_role() in ('admin','supervisor')"
--   → Al consultar profiles, RLS evaluaba la policy, que llamaba a
--     current_role(), que volvía a consultar profiles → recursión infinita.
--
-- Fix:
--   1. `current_role()` y dos helpers (`is_staff`, `is_admin`) se convierten
--      en SECURITY DEFINER → bypassean RLS al consultar profiles → corte
--      del ciclo.
--   2. Las policies de profiles se reescriben para usar `is_staff` /
--      `is_admin` (también SECURITY DEFINER, no recursivas).
--   3. Search_path se fija explícito (best practice 2025 contra schema
--      hijacking).
-- =========================================================================

-- ---------- 1. Helpers SECURITY DEFINER --------------------------------

create or replace function public.current_role()
returns public.user_role_t
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid()
$$;

revoke all on function public.current_role() from public;
grant execute on function public.current_role() to authenticated, anon, service_role;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role in ('admin', 'operaciones', 'supervisor')
     from public.profiles where id = auth.uid()),
    false
  )
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated, anon, service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  )
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon, service_role;

-- ---------- 2. Rebuild de policies de profiles (sin recursión) ---------

drop policy if exists "profiles self read" on public.profiles;
drop policy if exists "profiles admin write" on public.profiles;

create policy "profiles read own or staff"
  on public.profiles for select
  using (id = auth.uid() or public.is_staff());

create policy "profiles insert self or admin"
  on public.profiles for insert
  with check (id = auth.uid() or public.is_admin());

create policy "profiles update own or admin"
  on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy "profiles delete admin only"
  on public.profiles for delete
  using (public.is_admin());

-- ---------- 3. Asegurar SECURITY DEFINER en funciones que mutan ---------
-- (Estas ya eran SECURITY DEFINER en 0001/0004, las reaseguramos por idempotencia.)

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role_t, 'operaciones')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.tg_orders_notify()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
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

create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
