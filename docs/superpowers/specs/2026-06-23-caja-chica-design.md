# Spec — Tesorería › Caja Chica (espejo Google Drive + dashboard)

- **Fecha:** 2026-06-23
- **Estado:** Aprobado con ajustes (multi-ejercicio + `cash_box_snapshots`). Pendiente aprobación final pre-implementación.
- **Autor:** Martín Battaglia (presidente) + asistencia técnica.
- **Módulo:** Nexus › Tesorería › Caja Chica
- **Naturaleza:** Submódulo **espejo de solo-lectura** de una planilla de Google Drive. Nexus **nunca** escribe en el Excel. Todo el cambio es **aditivo** (tablas/rutas nuevas; cero `ALTER` sobre objetos existentes).

---

## 1. Objetivo

Replicar diariamente en Nexus la información de la planilla `Caja chica .xlsx` (Google Drive), **solo las solapas de ejercicio anual** (2026, 2027, …), manteniendo una copia estructurada en Supabase para tablero, conciliación de saldo y reporting. Frecuencia: **diaria a las 21:05 ART**.

## 2. Fuente de datos real (auditada)

| Campo | Valor |
|---|---|
| Título | `Caja chica .xlsx` (con espacios) |
| File ID | `1g2ZJ0IjQnElVE3NLKeQGw4Aeqpx_uQSf` |
| Carpeta (parentId) | `1j5z7-SX_zOiJLsU9NLBh5MtkX_bJT9Uf` |
| Dueño | `joseluis@logisticatops.com` (compartido con Martín) |
| MimeType | `...spreadsheetml.sheet` → **XLSX real** (se baja y se parsea con `exceljs`, no se exporta como Google-Sheet) |
| Tamaño | ~119 KB, 11 solapas |

### Estructura real de una solapa de ejercicio (ej. `2026`)
Libro mayor de **dos columnas independientes** (no transacciones pareadas):

```
 A        B         C        │  D       E          F        │  I
FECHA  ORIGEN   IMPORTE      │ FECHA  DESTINO    IMPORTE     │  SALDO (celda única)
──── ACREDITADOS (entra) ────┼──────── GASTOS (sale) ────────┼── $5.512.186,00
```

Hechos confirmados que condicionan el diseño:
- **No existen** columnas `Categoría`, `Usuario` ni `Número de comprobante`. Solo texto libre en `ORIGEN`/`DESTINO`.
- Los dos lados **no están alineados por fila** y tienen distinto largo. Son dos listas independientes.
- El **SALDO** es una **celda única** (col. I) mantenida a mano por el responsable.
- La primera fila de ACREDITADOS suele ser el **saldo de apertura** arrastrado del año anterior (ej. `Planilla del 2025`).
- Fechas en `dd/mm` (sin año; el año lo da la solapa), a veces **fuera de orden**. Importes con formato de moneda.

## 3. Decisiones de diseño (aprobadas)

1. **Modelo:** tabla única `cash_box_transactions` con discriminador `direction ∈ {acreditado, gasto}`; `concepto` = `ORIGEN` (acreditado) o `DESTINO` (gasto).
2. **Sincronización:** **snapshot-replace transaccional por ejercicio** (DELETE+INSERT atómico vía RPC), con guardas anti-borrado.
3. **Categorización:** tabla de reglas configurable `cash_box_category_rules` (keyword → categoría); fallback `Otros`.
4. **Saldo:** celda SALDO del Excel como principal **+** Σ(acreditado)−Σ(gasto) como control; se expone el **delta de conciliación**.
5. **Multi-ejercicio:** la columna `periodo` (int) sostiene N ejercicios. El job procesa una **lista configurable de períodos** (`CAJA_CHICA_PERIODOS`, default = año actual). Cada `periodo` se reemplaza de forma independiente (la solapa cuyo nombre == año).
6. **Histórico resumido:** tabla `cash_box_snapshots` con **un resumen por día por ejercicio** (totales, saldos, conciliación, mix por categoría) → alimenta “tendencia últimos 90 días” y el saldo histórico.

## 4. Esquema SQL — migración `0082_cash_box_foundation.sql` (aditiva)

> Convenciones reales del repo: `id uuid default gen_random_uuid()`, trigger `tg_touch_updated_at()` (definido en `0004`), RLS con `public.current_role()`, enums idempotentes `do $$ … duplicate_object … $$`, single-tenant (sin `org_id`). Logs en `bigserial`.

```sql
do $$ begin
  create type public.cash_box_direction_t as enum ('acreditado','gasto');
exception when duplicate_object then null; end $$;

-- (A) Movimientos espejados (multi-ejercicio por columna periodo)
create table if not exists public.cash_box_transactions (
  id           uuid primary key default gen_random_uuid(),
  periodo      int  not null,
  direction    public.cash_box_direction_t not null,
  tx_date      date,
  tx_date_raw  text not null,
  concepto     text not null,
  importe      numeric(14,2) not null check (importe >= 0),
  categoria    text,
  source_row   int  not null,
  row_hash     text not null,
  sync_run_id  uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);
create index if not exists cash_box_tx_periodo_idx   on public.cash_box_transactions (periodo, direction);
create index if not exists cash_box_tx_date_idx      on public.cash_box_transactions (tx_date);
create index if not exists cash_box_tx_categoria_idx on public.cash_box_transactions (periodo, categoria);

-- (B) Reglas de categorización configurables
create table if not exists public.cash_box_category_rules (
  id         uuid primary key default gen_random_uuid(),
  match_type text not null default 'contains' check (match_type in ('contains','regex','exact')),
  pattern    text not null,
  categoria  text not null,
  prioridad  int  not null default 100,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- (C) Bitácora de sync (espeja compliance_sync_log)
create table if not exists public.cash_box_sync_log (
  id            bigserial primary key,
  run_id        uuid not null unique default gen_random_uuid(),
  trigger       text not null check (trigger in ('cron','manual','api')),
  status        text not null check (status in ('running','completed','partial','error','skipped')),
  file_id       text,
  periodos      int[] ,                 -- ejercicios procesados en la corrida
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   int,
  rows_parsed   int default 0,
  rows_inserted int default 0,
  rows_changed  int default 0,
  rows_removed  int default 0,
  errors        int default 0,
  message       text,
  report        jsonb,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists cash_box_sync_started_idx on public.cash_box_sync_log (started_at desc);

-- (D) Histórico resumido — 1 snapshot por día por ejercicio (AJUSTE 2)
create table if not exists public.cash_box_snapshots (
  id               uuid primary key default gen_random_uuid(),
  periodo          int  not null,
  snapshot_date    date not null default current_date,
  sync_run_id      uuid,
  total_acreditado numeric(14,2) not null default 0,
  total_gasto      numeric(14,2) not null default 0,
  saldo_excel      numeric(14,2),
  saldo_calc       numeric(14,2),
  saldo_delta      numeric(14,2),
  movimientos      int not null default 0,
  por_categoria    jsonb,            -- {categoria: total_gasto} para tendencia/mix histórico
  created_at       timestamptz not null default now(),
  unique (periodo, snapshot_date)    -- upsert: 1 fila por día por ejercicio (última corrida del día gana)
);
create index if not exists cash_box_snap_idx on public.cash_box_snapshots (periodo, snapshot_date desc);

-- triggers updated_at
create trigger cash_box_tx_touch    before update on public.cash_box_transactions   for each row execute function public.tg_touch_updated_at();
create trigger cash_box_rules_touch before update on public.cash_box_category_rules for each row execute function public.tg_touch_updated_at();

-- (E) Snapshot-replace ATÓMICO por ejercicio (DELETE+INSERT en una transacción)
create or replace function public.cash_box_replace_periodo(p_periodo int, p_rows jsonb, p_run_id uuid)
returns int language plpgsql security definer as $$
declare v_count int;
begin
  delete from public.cash_box_transactions where periodo = p_periodo;
  insert into public.cash_box_transactions
    (periodo, direction, tx_date, tx_date_raw, concepto, importe, categoria, source_row, row_hash, sync_run_id)
  select p_periodo,
         (r->>'direction')::public.cash_box_direction_t,
         nullif(r->>'tx_date','')::date, r->>'tx_date_raw', r->>'concepto',
         (r->>'importe')::numeric, r->>'categoria',
         (r->>'source_row')::int, r->>'row_hash', p_run_id
  from jsonb_array_elements(p_rows) r;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- (F) Vistas de lectura
create or replace view public.v_cash_box_movimientos as
  select id, periodo, direction, tx_date, tx_date_raw, concepto, importe,
         coalesce(categoria,'Otros') as categoria, source_row
  from public.cash_box_transactions;

create or replace view public.v_cash_box_resumen as
  with agg as (
    select periodo,
           sum(importe) filter (where direction='acreditado') as total_acreditado,
           sum(importe) filter (where direction='gasto')      as total_gasto,
           count(*) as movimientos
    from public.cash_box_transactions group by periodo),
  ult as (
    select distinct on (periodo) periodo, saldo_excel, saldo_delta, snapshot_date
    from public.cash_box_snapshots
    order by periodo, snapshot_date desc)
  select a.periodo, a.total_acreditado, a.total_gasto, a.movimientos,
         (a.total_acreditado - a.total_gasto) as saldo_calculado,
         u.saldo_excel, u.saldo_delta, u.snapshot_date as ultimo_snapshot
  from agg a left join ult u using (periodo);

-- RLS: lectura autenticado; escritura roles tesorería (el job usa service-role → bypassa RLS)
alter table public.cash_box_transactions   enable row level security;
alter table public.cash_box_category_rules enable row level security;
alter table public.cash_box_sync_log        enable row level security;
alter table public.cash_box_snapshots       enable row level security;
-- read:  for select to authenticated using (true)
-- write: for all to authenticated using/with check (public.current_role() in ('admin','supervisor','operaciones'))

-- seed reglas (extracto representativo; extensible por Tesorería)
insert into public.cash_box_category_rules (pattern, categoria, prioridad) values
 ('nafta','Combustible',10),('combustible','Combustible',10),('peaje','Peajes',10),
 ('recolector de residuos','Servicios',20),('cerrajeria','Mantenimiento',20),('cerradura','Mantenimiento',20),
 ('almuerzo','Comida',30),('desayuno','Comida',30),('gaseosa','Comida',30),('coca cola','Comida',30),
 ('supermercado','Insumos',40),('limpieza','Insumos',40),('led','Insumos',40),('materiales electrico','Mantenimiento',40),
 ('anticipo','Anticipos',50),('a rendir','Anticipos',50),('reintegro','Anticipos',50),
 ('venta de','Cambio USD',60),('orden de extracci','Cambio USD',60),
 ('pago de prestamo','Préstamos',70),('pago de ruth','Préstamos',70),('pago de ivan','Préstamos',70),
 ('diferencia','Diferencias',80)
on conflict do nothing;
```

**Rollback:** `0083_cash_box_rollback.sql` (listo, no aplicado): `drop view`/`function`/`table`/`type` en orden inverso.

## 5. Flujo de sincronización (snapshot-replace, multi-ejercicio)

Endpoint: `GET|POST /api/tesoreria/caja-chica/sync` (Bearer `CRON_SECRET`, soporta `?dry=1`). Engine: `src/lib/tesoreria/caja-chica/sync-engine.ts`.

1. **21:05 ART** GitHub Actions → `curl` con Bearer.
2. Auth ✓ → inserta `cash_box_sync_log` (`status='running'`, `periodos=<lista>`).
3. `drive.downloadFileBuffer(CAJA_CHICA_DRIVE_FILE_ID)` → Buffer (~119 KB; un solo archivo, **sin walk**).
4. `exceljs.load(buffer)`. **Por cada `periodo` de la lista:** ubicar worksheet cuyo nombre == `String(periodo)`. Si falta → registrar y **saltar ese período** (no borra).
5. **Parseo independiente** por solapa: cols A–C (acreditados) hasta fila vacía; cols D–F (gastos) hasta fila vacía. Leer celda **SALDO** (col I). Normalizar `dd/mm`+periodo→`date` (inválida→null, guardar raw), limpiar importe, calcular `row_hash = sha1(direction|periodo|source_row|tx_date_raw|concepto|importe)`.
6. Categorizar con `cash_box_category_rules` (orden por `prioridad`; fallback `Otros`).
7. **Guardas anti-desastre** (por período, umbrales configurables): aborta el replace de ese período si → solapa ausente · `rows_parsed == 0` · caída de filas `> 40%` vs. set actual · `> 5%` de importes no parseables. → `status='partial'` y conserva datos previos del período.
8. Diff vs. actual por `row_hash` → `inserted/changed/removed` para el reporte.
9. `rpc('cash_box_replace_periodo', {periodo, rows, run_id})` → **DELETE+INSERT atómico** de ese período.
10. **Upsert `cash_box_snapshots`** del día (por período): totales, `saldo_excel`, `saldo_calc`, `saldo_delta`, `movimientos`, `por_categoria`.
11. Cierra `cash_box_sync_log` (`status`, counts, `report` jsonb con eventos).
12. Responde JSON. `?dry=1` hace todo menos escribir (pasos 9–11).

## 6. UI — `/tesoreria/caja-chica` (Server Component)

- **Patrón de datos:** `src/lib/tesoreria/caja-chica/data.ts` con `createClient()` (anon + RLS); agregaciones desde vistas (nunca en TS).
- **Selector de ejercicio** (default = período con datos más reciente).
- **Banner de conciliación:** saldo planilla vs Σ Nexus + Δ (verde si Δ=0; ámbar si difiere).
- **KPIs:** Saldo Caja Chica (verde si >0, rojo si ≤0), Gastado mes, Gastado año, Movimientos. Última sync en el header.
- **Gráficos** (componentes SVG propios de Nexus, sin librería externa): barras “Evolución de gastos mensuales”, donut “Distribución por categorías”. Indicadores adicionales (Top-10 conceptos, promedio mensual, mayor/menor gasto, ranking por categoría, tendencia 90 días desde `cash_box_snapshots`).
- **Tabla operativa:** Fecha, Concepto, Categoría, Importe (signo + color), Saldo posterior (corriente derivado), Observaciones. Búsqueda, orden, filtros fecha/categoría, export CSV/Excel.
- **Navegación:** +1 ítem en `src/components/shell/Sidebar.tsx` (dominio `tesoreria`), gated por permisos `finanzas.*`.

## 7. Archivos

**Nuevos:** `supabase/migrations/0082_cash_box_foundation.sql`, `supabase/migrations/0083_cash_box_rollback.sql` (no aplicado), `src/lib/tesoreria/caja-chica/{types,parse,categorize,sync-engine,data}.ts`, `src/app/api/tesoreria/caja-chica/sync/route.ts`, `src/app/(app)/tesoreria/caja-chica/page.tsx`, `src/components/tesoreria/caja-chica/*`, `.github/workflows/caja-chica-drive-sync.yml`.
**Modificados (mínimos):** `src/components/shell/Sidebar.tsx`, `src/lib/env.ts` (+`CAJA_CHICA_DRIVE_FILE_ID`, `CAJA_CHICA_PERIODOS`), `.env.example`.

## 8. Performance

Job: 1 descarga 119 KB + parse ~200 filas/solapa (<300 ms), **sin walk** → sin el riesgo de 504 de Compliance/Contratos; holgado bajo el límite de Netlify (~26 s). DB: ~200 filas/período reemplazadas/noche + 1 snapshot/día. Dashboard: agregaciones sobre cientos de filas vía vistas, sin N+1. Cron a **21:05** para no solaparse con los dos jobs de Drive existentes (21:00). Impacto en módulos existentes: **nulo** (aditivo).

## 9. Rollback

Código en rama `feat/tesoreria-caja-chica` → `git revert` del PR; ítem de sidebar tras flag. DB 100% aditiva → `0083_cash_box_rollback.sql`. Validación previa en **branch efímero de Supabase** antes de prod (por el drift del registro). Cron desmontable al instante. Drive `readonly` → riesgo sobre la planilla = 0. Las guardas evitan wipe; una sync mala se auto-cura en la siguiente (es espejo).

## 10. Prerrequisitos / ítems abiertos

1. **Bloqueante:** compartir `Caja chica .xlsx` (o su carpeta) con el email del **service-account de Nexus**, o moverla bajo `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
2. Definir lista por defecto de `CAJA_CHICA_PERIODOS` (propuesta: `[año_actual]`; opción `[año_actual, año_actual-1]` para captar ediciones tardías del ejercicio previo).
3. Aprobación final del contador/Tesorería sobre el set de reglas de categoría semilla.
4. Aplicación de `0082` a prod: solo tras validar en branch efímero + OK explícito de Martín.

## 11. Fuera de alcance (YAGNI)

Escritura hacia el Excel; otras solapas (Visa Nati, Deudas, años previos a la lista); motor contable / asientos; multi-tenant (`org_id`); reservas/allocations.
