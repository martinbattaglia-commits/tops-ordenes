-- 0214_ai_budget_alerts.sql — LINK-WA-002 · E1.1 · Guarda B (PRESUPUESTO).
-- ⚠️ PROPUESTA — requiere Gate SQL autorizado. ADITIVA PURA.
--
-- Alerta AUDITABLE al 70 % del presupuesto mensual de IA, SIN DUPLICADOS.
-- El bloqueo al 100 % ya existe (budget.checkMonthlyBudget); lo que faltaba era
-- el aviso temprano. La unicidad (period, threshold_pct) garantiza que la alerta
-- se emita UNA sola vez por mes y umbral, por más veces que se cruce el límite.
--
-- 🔑 Invariante del módulo AI: se escribe con la SESIÓN del usuario (cero
-- service_role en src/lib/ai) ⇒ policy de insert para authenticated; la lectura
-- de la auditoría queda restringida a administradores.

create table if not exists public.ai_budget_alerts (
  id            uuid primary key default gen_random_uuid(),
  period        text not null,                    -- 'YYYY-MM' del mes alertado
  threshold_pct int  not null check (threshold_pct between 1 and 100),
  spent_usd     numeric(10,4) not null,
  cap_usd       numeric(10,4) not null,
  provider      text not null,                    -- separación por provider…
  model         text,                             -- …y por modelo
  raised_by     uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  -- ANTI-DUPLICADO: una alerta por mes y umbral.
  unique (period, threshold_pct)
);

create index if not exists ai_budget_alerts_period_idx on public.ai_budget_alerts (period, created_at desc);

alter table public.ai_budget_alerts enable row level security;
revoke all on table public.ai_budget_alerts from public, anon;
grant select, insert on table public.ai_budget_alerts to authenticated;

-- Insert: cualquier autenticado puede dejar constancia de la alerta que disparó
-- su propia corrida (el UNIQUE evita el duplicado). Lectura: sólo admins.
drop policy if exists "ai_budget_alerts own insert" on public.ai_budget_alerts;
create policy "ai_budget_alerts own insert" on public.ai_budget_alerts
  for insert to authenticated
  with check (raised_by is null or raised_by = auth.uid());

drop policy if exists "ai_budget_alerts admin select" on public.ai_budget_alerts;
create policy "ai_budget_alerts admin select" on public.ai_budget_alerts
  for select to authenticated using (public.is_admin());
