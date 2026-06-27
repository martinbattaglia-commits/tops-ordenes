-- ============================================================
-- Migración 0100 — Enriquecimiento fiscal de proveedores
--   + auditoría completa de retenciones
--   + RPC consolidado de contexto
-- ============================================================

-- ─── Campos fiscales en vendors ──────────────────────────────
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS concepto_ganancias   text
    CHECK (concepto_ganancias IN ('honorarios','mercaderias','servicios','alquileres','excluido')),
  ADD COLUMN IF NOT EXISTS exento_ganancias      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cert_exclusion_hasta  date,
  ADD COLUMN IF NOT EXISTS cond_iva              text;
-- cond_iva: 'RI' | 'Monotributista' | 'Exento' | 'No Responsable' | 'Consumidor Final'

COMMENT ON COLUMN public.vendors.concepto_ganancias   IS 'Concepto habitual de retención de Ganancias para este proveedor';
COMMENT ON COLUMN public.vendors.exento_ganancias      IS 'True si el proveedor está exento de retención de Ganancias';
COMMENT ON COLUMN public.vendors.cert_exclusion_hasta  IS 'Vigencia del certificado de exclusión de retención (RG AFIP)';
COMMENT ON COLUMN public.vendors.cond_iva              IS 'Condición frente al IVA: RI, Monotributista, Exento, etc.';

-- ─── Campos de auditoría en ganancias_retenciones ────────────
ALTER TABLE public.ganancias_retenciones
  ADD COLUMN IF NOT EXISTS normativa_version text,
  ADD COLUMN IF NOT EXISTS pct_monto         numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ganancias_retenciones.normativa_version IS
  'Versión de la normativa utilizada (vigente_desde de los params aplicados). Permite reconstruir el cálculo en auditoría.';
COMMENT ON COLUMN public.ganancias_retenciones.pct_monto IS
  'Monto resultante de aplicar el % sobre el excedente (honorarios). Desglose del cálculo de escala progresiva.';

-- ─── RPC: contexto completo de retención en una sola llamada ──
-- Devuelve todo lo que necesita el panel: vendor, config, escala,
-- acumulado mensual, alertas y versión de normativa.
CREATE OR REPLACE FUNCTION ap_get_retencion_context(
  p_vendor_id uuid,
  p_fecha     date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_vendor       jsonb;
  v_params       jsonb;
  v_escala       jsonb;
  v_acumulado    numeric;
  v_ret_existe   boolean;
  v_normativa_v  text;
  v_vigente_p    date;
  v_vigente_e    date;
BEGIN
  -- Vendor info
  SELECT jsonb_build_object(
    'id',                   id,
    'razon',                razon,
    'cuit',                 cuit,
    'concepto_ganancias',   concepto_ganancias,
    'exento_ganancias',     exento_ganancias,
    'cert_exclusion_hasta', cert_exclusion_hasta,
    'cond_iva',             cond_iva
  ) INTO v_vendor
  FROM public.vendors WHERE id = p_vendor_id;

  IF v_vendor IS NULL THEN
    RETURN jsonb_build_object('error', 'Proveedor no encontrado');
  END IF;

  -- Última vigencia de params aplicable a la fecha
  SELECT MAX(vigente_desde) INTO v_vigente_p
  FROM public.ganancias_retention_params
  WHERE vigente_desde <= p_fecha;

  v_vigente_p := COALESCE(v_vigente_p, (SELECT MIN(vigente_desde) FROM public.ganancias_retention_params));

  -- Parámetros configurables (min + alicuota por concepto)
  SELECT jsonb_object_agg(concepto || '_' || param_key, valor) INTO v_params
  FROM public.ganancias_retention_params
  WHERE vigente_desde = v_vigente_p;

  -- Última vigencia de escala
  SELECT MAX(vigente_desde) INTO v_vigente_e
  FROM public.ganancias_escala_honorarios
  WHERE vigente_desde <= p_fecha;

  v_vigente_e := COALESCE(v_vigente_e, (SELECT MIN(vigente_desde) FROM public.ganancias_escala_honorarios));

  -- Escala progresiva
  SELECT jsonb_agg(
    jsonb_build_object('desde', desde, 'hasta', hasta, 'fijo', fijo, 'pct', pct)
    ORDER BY desde
  ) INTO v_escala
  FROM public.ganancias_escala_honorarios
  WHERE vigente_desde = v_vigente_e;

  -- Acumulado mensual del proveedor en el mes de p_fecha
  SELECT COALESCE(SUM(gr.neto_gravado), 0) INTO v_acumulado
  FROM   public.ganancias_retenciones gr
  JOIN   public.supplier_invoices      si ON si.id = gr.supplier_invoice_id
  WHERE  si.vendor_id = p_vendor_id
  AND    date_trunc('month', gr.fecha_pago) = date_trunc('month', p_fecha);

  -- ¿Ya existe al menos una retención para este proveedor este mes?
  SELECT EXISTS (
    SELECT 1
    FROM   public.ganancias_retenciones gr
    JOIN   public.supplier_invoices      si ON si.id = gr.supplier_invoice_id
    WHERE  si.vendor_id = p_vendor_id
    AND    date_trunc('month', gr.fecha_pago) = date_trunc('month', p_fecha)
  ) INTO v_ret_existe;

  -- Versión de normativa: fecha de vigencia de los params + escala
  v_normativa_v := GREATEST(v_vigente_p, v_vigente_e)::text;

  RETURN jsonb_build_object(
    'vendor',               v_vendor,
    'params',               COALESCE(v_params,  '{}'::jsonb),
    'escala',               COALESCE(v_escala,  '[]'::jsonb),
    'acumulado_previo',     v_acumulado,
    'normativa_version',    v_normativa_v,
    'retencion_existente',  v_ret_existe
  );
END;
$$;

-- ─── RPC: save concepto al proveedor ─────────────────────────
CREATE OR REPLACE FUNCTION ap_set_vendor_concepto_ganancias(
  p_vendor_id uuid,
  p_concepto  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_concepto NOT IN ('honorarios','mercaderias','servicios','alquileres','excluido') THEN
    RAISE EXCEPTION 'Concepto inválido: %', p_concepto;
  END IF;
  UPDATE public.vendors SET concepto_ganancias = p_concepto WHERE id = p_vendor_id;
END;
$$;

-- ─── RPC: upsert retención (versión 2, con campos de auditoría) ─
CREATE OR REPLACE FUNCTION ap_upsert_retencion_ganancias(
  p_supplier_invoice_id   uuid,
  p_concepto              text,
  p_tipo_comprobante      text,
  p_fecha_pago            date,
  p_neto_gravado          numeric,
  p_total_factura         numeric,
  p_acumulado_previo      numeric,
  p_acumulado_total       numeric,
  p_minimo_no_sujeto      numeric,
  p_base_imponible        numeric,
  p_excedente             numeric,
  p_alicuota              numeric,
  p_fijo_escala           numeric,
  p_pct_monto             numeric,
  p_retencion             numeric,
  p_neto_a_pagar          numeric,
  p_corresponde           boolean,
  p_motivo                text,
  p_tramo_txt             text,
  p_metodo                text,
  p_observaciones         text,
  p_normativa_version     text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.ganancias_retenciones (
    supplier_invoice_id, concepto, tipo_comprobante, fecha_pago,
    neto_gravado, total_factura, acumulado_previo, acumulado_total,
    minimo_no_sujeto, base_imponible, excedente, alicuota, fijo_escala, pct_monto,
    retencion, neto_a_pagar, corresponde, motivo, tramo_txt, metodo,
    observaciones, normativa_version, created_by, updated_at
  ) VALUES (
    p_supplier_invoice_id, p_concepto, p_tipo_comprobante, p_fecha_pago,
    p_neto_gravado, p_total_factura, p_acumulado_previo, p_acumulado_total,
    p_minimo_no_sujeto, p_base_imponible, p_excedente, p_alicuota, p_fijo_escala, p_pct_monto,
    p_retencion, p_neto_a_pagar, p_corresponde, p_motivo, p_tramo_txt, p_metodo,
    p_observaciones, p_normativa_version, auth.uid(), now()
  )
  ON CONFLICT (supplier_invoice_id) DO UPDATE SET
    concepto          = EXCLUDED.concepto,
    tipo_comprobante  = EXCLUDED.tipo_comprobante,
    fecha_pago        = EXCLUDED.fecha_pago,
    neto_gravado      = EXCLUDED.neto_gravado,
    total_factura     = EXCLUDED.total_factura,
    acumulado_previo  = EXCLUDED.acumulado_previo,
    acumulado_total   = EXCLUDED.acumulado_total,
    minimo_no_sujeto  = EXCLUDED.minimo_no_sujeto,
    base_imponible    = EXCLUDED.base_imponible,
    excedente         = EXCLUDED.excedente,
    alicuota          = EXCLUDED.alicuota,
    fijo_escala       = EXCLUDED.fijo_escala,
    pct_monto         = EXCLUDED.pct_monto,
    retencion         = EXCLUDED.retencion,
    neto_a_pagar      = EXCLUDED.neto_a_pagar,
    corresponde       = EXCLUDED.corresponde,
    motivo            = EXCLUDED.motivo,
    tramo_txt         = EXCLUDED.tramo_txt,
    metodo            = EXCLUDED.metodo,
    observaciones     = EXCLUDED.observaciones,
    normativa_version = EXCLUDED.normativa_version,
    updated_at        = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
