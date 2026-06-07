-- =========================================================================
-- 0058_ap_rpcs.sql — ERP-B1 · RPCs de Cuentas a Pagar (Gate 3)
--
-- RPC-First (espejo de tesoreria_register_payment, 0054:144): security definer
-- + has_permission(...) + set_config('ap.via_rpc','on') + lock FOR UPDATE en
-- transiciones. La cabecera supplier_invoices se RECONCILIA desde el detalle
-- (vat_lines + other_taxes) — el detalle es la fuente de verdad fiscal.
--
-- Identidad financiera (validación dura, no badge):
--   neto       = Σ vat_lines.base_neto
--   iva        = Σ vat_lines.importe_iva
--   percepciones = Σ other_taxes WHERE tax_kind LIKE 'PERCEPCION_%'
--   tributos     = Σ other_taxes WHERE tax_kind IN ('IMPUESTO_INTERNO','OTRO')
--   total      = neto + importe_no_gravado + importe_exento + iva + percepciones + tributos
--
-- NATURALEZA: ADITIVA. Lee (no modifica) payment_allocations/supplier_payments
-- en ap_void. No toca tesoreria_register_payment ni supplier_open_items.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. ap_create_supplier_invoice — alta con detalle fiscal, reconciliada
-- -------------------------------------------------------------------------
create or replace function public.ap_create_supplier_invoice(
  p_header      jsonb,
  p_vat_lines   jsonb default '[]'::jsonb,
  p_other_taxes jsonb default '[]'::jsonb,
  p_items       jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_invoice_id uuid; v_public_id text;
  v_neto numeric(14,2); v_iva numeric(14,2);
  v_percep numeric(14,2); v_tributos numeric(14,2);
  v_no_grav numeric(14,2); v_exento numeric(14,2); v_total numeric(14,2);
  v_total_claim numeric;
  v_vendor uuid; v_numero text;
begin
  perform set_config('ap.via_rpc', 'on', true);

  if not public.has_permission('cuentas_pagar.create') then
    raise exception 'FORBIDDEN: requiere permiso cuentas_pagar.create' using errcode = '42501';
  end if;

  v_vendor := nullif(p_header->>'vendor_id','')::uuid;
  v_numero := nullif(p_header->>'numero','');
  if v_vendor is null then raise exception 'VENDOR_REQUIRED' using errcode = 'check_violation'; end if;
  if v_numero is null then raise exception 'NUMERO_REQUIRED' using errcode = 'check_violation'; end if;

  -- Totales derivados del detalle (fuente de verdad)
  select coalesce(sum((e->>'base_neto')::numeric), 0),
         coalesce(sum((e->>'importe_iva')::numeric), 0)
    into v_neto, v_iva
  from jsonb_array_elements(coalesce(p_vat_lines, '[]'::jsonb)) e;

  select coalesce(sum((e->>'importe')::numeric) filter (where (e->>'tax_kind') like 'PERCEPCION_%'), 0),
         coalesce(sum((e->>'importe')::numeric) filter (where (e->>'tax_kind') in ('IMPUESTO_INTERNO','OTRO')), 0)
    into v_percep, v_tributos
  from jsonb_array_elements(coalesce(p_other_taxes, '[]'::jsonb)) e;

  v_no_grav := coalesce(nullif(p_header->>'importe_no_gravado','')::numeric, 0);
  v_exento  := coalesce(nullif(p_header->>'importe_exento','')::numeric, 0);
  v_total   := v_neto + v_no_grav + v_exento + v_iva + v_percep + v_tributos;

  -- Validación dura: si el cliente envía total, debe reconciliar
  v_total_claim := nullif(p_header->>'total','')::numeric;
  if v_total_claim is not null and abs(v_total_claim - v_total) > 0.02 then
    raise exception 'TOTAL_MISMATCH: total declarado % <> derivado %', v_total_claim, v_total
      using errcode = 'check_violation';
  end if;

  -- Cabecera (public_id/short_id por trigger 0014; approval_status default 'cargada')
  begin
    insert into public.supplier_invoices(
      vendor_id, cost_center_id, purchase_order_id, tipo_comprobante, punto_venta, numero, cae,
      fecha_emision, fecha_vencimiento, moneda,
      neto, importe_no_gravado, importe_exento, iva, percepciones, tributos, total,
      observ, pdf_url, created_by
    ) values (
      v_vendor,
      nullif(p_header->>'cost_center_id','')::uuid,
      nullif(p_header->>'purchase_order_id','')::uuid,
      coalesce(nullif(p_header->>'tipo_comprobante','')::public.supplier_comprobante_t, 'FACTURA_A'),
      coalesce(nullif(p_header->>'punto_venta','')::int, 1),
      v_numero,
      nullif(p_header->>'cae',''),
      coalesce(nullif(p_header->>'fecha_emision','')::date, current_date),
      nullif(p_header->>'fecha_vencimiento','')::date,
      coalesce(nullif(p_header->>'moneda',''), 'ARS'),
      v_neto, v_no_grav, v_exento, v_iva, v_percep, v_tributos, v_total,
      nullif(p_header->>'observ',''),
      nullif(p_header->>'pdf_url',''),
      v_uid
    )
    returning id, public_id into v_invoice_id, v_public_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_INVOICE: ya existe ese comprobante para el proveedor (pv/nro)'
      using errcode = 'unique_violation';
  end;

  -- Detalle (el guard ap.via_rpc ya está 'on')
  insert into public.supplier_invoice_vat_lines(supplier_invoice_id, alic_iva_id, alicuota_iva, base_neto, importe_iva)
  select v_invoice_id, (e->>'alic_iva_id')::smallint, (e->>'alicuota_iva')::numeric,
         coalesce((e->>'base_neto')::numeric, 0), coalesce((e->>'importe_iva')::numeric, 0)
  from jsonb_array_elements(coalesce(p_vat_lines, '[]'::jsonb)) e;

  insert into public.supplier_invoice_other_taxes(supplier_invoice_id, tax_kind, jurisdiction, base, alicuota, importe)
  select v_invoice_id, (e->>'tax_kind')::public.ap_other_tax_t, nullif(e->>'jurisdiction',''),
         coalesce((e->>'base')::numeric, 0), nullif(e->>'alicuota','')::numeric, coalesce((e->>'importe')::numeric, 0)
  from jsonb_array_elements(coalesce(p_other_taxes, '[]'::jsonb)) e;

  insert into public.supplier_invoice_items(supplier_invoice_id, descripcion, cantidad, precio_unitario, alic_iva_id, importe_neto, importe_iva, importe_total, orden)
  select v_invoice_id, e->>'descripcion', coalesce((e->>'cantidad')::numeric, 1), coalesce((e->>'precio_unitario')::numeric, 0),
         coalesce((e->>'alic_iva_id')::smallint, 5), coalesce((e->>'importe_neto')::numeric, 0),
         coalesce((e->>'importe_iva')::numeric, 0), coalesce((e->>'importe_total')::numeric, 0),
         coalesce((e->>'orden')::int, 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e;

  insert into public.supplier_invoice_audit(supplier_invoice_id, user_id, action, from_status, to_status, note)
  values (v_invoice_id, v_uid, 'crear', null, 'cargada', nullif(p_header->>'observ',''));

  return jsonb_build_object(
    'invoice_id', v_invoice_id, 'public_id', v_public_id,
    'neto', v_neto, 'iva', v_iva, 'percepciones', v_percep, 'tributos', v_tributos, 'total', v_total
  );
end; $$;

-- -------------------------------------------------------------------------
-- 2. Helper interno de transición (lock + validación + audit)
-- -------------------------------------------------------------------------
create or replace function public.ap__transition(
  p_invoice_id uuid,
  p_from public.ap_approval_status_t[],
  p_to   public.ap_approval_status_t,
  p_action text,
  p_note text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_cur public.ap_approval_status_t; v_uid uuid := auth.uid();
begin
  select approval_status into v_cur from public.supplier_invoices where id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND: %', p_invoice_id using errcode = 'check_violation'; end if;
  if not (v_cur = any(p_from)) then
    raise exception 'INVALID_TRANSITION: % desde % no permitido', p_action, v_cur using errcode = 'check_violation';
  end if;
  update public.supplier_invoices set approval_status = p_to where id = p_invoice_id;
  insert into public.supplier_invoice_audit(supplier_invoice_id, user_id, action, from_status, to_status, note)
  values (p_invoice_id, v_uid, p_action, v_cur, p_to, p_note);
end; $$;

-- -------------------------------------------------------------------------
-- 3. Transiciones públicas
-- -------------------------------------------------------------------------
create or replace function public.ap_submit_for_review(p_invoice_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('cuentas_pagar.edit') then
    raise exception 'FORBIDDEN: requiere permiso cuentas_pagar.edit' using errcode = '42501'; end if;
  perform public.ap__transition(p_invoice_id, array['cargada']::public.ap_approval_status_t[], 'en_revision', 'enviar_revision', p_note);
  return jsonb_build_object('invoice_id', p_invoice_id, 'approval_status', 'en_revision');
end; $$;

create or replace function public.ap_approve(p_invoice_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('cuentas_pagar.sign') then
    raise exception 'FORBIDDEN: requiere permiso cuentas_pagar.sign' using errcode = '42501'; end if;
  perform public.ap__transition(p_invoice_id, array['cargada','en_revision']::public.ap_approval_status_t[], 'aprobada', 'aprobar', p_note);
  return jsonb_build_object('invoice_id', p_invoice_id, 'approval_status', 'aprobada');
end; $$;

create or replace function public.ap_reopen(p_invoice_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('cuentas_pagar.sign') then
    raise exception 'FORBIDDEN: requiere permiso cuentas_pagar.sign' using errcode = '42501'; end if;
  perform public.ap__transition(p_invoice_id, array['aprobada']::public.ap_approval_status_t[], 'en_revision', 'reabrir', p_note);
  return jsonb_build_object('invoice_id', p_invoice_id, 'approval_status', 'en_revision');
end; $$;

-- ap_void: anula (lógico). Bloquea si hay pagos confirmados imputados.
-- Espeja status='anulada' (legacy) para que supplier_open_items (ERP-A) la excluya.
create or replace function public.ap_void(p_invoice_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur public.ap_approval_status_t; v_paid numeric; v_uid uuid := auth.uid();
begin
  if not public.has_permission('cuentas_pagar.delete') then
    raise exception 'FORBIDDEN: requiere permiso cuentas_pagar.delete' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'VOID_REASON_REQUIRED' using errcode = 'check_violation'; end if;

  select approval_status into v_cur from public.supplier_invoices where id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND: %', p_invoice_id using errcode = 'check_violation'; end if;
  if v_cur = 'anulada' then raise exception 'ALREADY_VOID' using errcode = 'check_violation'; end if;

  -- Lectura (no modificación) de ERP-A: no anular si tiene pagos confirmados imputados
  select coalesce(sum(pa.amount), 0) into v_paid
  from public.payment_allocations pa
  join public.supplier_payments sp on sp.id = pa.payment_id
  where pa.supplier_invoice_id = p_invoice_id and sp.status = 'confirmado';
  if v_paid > 0 then
    raise exception 'INVOICE_HAS_PAYMENTS: factura con pagos confirmados (%), anular el pago primero', v_paid
      using errcode = 'check_violation';
  end if;

  update public.supplier_invoices
    set approval_status = 'anulada',
        status = 'anulada'   -- compat ERP-A (supplier_open_items filtra status<>'anulada')
  where id = p_invoice_id;

  insert into public.supplier_invoice_audit(supplier_invoice_id, user_id, action, from_status, to_status, note)
  values (p_invoice_id, v_uid, 'anular', v_cur, 'anulada', p_reason);

  return jsonb_build_object('invoice_id', p_invoice_id, 'approval_status', 'anulada');
end; $$;

-- -------------------------------------------------------------------------
-- 4. GRANTS (RPC security definer + has_permission; expuestas a authenticated)
-- -------------------------------------------------------------------------
grant execute on function public.ap_create_supplier_invoice(jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.ap_submit_for_review(uuid, text) to authenticated;
grant execute on function public.ap_approve(uuid, text) to authenticated;
grant execute on function public.ap_reopen(uuid, text) to authenticated;
grant execute on function public.ap_void(uuid, text) to authenticated;
-- ap__transition es interno: NO se otorga a authenticated.
revoke all on function public.ap__transition(uuid, public.ap_approval_status_t[], public.ap_approval_status_t, text, text) from public;

notify pgrst, 'reload schema';
