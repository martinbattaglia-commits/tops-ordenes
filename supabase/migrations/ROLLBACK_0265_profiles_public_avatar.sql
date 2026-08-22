-- ROLLBACK_0265_profiles_public_avatar.sql
-- Restaura public.profiles_public a la definición de 0046 (id, full_name).

create or replace view public.profiles_public as
  select id, full_name
    from public.profiles
   where coalesce(active, true) is true;

revoke all on public.profiles_public from public, anon;
grant select on public.profiles_public to authenticated, service_role;

notify pgrst, 'reload schema';
