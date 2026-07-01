-- 0158_connect_member_profile_search.sql — Nexus Link F3 · HOTFIX piloto (DEFECT-3).
-- ENTREGADA, NO APLICADA. Habilita el autocomplete de usuarios internos para agregar
-- miembros a canales/grupos (hoy la UI exige el profile_id UUID a mano — no usable).
-- ─────────────────────────────────────────────────────────────────────────
-- RPC mínima y segura `connect_search_profiles(q, limit_count)`:
--   · Gate: has_permission('connect.view') (fail-closed) — misma frontera que connect_search.
--   · Devuelve SOLO staff interno elegible: role in (admin/operaciones/supervisor)
--     (alineado con is_staff()), client_id IS NULL (excluye clientes/externos B2B), active.
--   · Match por nombre/apellido/email (ILIKE, `q` como bind param), límite acotado (1..25).
--   · SECURITY DEFINER (lee profiles cruzando RLS) + search_path explícito; grants: authenticated.
-- SEGURIDAD (revisión adversarial 2026-07-01): NO devuelve `email`. La mig 0040
--   (profiles_pii_lockdown) prohíbe exponer email cross-staff a roles no-admin, y por eso
--   `profiles_public` (0046) expone solo id+full_name. Esta RPC respeta ese lockdown:
--   permite BUSCAR por email en el WHERE (tipeás un email que ya conocés y encontrás a la
--   persona), pero SOLO devuelve id + full_name → no enumera emails ajenos. Escapa además
--   los comodines LIKE (\ % _) en `q` para evitar barridos con '%'/'_'.
-- Idempotente (CREATE OR REPLACE). Reversible (drop function / re-aplicar estado previo).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.connect_search_profiles(q text, limit_count int default 10)
returns table (profile_id uuid, full_name text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_lim int  := least(greatest(coalesce(limit_count, 10), 1), 25);
  v_q   text := btrim(coalesce(q, ''));
  v_pat text;
begin
  -- Gate fail-closed (misma frontera que el resto de Nexus Link).
  if not public.has_permission('connect.view') then
    raise exception 'Sin permiso connect.view' using errcode = 'insufficient_privilege';
  end if;
  -- Mínimo 2 chars para evitar barridos.
  if length(v_q) < 2 then
    return;
  end if;
  -- Escapa comodines LIKE (\ % _) → `q` no puede usarse como patrón (barrido con '%'/'_').
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select p.id,
         nullif(btrim(coalesce(p.full_name, '') || ' ' || coalesce(p.apellido, '')), '')
    from public.profiles p
   where coalesce(p.active, true)
     and p.client_id is null                                 -- excluye clientes/externos (B2B)
     and p.role in ('admin', 'operaciones', 'supervisor')    -- staff interno (alineado con is_staff())
     and ( p.full_name ilike v_pat escape '\'
        or p.apellido  ilike v_pat escape '\'
        or p.email     ilike v_pat escape '\' )              -- se puede BUSCAR por email; NO se devuelve (PII 0040)
   order by p.full_name asc nulls last, p.id
   limit v_lim;
end;
$$;
revoke all on function public.connect_search_profiles(text, int) from public, anon, authenticated;
grant execute on function public.connect_search_profiles(text, int) to authenticated;

notify pgrst, 'reload schema';
