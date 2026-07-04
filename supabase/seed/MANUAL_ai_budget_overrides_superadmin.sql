-- MANUAL_ai_budget_overrides_superadmin.sql — override superadmin 300/día (Dirección).
-- ⚠️ SEED MANUAL — NO ES UNA MIGRACIÓN. NO auto-apply. Vive FUERA de
--    supabase/migrations/ (en supabase/seed/) a propósito, para que ninguna
--    ventana lo aplique como si fuera migración productiva.
-- ─────────────────────────────────────────────────────────────────────────
-- NO forma parte de 0180 (que es solo esquema). Se aplica en la MISMA ventana,
-- DESPUÉS de 0180, con autorización explícita de Dirección. Idempotente
-- (on conflict). Resuelve user_id por email (no hardcodea uuids). Cubre las DOS
-- cuentas de Martín Battaglia (superadmin/Dirección/desarrollador Nexus).
-- Límite aprobado: superadmin = 300/día; pilotos comunes siguen en 40 (default).
-- ─────────────────────────────────────────────────────────────────────────

insert into public.ai_budget_overrides (user_id, daily_limit, note, created_by)
select u.id,
       300,
       'Superadmin Dirección — Martín Battaglia (F5 override; ambas cuentas)',
       u.id
from auth.users u
where lower(u.email) in ('martin@logisticatops.com', 'martin.battaglia@logisticatops.com')
on conflict (user_id) do update
  set daily_limit = excluded.daily_limit,
      note        = excluded.note,
      expires_at  = null,          -- reactiva si venía vencido
      updated_at  = now();

-- Verificación inmediata (esperado: 2 filas, daily_limit = 300, expires_at null):
-- select u.email, o.daily_limit, o.expires_at, o.updated_at
-- from public.ai_budget_overrides o
-- join auth.users u on u.id = o.user_id
-- where lower(u.email) in ('martin@logisticatops.com', 'martin.battaglia@logisticatops.com')
-- order by u.email;
