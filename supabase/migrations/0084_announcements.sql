-- =====================================================================
-- 0084_announcements.sql — Command Center: comunicados editables
-- El banner del Cockpit Ejecutivo pasa de lista hardcodeada a tabla editable
-- (Sistema › Comunicados). RBAC en app: sistema.view + isCurrentUserAdmin().
-- RLS write = current_role()='admin'. 100% aditivo (sin enums/roles/permisos).
-- Aplicado a prod: <registrar fecha al aplicar>
-- =====================================================================

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null default '',
  icon        text not null default 'megaphone'
                check (icon in ('megaphone','calendar','shield','users','bell','bolt','sparkle')),
  priority    text not null default 'medium'
                check (priority in ('low','medium','high','critical')),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

create index if not exists announcements_active_sort_idx
  on public.announcements (active, sort_order);

-- updated_at: reusa el trigger compartido (definido en 0005_fix_rls_recursion.sql)
drop trigger if exists trg_announcements_touch on public.announcements;
create trigger trg_announcements_touch
  before update on public.announcements
  for each row execute function public.tg_touch_updated_at();

-- RLS: lectura abierta a autenticados (el banner no es sensible);
-- escritura solo para admin legacy (profiles.role='admin' = Presidencia + Administración).
alter table public.announcements enable row level security;

drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements
  for select to authenticated using (true);

drop policy if exists "announcements write" on public.announcements;
create policy "announcements write" on public.announcements
  for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

grant select, insert, update, delete on public.announcements to authenticated;

-- Seed: solo si la tabla está vacía → migración re-ejecutable, sin duplicar.
do $$
begin
  if not exists (select 1 from public.announcements) then
    insert into public.announcements (title, description, icon, priority, sort_order) values
      ('¡Atención!',            'Actualización urgente del sistema',  'megaphone', 'critical', 0),
      ('Sábado 28/06',          '22:00 a 02:00 hs',                   'calendar',  'high',     1),
      ('Política de seguridad', 'Cambios de contraseña cada 60 días', 'shield',    'medium',   2),
      ('Reunión general',       'Viernes 27/06 · 09:00 hs',           'users',     'medium',   3);
  end if;
end $$;

notify pgrst, 'reload schema';
