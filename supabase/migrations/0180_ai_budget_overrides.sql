-- 0180_ai_budget_overrides.sql — F5 · Override de límite diario del Copilot por usuario.
-- ─────────────────────────────────────────────────────────────────────────
-- Motivación: el límite diario del Copilot (env AI_DAILY_LIMIT / default 40) es un
--   ÚNICO valor global para TODO piloto. Las cuentas superadmin de Dirección
--   (Martín Battaglia: martin@ y martin.battaglia@) se agotaban igual que un piloto
--   común durante desarrollo/pruebas. Esta tabla habilita un límite diario POR
--   USUARIO — auditable, expirable y reversible — SIN abrir el límite a todos,
--   SIN tocar el tope mensual global (ai_monthly_spend / AI_MONTHLY_BUDGET_USD),
--   la auditoría (ai_messages), el kill-switch (AI_ENABLED), el provider gate
--   ni la RLS de datos de negocio.
-- Contenido:
--   1. Tabla public.ai_budget_overrides (1 fila por usuario; daily_limit ∈ [1,100000]).
--   2. RLS: SOLO admin (is_admin()) lee y escribe. Los usuarios comunes NO leen la
--      tabla directo — su límite se resuelve por la función DEFINER de abajo.
--   3. public.ai_daily_limit_for(p_default): devuelve el límite del usuario ACTUAL
--      (auth.uid()) → override vigente y positivo si existe, si no el default.
--      Fail-closed (sin sesión / sin override → default).
-- DEPENDE de: 0009 (is_admin()), 0174 (módulo AI / ai_messages).
-- Consume esta migración: src/lib/ai/budget.ts (checkBudget llama a ai_daily_limit_for).
--   El código es fail-closed: si la RPC no existe/falla, usa el default (40) → el
--   orden de aplicación (migración vs deploy) es indistinto (ambos degradan seguro).
-- Seed superadmin (300/día para las 2 cuentas de Martín): archivo SEPARADO y
--   MANUAL en supabase/seed/MANUAL_ai_budget_overrides_superadmin.sql (NO se
--   aplica en esta migración). Validación read-only en supabase/tests/.
-- Rollback: ROLLBACK_0180_ai_budget_overrides.md.
-- IDEMPOTENTE. Sin datos. Sin cambios sobre tablas existentes.
-- ─────────────────────────────────────────────────────────────────────────

-- ═════════════════════════ 1. TABLA ═════════════════════════
create table if not exists public.ai_budget_overrides (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  daily_limit integer     not null,
  expires_at  timestamptz,                 -- null = sin vencimiento
  note        text,
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Rango de dominio: > 0 (obligatorio) y techo defensivo contra fat-finger /
  -- overflow (el tope mensual global en USD es el bound real de gasto).
  constraint ai_budget_overrides_daily_limit_ck check (daily_limit between 1 and 100000)
);

-- updated_at automático (patrón per-tabla del repo: 0004/0005/0011).
create or replace function public.ai_budget_overrides_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_budget_overrides_touch on public.ai_budget_overrides;
create trigger ai_budget_overrides_touch
  before update on public.ai_budget_overrides
  for each row execute function public.ai_budget_overrides_touch_updated_at();

-- ═════════════════════════ 2. RLS (solo admin) ═════════════════════════
-- SELECT/INSERT/UPDATE/DELETE: exclusivamente admin (is_admin() = profiles.role
-- ='admin', autoritativo). Un piloto común NO puede leer la tabla ni ver el
-- override de terceros; obtiene SU límite únicamente vía ai_daily_limit_for().
alter table public.ai_budget_overrides enable row level security;

drop policy if exists ai_budget_overrides_admin_all on public.ai_budget_overrides;
create policy ai_budget_overrides_admin_all on public.ai_budget_overrides
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.ai_budget_overrides from anon;
grant select, insert, update, delete on public.ai_budget_overrides to authenticated;

-- ═══════════════ 3. RESOLUCIÓN DE LÍMITE (SECURITY DEFINER) ═══════════════
-- Devuelve el límite diario del usuario ACTUAL: override vigente (no vencido,
-- positivo) si existe; si no, el default recibido (acotado a >= 1). DEFINER para
-- que un piloto lea SU límite sin poder leer la tabla ni el de terceros.
-- Fail-closed: sin sesión (auth.uid() null) o sin override → default.
create or replace function public.ai_daily_limit_for(p_default integer default 40)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select o.daily_limit
       from public.ai_budget_overrides o
      where o.user_id = auth.uid()
        and o.daily_limit > 0
        and (o.expires_at is null or o.expires_at > now())
      limit 1),
    greatest(coalesce(p_default, 40), 1)
  )
$$;

revoke all on function public.ai_daily_limit_for(integer) from public, anon;
grant execute on function public.ai_daily_limit_for(integer) to authenticated;
