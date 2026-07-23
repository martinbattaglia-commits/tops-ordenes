-- 0183 · AI Copilot · Facturación agrupada POR CLIENTE (smoke humano 2026-07-06)
-- ─────────────────────────────────────────────────────────────────────────────
-- CONTEXTO: "¿Cuál fue el cliente que más facturó?" devolvía el vacío genérico
-- (auditoría ai_messages 2026-07-07 01:03 UTC: search_knowledge → 0 filas) aunque
-- customer_invoices tiene 29 facturas. ai_billing_summary (0182) solo suma por
-- PERÍODO; no agrupa por cliente. Esta RPC cierra ese hueco.
--
-- DETERMINISMO: el ranking/el top-1 lo calcula SQL (sum + order by desc + limit);
-- el modelo solo narra y cita. Singular ("EL cliente que más…") ⇒ p_limit=1.
--
-- SEGURIDAD (patrón INVOKER, igual que 0178/0181/0182):
--   · SECURITY INVOKER → RLS del caller (customer_invoices: admin/operaciones/
--     supervisor o cliente propio — un cliente B2B solo vería SU facturación).
--   · razón social pasa por ai_docs_redact. Sin CUIT/contacto.
--   · Read-only puro (SQL, STABLE). Ninguna escritura. NO toca tablas ni datos.
--
-- CRITERIO: facturas AUTORIZADO_ARCA, sin anuladas; fecha = coalesce(
-- fecha_autorizacion_arca, created_at); períodos: todo | mes_actual | ultimo_mes.
--
-- DATOS PILOTO (decisión Dirección 2026-07-07): los clientes de la etapa piloto
-- (p.ej. "CLIENTE TEST QA TOPS") son VÁLIDOS y computan normal. NO se filtra por
-- nombre: solo excluyen los campos estructurados (anulada, estado_arca). Si en el
-- futuro se necesita excluir datos de prueba, se hará con un flag estructurado
-- (is_demo / exclude_from_reporting), nunca por razón social.
--
-- IDEMPOTENTE: create or replace + revoke/grant repetibles.
-- APLICAR A MANO EN EL SQL EDITOR (G3) SOLO CON OK EXPLÍCITO. Rollback → md hermano.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ai_customer_revenue_overview(
  p_periodo text default 'todo',
  p_limit   int  default 10
) returns table (
  cliente text, total numeric, cantidad int, periodo text, desde date, hasta date, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with params as (
    select case coalesce(nullif(btrim(p_periodo), ''), 'todo')
      when 'mes_actual' then 'mes_actual'
      when 'ultimo_mes' then 'ultimo_mes'
      else 'todo' end as periodo
  ),
  fact as (
    select
      public.ai_docs_redact(coalesce(nullif(btrim(ci.razon_social), ''), 'Cliente')) as cliente,
      sum(ci.total) as total,
      count(*)::int as cantidad,
      min(coalesce(ci.fecha_autorizacion_arca, ci.created_at))::date as desde,
      max(coalesce(ci.fecha_autorizacion_arca, ci.created_at))::date as hasta
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
    group by 1
  )
  select
    f.cliente,
    f.total,
    f.cantidad,
    (select periodo from params) as periodo,
    f.desde,
    f.hasta,
    'Facturación por cliente · ' || f.cliente
      || ' · ARS ' || to_char(coalesce(f.total, 0), 'FM999G999G999G990D00')
      || ' · ' || f.cantidad || ' facturas autorizadas'
      || ' · período: ' || (select periodo from params)
      || ' (' || to_char(f.desde, 'YYYY-MM-DD') || ' → ' || to_char(f.hasta, 'YYYY-MM-DD') || ')'
      as detalle
  from fact f
  order by f.total desc nulls last
  limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;

revoke all on function public.ai_customer_revenue_overview(text, int) from public, anon;
grant execute on function public.ai_customer_revenue_overview(text, int) to authenticated;
