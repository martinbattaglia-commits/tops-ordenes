-- =========================================================================
-- 0082_cash_box_foundation — Tesorería › Caja Chica (espejo read-only Drive)
-- =========================================================================
-- Contexto: submódulo ESPEJO de la planilla Google Drive «Caja chica .xlsx»
-- (una solapa por ejercicio: 2026, 2027…). Un job diario (21:05 ART) hace
-- snapshot-replace transaccional por período. Nexus NUNCA escribe el Excel.
--
-- Decisiones (diseño aprobado):
--   · Tabla única + columna direction (acreditado | gasto).
--   · Snapshot-replace atómico por ejercicio vía RPC cash_box_replace_periodo.
--   · Categorías por reglas configurables (cash_box_category_rules), fallback 'Otros'.
--   · Saldo = celda Excel «SALDO» (en la planilla real es I3 = fórmula =C140-F140)
--     con FALLBACK Σ(acreditado)-Σ(gasto) + WARNING si la etiqueta no se encuentra.
--   · Multi-ejercicio (columna periodo).
--   · Histórico diario resumido en cash_box_snapshots.
--
-- 100% ADITIVA: no altera tablas/objetos existentes. Rollback en 0083.
-- Convenciones (auditadas pre-flight): id uuid default gen_random_uuid();
-- created_at/updated_at not null default now(); trigger public.tg_touch_updated_at()
-- (def. en 0005_fix_rls_recursion.sql:151); RLS con public.current_role();
-- enums idempotentes do $$ … duplicate_object … $$.
-- =========================================================================

-- ---- Enum dirección -----------------------------------------------------
do $$ begin
  create type public.cash_box_direction_t as enum ('acreditado','gasto');
exception when duplicate_object then null; end $$;

-- ---- (A) Movimientos espejados de la solapa de ejercicio ----------------
create table if not exists public.cash_box_transactions (
  id           uuid primary key default gen_random_uuid(),
  periodo      int  not null,                          -- año / solapa (2026, 2027…)
  direction    public.cash_box_direction_t not null,   -- acreditado | gasto
  tx_date      date,                                   -- fecha normalizada (null si inválida)
  tx_date_raw  text not null,                          -- "dd/mm" reconstruido (auditoría)
  concepto     text not null,                          -- ORIGEN (acreditado) o DESTINO (gasto)
  importe      numeric(14,2) not null check (importe >= 0),
  categoria    text,                                   -- inferida por reglas; null→'Otros' en vista
  source_row   int  not null,                          -- fila 1-based en la planilla
  row_hash     text not null,                          -- detección de cambios
  sync_run_id  uuid,                                   -- corrida que la insertó
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists cash_box_tx_periodo_idx   on public.cash_box_transactions (periodo, direction);
create index if not exists cash_box_tx_date_idx      on public.cash_box_transactions (tx_date);
create index if not exists cash_box_tx_categoria_idx on public.cash_box_transactions (periodo, categoria);

-- ---- (B) Reglas de categorización configurables -------------------------
create table if not exists public.cash_box_category_rules (
  id         uuid primary key default gen_random_uuid(),
  match_type text not null default 'contains' check (match_type in ('contains','regex','exact')),
  pattern    text not null,
  categoria  text not null,
  prioridad  int  not null default 100,               -- menor corre primero
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- (C) Bitácora de sync ----------------------------------------------
create table if not exists public.cash_box_sync_log (
  id            bigserial primary key,
  run_id        uuid not null unique default gen_random_uuid(),
  trigger       text not null check (trigger in ('cron','manual','api')),
  status        text not null check (status in ('running','completed','partial','error','skipped')),
  file_id       text,
  periodos      int[],                                 -- ejercicios procesados en la corrida
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   int,
  rows_parsed   int default 0,
  rows_inserted int default 0,
  rows_changed  int default 0,
  rows_removed  int default 0,
  saldo_excel   numeric(14,2),                         -- saldo del período primario (celda o fallback Σ)
  saldo_calc    numeric(14,2),                         -- Σ(acreditado) − Σ(gasto) del período primario
  saldo_delta   numeric(14,2),                         -- conciliación (saldo_excel − saldo_calc)
  warnings      int default 0,                         -- p.ej. etiqueta SALDO no encontrada → fallback Σ
  errors        int default 0,
  message       text,
  report        jsonb,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists cash_box_sync_started_idx on public.cash_box_sync_log (started_at desc);

-- ---- (D) Histórico resumido — 1 snapshot por día por ejercicio ----------
create table if not exists public.cash_box_snapshots (
  id               uuid primary key default gen_random_uuid(),
  periodo          int  not null,
  snapshot_date    date not null default current_date,
  sync_run_id      uuid,
  total_acreditado numeric(14,2) not null default 0,
  total_gasto      numeric(14,2) not null default 0,
  saldo_excel      numeric(14,2),                      -- celda «SALDO» o fallback Σ
  saldo_calc       numeric(14,2),                      -- Σ(acreditado) - Σ(gasto)
  saldo_delta      numeric(14,2),                      -- conciliación (saldo_excel - saldo_calc)
  saldo_source     text check (saldo_source in ('label','calc_fallback')),  -- origen del saldo_excel
  movimientos      int not null default 0,
  por_categoria    jsonb,                              -- {categoria: total_gasto}
  created_at       timestamptz not null default now(),
  unique (periodo, snapshot_date)                      -- upsert: última corrida del día gana
);
create index if not exists cash_box_snap_idx on public.cash_box_snapshots (periodo, snapshot_date desc);

-- ---- Triggers updated_at (usa public.tg_touch_updated_at() de 0005) ------
drop trigger if exists trg_cash_box_tx_touch on public.cash_box_transactions;
create trigger trg_cash_box_tx_touch
  before update on public.cash_box_transactions
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists trg_cash_box_rules_touch on public.cash_box_category_rules;
create trigger trg_cash_box_rules_touch
  before update on public.cash_box_category_rules
  for each row execute function public.tg_touch_updated_at();

-- ---- (E) Snapshot-replace ATÓMICO por ejercicio (DELETE+INSERT) ---------
-- security definer + search_path fijo (mismo criterio que tg_touch_updated_at).
-- EXECUTE restringido a service_role (lo llama el job con createAdminClient).
-- IMPORTANTE: hay que revocar de public Y de anon/authenticated, porque Supabase
-- otorga EXECUTE a esos roles vía default privileges (revoke from public no alcanza).
create or replace function public.cash_box_replace_periodo(p_periodo int, p_rows jsonb, p_run_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count int;
begin
  delete from public.cash_box_transactions where periodo = p_periodo;
  insert into public.cash_box_transactions
    (periodo, direction, tx_date, tx_date_raw, concepto, importe, categoria, source_row, row_hash, sync_run_id)
  select p_periodo,
         (r->>'direction')::public.cash_box_direction_t,
         nullif(r->>'tx_date','')::date,
         r->>'tx_date_raw',
         r->>'concepto',
         (r->>'importe')::numeric,
         nullif(r->>'categoria',''),
         (r->>'source_row')::int,
         r->>'row_hash',
         p_run_id
  from jsonb_array_elements(p_rows) as r;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.cash_box_replace_periodo(int, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.cash_box_replace_periodo(int, jsonb, uuid) to service_role;

-- ---- (F) Vistas de lectura ---------------------------------------------
-- security_invoker=true: la vista respeta RLS/permisos del usuario que consulta
-- (sin esto Supabase las marca como SECURITY DEFINER VIEW — advisor nivel ERROR).
create or replace view public.v_cash_box_movimientos
  with (security_invoker = true) as
  select id, periodo, direction, tx_date, tx_date_raw, concepto, importe,
         coalesce(categoria, 'Otros') as categoria, source_row, sync_run_id
  from public.cash_box_transactions;

create or replace view public.v_cash_box_resumen
  with (security_invoker = true) as
  with agg as (
    select periodo,
           coalesce(sum(importe) filter (where direction = 'acreditado'), 0) as total_acreditado,
           coalesce(sum(importe) filter (where direction = 'gasto'), 0)      as total_gasto,
           count(*) as movimientos
    from public.cash_box_transactions
    group by periodo),
  ult as (
    select distinct on (periodo)
           periodo, saldo_excel, saldo_delta, saldo_source, snapshot_date
    from public.cash_box_snapshots
    order by periodo, snapshot_date desc)
  select a.periodo,
         a.total_acreditado, a.total_gasto, a.movimientos,
         (a.total_acreditado - a.total_gasto) as saldo_calculado,
         u.saldo_excel, u.saldo_delta, u.saldo_source, u.snapshot_date as ultimo_snapshot
  from agg a
  left join ult u using (periodo);

-- ---- RLS ----------------------------------------------------------------
-- Lectura: cualquier autenticado (datos de staff). Escritura: roles tesorería.
-- El job escribe con service-role → bypassa RLS de todos modos.
--
-- ⚠️ TEMPORAL — REVISAR EN AUDITORÍA DE SEGURIDAD FINANCIERA:
-- la política de lectura `for select to authenticated using (true)` deja la
-- Caja Chica visible a CUALQUIER usuario autenticado. Es una decisión TEMPORAL
-- (alineada al patrón actual de compliance_items). Debe revisarse en una futura
-- auditoría de seguridad financiera para restringir la lectura a roles de finanzas.
alter table public.cash_box_transactions   enable row level security;
alter table public.cash_box_category_rules enable row level security;
alter table public.cash_box_sync_log        enable row level security;
alter table public.cash_box_snapshots       enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'cash_box_transactions','cash_box_category_rules','cash_box_sync_log','cash_box_snapshots'
  ] loop
    execute format('drop policy if exists "%1$s read" on public.%1$s', t);
    execute format($f$
      create policy "%1$s read" on public.%1$s
        for select to authenticated using (true);
    $f$, t);
    execute format('drop policy if exists "%1$s write" on public.%1$s', t);
    execute format($f$
      create policy "%1$s write" on public.%1$s
        for all to authenticated
        using (public.current_role() in ('admin','supervisor','operaciones'))
        with check (public.current_role() in ('admin','supervisor','operaciones'));
    $f$, t);
  end loop;
end $$;

-- ---- Seed de reglas de categoría (idempotente: solo si la tabla está vacía) ----
insert into public.cash_box_category_rules (pattern, categoria, prioridad)
select v.pattern, v.categoria, v.prioridad
from (values
  ('nafta','Combustible',10),('combustible','Combustible',10),('gnc','Combustible',10),('peaje','Peajes',10),
  ('recolector de residuos','Servicios',20),('agua','Servicios',20),('edesur','Servicios',20),('luz','Servicios',20),
  ('cerrajeria','Mantenimiento',20),('cerradura','Mantenimiento',20),('repuesto','Mantenimiento',25),
  ('manifold','Mantenimiento',25),('luminaria','Mantenimiento',25),('electrocity','Mantenimiento',25),
  ('materiales electrico','Mantenimiento',25),('puerta','Mantenimiento',25),
  ('almuerzo','Comida',30),('desayuno','Comida',30),('gaseosa','Comida',30),('coca cola','Comida',30),
  ('panaderia','Comida',30),('leche','Comida',30),('cafe','Comida',30),('supermercado','Insumos',40),
  ('limpieza','Insumos',40),('led','Insumos',40),('disco solido','Insumos',40),('copiado','Insumos',40),
  ('anticipo','Anticipos',50),('a rendir','Anticipos',50),('reintegro','Anticipos',50),
  ('venta de','Cambio USD',60),('orden de extracci','Cambio USD',60),
  ('pago de prestamo','Préstamos',70),('pago de ruth','Préstamos',70),('pago de ivan','Préstamos',70),
  ('pago de manu','Préstamos',70),('divanlito','Proveedores',75),('wintrade','Proveedores',75),
  ('formia','Proveedores',75),('quartier','Proveedores',75),('veliz','Proveedores',75),
  ('diferencia','Diferencias',80),('redondeo','Diferencias',80)
) as v(pattern, categoria, prioridad)
where not exists (select 1 from public.cash_box_category_rules);

notify pgrst, 'reload schema';
