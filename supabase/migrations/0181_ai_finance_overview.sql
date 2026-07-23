-- 0181 · AI Copilot · RPCs read-only de facturación y compras (fix/f5-2)
-- ─────────────────────────────────────────────────────────────────────────────
-- CONTEXTO (auditoría 2026-07-06): el Copilot no tenía NINGUNA tool ni proyección
-- para facturas emitidas (customer_invoices, 29 filas), facturas de proveedor
-- (supplier_invoices, 16), órdenes de compra (purchase_orders, 24) ni proveedores
-- (vendors). "cuál fue la última factura/OC/proveedor" caía en search_knowledge
-- (que solo indexa compliance+contratos) → NO_EVIDENCE. Estas 4 RPC cierran el hueco.
--
-- DETERMINISMO (regla del pedido: "SQL primero, IA después"): el "último/recientes"
-- lo calcula la RPC (order by fecha desc + limit), NO el modelo. El modelo solo
-- elige el `mode` y redacta citando la fuente.
--
-- SEGURIDAD (patrón INVOKER, igual que ai_contracts_overview/ai_compliance_pending):
--   • SECURITY INVOKER → heredan la RLS de la tabla leída. Verificado 2026-07-06:
--       - customer_invoices: SELECT para current_role() ∈ (admin,operaciones,supervisor)
--         o cliente propio. Los 6 pilotos son staff (admin/operaciones) → leen.
--       - supplier_invoices / purchase_orders / vendors: SELECT para authenticated.
--   • Solo campos de NEGOCIO. NUNCA CUIT, teléfono, email, CBU ni domicilio. El texto
--     libre pasa por ai_docs_redact (doble red; el engine re-redacta PII igual).
--   • Read-only puro (SQL, STABLE). Ninguna escritura.
--
-- IDEMPOTENTE: create or replace + revoke/grant repetibles. NO crea tablas. NO backfill.
-- Aditiva y reversible → ver ROLLBACK_0181_ai_finance_overview.md.
-- APLICAR A MANO EN EL SQL EDITOR (G3). No ejecutar db push.
-- ─────────────────────────────────────────────────────────────────────────────

-- =========================================================================
-- 1. ai_customer_invoices_overview — facturas EMITIDAS a clientes (ventas)
--    modes: ultima | recientes | por_cliente | todas
-- =========================================================================
create or replace function public.ai_customer_invoices_overview(
  p_mode  text default 'recientes',
  p_query text default null,
  p_limit int  default 30
) returns table (
  public_id text, razon_social text, total numeric, fecha date, estado text, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select
    btrim(
      coalesce(ci.tipo_comprobante::text, '') || ' ' ||
      coalesce(ci.punto_venta::text, '') || '-' || coalesce(ci.numero_comprobante::text, '')
    ) as public_id,
    public.ai_docs_redact(coalesce(ci.razon_social, 'Cliente')) as razon_social,
    ci.total,
    coalesce(ci.fecha_autorizacion_arca::date, ci.created_at::date) as fecha,
    ci.estado_arca::text as estado,
    public.ai_docs_redact(concat_ws(' · ',
      'Factura emitida',
      nullif(btrim(ci.tipo_comprobante::text), ''),
      'cliente ' || coalesce(nullif(btrim(ci.razon_social), ''), 's/d'),
      'total ' || coalesce(ci.moneda, 'ARS') || ' ' || to_char(coalesce(ci.total, 0), 'FM999G999G990D00'),
      'estado ARCA ' || coalesce(ci.estado_arca::text, 's/d'),
      case when ci.cae is not null then 'CAE emitido' end,
      'emitida ' || to_char(coalesce(ci.fecha_autorizacion_arca, ci.created_at), 'YYYY-MM-DD')
    )) as detalle
  from public.customer_invoices ci
  where coalesce(ci.anulada, false) = false
    and (
      p_query is null or btrim(p_query) = ''
      or ci.razon_social ilike '%' || btrim(p_query) || '%'
      or coalesce(ci.numero_comprobante::text, '') ilike '%' || btrim(p_query) || '%'
    )
    and case coalesce(nullif(btrim(p_mode), ''), 'recientes')
      when 'por_cliente' then (p_query is not null and btrim(p_query) <> '')
      else true
    end
  order by coalesce(ci.fecha_autorizacion_arca, ci.created_at) desc
  limit case when coalesce(nullif(btrim(p_mode), ''), 'recientes') = 'ultima'
             then 1 else least(greatest(coalesce(p_limit, 30), 1), 50) end
$$;

revoke all on function public.ai_customer_invoices_overview(text, text, int) from public, anon;
grant execute on function public.ai_customer_invoices_overview(text, text, int) to authenticated;

-- =========================================================================
-- 2. ai_supplier_invoices_overview — facturas de PROVEEDORES (compras)
--    modes: ultima | recientes | por_proveedor | pendientes_aprobacion | todas
-- =========================================================================
create or replace function public.ai_supplier_invoices_overview(
  p_mode  text default 'recientes',
  p_query text default null,
  p_limit int  default 30
) returns table (
  public_id text, proveedor text, total numeric, fecha date, estado text, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select
    btrim(coalesce(si.tipo_comprobante::text, '') || ' ' || coalesce(si.numero, '')) as public_id,
    public.ai_docs_redact(coalesce(v.razon, 'Proveedor')) as proveedor,
    si.total,
    si.fecha_emision as fecha,
    si.status::text as estado,
    public.ai_docs_redact(concat_ws(' · ',
      'Factura de proveedor',
      nullif(btrim(si.tipo_comprobante::text), ''),
      'proveedor ' || coalesce(nullif(btrim(v.razon), ''), 's/d'),
      'total ' || coalesce(si.moneda, 'ARS') || ' ' || to_char(coalesce(si.total, 0), 'FM999G999G990D00'),
      'estado ' || coalesce(si.status::text, 's/d'),
      'aprobación ' || coalesce(si.approval_status::text, 's/d'),
      case when si.fecha_emision is not null then 'emitida ' || to_char(si.fecha_emision, 'YYYY-MM-DD') end
    )) as detalle
  from public.supplier_invoices si
  left join public.vendors v on v.id = si.vendor_id
  where (
      p_query is null or btrim(p_query) = ''
      or v.razon ilike '%' || btrim(p_query) || '%'
      or coalesce(si.numero, '') ilike '%' || btrim(p_query) || '%'
    )
    and case coalesce(nullif(btrim(p_mode), ''), 'recientes')
      when 'pendientes_aprobacion' then (si.approval_status::text is distinct from 'aprobada')
      when 'por_proveedor' then (p_query is not null and btrim(p_query) <> '')
      else true
    end
  order by si.fecha_emision desc nulls last
  limit case when coalesce(nullif(btrim(p_mode), ''), 'recientes') = 'ultima'
             then 1 else least(greatest(coalesce(p_limit, 30), 1), 50) end
$$;

revoke all on function public.ai_supplier_invoices_overview(text, text, int) from public, anon;
grant execute on function public.ai_supplier_invoices_overview(text, text, int) to authenticated;

-- =========================================================================
-- 3. ai_purchase_orders_overview — órdenes de compra
--    modes: ultima | recientes | por_proveedor | todas
-- =========================================================================
create or replace function public.ai_purchase_orders_overview(
  p_mode  text default 'recientes',
  p_query text default null,
  p_limit int  default 30
) returns table (
  public_id text, proveedor text, total numeric, fecha date, estado text, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select
    coalesce(nullif(btrim(po.public_id), ''), 'OC#' || left(po.id::text, 8)) as public_id,
    public.ai_docs_redact(coalesce(v.razon, 'Proveedor')) as proveedor,
    po.total,
    po.date::date as fecha,
    po.status::text as estado,
    public.ai_docs_redact(concat_ws(' · ',
      'Orden de compra',
      'proveedor ' || coalesce(nullif(btrim(v.razon), ''), 's/d'),
      'total ARS ' || to_char(coalesce(po.total, 0), 'FM999G999G990D00'),
      'estado ' || coalesce(po.status::text, 's/d'),
      case when po.date is not null then to_char(po.date, 'YYYY-MM-DD') end
    )) as detalle
  from public.purchase_orders po
  left join public.vendors v on v.id = po.vendor_id
  where (
      p_query is null or btrim(p_query) = ''
      or v.razon ilike '%' || btrim(p_query) || '%'
      or coalesce(po.public_id, '') ilike '%' || btrim(p_query) || '%'
    )
    and case coalesce(nullif(btrim(p_mode), ''), 'recientes')
      when 'por_proveedor' then (p_query is not null and btrim(p_query) <> '')
      else true
    end
  order by po.date desc nulls last
  limit case when coalesce(nullif(btrim(p_mode), ''), 'recientes') = 'ultima'
             then 1 else least(greatest(coalesce(p_limit, 30), 1), 50) end
$$;

revoke all on function public.ai_purchase_orders_overview(text, text, int) from public, anon;
grant execute on function public.ai_purchase_orders_overview(text, text, int) to authenticated;

-- =========================================================================
-- 4. ai_suppliers_overview — proveedores (vendors); sin query = más recientes
--    (el primero = último proveedor cargado). Solo razón social/categoría/estado.
-- =========================================================================
create or replace function public.ai_suppliers_overview(
  p_query text default null,
  p_limit int  default 15
) returns table (
  public_id text, razon text, categoria text, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select
    'PROV#' || left(v.id::text, 8) as public_id,
    public.ai_docs_redact(coalesce(v.razon, 'Proveedor')) as razon,
    coalesce(v.categoria::text, '') as categoria,
    public.ai_docs_redact(concat_ws(' · ',
      'Proveedor',
      coalesce(nullif(btrim(v.razon), ''), 's/d'),
      case when nullif(btrim(v.categoria::text), '') is not null then 'categoría ' || v.categoria::text end,
      case when coalesce(v.active, true) then 'activo' else 'inactivo' end
    )) as detalle
  from public.vendors v
  where (
      p_query is null or btrim(p_query) = ''
      or v.razon ilike '%' || btrim(p_query) || '%'
      or coalesce(v.categoria::text, '') ilike '%' || btrim(p_query) || '%'
    )
  order by v.created_at desc nulls last
  limit least(greatest(coalesce(p_limit, 15), 1), 50)
$$;

revoke all on function public.ai_suppliers_overview(text, int) from public, anon;
grant execute on function public.ai_suppliers_overview(text, int) to authenticated;
