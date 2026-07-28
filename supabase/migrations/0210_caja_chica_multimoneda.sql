-- =========================================================================
-- 0210_caja_chica_multimoneda.sql — Caja Chica Multimoneda ARS/USD (CCN-002)
--
-- Expediente : EXPEDIENTE-CCN-002-CAJA-MULTIMONEDA / CCN-002_F1_Diagnostic_Implementation_Plan.md
-- Autoridad  : Dirección (Martín Battaglia). F2 autorizada 2026-07-28 (GO FASE 2).
--
-- NÚMERO 0210 VERIFICADO 2026-07-28 contra:
--   · repo canónico y TODOS los worktrees (máximo existente: 0209_connect_audio);
--   · tracker de prod `supabase_migrations.schema_migrations` (máximo: 0209).
-- ⚠️ Re-verificar el número al momento de aplicar (lección ERP-A2C: el tracker
--    no es confiable; manda el catálogo). No renumerar migraciones existentes.
--
-- LINAJE (documental, NO se modifica ese bloque acá):
--   Las migraciones de Caja Chica 0195–0199 NO están en el repositorio: viven en
--   ~/CODE/EXPEDIENTE-CAJA-CHICA-NATIVA/{F1_SQL,F2_SQL,F4_CORTE} y fueron
--   aplicadas A MANO en prod (tampoco figuran en el tracker):
--     0195 enums ('caja_chica' + acciones caja_*) · 0196 fundación
--     (cash_box_entries + RLS + permisos + guards + v_cash_box_libro) ·
--     0197 constraint type↔direction · 0198 RPCs caja_chica_* · 0199 congela
--     el espejo legacy de Sheets. Esta migración DEPENDE de las cinco.
--
-- QUÉ HACE (mínimo necesario para la segunda caja, Resolución D-1..D-5):
--   1) Invariante de unicidad: UNA caja activa por moneda (índice único parcial).
--   2) RPC de alta con moneda explícita `p_currency` (default 'ARS' SOLO por
--      compatibilidad de firma durante la ventana de deploy; la app la envía
--      siempre). Resuelve la cuenta por (account_type='caja', currency) y
--      re-valida moneda contra allowlist. Reemplaza el guard «solo ARS» de 0198.
--   3) v_cash_box_libro: expone `bank_account_id` y `currency` (columnas
--      APPENDEADAS al final — CREATE OR REPLACE VIEW lo exige; los consumidores
--      existentes no se rompen).
--   La RPC de anulación NO se toca: opera por movement_id sobre su propia
--   cuenta; conserva cuenta y moneda por construcción.
--
-- QUÉ NO HACE (prohibido por la Resolución):
--   · NO inserta la cuenta USD (data-op posterior, separado del deploy);
--   · NO carga saldos ni toca movimientos históricos;
--   · NO agrega `currency` a treasury_movements (la moneda es de la cuenta);
--   · NO agrega infraestructura FX ni cotizaciones.
--
-- ORDEN DE DESPLIEGUE OBLIGATORIO (compatibilidad en ambas direcciones):
--   0210 primero, deploy del código después, data-op USD al final.
--   · 0210 con código viejo: el viejo llama la RPC sin p_currency → default
--     'ARS' → comportamiento idéntico. La vista sólo ganó columnas.
--   · Código nuevo sin 0210: NO desplegar (la query .eq('currency') y el
--     parámetro p_currency no existirían). Por eso la migración va primero.
--
-- ⚠️ G3: NO aplicar automáticamente. Aplica Dirección (SQL Editor o MCP con
--    autorización expresa, Gate posterior). Idempotente y re-ejecutable.
-- =========================================================================

-- =========================================================================
-- 1. Invariante: UNA caja activa por moneda.
--    Sin esto, dos cajas ARS activas harían ambigua la resolución de cuenta
--    de la RPC (limit 1 silencioso — hallazgo B1/B7 del diagnóstico F1).
--    Parcial sobre active: una caja desactivada no bloquea su reemplazo.
-- =========================================================================
create unique index if not exists bank_accounts_caja_activa_por_moneda_uq
  on public.bank_accounts (account_type, currency)
  where account_type = 'caja' and active;

comment on index public.bank_accounts_caja_activa_por_moneda_uq is
  'CCN-002: a lo sumo una cuenta de Caja Chica ACTIVA por moneda. La resolución de cuenta de caja_chica_registrar_movimiento depende de esta unicidad.';

-- =========================================================================
-- 2. RPC de alta con moneda explícita.
--    Postgres trataría una firma distinta como OVERLOAD (la vieja de 6 args
--    seguiría viva y PostgREST no sabría a cuál llamar) ⇒ se DROPea la firma
--    0198 y se crea la nueva. El cuerpo espeja 0198 §1; cambia SOLO la
--    resolución de cuenta por moneda.
-- =========================================================================
drop function if exists public.caja_chica_registrar_movimiento(
  date, public.treasury_direction_t, numeric, text, uuid, text
);

create or replace function public.caja_chica_registrar_movimiento(
  p_date           date,
  p_direction      public.treasury_direction_t,   -- 'ingreso' | 'egreso'
  p_amount         numeric,
  p_concept        text,
  p_responsable_id uuid,
  p_observations   text default null,
  p_currency       text default 'ARS'             -- CCN-002: caja destino por moneda
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_caja  uuid;
  v_mov   uuid;
  v_pub   text;
  v_entry uuid;
begin
  -- guarda de inserción del motor: habilita alta de tipos <> 'ajuste' (scope tx)
  perform set_config('treasury.via_rpc', 'on', true);

  -- AUDITORÍA ANTES DE PERSISTIR: sin usuario autenticado no hay operación.
  if v_uid is null then
    raise exception 'NO_AUTH_CONTEXT: operación sin usuario autenticado' using errcode='42501';
  end if;

  -- fail-closed (patrón HOTFIX 0055: NULL ↓ FALSE)
  if not coalesce(public.has_permission('tesoreria.caja.create'), false) then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.caja.create' using errcode='42501';
  end if;

  -- CCN-002: allowlist de monedas habilitadas. Ni conversión ni equivalencias.
  if p_currency is null or p_currency not in ('ARS','USD') then
    raise exception 'CAJA_CURRENCY_INVALID: moneda % no habilitada (ARS|USD)', coalesce(p_currency,'NULL')
      using errcode='check_violation';
  end if;

  -- validaciones de dominio (idénticas a 0198)
  if p_concept is null or btrim(p_concept) = '' then
    raise exception 'CAJA_CONCEPT_REQUIRED: el concepto es obligatorio' using errcode='check_violation';
  end if;
  if p_direction is null then
    raise exception 'CAJA_DIRECTION_INVALID: dirección requerida (ingreso|egreso)' using errcode='check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT: el importe debe ser > 0' using errcode='check_violation';
  end if;
  if p_responsable_id is null then
    raise exception 'CAJA_RESPONSABLE_REQUIRED: el responsable es obligatorio' using errcode='check_violation';
  end if;
  if not exists (select 1 from public.profiles where id = p_responsable_id) then
    raise exception 'CAJA_RESPONSABLE_INVALID: responsable inexistente' using errcode='check_violation';
  end if;

  -- La RPC (y SOLO la RPC) resuelve la cuenta: caja de LA MONEDA pedida.
  -- Unicidad garantizada por bank_accounts_caja_activa_por_moneda_uq (§1):
  -- no hay limit 1 silencioso posible entre cajas de la misma moneda.
  select id into v_caja
    from public.bank_accounts
    where account_type = 'caja' and currency = p_currency and active;
  if v_caja is null then
    raise exception 'CAJA_CURRENCY_NOT_ENABLED: no hay cuenta de Caja Chica activa en % (habilitación = data-op de Dirección)', p_currency
      using errcode='check_violation';
  end if;

  -- persistencia atómica: movimiento (append-only, numerado por trigger) + detalle.
  -- El movimiento NO lleva moneda: la hereda de v_caja (única fuente de verdad).
  insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
       reference_type, status, created_by)
  values (coalesce(p_date, current_date), 'caja_chica', p_direction, v_caja, p_amount, btrim(p_concept),
       'manual', 'confirmado', v_uid)
  returning id, public_id into v_mov, v_pub;

  insert into public.cash_box_entries(movement_id, responsable_id, observaciones, created_by)
  values (v_mov, p_responsable_id, nullif(btrim(coalesce(p_observations,'')),''), v_uid)
  returning id into v_entry;

  return jsonb_build_object('movement_id', v_mov, 'public_id', v_pub, 'entry_id', v_entry, 'currency', p_currency);
end; $$;

grant execute on function public.caja_chica_registrar_movimiento(
  date, public.treasury_direction_t, numeric, text, uuid, text, text
) to authenticated;

-- =========================================================================
-- 3. v_cash_box_libro: moneda y cuenta visibles.
--    Columnas nuevas AL FINAL (regla de CREATE OR REPLACE VIEW). El resto del
--    cuerpo es idéntico a 0196 §5 (LEFT JOIN para no ocultar movimientos).
-- =========================================================================
create or replace view public.v_cash_box_libro
with (security_invoker = true) as
select
  m.id          as movement_id,
  m.public_id,
  m.date,
  m.direction,
  m.amount,
  m.description as concepto,
  m.status,
  m.voided_at,
  m.void_reason,
  m.created_at,
  m.created_by,
  e.id          as entry_id,
  e.responsable_id,
  pr.full_name  as responsable,
  e.observaciones,
  m.bank_account_id,                 -- CCN-002
  ba.currency                        -- CCN-002: moneda nativa (de la cuenta)
from public.treasury_movements m
left join public.cash_box_entries e on e.movement_id = m.id
left join public.profiles pr        on pr.id = e.responsable_id
left join public.bank_accounts ba   on ba.id = m.bank_account_id
where m.type = 'caja_chica'
order by m.date desc, m.created_at desc;

grant select on public.v_cash_box_libro to authenticated;

-- Refrescar el cache de esquema de PostgREST (igual que 0190/0198).
notify pgrst, 'reload schema';

-- Verificación read-only post-aplicación:
--   select indexname from pg_indexes where indexname='bank_accounts_caja_activa_por_moneda_uq';
--   select pg_get_function_identity_arguments('public.caja_chica_registrar_movimiento'::regproc);
--   -- esperado: ... p_observations text, p_currency text  (una sola firma)
--   select column_name from information_schema.columns
--    where table_name='v_cash_box_libro' and column_name in ('bank_account_id','currency');

-- FIN 0210.
