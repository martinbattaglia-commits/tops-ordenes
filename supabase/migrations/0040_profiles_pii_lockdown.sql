-- =========================================================================
-- 0040_profiles_pii_lockdown.sql — GATE 5.5: cierra F-01-R (PII de usuarios).
--
-- PROBLEMA (auditoría de seguridad, SECURITY_HARDENING_AUDIT.md §F-01-R):
--   La policy SELECT de `public.profiles` (definida en 0005) es:
--       using (id = auth.uid() OR public.is_staff())
--   e `is_staff()` = role IN ('admin','operaciones','supervisor'). Por lo tanto
--   CUALQUIER usuario staff (no solo admin) puede leer TODA la tabla profiles
--   (emails, nombres, roles de todos) consultando PostgREST directo
--   (GET /rest/v1/profiles?select=email,role) aunque la UI lo bloquee.
--   → Exposición de PII a non-admin.
--
-- FIX:
--   SELECT de profiles → solo la PROPIA fila o admin:
--       using (id = auth.uid() OR public.is_admin())
--   INSERT/UPDATE/DELETE ya eran own-or-admin / admin-only (0005) → sin cambios.
--
-- USOS REVISADOS (no rompen — todas las lecturas cross-usuario son admin-gated):
--   · settings/users/page.tsx  (lista todos)        → página admin-gated.
--   · rbac/data.ts listUserAssignments (join profiles) → /settings/roles admin-gated (Gate 5.5).
--   · fiscal/*, users/* (lectura del PROPIO rol)     → id = auth.uid(), sigue permitido.
--   · current_role()/is_admin()/is_staff() (SECURITY DEFINER) → bypassan RLS, intactos.
--   Si en el futuro un flujo NON-admin necesita mostrar nombres de otros usuarios,
--   usar una VISTA `profiles_public(id, full_name)` SIN email (no exponer PII).
--
-- Re-ejecutable (drop/create idempotente). ADDITIVE: no toca datos ni otras tablas.
-- ⚠️ NO aplicada por el asistente. La aplica Martín a mano en el SQL Editor de Supabase,
--    con backup previo (PROD compartida, PITR off). Verificación abajo.
-- =========================================================================

drop policy if exists "profiles read own or staff" on public.profiles;
drop policy if exists "profiles read own or admin" on public.profiles;

create policy "profiles read own or admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

notify pgrst, 'reload schema';

-- =========================================================================
-- VERIFICACIÓN (correr como un usuario NO admin, p.ej. operaciones):
--   select count(*) from public.profiles;        -- debe devolver 1 (solo su fila)
--   select email from public.profiles;           -- solo su propio email
-- Como admin:
--   select count(*) from public.profiles;        -- todas las filas
-- ROLLBACK (si hiciera falta restaurar el comportamiento previo):
--   drop policy if exists "profiles read own or admin" on public.profiles;
--   create policy "profiles read own or staff" on public.profiles for select
--     using (id = auth.uid() or public.is_staff());
-- =========================================================================
