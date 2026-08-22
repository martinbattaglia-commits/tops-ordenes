-- 0265_profiles_public_avatar.sql — Nexus Link RC1.4 / P2 · Vista pública con avatar_url.
-- ESTADO: ENTREGADA, NO APLICADA (G3 / Gobernanza v2).
-- PENDIENTE DE DIRECCIÓN — AUTORIZACIÓN DE MIGRACIÓN/INFRAESTRUCTURA.
-- ─────────────────────────────────────────────────────────────────────────
-- OBJETIVO:
--   Extender public.profiles_public (0046) para incluir avatar_url
--   respetando el lockdown de PII de 0040 (sin exponer emails ni teléfonos).
-- ─────────────────────────────────────────────────────────────────────────

create or replace view public.profiles_public as
  select id, full_name, avatar_url
    from public.profiles
   where coalesce(active, true) is true;

revoke all on public.profiles_public from public, anon;
grant select on public.profiles_public to authenticated, service_role;

notify pgrst, 'reload schema';
