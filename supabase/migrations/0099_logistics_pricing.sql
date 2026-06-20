-- =========================================================================
-- 0099_logistics_pricing.sql — Fase 13.E · Pricing de órdenes logísticas
--   (SIMULACIÓN read-only; honesta sobre datos faltantes)
--
-- DIAGNÓSTICO: logistics_orders no tiene client_id (solo client_name texto), ni
-- servicio asociado, ni tarifa, ni precio. Por eso el motor NO inventa datos:
-- detecta qué falta y devuelve "no priceable" con motivos. Es la base para pasar
-- de "safe partial" a facturación automática cuando se agregue el mapeo
-- orden→cliente y orden→servicio.
--
-- NATURALEZA: ADITIVA, read-only (STABLE). No escribe, no factura, no contabiliza.
-- Requiere 0096/0097.
-- =========================================================================

create or replace function public.billing_price_logistics_order(
  p_order_id uuid,
  p_period_start date default null,
  p_period_end date default null,
  p_service_id uuid default null   -- opcional: servicio sugerido por el operador
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  lo public.logistics_orders;
  v_client_matches int; v_client_id uuid; v_client_razon text;
  v_qty numeric; v_rate_id uuid; v_price numeric; v_vat numeric; v_cc uuid;
  v_net numeric; v_vat_amt numeric;
  v_reasons jsonb := '[]'::jsonb; v_warnings jsonb := '[]'::jsonb;
  v_priceable boolean;
begin
  if not (public.has_permission('contabilidad.view') or public.has_permission('comercial.view')
          or public.current_role() in ('admin','operaciones','supervisor')) then
    raise exception 'FORBIDDEN: requiere lectura' using errcode='42501';
  end if;

  select * into lo from public.logistics_orders where id = p_order_id;
  if lo.id is null then
    raise exception 'ORDER_NOT_FOUND: %', p_order_id using errcode='no_data_found';
  end if;

  -- Cliente: NO hay client_id; se intenta resolver por client_name (texto) → advertencia.
  select count(*) into v_client_matches from public.clients cl where lower(cl.razon) = lower(lo.client_name);
  if v_client_matches = 1 then
    select id, razon into v_client_id, v_client_razon from public.clients cl where lower(cl.razon) = lower(lo.client_name);
    v_warnings := v_warnings || jsonb_build_array('cliente resuelto por nombre (no por client_id): '||coalesce(v_client_razon,''));
  else
    v_reasons := v_reasons || jsonb_build_array(
      case when v_client_matches = 0 then 'sin cliente: client_name "'||coalesce(lo.client_name,'')||'" no coincide con ningún cliente'
           else 'cliente ambiguo: '||v_client_matches||' clientes coinciden con "'||coalesce(lo.client_name,'')||'"' end);
  end if;

  -- Servicio: logistics_orders no tiene servicio asociado. Se usa el sugerido (p_service_id) si se pasó.
  if p_service_id is null then
    v_reasons := v_reasons || jsonb_build_array('sin servicio: la orden no tiene servicio facturable mapeado (pasar p_service_id para simular)');
  elsif not exists (select 1 from public.billable_services where id = p_service_id and is_active) then
    v_reasons := v_reasons || jsonb_build_array('servicio inválido o inactivo');
  end if;

  -- Cantidad: Σ de cantidades de las líneas (sin unidad fiscal confiable → advertencia).
  select coalesce(sum(quantity_requested), 0) into v_qty from public.logistics_order_items where order_id = p_order_id;
  if v_qty <= 0 then
    v_reasons := v_reasons || jsonb_build_array('sin cantidad: la orden no tiene líneas con cantidad');
  else
    v_warnings := v_warnings || jsonb_build_array('cantidad = Σ líneas ('||v_qty||') — verificar unidad vs. servicio');
  end if;

  -- Tarifa: requiere cliente + servicio resueltos.
  if v_client_id is not null and p_service_id is not null then
    v_rate_id := public.customer_service_rate_for(v_client_id, p_service_id, coalesce(p_period_start, current_date));
    if v_rate_id is null then
      v_reasons := v_reasons || jsonb_build_array('sin tarifa: no hay customer_service_rate vigente para el cliente/servicio');
    else
      select unit_price, vat_rate, cost_center_id into v_price, v_vat, v_cc from public.customer_service_rates where id = v_rate_id;
    end if;
  end if;

  v_priceable := (jsonb_array_length(v_reasons) = 0);

  if v_priceable then
    v_net := round(v_qty * v_price, 2);
    v_vat_amt := round(v_net * coalesce(v_vat,21) / 100, 2);
  end if;

  return jsonb_build_object(
    'ok', true,
    'dry_run', true,
    'order_id', p_order_id,
    'public_id', lo.public_id,
    'priceable', v_priceable,
    'reasons', v_reasons,
    'warnings', v_warnings,
    'client_name', lo.client_name,
    'client_id', v_client_id,
    'client_matches', v_client_matches,
    'service_id', p_service_id,
    'quantity', v_qty,
    'rate_id', v_rate_id,
    'unit_price', v_price,
    'net_amount', v_net,
    'vat_rate', v_vat,
    'vat_amount', v_vat_amt,
    'gross_amount', case when v_priceable then v_net + v_vat_amt else null end,
    'cost_center_id', v_cc,
    'nota', 'Simulación READ-ONLY: no factura, no contabiliza, no modifica datos.'
  );
end; $$;
revoke all on function public.billing_price_logistics_order(uuid,date,date,uuid) from public;
grant execute on function public.billing_price_logistics_order(uuid,date,date,uuid) to authenticated;

-- -------------------------------------------------------------------------
-- Vista de clasificación priceable / no priceable (sin servicio mapeado, la
-- mayoría cae en "no priceable" — refleja la realidad del dato).
-- -------------------------------------------------------------------------
create or replace view public.v_logistics_orders_pricing
with (security_invoker = true) as
select
  lo.id as order_id, lo.public_id, lo.client_name, lo.status, lo.created_at::date as fecha,
  (select count(*) from public.clients cl where lower(cl.razon) = lower(lo.client_name)) as client_matches,
  (select count(*) from public.logistics_order_items i where i.order_id = lo.id) as items_count,
  -- Sin mapeo orden→servicio/tarifa, no es priceable automáticamente.
  false as priceable,
  trim(both ' ,' from
    case when (select count(*) from public.clients cl where lower(cl.razon) = lower(lo.client_name)) <> 1
         then 'cliente no resuelto, ' else '' end ||
    'sin servicio/tarifa mapeada'
  ) as motivo_no_priceable
from public.logistics_orders lo
where lo.active = true and lo.status in ('despachado','entregado');

comment on view public.v_logistics_orders_pricing is
  'Clasificación de órdenes logísticas para pricing. Hoy priceable=false (falta mapeo orden→cliente y orden→servicio/tarifa). Usar billing_price_logistics_order(order, ..., p_service_id) para simular con un servicio sugerido.';

grant select on public.v_logistics_orders_pricing to authenticated;

notify pgrst, 'reload schema';
