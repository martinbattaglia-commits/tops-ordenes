-- 0182 · AI Copilot · RPCs analíticas read-only (fix/f5-2, auditoría 2026-07-06)
-- ─────────────────────────────────────────────────────────────────────────────
-- CONTEXTO: preguntas AGREGADAS fallaban o respondían mal:
--   · "¿Cuánto se facturó el último mes?" → empty (no había agregado mensual).
--   · "¿Cuánta plata hay en el banco Santander?" → empty (treasury_bank_balances
--     EXISTE — view security_invoker con Santander/Galicia/Caja — sin tool).
--   · "¿Qué proveedor consume más presupuesto?" → devolvía CATÁLOGO de
--     proveedores (suppliers_overview) en vez de un ranking por monto.
-- DETERMINISMO: la SUMA/SALDO/RANKING lo calcula SQL; el modelo solo narra y cita.
--
-- SEGURIDAD (patrón INVOKER, igual que 0178/0181):
--   · SECURITY INVOKER → hereda RLS del caller. Verificado 2026-07-06:
--     - customer_invoices: SELECT admin/operaciones/supervisor (o cliente propio).
--     - treasury_bank_balances: VIEW security_invoker=true → RLS de bank_accounts/
--       treasury_movements (admin/operaciones/supervisor).
--     - supplier_invoices / purchase_orders / vendors: SELECT authenticated.
--   · Solo campos de negocio; texto libre por ai_docs_redact. Sin CUIT/contacto.
--   · Read-only puro (SQL, STABLE). Ninguna escritura.
--
-- CRITERIO DE NEGOCIO (documentado para la contadora/Dirección):
--   · "facturado" = customer_invoices AUTORIZADO_ARCA, sin anuladas, fecha =
--     coalesce(fecha_autorizacion_arca, created_at).
--   · "gasto" (proveedor) = supplier_invoices sin anuladas, por fecha_emision.
--   · "presupuesto comprometido" = purchase_orders sin anuladas/borrador, por date.
--   · "ultimo_mes" = mes calendario CERRADO anterior; si no tiene datos, cae al
--     último mes CON datos (el campo `periodo` lo transparenta — sin inventar).
--
-- IDEMPOTENTE: create or replace + revoke/grant repetibles. NO toca tablas ni datos.
-- APLICAR A MANO EN EL SQL EDITOR (G3) SOLO CON OK EXPLÍCITO. Rollback → md hermano.
-- ─────────────────────────────────────────────────────────────────────────────

-- =========================================================================
-- 1. ai_billing_summary — total facturado por período (agregado mensual)
--    modes: ultimo_mes (default, con fallback a último mes con datos) |
--           mes_actual | ultimos_meses (últimos p_meses meses con datos)
-- =========================================================================
create or replace function public.ai_billing_summary(
  p_mode  text default 'ultimo_mes',
  p_meses int  default 3
) returns table (
  periodo text, total numeric, cantidad int, desde date, hasta date, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with base as (
    select
      date_trunc('month', coalesce(ci.fecha_autorizacion_arca, ci.created_at))::date as mes,
      sum(ci.total) as total,
      count(*)::int as cantidad,
      min(coalesce(ci.fecha_autorizacion_arca, ci.created_at))::date as desde,
      max(coalesce(ci.fecha_autorizacion_arca, ci.created_at))::date as hasta
    from public.customer_invoices ci
    where coalesce(ci.anulada, false) = false
      and ci.estado_arca = 'AUTORIZADO_ARCA'
    group by 1
  ),
  target as (
    select * from base
    where case coalesce(nullif(btrim(p_mode), ''), 'ultimo_mes')
      when 'mes_actual' then mes = date_trunc('month', current_date)::date
      when 'ultimo_mes' then mes = (date_trunc('month', current_date) - interval '1 month')::date
      else true
    end
  ),
  elegido as (
    select * from target
    union all
    -- ultimo_mes sin datos → último mes CON datos (el `periodo` lo hace explícito).
    select * from (select * from base order by mes desc limit 1) f
    where coalesce(nullif(btrim(p_mode), ''), 'ultimo_mes') = 'ultimo_mes'
      and not exists (select 1 from target)
  )
  select
    to_char(e.mes, 'YYYY-MM') as periodo,
    e.total,
    e.cantidad,
    e.desde,
    e.hasta,
    'Facturación ' || to_char(e.mes, 'YYYY-MM')
      || ' · total ARS ' || to_char(e.total, 'FM999G999G999G990D00')
      || ' · ' || e.cantidad || ' facturas autorizadas'
      || ' · del ' || to_char(e.desde, 'YYYY-MM-DD') || ' al ' || to_char(e.hasta, 'YYYY-MM-DD')
      as detalle
  from elegido e
  order by e.mes desc
  limit case when coalesce(nullif(btrim(p_mode), ''), 'ultimo_mes') = 'ultimos_meses'
             then least(greatest(coalesce(p_meses, 3), 1), 12) else 1 end
$$;

revoke all on function public.ai_billing_summary(text, int) from public, anon;
grant execute on function public.ai_billing_summary(text, int) to authenticated;

-- =========================================================================
-- 2. ai_bank_balances_overview — saldos de bancos/caja (Tesorería)
--    Lee treasury_bank_balances (view security_invoker → RLS del caller).
-- =========================================================================
create or replace function public.ai_bank_balances_overview(
  p_query text default null,
  p_limit int  default 15
) returns table (
  bank_name text, account_name text, balance numeric, moneda text, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select
    b.bank_name,
    b.account_name,
    b.balance,
    coalesce(b.currency, 'ARS') as moneda,
    b.bank_name
      || case when nullif(btrim(b.account_name), '') is not null then ' · ' || b.account_name else '' end
      || ' · saldo ' || coalesce(b.currency, 'ARS') || ' ' || to_char(coalesce(b.balance, 0), 'FM999G999G999G990D00')
      || ' (saldo actual derivado de movimientos de Tesorería)'
      as detalle
  from public.treasury_bank_balances b
  where (
    p_query is null or btrim(p_query) = ''
    or b.bank_name    ilike '%' || btrim(p_query) || '%'
    or b.account_name ilike '%' || btrim(p_query) || '%'
  )
  order by b.balance desc nulls last
  limit least(greatest(coalesce(p_limit, 15), 1), 50)
$$;

revoke all on function public.ai_bank_balances_overview(text, int) from public, anon;
grant execute on function public.ai_bank_balances_overview(text, int) to authenticated;

-- =========================================================================
-- 3. ai_supplier_spend_overview — ranking de proveedores por monto agregado
--    base: gasto (supplier_invoices, sin anuladas) |
--          compromiso (purchase_orders sin anuladas/borrador = presupuesto)
--    periodo: todo | mes_actual | ultimo_mes | ultimos_30_dias
-- =========================================================================
create or replace function public.ai_supplier_spend_overview(
  p_base    text default 'gasto',
  p_periodo text default 'todo',
  p_limit   int  default 10
) returns table (
  proveedor text, total numeric, cantidad int, periodo text, base text, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with params as (
    select
      case when coalesce(nullif(btrim(p_base), ''), 'gasto') = 'compromiso'
           then 'compromiso' else 'gasto' end as base,
      coalesce(nullif(btrim(p_periodo), ''), 'todo') as periodo
  ),
  gasto as (
    select public.ai_docs_redact(coalesce(v.razon, 'Proveedor')) as proveedor,
           sum(si.total) as total, count(*)::int as cantidad
    from public.supplier_invoices si
    join public.vendors v on v.id = si.vendor_id
    cross join params p
    where p.base = 'gasto'
      and si.status::text is distinct from 'anulada'
      and case p.periodo
        when 'mes_actual' then date_trunc('month', si.fecha_emision) = date_trunc('month', current_date)
        when 'ultimo_mes' then date_trunc('month', si.fecha_emision) = date_trunc('month', current_date - interval '1 month')
        when 'ultimos_30_dias' then si.fecha_emision >= current_date - 30
        else true
      end
    group by 1
  ),
  compromiso as (
    select public.ai_docs_redact(coalesce(v.razon, 'Proveedor')) as proveedor,
           sum(po.total) as total, count(*)::int as cantidad
    from public.purchase_orders po
    join public.vendors v on v.id = po.vendor_id
    cross join params p
    where p.base = 'compromiso'
      and po.status::text not in ('anulada', 'borrador')
      and case p.periodo
        when 'mes_actual' then date_trunc('month', po.date) = date_trunc('month', current_date)
        when 'ultimo_mes' then date_trunc('month', po.date) = date_trunc('month', current_date - interval '1 month')
        when 'ultimos_30_dias' then po.date >= current_date - interval '30 days'
        else true
      end
    group by 1
  ),
  ranking as (
    select * from gasto
    union all
    select * from compromiso
  )
  select
    r.proveedor,
    r.total,
    r.cantidad,
    (select periodo from params) as periodo,
    (select base from params) as base,
    case when (select base from params) = 'compromiso'
         then 'Presupuesto comprometido (OC firmadas/activas)'
         else 'Gasto (facturas de proveedor)' end
      || ' · ' || r.proveedor
      || ' · ARS ' || to_char(coalesce(r.total, 0), 'FM999G999G999G990D00')
      || ' · ' || r.cantidad || case when (select base from params) = 'compromiso' then ' OC' else ' facturas' end
      || ' · período: ' || (select periodo from params)
      as detalle
  from ranking r
  order by r.total desc nulls last
  limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;

revoke all on function public.ai_supplier_spend_overview(text, text, int) from public, anon;
grant execute on function public.ai_supplier_spend_overview(text, text, int) to authenticated;
