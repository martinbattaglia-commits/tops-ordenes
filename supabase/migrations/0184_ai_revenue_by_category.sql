-- 0184 · AI Copilot · Ingresos por CATEGORÍA / unidad de negocio (estándar gerencial)
-- ─────────────────────────────────────────────────────────────────────────────
-- CONTEXTO (2026-07-07): "reporte por categoría de los ingresos del último mes,
-- % ANMAT vs % Cargas Generales" no tenía fuente conectada. Caso testigo de la
-- capa de REPORTES GERENCIALES: el cálculo (montos, %, conteos) es SQL; Gemini
-- solo redacta el reporte con estos números.
--
-- FUENTE DE CATEGORÍA (investigación read-only 2026-07-07, no asumida):
--   · customer_invoices / invoice_items / orders NO tienen categoría propia.
--   · clients.tags (text[]) SÍ: {ANMAT}, {CARGAS GENERALES}, {OFICINAS,...}.
--   · contracts.tipo (ANMAT | Cargas Generales) NO mapea hoy a los clientes de
--     facturación (0 matches por razón social) → documentado, no usado.
--   · invoice_items.descripcion contiene keywords ANMAT/regulado (5 ítems).
--
-- CRITERIO DETERMINÍSTICO Y AUDITABLE (prioridad):
--   1. cliente con tag 'ANMAT'            → ANMAT            (método: tags de cliente)
--   2. cliente con tag 'CARGAS GENERALES' → Cargas Generales (método: tags de cliente)
--   3. algún ítem de la factura con %anmat%/%regulad% → ANMAT (método: keyword en ítems)
--   4. resto → 'Sin clasificar' (SIEMPRE visible; brecha registrada, nunca se oculta
--      ni se inventa). Nada se filtra por nombre (clientes piloto computan normal).
--
-- Dry-run junio 2026 (validado): ANMAT 100.187.092,50 (79,4% · 9 fact) ·
-- Sin clasificar 21.668.075 (17,2% · 7) · Cargas Generales 4.374.150 (3,5% · 2);
-- suma EXACTA al total de ai_billing_summary (126.229.317,50). Chart-ready por
-- construcción (categoría + monto + porcentaje → torta/barras).
--
-- SEGURIDAD: SECURITY INVOKER (RLS del caller sobre customer_invoices/clients/
-- invoice_items). Sin PII (categorías = etiquetas fijas). Read-only puro (STABLE).
-- IDEMPOTENTE: create or replace + revoke/grant. NO toca tablas ni datos.
-- APLICAR A MANO EN EL SQL EDITOR (G3) SOLO CON OK EXPLÍCITO. Rollback → md hermano.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ai_revenue_by_category(
  p_periodo text default 'ultimo_mes',
  p_limit   int  default 10
) returns table (
  categoria text, monto numeric, porcentaje numeric, cantidad int,
  total_periodo numeric, periodo text, desde date, hasta date, metodo text, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with params as (
    select case coalesce(nullif(btrim(p_periodo), ''), 'ultimo_mes')
      when 'mes_actual' then 'mes_actual'
      when 'todo' then 'todo'
      else 'ultimo_mes' end as periodo
  ),
  fact as (
    select
      ci.total,
      coalesce(ci.fecha_autorizacion_arca, ci.created_at)::date as fecha,
      case
        when exists (select 1 from public.clients cl where cl.id = ci.client_id
                     and 'ANMAT' = any(cl.tags)) then 'ANMAT'
        when exists (select 1 from public.clients cl where cl.id = ci.client_id
                     and 'CARGAS GENERALES' = any(cl.tags)) then 'Cargas Generales'
        when exists (select 1 from public.invoice_items ii where ii.invoice_id = ci.id
                     and (ii.descripcion ilike '%anmat%' or ii.descripcion ilike '%regulad%'))
          then 'ANMAT'
        else 'Sin clasificar'
      end as categoria,
      case
        when exists (select 1 from public.clients cl where cl.id = ci.client_id
                     and ('ANMAT' = any(cl.tags) or 'CARGAS GENERALES' = any(cl.tags)))
          then 'tags de cliente'
        when exists (select 1 from public.invoice_items ii where ii.invoice_id = ci.id
                     and (ii.descripcion ilike '%anmat%' or ii.descripcion ilike '%regulad%'))
          then 'keyword en ítems'
        else 'sin tag ni keyword'
      end as metodo
    from public.customer_invoices ci
    cross join params p
    where coalesce(ci.anulada, false) = false
      and ci.estado_arca = 'AUTORIZADO_ARCA'
      and case p.periodo
        when 'mes_actual' then date_trunc('month', coalesce(ci.fecha_autorizacion_arca, ci.created_at))
                              = date_trunc('month', current_date)
        when 'ultimo_mes' then date_trunc('month', coalesce(ci.fecha_autorizacion_arca, ci.created_at))
                              = date_trunc('month', current_date - interval '1 month')
        else true
      end
  ),
  agg as (
    select f.categoria,
           sum(f.total) as monto,
           count(*)::int as cantidad,
           string_agg(distinct f.metodo, ' + ') as metodo,
           min(f.fecha) as desde,
           max(f.fecha) as hasta
    from fact f
    group by 1
  ),
  tot as (select coalesce(sum(a.monto), 0) as total from agg a)
  select
    a.categoria,
    a.monto,
    round(100.0 * a.monto / nullif(t.total, 0), 1) as porcentaje,
    a.cantidad,
    t.total as total_periodo,
    (select periodo from params) as periodo,
    a.desde,
    a.hasta,
    a.metodo,
    'Ingresos ' || a.categoria
      || ' · ARS ' || to_char(a.monto, 'FM999G999G999G990D00')
      || ' · ' || round(100.0 * a.monto / nullif(t.total, 0), 1) || '% del total ARS '
      || to_char(t.total, 'FM999G999G999G990D00')
      || ' · ' || a.cantidad || ' facturas'
      || ' · método: ' || a.metodo
      || ' · período: ' || (select periodo from params)
      || ' (' || to_char(a.desde, 'YYYY-MM-DD') || ' → ' || to_char(a.hasta, 'YYYY-MM-DD') || ')'
      as detalle
  from agg a cross join tot t
  order by a.monto desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;

revoke all on function public.ai_revenue_by_category(text, int) from public, anon;
grant execute on function public.ai_revenue_by_category(text, int) to authenticated;
